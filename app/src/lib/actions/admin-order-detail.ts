'use server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/utils/uuid'
import { firstRelation, relationList } from '@/lib/supabase/relations'
import type { Order, OrderFile } from '@/lib/types/database'
import { readPaymentNotes } from '@/lib/kiosk/payment'

export async function getAdminOrderDetailAction(orderId: string) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!isUuid(orderId)) return { ok: false as const, error: 'Invalid order.' }
  const row = await supabaseAdmin.from('orders').select('*,services(name,slug),queue_entries(*),order_files(*)').eq('id', orderId).maybeSingle()
  if (row.error || !row.data) return { ok: false as const, error: 'This order could not be found or loaded.' }
  const files = await Promise.all((row.data.order_files as OrderFile[] ?? []).map(async file => {
    let availability: 'local' | 'cloud' | 'missing' | 'unknown' = 'unknown'
    if (file.local_path) {
      try {
        const root = await fs.realpath(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles'), target = await fs.realpath(file.local_path)
        const relative = path.relative(root, target), stat = await fs.stat(target)
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && stat.isFile() && stat.size === Number(file.file_size)) availability = 'local'
      } catch {}
    }
    if (availability !== 'local') {
      const cloud = await supabaseAdmin.storage.from(file.storage_bucket).info(file.storage_path)
      if (cloud.data) availability = 'cloud'
      else if (String(cloud.error?.statusCode) === '404' || /not found/i.test(cloud.error?.message ?? '')) availability = 'missing'
    }
    return { id: file.id, file_name: file.file_name, file_type: file.file_type, file_size: file.file_size, availability }
  }))
  const history = await supabaseAdmin.from('audit_log').select('id,created_at,metadata').eq('event_type', 'print_submitted')
    .contains('metadata', { orderId }).order('created_at', { ascending: false }).limit(20)
  return { ok: true as const, data: { order: row.data as Order, service: firstRelation(row.data.services) as { name: string; slug: string } | null,
    queue: relationList(row.data.queue_entries)?.[0] as { queue_number: number; status: string } | undefined,
    payment: readPaymentNotes(row.data.customer_notes), files, printHistory: history.data ?? [], historyError: history.error ? 'Print history could not be loaded.' : null } }
}
