# Phase 2: Database Schema Design (Supabase/PostgreSQL)

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Entity Relationship Diagram

```
profiles ──────────┐
                    │ 1:N
                    ▼
services ────────► orders ◄──── kiosk_stations
   │                │
   │ 1:N            │ 1:N
   ▼                ▼
service_options   order_files
                    │
                    │ 1:1
                    ▼
                queue_entries
                    │
                    ▼
               audit_log
```

---

## 2. Table Definitions

### 2.1 `profiles` — User accounts

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'kiosk')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Users read/update own profile. Admins read all.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

---

### 2.2 `services` — Available service types

```sql
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,           -- 'printing', 'id-picture', 'doc-editing', 'photo-editing'
  description TEXT,
  icon TEXT,                            -- icon identifier for UI
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_duration_minutes INT NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed data
INSERT INTO services (name, slug, description, base_price, estimated_duration_minutes, display_order) VALUES
  ('Printing', 'printing', 'Document and photo printing', 5.00, 3, 1),
  ('ID Picture', 'id-picture', 'ID photo capture and printing', 50.00, 5, 2),
  ('Document Editing', 'doc-editing', 'Document formatting and editing', 30.00, 15, 3),
  ('Photo Editing', 'photo-editing', 'Photo enhancement and editing', 40.00, 10, 4);
```

---

### 2.3 `service_options` — Configurable options per service

```sql
CREATE TABLE service_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- 'Paper Size', 'Color Mode', 'Copies'
  option_type TEXT NOT NULL CHECK (option_type IN ('select', 'number', 'toggle', 'text')),
  choices JSONB,                        -- ['A4','Letter','Legal'] for select type
  default_value TEXT,
  price_modifier DECIMAL(10,2) DEFAULT 0, -- additional cost
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Example options for Printing
-- Paper Size: select from A4, Letter, Legal, Short, Long
-- Color: toggle (BW vs Color)
-- Copies: number (1-100)
-- Double-sided: toggle
```

---

### 2.4 `kiosk_stations` — Registered kiosk machines

```sql
CREATE TABLE kiosk_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_name TEXT NOT NULL,           -- 'Kiosk 1', 'Kiosk 2'
  location TEXT,                        -- 'Main Lobby', 'Branch 2'
  device_token TEXT NOT NULL UNIQUE,    -- auth token for this kiosk
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_heartbeat TIMESTAMPTZ,
  ip_address TEXT,
  config JSONB DEFAULT '{}',            -- local config overrides
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 2.5 `orders` — Central order table (kiosk + online)

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,    -- 'ORD-20260513-001' (human-readable)
  
  -- Source
  source TEXT NOT NULL CHECK (source IN ('kiosk', 'online')),
  kiosk_station_id UUID REFERENCES kiosk_stations(id),
  
  -- Customer
  customer_id UUID REFERENCES profiles(id),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  
  -- Service
  service_id UUID NOT NULL REFERENCES services(id),
  service_options JSONB DEFAULT '{}',   -- selected options snapshot
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'cancelled', 'failed')),
  
  -- Priority & Queue
  is_rush BOOLEAN NOT NULL DEFAULT false,
  priority_score DECIMAL(10,4) DEFAULT 0,  -- computed by queue optimizer
  estimated_duration_minutes INT,
  
  -- Pricing
  total_price DECIMAL(10,2) DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT,
  
  -- Sync
  local_synced BOOLEAN NOT NULL DEFAULT false,   -- file downloaded to kiosk PC
  local_path TEXT,                                -- path on kiosk PC
  
  -- Processing
  processed_by UUID REFERENCES profiles(id),     -- admin who handled it
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Notes
  customer_notes TEXT,
  admin_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_source ON orders(source);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_priority ON orders(priority_score DESC);
CREATE INDEX idx_orders_local_synced ON orders(local_synced) WHERE local_synced = false;

-- RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read own orders"
  ON orders FOR SELECT
  USING (auth.uid() = customer_id);

CREATE POLICY "Customers create orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "Admins full access"
  ON orders FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Kiosk create orders"
  ON orders FOR INSERT
  WITH CHECK (source = 'kiosk');
```

---

### 2.6 `order_files` — Files attached to orders

```sql
CREATE TABLE order_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  
  -- File info
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,              -- MIME type
  file_size BIGINT NOT NULL,            -- bytes
  
  -- Storage
  storage_bucket TEXT NOT NULL DEFAULT 'order-files',
  storage_path TEXT NOT NULL,           -- path in Supabase Storage
  storage_url TEXT,                     -- public/signed URL
  
  -- Local sync
  local_path TEXT,                      -- path on kiosk PC after download
  is_downloaded BOOLEAN NOT NULL DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  
  -- Metadata
  page_count INT,                       -- for documents
  dimensions JSONB,                     -- {width, height} for images
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_files_order ON order_files(order_id);
CREATE INDEX idx_order_files_download ON order_files(is_downloaded) WHERE is_downloaded = false;

ALTER TABLE order_files ENABLE ROW LEVEL SECURITY;
-- Policies mirror orders table access
```

---

### 2.7 `queue_entries` — Queue management

```sql
CREATE TABLE queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  queue_number INT NOT NULL,            -- daily sequential number (resets daily)
  
  -- Queue date (for daily reset)
  queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Optimization fields
  priority_score DECIMAL(10,4) DEFAULT 0,
  wait_time_minutes DECIMAL(10,2) DEFAULT 0,
  estimated_service_minutes DECIMAL(10,2),
  congestion_factor DECIMAL(5,3) DEFAULT 1.0,
  rush_multiplier DECIMAL(5,3) DEFAULT 1.0,
  
  -- Position
  position INT,                          -- current position in optimized queue
  
  -- Status
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'serving', 'served', 'skipped', 'cancelled')),
  
  called_at TIMESTAMPTZ,                -- when customer was called
  served_at TIMESTAMPTZ,                -- when service started
  finished_at TIMESTAMPTZ,              -- when service completed
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(queue_number, queue_date)      -- unique queue # per day
);

CREATE INDEX idx_queue_date ON queue_entries(queue_date);
CREATE INDEX idx_queue_status ON queue_entries(status);
CREATE INDEX idx_queue_position ON queue_entries(position);
CREATE INDEX idx_queue_priority ON queue_entries(priority_score DESC);
```

---

### 2.8 `audit_log` — System event tracking

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  event_type TEXT NOT NULL,              -- 'order.created', 'order.status_changed', 'file.uploaded', etc.
  entity_type TEXT,                      -- 'order', 'file', 'queue'
  entity_id UUID,
  
  actor_id UUID REFERENCES profiles(id),
  actor_role TEXT,
  
  old_value JSONB,
  new_value JSONB,
  metadata JSONB DEFAULT '{}',
  
  ip_address TEXT,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_event ON audit_log(event_type);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
```

---

## 3. Database Functions

### 3.1 Auto-generate order number

```sql
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  today_date TEXT;
  seq_num INT;
BEGIN
  today_date := to_char(now(), 'YYYYMMDD');
  
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(order_number, '-', 3) AS INT)
  ), 0) + 1
  INTO seq_num
  FROM orders
  WHERE order_number LIKE 'ORD-' || today_date || '-%';
  
  NEW.order_number := 'ORD-' || today_date || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION generate_order_number();
```

### 3.2 Auto-generate queue number (daily reset)

```sql
CREATE OR REPLACE FUNCTION generate_queue_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(queue_number), 0) + 1
  INTO next_num
  FROM queue_entries
  WHERE queue_date = CURRENT_DATE;
  
  NEW.queue_number := next_num;
  NEW.queue_date := CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_number
  BEFORE INSERT ON queue_entries
  FOR EACH ROW
  WHEN (NEW.queue_number IS NULL)
  EXECUTE FUNCTION generate_queue_number();
```

### 3.3 Update `updated_at` timestamp

```sql
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all relevant tables
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_queue_updated BEFORE UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_kiosk_updated BEFORE UPDATE ON kiosk_stations
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
```

---

## 4. Realtime Subscriptions

Enable realtime on key tables:

```sql
-- Enable realtime for orders, queue_entries
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE order_files;
```

| Channel | Table | Events | Consumer |
|---------|-------|--------|----------|
| Admin feed | `orders` | INSERT, UPDATE | Admin dashboard |
| Customer tracking | `orders` | UPDATE (filtered by customer_id) | Customer order page |
| Queue display | `queue_entries` | INSERT, UPDATE | Queue display screen |
| Sync trigger | `orders` | INSERT (source='online') | Kiosk sync service |

---

## 5. Storage Bucket Setup

```sql
-- Create storage buckets via Supabase Dashboard or API
-- Bucket: order-files
--   Public: false
--   File size limit: 52428800 (50MB)
--   Allowed MIME types: application/pdf, image/*, application/msword,
--     application/vnd.openxmlformats-officedocument.*

-- Bucket: id-photos
--   Public: false
--   File size limit: 10485760 (10MB)
--   Allowed MIME types: image/*
```
