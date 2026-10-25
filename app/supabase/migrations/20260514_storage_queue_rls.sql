-- Storage bucket + RLS for hybrid file flow (2026-05-14)

INSERT INTO storage.buckets (id, name, public)
VALUES ('order-files', 'order-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_order_files_admin_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-files'
  AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "order_files_select_customer"
ON public.order_files FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_files.order_id
      AND o.customer_id IS NOT NULL
      AND o.customer_id = auth.uid()
  )
);

CREATE POLICY "order_files_all_admin"
ON public.order_files FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "queue_entries_admin_all"
ON public.queue_entries FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "queue_entries_customer_select"
ON public.queue_entries FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = queue_entries.order_id
      AND o.customer_id IS NOT NULL
      AND o.customer_id = auth.uid()
  )
);
