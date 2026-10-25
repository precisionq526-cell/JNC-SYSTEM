export function hasServiceRoleConfig(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return Boolean(key && key.length > 20 && !key.includes('placeholder'))
}
