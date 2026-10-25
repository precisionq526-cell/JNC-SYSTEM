'use server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'

export async function getOrderFileSignedUrl(
  storagePath: string,
  fileName?: string
): Promise<{ url?: string; error?: string }> {
  if (!hasServiceRoleConfig()) {
    return { error: 'Server storage is not configured' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  if (profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const file = await supabaseAdmin.from('order_files').select('storage_bucket,file_name').eq('storage_path', storagePath).maybeSingle()
  if (file.error || !file.data) return { error: 'File record not found.' }
  const info = await supabaseAdmin.storage.from(file.data.storage_bucket).info(storagePath)
  if (info.error || !info.data) return { error: 'This file is missing from cloud storage and is not available on this PC. Restore it from the original kiosk or upload it again.' }
  const { data, error } = await supabaseAdmin.storage.from(file.data.storage_bucket).createSignedUrl(storagePath, 300, {
    download: fileName || true
  })

  if (error || !data?.signedUrl) {
    return { error: error?.message ?? 'Could not sign URL' }
  }

  return { url: data.signedUrl }
}
