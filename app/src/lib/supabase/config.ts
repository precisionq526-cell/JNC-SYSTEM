const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'
const LOCAL_SUPABASE_KEY = 'local-development-placeholder'

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return isHttpUrl(url) ? url : LOCAL_SUPABASE_URL
}

export function hasSupabaseConfig(): boolean {
  return isHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

export function getSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_SUPABASE_KEY
}

export function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_SUPABASE_KEY
}

function isHttpUrl(value: string | undefined): value is string {
  return Boolean(value && /^https?:\/\//.test(value))
}
