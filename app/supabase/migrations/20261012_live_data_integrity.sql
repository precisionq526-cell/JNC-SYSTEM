-- Apply to the existing Kiosk System Supabase project. No sample records are inserted.
-- Order, file metadata and queue entry are committed together. Cloud uploads precede this transaction.
BEGIN;
-- Order-processing capacity is separate from physical printer count.
-- Run after the existing schema and 20260529_mg1_hardware_failover migration.
CREATE TABLE IF NOT EXISTS public.queue_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_servers INTEGER NOT NULL DEFAULT 0 CHECK (active_servers BETWEEN 0 AND 2),
  atc_lookahead NUMERIC NOT NULL DEFAULT 2 CHECK (atc_lookahead > 0),
  page_penalty NUMERIC NOT NULL DEFAULT 0 CHECK (page_penalty >= 0),
  max_wait_minutes NUMERIC NOT NULL DEFAULT 60 CHECK (max_wait_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.queue_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.queue_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS queue_settings_admin ON public.queue_settings;
CREATE POLICY queue_settings_admin ON public.queue_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Serialize dispatch so two browser tabs cannot consume the final processing slot.
-- Authorization is checked in the Server Action; only service_role can call this RPC.
CREATE OR REPLACE FUNCTION public.transition_queue_order(p_order_id UUID, p_status TEXT, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_order public.orders%ROWTYPE; capacity INTEGER; in_progress INTEGER; service_slug TEXT; printer_id UUID;
BEGIN
  SELECT active_servers INTO STRICT capacity FROM public.queue_settings WHERE id = 1 FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  SELECT * INTO STRICT current_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF p_status IN ('pending', 'queued') THEN
    IF current_order.status NOT IN ('pending', 'queued') THEN RAISE EXCEPTION 'Only waiting orders can change queue state'; END IF;
    UPDATE public.orders SET status = p_status WHERE id = p_order_id;
  ELSIF p_status = 'processing' THEN
    IF current_order.status NOT IN ('pending', 'queued') THEN RAISE EXCEPTION 'This order is no longer waiting'; END IF;
    SELECT count(*) INTO in_progress FROM public.orders WHERE status = 'processing';
    IF in_progress >= capacity THEN RAISE EXCEPTION 'All active staff slots are occupied. Complete an order or update staff availability.'; END IF;
    UPDATE public.orders SET status = p_status, started_at = now(), processed_by = p_actor_id WHERE id = p_order_id;
    UPDATE public.queue_entries SET status = 'serving', called_at = now(), served_at = now(), position = NULL,
      wait_time_minutes = greatest(0, extract(epoch FROM (now() - current_order.created_at)) / 60), estimated_wait_minutes = 0
      WHERE order_id = p_order_id;
  ELSIF p_status = 'completed' THEN
    IF current_order.status <> 'processing' THEN RAISE EXCEPTION 'Start processing before completing the order'; END IF;
    UPDATE public.orders SET status = p_status, completed_at = now() WHERE id = p_order_id;
    UPDATE public.queue_entries SET status = 'served', finished_at = now(), position = NULL, estimated_wait_minutes = 0 WHERE order_id = p_order_id;
  ELSIF p_status IN ('cancelled', 'failed') THEN
    IF current_order.status NOT IN ('pending', 'queued', 'processing') THEN RAISE EXCEPTION 'This order is already closed'; END IF;
    UPDATE public.orders SET status = p_status WHERE id = p_order_id;
    UPDATE public.queue_entries SET status = 'cancelled', finished_at = now(), position = NULL, estimated_wait_minutes = NULL WHERE order_id = p_order_id;
  ELSE RAISE EXCEPTION 'Unsupported queue transition';
  END IF;
  SELECT slug INTO service_slug FROM public.services WHERE id=current_order.service_id;
  IF service_slug IN ('printing','id-picture') THEN
    IF p_status='processing' THEN
      SELECT device.id INTO printer_id FROM public.hardware_devices device WHERE device.device_type='printer'
        AND device.status='online' AND device.is_enabled AND device.last_heartbeat>=now()-interval '3 minutes'
        AND NOT EXISTS(SELECT 1 FROM public.print_job_assignments job WHERE job.device_id=device.id AND job.status='processing')
        ORDER BY device.last_heartbeat DESC LIMIT 1;
      INSERT INTO public.print_job_assignments(order_id,device_id,status,started_at,notes)
        VALUES(p_order_id,printer_id,CASE WHEN printer_id IS NULL THEN 'pending' ELSE 'processing' END,
          CASE WHEN printer_id IS NULL THEN NULL ELSE now() END,CASE WHEN printer_id IS NULL THEN 'No available physical printer' ELSE NULL END)
        ON CONFLICT(order_id) DO UPDATE SET device_id=excluded.device_id,status=excluded.status,started_at=excluded.started_at,notes=excluded.notes;
    ELSIF p_status IN ('completed','failed','cancelled') THEN
      UPDATE public.print_job_assignments SET status=CASE WHEN p_status='completed' THEN 'completed' ELSE 'failed' END,
        completed_at=CASE WHEN p_status='completed' THEN now() ELSE completed_at END WHERE order_id=p_order_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_queue_order(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_queue_order(UUID, TEXT, UUID) TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_settings;
  END IF;
END $$;


ALTER TABLE public.order_files ADD COLUMN IF NOT EXISTS asset_classification TEXT;
ALTER TABLE public.queue_entries ADD COLUMN IF NOT EXISTS estimated_wait_minutes NUMERIC;
ALTER TABLE public.queue_entries ADD COLUMN IF NOT EXISTS arrival_rate_snapshot NUMERIC;
ALTER TABLE public.queue_entries ADD COLUMN IF NOT EXISTS utilization_snapshot NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS submission_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS orders_submission_key_unique ON public.orders(submission_key);

CREATE TABLE IF NOT EXISTS public.daily_ticket_counters (
  ticket_date DATE PRIMARY KEY,
  last_order INTEGER NOT NULL DEFAULT 0,
  last_queue INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.daily_ticket_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_ticket_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.daily_ticket_counters TO service_role;
LOCK TABLE public.orders, public.queue_entries IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.daily_ticket_counters(ticket_date, last_order)
  SELECT to_date(split_part(order_number, '-', 2), 'YYYYMMDD'), max(split_part(order_number, '-', 3)::integer)
  FROM public.orders WHERE order_number ~ '^ORD-[0-9]{8}-[0-9]+$'
  GROUP BY split_part(order_number, '-', 2)
ON CONFLICT (ticket_date) DO UPDATE SET last_order = greatest(daily_ticket_counters.last_order, excluded.last_order);
INSERT INTO public.daily_ticket_counters(ticket_date, last_queue)
  SELECT queue_date, max(queue_number) FROM public.queue_entries GROUP BY queue_date
ON CONFLICT (ticket_date) DO UPDATE SET last_queue = greatest(daily_ticket_counters.last_queue, excluded.last_queue);

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE business_day date := (now() AT TIME ZONE 'Asia/Manila')::date; next_number integer;
BEGIN
  INSERT INTO public.daily_ticket_counters(ticket_date,last_order) VALUES(business_day,1)
    ON CONFLICT (ticket_date) DO UPDATE SET last_order = daily_ticket_counters.last_order + 1
    RETURNING last_order INTO next_number;
  NEW.order_number := 'ORD-' || to_char(business_day, 'YYYYMMDD') || '-' || lpad(next_number::text, greatest(3,length(next_number::text)), '0');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.generate_queue_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE business_day date := (now() AT TIME ZONE 'Asia/Manila')::date; next_number integer;
BEGIN
  INSERT INTO public.daily_ticket_counters(ticket_date,last_queue) VALUES(business_day,1)
    ON CONFLICT (ticket_date) DO UPDATE SET last_queue = daily_ticket_counters.last_queue + 1
    RETURNING last_queue INTO next_number;
  NEW.queue_number := next_number; NEW.queue_date := business_day;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.commit_order_submission(
  p_submission_key uuid, p_order_id uuid, p_meta jsonb, p_files jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE receipt public.orders%ROWTYPE; svc public.services%ROWTYPE;
  opt public.service_options%ROWTYPE; selected jsonb; value text; key text;
  copies integer := 1; price numeric; modifiers numeric := 0; file jsonb; qnumber integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_key::text, 0));
  SELECT * INTO receipt FROM public.orders WHERE submission_key = p_submission_key;
  IF FOUND THEN
    IF receipt.service_id <> (p_meta->>'serviceId')::uuid OR receipt.source <> p_meta->>'source' THEN
      RAISE EXCEPTION 'Submission key already belongs to a different order';
    END IF;
    SELECT queue_number INTO STRICT qnumber FROM public.queue_entries WHERE order_id = receipt.id;
    SELECT * INTO STRICT svc FROM public.services WHERE id=receipt.service_id;
    RETURN jsonb_build_object('orderId',receipt.id,'orderNumber',receipt.order_number,'queueNumber',qnumber,'totalPrice',receipt.total_price,'createdAt',receipt.created_at,'estimatedDurationMinutes',receipt.estimated_duration_minutes,'serviceName',svc.name);
  END IF;
  IF p_order_id IS NULL OR p_submission_key IS NULL OR p_meta->>'source' NOT IN ('online','kiosk') THEN RAISE EXCEPTION 'Invalid submission'; END IF;
  SELECT * INTO STRICT svc FROM public.services WHERE id = (p_meta->>'serviceId')::uuid AND is_active FOR SHARE;
  IF svc.estimated_duration_minutes <= 0 OR svc.base_price < 0 THEN RAISE EXCEPTION 'Invalid service configuration'; END IF;
  selected := coalesce(p_meta->'serviceOptions','{}');
  IF jsonb_typeof(selected) <> 'object' OR jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) > 20 THEN RAISE EXCEPTION 'Invalid files or options'; END IF;
  IF jsonb_array_length(p_files) = 0 AND svc.slug NOT IN ('id-picture','scanning') THEN RAISE EXCEPTION 'At least one file is required'; END IF;
  FOR key IN SELECT jsonb_object_keys(selected) LOOP
    IF key NOT IN ('Transaction Type','Pickup At','Pickup Date','Pickup Time') AND NOT EXISTS (
      SELECT 1 FROM public.service_options WHERE service_id = svc.id AND name = key
    ) THEN RAISE EXCEPTION 'Option % is not configured for this service',key; END IF;
  END LOOP;
  FOR opt IN SELECT * FROM public.service_options WHERE service_id = svc.id ORDER BY display_order FOR SHARE LOOP
    value := selected->>opt.name;
    IF opt.is_required AND (value IS NULL OR btrim(value) = '') THEN RAISE EXCEPTION 'Required option: %',opt.name; END IF;
    IF value IS NULL OR value = '' THEN CONTINUE; END IF;
    IF opt.option_type = 'select' AND NOT coalesce(opt.choices @> jsonb_build_array(value),false) THEN RAISE EXCEPTION 'Invalid selection: %',opt.name; END IF;
    IF opt.option_type = 'toggle' AND value NOT IN ('Yes','No','true','false') THEN RAISE EXCEPTION 'Invalid toggle: %',opt.name; END IF;
    IF opt.option_type = 'number' THEN
      IF value !~ '^[0-9]+$' OR value::numeric < 1 OR value::numeric > 10000 THEN RAISE EXCEPTION 'Invalid quantity: %',opt.name; END IF;
      IF opt.name = 'Copies' THEN copies := value::integer; END IF;
    END IF;
    IF length(value) > 2000 THEN RAISE EXCEPTION 'Option value too long'; END IF;
    IF value NOT IN ('No','false') THEN modifiers := modifiers + coalesce(opt.price_modifier,0); END IF;
  END LOOP;
  IF coalesce(selected->>'Transaction Type','') NOT IN ('walk-in','schedule') THEN RAISE EXCEPTION 'Choose a transaction type'; END IF;
  IF selected->>'Transaction Type' = 'schedule' AND (
    selected->>'Pickup At' IS NULL OR (selected->>'Pickup At')::timestamptz <= now()
  ) THEN RAISE EXCEPTION 'Choose a future pickup time'; END IF;
  price := greatest(svc.base_price,svc.base_price * copies + modifiers);
  IF price < 0 OR price > 999999 THEN RAISE EXCEPTION 'Order price outside allowed range'; END IF;

  INSERT INTO public.orders(id,submission_key,source,customer_id,customer_name,customer_email,customer_phone,service_id,service_options,total_price,estimated_duration_minutes,customer_notes)
  VALUES(p_order_id,p_submission_key,p_meta->>'source',nullif(p_meta->>'customerId','')::uuid,
    nullif(p_meta->>'customerName',''),nullif(p_meta->>'customerEmail',''),nullif(p_meta->>'customerPhone',''),svc.id,selected,price,svc.estimated_duration_minutes,nullif(p_meta->>'customerNotes',''))
  RETURNING * INTO receipt;
  FOR file IN SELECT * FROM jsonb_array_elements(p_files) LOOP
    IF length(file->>'file_name') > 255 OR coalesce(file->>'storage_path','') NOT LIKE p_order_id::text || '/%'
      OR coalesce(file->>'storage_bucket','') <> 'order-files'
      OR coalesce((file->>'file_size')::bigint,0) < 1 OR (file->>'file_size')::bigint > 209715200 THEN RAISE EXCEPTION 'Invalid file metadata'; END IF;
    INSERT INTO public.order_files(order_id,file_name,file_type,file_size,storage_bucket,storage_path,asset_classification,metadata)
      VALUES(receipt.id,file->>'file_name',file->>'file_type',(file->>'file_size')::bigint,'order-files',file->>'storage_path',file->>'asset_classification',coalesce(file->'metadata','{}'));
  END LOOP;
  INSERT INTO public.queue_entries(order_id,estimated_service_minutes,status,estimated_wait_minutes)
    VALUES(receipt.id,svc.estimated_duration_minutes,'waiting',NULL) RETURNING queue_number INTO qnumber;
  RETURN jsonb_build_object('orderId',receipt.id,'orderNumber',receipt.order_number,'queueNumber',qnumber,'totalPrice',receipt.total_price,'createdAt',receipt.created_at,'estimatedDurationMinutes',receipt.estimated_duration_minutes,'serviceName',svc.name);
END $$;
REVOKE ALL ON FUNCTION public.commit_order_submission(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_submission(uuid,uuid,jsonb,jsonb) TO service_role;

-- Prevent anonymous/client inserts bypassing canonical prices and atomic queue creation.
DROP POLICY IF EXISTS "Customers create orders" ON public.orders;
REVOKE INSERT,UPDATE,DELETE ON public.orders, public.queue_entries, public.order_files FROM anon,authenticated;
REVOKE UPDATE ON public.profiles FROM anon,authenticated;
GRANT UPDATE(full_name,phone,avatar_url) ON public.profiles TO authenticated;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin')
$$;
REVOKE ALL ON FUNCTION public.app_is_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.app_is_admin() TO authenticated;
DROP POLICY IF EXISTS queue_admin_read ON public.queue_entries;
CREATE POLICY queue_admin_read ON public.queue_entries FOR SELECT TO authenticated USING(public.app_is_admin());

CREATE TABLE IF NOT EXISTS public.transfer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), short_code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, kiosk_station_id UUID REFERENCES public.kiosk_stations(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.transfer_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES public.transfer_sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, file_size BIGINT NOT NULL CHECK (file_size > 0), file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transfer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transfer_sessions, public.transfer_files FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.transfer_sessions, public.transfer_files TO service_role;
CREATE OR REPLACE FUNCTION public.commit_transfer_files(p_session_id UUID, p_files JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE session public.transfer_sessions%ROWTYPE; file JSONB; row public.transfer_files%ROWTYPE; result JSONB := '[]';
BEGIN
  SELECT * INTO STRICT session FROM public.transfer_sessions WHERE id = p_session_id FOR UPDATE;
  IF session.status <> 'active' OR session.expires_at <= now() THEN RAISE EXCEPTION 'Transfer session closed or expired'; END IF;
  IF jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid transfer batch'; END IF;
  FOR file IN SELECT * FROM jsonb_array_elements(p_files) LOOP
    IF coalesce(file->>'storage_path','') NOT LIKE p_session_id::text || '/%' OR coalesce((file->>'file_size')::bigint,0) NOT BETWEEN 1 AND 209715200 THEN RAISE EXCEPTION 'Invalid transfer file'; END IF;
    INSERT INTO public.transfer_files(session_id,file_name,file_size,file_type,storage_path)
      VALUES(p_session_id,file->>'file_name',(file->>'file_size')::bigint,file->>'file_type',file->>'storage_path') RETURNING * INTO row;
    result := result || jsonb_build_array(to_jsonb(row));
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commit_transfer_files(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_transfer_files(UUID,JSONB) TO service_role;
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('transfer-files','transfer-files',false,209715200) ON CONFLICT(id) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_service_configuration(p_service JSONB,p_options JSONB,p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid UUID := (p_service->>'id')::uuid; option JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  PERFORM 1 FROM public.services WHERE id=sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found'; END IF;
  IF (p_service->>'base_price')::numeric < 0 OR (p_service->>'estimated_duration_minutes')::integer < 1 THEN RAISE EXCEPTION 'Invalid service price or duration'; END IF;
  UPDATE public.services SET base_price=(p_service->>'base_price')::numeric, estimated_duration_minutes=(p_service->>'estimated_duration_minutes')::integer,
    is_active=(p_service->>'is_active')::boolean,updated_at=now() WHERE id=sid;
  DELETE FROM public.service_options WHERE service_id=sid;
  FOR option IN SELECT * FROM jsonb_array_elements(p_options) LOOP
    INSERT INTO public.service_options(service_id,name,option_type,choices,default_value,price_modifier,is_required,display_order)
      VALUES(sid,option->>'name',option->>'option_type',option->'choices',nullif(option->>'default_value',''),(option->>'price_modifier')::numeric,(option->>'is_required')::boolean,(option->>'display_order')::integer);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_service_configuration(JSONB,JSONB,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_configuration(JSONB,JSONB,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.reroute_hardware_assignment(p_assignment_id UUID,p_failed_device_id UUID,p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.print_job_assignments%ROWTYPE; replacement UUID; outcome TEXT;
BEGIN
  SELECT * INTO STRICT job FROM public.print_job_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF job.device_id IS DISTINCT FROM p_failed_device_id OR job.status NOT IN ('pending','assigned','rerouted') THEN RETURN 'skipped'; END IF;
  SELECT id INTO replacement FROM public.hardware_devices WHERE id<>p_failed_device_id AND device_type='printer'
    AND status='online' AND is_enabled AND last_heartbeat>=now()-interval '3 minutes' ORDER BY last_heartbeat DESC LIMIT 1;
  outcome:=CASE WHEN replacement IS NULL THEN 'unassigned' ELSE 'rerouted' END;
  UPDATE public.print_job_assignments SET device_id=replacement,status=CASE WHEN replacement IS NULL THEN 'pending' ELSE 'rerouted' END,
    rerouted_from_device_id=p_failed_device_id,notes=p_reason WHERE id=p_assignment_id;
  INSERT INTO public.failover_events(order_id,assignment_id,from_device_id,to_device_id,reason,status)
    VALUES(job.order_id,job.id,p_failed_device_id,replacement,p_reason,outcome);
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.reroute_hardware_assignment(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reroute_hardware_assignment(UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.kiosk_data_contract_version()
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.kiosk_data_contract_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_data_contract_version() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
