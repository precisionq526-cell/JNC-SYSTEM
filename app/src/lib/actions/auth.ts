'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import { createClient } from '@/lib/supabase/server'

export async function signInAction(input: { email: string; password: string }): Promise<{ ok: boolean; error?: string }> {
  const email = input.email.trim()
  if (!email || !input.password) return { ok: false, error: 'Enter your email address and password.' }
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: input.password })
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user && hasServiceRoleConfig()) {
        const profile = await supabaseAdmin.from('profiles').upsert({ id: user.id, email: user.email,
          full_name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.slice(0,120) : null, role: 'customer' },
          { onConflict: 'id', ignoreDuplicates: true })
        if (profile.error) return { ok: false, error: 'Signed in, but the account profile could not be loaded. Please retry.' }
      }
      return { ok: true }
    }
    if (error.name === 'AuthRetryableFetchError' || /fetch|network/i.test(error.message)) {
      return { ok: false, error: 'The sign-in service could not be reached. Check the connection and try again.' }
    }
    return { ok: false, error: /email not/i.test(error.message) ? 'Please verify your email before logging in.' : error.message }
  } catch {
    return { ok: false, error: 'The sign-in service could not be reached. Check the connection and try again.' }
  }
}

export async function createCustomerProfileAction(input: {
  userId: string
  email: string
  fullName: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasServiceRoleConfig()) {
    return { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }
  }

  const userId = input.userId.trim()
  const email = input.email.trim()
  const fullName = input.fullName.trim()

  if (!userId || !email || !fullName) {
    return { ok: false, error: 'Missing profile details' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) return { ok: false, error: 'Sign in to create your own profile.' }

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: user.email,
        full_name: fullName.slice(0,120),
        role: 'customer',
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true }
}
