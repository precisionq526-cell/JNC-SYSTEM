-- Order-processing capacity is separate from physical printer count.
-- Run after the existing schema and 20260529_mg1_hardware_failover migration.
CREATE TABLE IF NOT EXISTS public.queue_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_servers INTEGER NOT NULL DEFAULT 1 CHECK (active_servers BETWEEN 0 AND 2),
  atc_lookahead NUMERIC NOT NULL DEFAULT 2 CHECK (atc_lookahead > 0),
  page_penalty NUMERIC NOT NULL DEFAULT 0 CHECK (page_penalty >= 0),
  max_wait_minutes NUMERIC NOT NULL DEFAULT 60 CHECK (max_wait_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.queue_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.queue_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY queue_settings_admin ON public.queue_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Serialize dispatch so two browser tabs cannot consume the final processing slot.
-- Authorization is checked in the Server Action; only service_role can call this RPC.
CREATE OR REPLACE FUNCTION public.transition_queue_order(p_order_id UUID, p_status TEXT, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_order public.orders%ROWTYPE; capacity INTEGER; in_progress INTEGER;
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
END;
$$;
REVOKE ALL ON FUNCTION public.transition_queue_order(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_queue_order(UUID, TEXT, UUID) TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_settings;
