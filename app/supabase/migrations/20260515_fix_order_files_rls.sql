-- Fix: Add missing RLS policies for order_files table
-- The order_files table had RLS enabled but NO policies,
-- making it impossible for anyone (including admins) to read file data
-- through the browser client. This caused files to appear missing in admin.

-- Allow admins full access to order_files
CREATE POLICY "Admins full access to order_files" ON public.order_files
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Allow customers to read their own order files (via order ownership)
CREATE POLICY "Customers read own order files" ON public.order_files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_files.order_id
        AND orders.customer_id = auth.uid()
    )
  );

-- Allow kiosk orders to insert files (no auth required for kiosk source)
CREATE POLICY "Kiosk insert order files" ON public.order_files
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_files.order_id
        AND orders.source = 'kiosk'
    )
  );

-- Allow authenticated users to insert files for their own orders
CREATE POLICY "Users insert own order files" ON public.order_files
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_files.order_id
        AND orders.customer_id = auth.uid()
    )
  );
