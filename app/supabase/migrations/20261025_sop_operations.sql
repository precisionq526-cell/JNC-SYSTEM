-- SOP alignment. Apply after 20261012_live_data_integrity.sql. No customer records are deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sop_settings (
  id integer PRIMARY KEY CHECK(id=1), policy jsonb NOT NULL, pricing jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.profiles(id)
);
INSERT INTO public.sop_settings(id,policy,pricing) VALUES(1,
  '{"intakeState":"online","enforceHours":true,"openingMinute":480,"closingMinute":1080,"workingDays":[1,2,3,4,5,6],"completionBufferMinutes":2,"dispatchMode":"walkins-first","unpaidTimeoutMinutes":15,"uncollectedHours":48}',
  '{"rates":{"Short":{"bw":3,"accents":4,"images":10},"A4":{"bw":3,"accents":4,"images":12},"Long":{"bw":4,"accents":5,"images":15},"Legal":{"bw":4,"accents":5,"images":15}},"finishing":{},"studentDiscounts":{"textLow":1,"textHigh":0.5,"imageLow":2,"imageHigh":1}}')
  ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.sop_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sop_settings_admin ON public.sop_settings;
CREATE POLICY sop_settings_admin ON public.sop_settings FOR SELECT TO authenticated USING(public.app_is_admin());
GRANT ALL ON public.sop_settings TO service_role;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK(status IN('pending','queued','processing','finishing','completed','collected','cancelled','failed'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pricing_quote jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS student_status text NOT NULL DEFAULT 'none' CHECK(student_status IN('none','pending','approved','rejected'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS student_proof jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ticket_released_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS finishing_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collected_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS disposal_recorded_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS setup_duration_minutes numeric NOT NULL DEFAULT 0 CHECK(setup_duration_minutes>=0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS offline_ticket_number text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_offline_ticket_unique ON public.orders(offline_ticket_number) WHERE offline_ticket_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.kiosk_data_contract_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 3 $$;
REVOKE ALL ON FUNCTION public.kiosk_data_contract_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_data_contract_version() TO service_role;

CREATE OR REPLACE FUNCTION public.sop_payment_record(notes text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF left(coalesce(notes,''),15)<>'JNC_PAYMENT_V1:' THEN RETURN '{}'::jsonb; END IF;
  RETURN substring(notes FROM 16)::jsonb;
EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.sop_payment_record(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sop_payment_record(text) TO service_role;
CREATE OR REPLACE FUNCTION public.sop_order_held(o public.orders) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN r.student_status IN ('pending','rejected') THEN true
    WHEN r.is_paid THEN false
    WHEN coalesce(r.payment_method,public.sop_payment_record(r.customer_notes)->>'method','cash') <> 'cash' THEN true
    ELSE coalesce((r.service_options->>'Transaction Type') = 'schedule',false)
  END
  FROM (SELECT (o).*) AS r;
$$;
REVOKE ALL ON FUNCTION public.sop_order_held(public.orders) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sop_order_held(public.orders) TO service_role;

-- Preserve the existing atomic submission implementation; the wrapper validates the SOP contract.
DO $$ BEGIN
  IF to_regprocedure('public.commit_order_submission_v2(uuid,uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.commit_order_submission(uuid,uuid,jsonb,jsonb) RENAME TO commit_order_submission_v2;
  END IF;
  IF to_regprocedure('public.transition_queue_order_v2(uuid,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.transition_queue_order(uuid,text,uuid) RENAME TO transition_queue_order_v2;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.commit_order_submission_v2(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.transition_queue_order_v2(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.commit_order_submission(p_submission_key uuid,p_order_id uuid,p_meta jsonb,p_files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE settings public.sop_settings%ROWTYPE; result jsonb; quote jsonb; options jsonb; legacy_meta jsonb;
  item jsonb; fee jsonb; category text; paper text; rate numeric; deduction numeric; price numeric:=0;
  copies integer; clock_time timestamp; minutes integer; student boolean; method text; payment jsonb; accepted_at timestamptz; replay boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_key::text,0));
  IF EXISTS(SELECT 1 FROM public.orders WHERE submission_key=p_submission_key) THEN
    IF p_meta->>'offlineTicketNumber' IS NOT NULL THEN
      IF p_meta->>'offlineTicketNumber' <> 'LAN-'||to_char((p_meta->>'offlineSubmittedAt')::timestamptz AT TIME ZONE 'Asia/Manila','YYYYMMDD')||'-'||upper(replace(p_order_id::text,'-','')) THEN RAISE EXCEPTION 'Invalid offline ticket'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND pricing_quote->>'fingerprint'=p_meta->'pricingQuote'->>'fingerprint') THEN RAISE EXCEPTION 'Existing order and offline quote need reconciliation'; END IF;
      UPDATE public.orders SET offline_ticket_number=p_meta->>'offlineTicketNumber' WHERE id=p_order_id AND offline_ticket_number IS NULL;
    END IF;
    RETURN public.commit_order_submission_v2(p_submission_key,p_order_id,p_meta,p_files);
  END IF;
  SELECT * INTO STRICT settings FROM public.sop_settings WHERE id=1 FOR SHARE;
  replay:=p_meta->>'offlineSubmittedAt' IS NOT NULL;
  accepted_at:=coalesce((p_meta->>'offlineSubmittedAt')::timestamptz,now());
  IF accepted_at>now()+interval '5 minutes' OR accepted_at<now()-interval '90 days' THEN RAISE EXCEPTION 'Offline acceptance timestamp needs manual reconciliation'; END IF;
  IF replay AND p_meta->>'offlineTicketNumber' <> 'LAN-'||to_char(accepted_at AT TIME ZONE 'Asia/Manila','YYYYMMDD')||'-'||upper(replace(p_order_id::text,'-','')) THEN RAISE EXCEPTION 'Invalid offline ticket'; END IF;
  IF NOT replay AND settings.policy->>'intakeState'<>'online' THEN RAISE EXCEPTION 'Order intake is closed or offline'; END IF;
  clock_time:=accepted_at AT TIME ZONE 'Asia/Manila'; minutes:=extract(hour FROM clock_time)::int*60+extract(minute FROM clock_time)::int;
  IF NOT replay AND (settings.policy->>'enforceHours')::boolean AND (
    NOT (settings.policy->'workingDays' @> to_jsonb(extract(dow FROM clock_time)::int)) OR
    minutes<(settings.policy->>'openingMinute')::int OR minutes>=(settings.policy->>'closingMinute')::int
  ) THEN RAISE EXCEPTION 'Order intake is closed outside shop hours (Asia/Manila)'; END IF;
  options:=p_meta->'serviceOptions'; quote:=p_meta->'pricingQuote';
  IF EXISTS(SELECT 1 FROM public.services WHERE id=(p_meta->>'serviceId')::uuid AND slug='printing') THEN
    IF quote IS NULL OR quote->>'version'<>'1' OR jsonb_array_length(quote->'pages')<1 THEN RAISE EXCEPTION 'Refresh the verified page quote'; END IF;
    IF (quote->>'expiresAt')::timestamptz<accepted_at THEN RAISE EXCEPTION 'The print quote expired. Refresh before paying'; END IF;
    copies:=(options->>'Copies')::int; paper:=options->>'Paper Size'; IF paper='Letter' THEN paper:='Short'; END IF;
    student:=(quote->>'student')::boolean;
    IF copies<1 OR copies>10000 OR quote->>'paper'<>paper OR (quote->>'copies')::int<>copies THEN RAISE EXCEPTION 'Print quote does not match the options'; END IF;
    IF student AND (p_meta->'studentProof'->>'path' IS NULL OR p_meta->'studentProof'->>'path' NOT LIKE p_order_id::text||'/student/%') THEN RAISE EXCEPTION 'Student ID proof is required for the discount'; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(quote->'pages') LOOP
      category:=item->>'category'; rate:=(settings.pricing->'rates'->paper->>category)::numeric;
      IF rate IS NULL OR rate<0 THEN RAISE EXCEPTION 'Unsupported page rate'; END IF;
      deduction:=0;
      IF student THEN
        deduction:=(settings.pricing->'studentDiscounts'->>(CASE WHEN category='images' THEN CASE WHEN (item->>'imageCoverage')::numeric<0.5 THEN 'imageLow' ELSE 'imageHigh' END ELSE CASE WHEN (item->>'textCoverage')::numeric<0.5 THEN 'textLow' ELSE 'textHigh' END END))::numeric;
      END IF;
      IF deduction IS NULL OR deduction<0 OR deduction>rate THEN RAISE EXCEPTION 'Invalid discount rate'; END IF;
      price:=price+round((rate-deduction)*copies,2);
    END LOOP;
    FOR fee IN SELECT * FROM jsonb_array_elements(coalesce(quote->'finishing','[]')) LOOP
      rate:=(settings.pricing->'finishing'->>(fee->>'name'))::numeric;
      IF rate IS NULL OR rate<0 THEN RAISE EXCEPTION 'Finishing price is not configured'; END IF;
      price:=price+rate;
    END LOOP;
    IF price<>(quote->>'total')::numeric THEN RAISE EXCEPTION 'Shop prices changed. Refresh the quote before paying'; END IF;
    IF price<0 OR price>999999 THEN RAISE EXCEPTION 'Order amount exceeds the supported limit'; END IF;
  END IF;
  -- These layout/finishing controls belong to the SOP engine, not service-option definitions.
  legacy_meta:=jsonb_set(p_meta,'{serviceOptions}',options-'Finishing'-'Print margin (mm)');
  result:=public.commit_order_submission_v2(p_submission_key,p_order_id,legacy_meta,p_files);
  payment:=CASE WHEN left(coalesce(p_meta->>'customerNotes',''),15)='JNC_PAYMENT_V1:' THEN substring(p_meta->>'customerNotes' FROM 16)::jsonb ELSE '{}'::jsonb END;
  method:=coalesce(payment->>'method','cash');
  UPDATE public.orders SET service_options=options,pricing_quote=quote,
    total_price=CASE WHEN quote IS NULL THEN total_price ELSE price END,
    student_status=CASE WHEN coalesce((quote->>'student')::boolean,false) THEN 'pending' ELSE 'none' END,
    student_proof=p_meta->'studentProof',payment_method=method,
    created_at=accepted_at,offline_ticket_number=CASE WHEN replay THEN p_meta->>'offlineTicketNumber' ELSE NULL END,
    payment_expires_at=CASE WHEN method='cash' AND options->>'Transaction Type'='schedule' THEN accepted_at+make_interval(mins=>(settings.policy->>'unpaidTimeoutMinutes')::int) ELSE NULL END
    WHERE id=p_order_id;
  UPDATE public.orders o SET ticket_released_at=accepted_at WHERE id=p_order_id AND NOT public.sop_order_held(o);
  UPDATE public.order_files f SET page_count=(f.metadata->>'pageCount')::int WHERE order_id=p_order_id AND f.metadata ? 'pageCount';
  SELECT jsonb_set(result,'{totalPrice}',to_jsonb(total_price)) INTO result FROM public.orders WHERE id=p_order_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commit_order_submission(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_submission(uuid,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_queue_order(p_order_id uuid,p_status text,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; capacity integer; active integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT active_servers INTO STRICT capacity FROM public.queue_settings WHERE id=1 FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF p_status='completed' AND o.status='processing' THEN RAISE EXCEPTION 'Move printing to finishing and complete quality checks before pickup'; END IF;
  IF p_status IN('queued','processing','finishing','completed','collected') AND public.sop_order_held(o) THEN RAISE EXCEPTION 'Verify the student eligibility and required payment first'; END IF;
  IF p_status='processing' THEN
    SELECT count(*) INTO active FROM public.orders WHERE status IN('processing','finishing');
    IF active>=capacity THEN RAISE EXCEPTION 'All active staff slots are occupied'; END IF;
    IF p_order_id IS DISTINCT FROM public.next_sop_order() THEN RAISE EXCEPTION 'Start the first eligible order in the dispatch queue. Refresh to see its current priority'; END IF;
    PERFORM public.transition_queue_order_v2(p_order_id,p_status,p_actor_id);
    UPDATE public.queue_entries SET wait_time_minutes=greatest(0,extract(epoch FROM (now()-coalesce(o.ticket_released_at,o.created_at)))/60) WHERE order_id=p_order_id;
  ELSIF p_status='finishing' THEN
    IF o.status<>'processing' THEN RAISE EXCEPTION 'Start printing before finishing'; END IF;
    UPDATE public.orders SET status='finishing',finishing_at=now() WHERE id=p_order_id;
    UPDATE public.print_job_assignments SET status='completed',completed_at=now() WHERE order_id=p_order_id;
  ELSIF p_status='collected' THEN
    IF o.status<>'completed' OR NOT o.is_paid OR o.disposal_recorded_at IS NOT NULL THEN RAISE EXCEPTION 'Order must be ready and payment received before collection'; END IF;
    UPDATE public.orders SET status='collected',collected_at=now(),collected_by=p_actor_id WHERE id=p_order_id;
  ELSE
    IF o.status='finishing' AND p_status IN('completed','cancelled','failed') THEN UPDATE public.orders SET status='processing' WHERE id=p_order_id; END IF;
    PERFORM public.transition_queue_order_v2(p_order_id,p_status,p_actor_id);
  END IF;
  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_id,actor_role,metadata)
    VALUES('order_transition','order',p_order_id,p_actor_id,'admin',jsonb_build_object('from',o.status,'to',p_status));
END $$;
REVOKE ALL ON FUNCTION public.transition_queue_order(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_queue_order(uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_unpaid_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
  WITH expired AS (
    UPDATE public.orders SET status='cancelled',admin_notes=concat_ws(E'\n',admin_notes,'Counter prepayment window expired; no receipt submitted.')
    WHERE status IN('pending','queued') AND NOT is_paid AND payment_expires_at<=now()
      AND coalesce(payment_method,'cash')='cash'
      AND coalesce(customer_notes,'') NOT LIKE '%"receiptPath"%'
    RETURNING id
  ) UPDATE public.queue_entries SET status='cancelled',position=NULL,finished_at=now() WHERE order_id IN(SELECT id FROM expired);
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_requests() TO service_role;

CREATE OR REPLACE FUNCTION public.approve_sop_payment(p_order_id uuid,p_record jsonb,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF o.status IN('cancelled','failed') THEN RAISE EXCEPTION 'This request is closed'; END IF;
  IF o.is_paid THEN RETURN; END IF;
  IF p_record->>'method' NOT IN('cash','gcash','maya') OR p_record->>'status'<>'approved' THEN RAISE EXCEPTION 'Invalid payment approval'; END IF;
  UPDATE public.orders SET is_paid=true,payment_method=p_record->>'method',payment_expires_at=NULL,
    customer_notes='JNC_PAYMENT_V1:'||p_record::text WHERE id=p_order_id;
  UPDATE public.orders r SET ticket_released_at=coalesce(ticket_released_at,now()),
    customer_id=coalesce(customer_id,nullif(p_record->>'customerId','')::uuid)
    WHERE id=p_order_id AND NOT public.sop_order_held(r);
  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_id,actor_role,metadata)
    VALUES('payment_approved','order',p_order_id,p_actor_id,'admin',jsonb_build_object('amount',o.total_price,'method',p_record->>'method'));
END $$;
REVOKE ALL ON FUNCTION public.approve_sop_payment(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sop_payment(uuid,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_sop_student(p_order_id uuid,p_approved boolean,p_reason text,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; payment jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF o.student_status<>'pending' OR o.status NOT IN('pending','queued') THEN RAISE EXCEPTION 'Student review is no longer pending'; END IF;
  IF NOT p_approved AND length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Explain the reason for declining verification'; END IF;
  UPDATE public.orders SET student_status=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END WHERE id=p_order_id;
  payment:=CASE WHEN left(coalesce(o.customer_notes,''),15)='JNC_PAYMENT_V1:' THEN substring(o.customer_notes FROM 16)::jsonb ELSE '{}'::jsonb END;
  UPDATE public.orders r SET ticket_released_at=coalesce(ticket_released_at,now()),customer_id=coalesce(customer_id,nullif(payment->>'customerId','')::uuid)
    WHERE id=p_order_id AND NOT public.sop_order_held(r);
  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_id,actor_role,metadata)
    VALUES('student_verification','order',p_order_id,p_actor_id,'admin',jsonb_build_object('approved',p_approved,'reason',left(p_reason,500)));
END $$;
REVOKE ALL ON FUNCTION public.verify_sop_student(uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_sop_student(uuid,boolean,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.collect_sop_order(p_order_id uuid,p_cash_received numeric,p_verification text,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; record jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF o.status<>'completed' OR public.sop_order_held(o) OR o.disposal_recorded_at IS NOT NULL THEN RAISE EXCEPTION 'This order is not available for collection'; END IF;
  IF length(trim(coalesce(p_verification,'')))<3 THEN RAISE EXCEPTION 'Ticket verification is required'; END IF;
  IF NOT o.is_paid THEN
    IF coalesce(o.payment_method,'cash')<>'cash' OR p_cash_received IS NULL OR p_cash_received<o.total_price THEN RAISE EXCEPTION 'Record the full cash payment before collection'; END IF;
    record:=jsonb_build_object('method','cash','status','approved','verifiedAt',now(),'verifiedBy',p_actor_id);
    PERFORM public.approve_sop_payment(p_order_id,record,p_actor_id);
  END IF;
  PERFORM public.transition_queue_order(p_order_id,'collected',p_actor_id);
  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_id,actor_role,metadata)
    VALUES('pickup_verified','order',p_order_id,p_actor_id,'admin',jsonb_build_object('verification',left(p_verification,300),'cashReceived',p_cash_received,'change',CASE WHEN p_cash_received IS NULL THEN 0 ELSE greatest(0,p_cash_received-o.total_price) END));
END $$;
REVOKE ALL ON FUNCTION public.collect_sop_order(uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.collect_sop_order(uuid,numeric,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.next_sop_order() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH cfg AS(SELECT s.policy,q.atc_lookahead,q.page_penalty,q.max_wait_minutes FROM public.sop_settings s CROSS JOIN public.queue_settings q WHERE s.id=1 AND q.id=1),
  jobs AS(SELECT o.id,coalesce(o.ticket_released_at,o.created_at) AS arrival,
    CASE WHEN o.service_options->>'Transaction Type'='schedule' THEN coalesce(nullif(o.service_options->>'Pickup At','')::timestamptz,
      CASE WHEN o.service_options->>'Pickup Date' ~ '^\d{4}-\d{2}-\d{2}$' AND o.service_options->>'Pickup Time' ~ '^\d{2}:\d{2}$'
        THEN ((o.service_options->>'Pickup Date')||'T'||(o.service_options->>'Pickup Time')||':00+08:00')::timestamptz END) ELSE NULL END AS due,
    greatest(0.1,o.estimated_duration_minutes) AS duration,greatest(0.1,o.estimated_duration_minutes-o.setup_duration_minutes) AS print_minutes
    FROM public.orders o WHERE o.status IN('pending','queued') AND NOT public.sop_order_held(o)),
  means AS(SELECT coalesce(avg(print_minutes) FILTER(WHERE due IS NOT NULL),5) AS average FROM jobs),
  scored AS(SELECT jobs.*,cfg.*,
    CASE WHEN cfg.policy->>'dispatchMode'='walkins-first' THEN CASE WHEN due IS NULL THEN 0 ELSE 1 END
      WHEN extract(epoch FROM(now()-arrival))/60>=cfg.max_wait_minutes THEN 0
      WHEN due IS NOT NULL AND extract(epoch FROM(due-now()))/60<=duration THEN 1
      WHEN due IS NULL THEN 2 ELSE 3 END AS lane,
    CASE WHEN due IS NULL THEN 0 ELSE 1/duration*exp(-greatest(0,extract(epoch FROM(due-now()))/60-duration)/(atc_lookahead*average))/(1+page_penalty*print_minutes/average) END AS score
    FROM jobs CROSS JOIN cfg CROSS JOIN means)
  SELECT id FROM scored ORDER BY lane,
    CASE WHEN (policy->>'dispatchMode'='walkins-first' AND due IS NULL) OR (policy->>'dispatchMode'<>'walkins-first' AND (lane=0 OR due IS NULL)) THEN extract(epoch FROM arrival) ELSE NULL END ASC,
    score DESC,arrival,id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.next_sop_order() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.next_sop_order() TO service_role;

CREATE OR REPLACE FUNCTION public.set_sop_order_estimate(p_order_id uuid,p_setup numeric,p_total numeric,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_setup<0 OR p_setup>120 OR p_total<=p_setup OR p_total>10080 THEN RAISE EXCEPTION 'Enter valid setup and total service minutes'; END IF;
  UPDATE public.orders SET setup_duration_minutes=p_setup,estimated_duration_minutes=p_total WHERE id=p_order_id AND status IN('pending','queued');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only waiting orders can change processing estimates'; END IF;
  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_id,actor_role,metadata)
    VALUES('service_estimate_updated','order',p_order_id,p_actor_id,'admin',jsonb_build_object('setupMinutes',p_setup,'totalMinutes',p_total));
END $$;
REVOKE ALL ON FUNCTION public.set_sop_order_estimate(uuid,numeric,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_sop_order_estimate(uuid,numeric,numeric,uuid) TO service_role;
COMMIT;
