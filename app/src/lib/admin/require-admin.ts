import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'

export async function requireAdmin() {
  if (!hasServiceRoleConfig()) return { ok: false as const, error: 'Database connection is unavailable.' }
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ok: false as const, error: 'Unauthorized' }
  const { data } = await client.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (data?.role !== 'admin') return { ok: false as const, error: 'Administrator access required.' }
  return { ok: true as const, userId: user.id }
}
