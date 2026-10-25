-- M/G/1 queue telemetry + hardware failover support

ALTER TABLE public.order_files
  ADD COLUMN IF NOT EXISTS asset_classification TEXT
    CHECK (asset_classification IN ('document', 'image'));

ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS estimated_wait_minutes DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS arrival_rate_snapshot DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS utilization_snapshot DECIMAL(10,4);

UPDATE public.service_options
SET choices = '["A4","Short","Long"]'::jsonb,
    default_value = 'A4'
WHERE name = 'Paper Size';

UPDATE public.service_options
SET name = 'Print Color',
    choices = '["B&W","Colored"]'::jsonb,
    default_value = 'B&W'
WHERE name IN ('Color Mode', 'Print Color');

CREATE TABLE IF NOT EXISTS public.hardware_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name TEXT NOT NULL UNIQUE,
  device_type TEXT NOT NULL CHECK (device_type IN ('printer', 'computer', 'kiosk_terminal')),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error', 'busy')),
  location TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  capabilities JSONB NOT NULL DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.print_job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.hardware_devices(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'processing', 'completed', 'failed', 'rerouted')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rerouted_from_device_id UUID REFERENCES public.hardware_devices(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);

CREATE TABLE IF NOT EXISTS public.failover_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES public.print_job_assignments(id) ON DELETE SET NULL,
  from_device_id UUID REFERENCES public.hardware_devices(id) ON DELETE SET NULL,
  to_device_id UUID REFERENCES public.hardware_devices(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rerouted', 'unassigned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.hardware_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failover_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardware_devices_admin_all"
  ON public.hardware_devices FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "print_job_assignments_admin_all"
  ON public.print_job_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "failover_events_admin_all"
  ON public.failover_events FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE TRIGGER trg_hardware_devices_updated BEFORE UPDATE ON public.hardware_devices
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER trg_print_job_assignments_updated BEFORE UPDATE ON public.print_job_assignments
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.hardware_devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.print_job_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.failover_events;
