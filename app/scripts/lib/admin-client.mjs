import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

export function createMaintenanceClient() {
  dotenv.config({ path: '.env.local', quiet: true })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this maintenance script.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
