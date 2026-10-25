import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAnonKey, getSupabaseUrl } from './config'

export function createClient() {
  return createBrowserClient(
    getSupabaseUrl(),
    getSupabaseAnonKey()
  )
}

export function clearSupabaseBrowserAuthStorage() {
  if (typeof window === 'undefined') return

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith('sb-') && key.includes('auth-token')) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Ignore storage access errors in restricted browser contexts.
  }

  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim()
    if (!name?.startsWith('sb-') || !name.includes('auth-token')) return
    document.cookie = `${name}=; Max-Age=0; path=/`
  })
}
