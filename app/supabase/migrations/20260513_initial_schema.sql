-- Initial Schema for Kiosk System
-- Generated: 2026-05-13

-- 1. PROFILES Table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'kiosk')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 2. SERVICES Table
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_duration_minutes INT NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Services
INSERT INTO public.services (name, slug, description, icon, base_price, estimated_duration_minutes, display_order) VALUES
  ('Printing', 'printing', 'Document and photo printing', '🖨️', 5.00, 3, 1),
  ('ID Picture', 'id-picture', 'ID photo capture and printing', '📷', 50.00, 5, 2),
  ('Document Editing', 'doc-editing', 'Document formatting and editing', '📝', 30.00, 15, 3),
  ('Photo Editing', 'photo-editing', 'Photo enhancement and editing', '🎨', 40.00, 10, 4);

-- 3. SERVICE_OPTIONS Table
CREATE TABLE public.service_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  option_type TEXT NOT NULL CHECK (option_type IN ('select', 'number', 'toggle', 'text')),
  choices JSONB,
  default_value TEXT,
  price_modifier DECIMAL(10,2) DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. KIOSK_STATIONS Table
CREATE TABLE public.kiosk_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_name TEXT NOT NULL,
  location TEXT,
  device_token TEXT NOT NULL UNIQUE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_heartbeat TIMESTAMPTZ,
  ip_address TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. ORDERS Table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('kiosk', 'online')),
  kiosk_station_id UUID REFERENCES public.kiosk_stations(id),
  customer_id UUID REFERENCES auth.users(id),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  service_id UUID NOT NULL REFERENCES public.services(id),
  service_options JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'cancelled', 'failed')),
  is_rush BOOLEAN NOT NULL DEFAULT false,
  priority_score DECIMAL(10,4) DEFAULT 0,
  estimated_duration_minutes INT,
  total_price DECIMAL(10,2) DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT,
  local_synced BOOLEAN NOT NULL DEFAULT false,
  local_path TEXT,
  processed_by UUID REFERENCES public.profiles(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  customer_notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read own orders" ON public.orders FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "Customers create orders" ON public.orders FOR INSERT WITH CHECK (auth.uid() = customer_id OR source = 'kiosk');
CREATE POLICY "Admins full access" ON public.orders FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 6. ORDER_FILES Table
CREATE TABLE public.order_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'order-files',
  storage_path TEXT NOT NULL,
  storage_url TEXT,
  local_path TEXT,
  is_downloaded BOOLEAN NOT NULL DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  page_count INT,
  dimensions JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_files ENABLE ROW LEVEL SECURITY;

-- 7. QUEUE_ENTRIES Table
CREATE TABLE public.queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_number INT NOT NULL,
  queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  priority_score DECIMAL(10,4) DEFAULT 0,
  wait_time_minutes DECIMAL(10,2) DEFAULT 0,
  estimated_service_minutes DECIMAL(10,2),
  congestion_factor DECIMAL(5,3) DEFAULT 1.0,
  rush_multiplier DECIMAL(5,3) DEFAULT 1.0,
  position INT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'serving', 'served', 'skipped', 'cancelled')),
  called_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(queue_number, queue_date)
);

-- 8. AUDIT_LOG Table
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  actor_id UUID REFERENCES public.profiles(id),
  actor_role TEXT,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FUNCTIONS & TRIGGERS

-- Order Number Generation
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  today_date TEXT;
  seq_num INT;
BEGIN
  today_date := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number, '-', 3) AS INT)), 0) + 1
  INTO seq_num
  FROM public.orders
  WHERE order_number LIKE 'ORD-' || today_date || '-%';
  NEW.order_number := 'ORD-' || today_date || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number BEFORE INSERT ON public.orders FOR EACH ROW WHEN (NEW.order_number IS NULL) EXECUTE FUNCTION generate_order_number();

-- Queue Number Generation
CREATE OR REPLACE FUNCTION generate_queue_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(queue_number), 0) + 1
  INTO next_num
  FROM public.queue_entries
  WHERE queue_date = CURRENT_DATE;
  NEW.queue_number := next_num;
  NEW.queue_date := CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_number BEFORE INSERT ON public.queue_entries FOR EACH ROW WHEN (NEW.queue_number IS NULL) EXECUTE FUNCTION generate_queue_number();

-- Updated At Timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_queue_updated BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_kiosk_updated BEFORE UPDATE ON public.kiosk_stations FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- REALTIME CONFIG
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_files;
