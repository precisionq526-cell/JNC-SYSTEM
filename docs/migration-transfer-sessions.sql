-- ============================================
-- MOBILE BRIDGE — Transfer Session Tables
-- ============================================
-- Run this migration in your Supabase SQL Editor
-- to enable the QR Code file transfer feature.

-- Transfer Sessions: each QR code creates one session
CREATE TABLE IF NOT EXISTS public.transfer_sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  short_code    VARCHAR(6) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  kiosk_station_id VARCHAR(50) DEFAULT 'default-kiosk-001',
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'completed', 'expired')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by short code
CREATE INDEX IF NOT EXISTS idx_transfer_sessions_code
  ON public.transfer_sessions (short_code)
  WHERE status = 'active';

-- Transfer Files: each uploaded file belongs to a session
CREATE TABLE IF NOT EXISTS public.transfer_files (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES public.transfer_sessions(id) ON DELETE CASCADE,
  file_name     VARCHAR(255) NOT NULL,
  file_size     BIGINT NOT NULL DEFAULT 0,
  file_type     VARCHAR(100) DEFAULT 'application/octet-stream',
  storage_path  TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

-- Index for session-based file lookup
CREATE INDEX IF NOT EXISTS idx_transfer_files_session
  ON public.transfer_files (session_id);

-- Enable Realtime on transfer_files so the kiosk
-- gets instant INSERT notifications when a phone uploads
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_files;

-- ============================================
-- Storage Bucket
-- ============================================
-- Create a 'transfer-files' bucket in Supabase Storage
-- (run this in the Supabase Dashboard → Storage → New bucket)
-- Name: transfer-files
-- Public: false (files are accessed via signed URLs)
-- File size limit: 50MB

-- ============================================
-- RLS Policies (adjust for your security needs)
-- ============================================
-- Allow authenticated users to insert sessions
ALTER TABLE public.transfer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_files ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by server actions)
CREATE POLICY "Service role full access on transfer_sessions"
  ON public.transfer_sessions FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on transfer_files"
  ON public.transfer_files FOR ALL
  USING (true) WITH CHECK (true);
