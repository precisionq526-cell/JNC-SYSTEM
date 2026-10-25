import 'server-only'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/utils/uuid'
import type { Order, OrderFile } from '@/lib/types/database'
import { readOrderFile, prepareFilePdf } from './order-files'

const cache = new Map<string, { bytes: Buffer; createdAt: number }>()
export async function getVerifiedOrderFile(orderId: string, fileId: string) {
  if (!isUuid(orderId) || !isUuid(fileId)) throw new Error('Invalid order or file identifier.')
  const [order, file] = await Promise.all([
    supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabaseAdmin.from('order_files').select('*').eq('order_id', orderId).eq('id', fileId).maybeSingle(),
  ])
  if (order.error || file.error || !order.data || !file.data) throw new Error('This file does not belong to the selected order or could not be loaded.')
  const loaded = await readOrderFile(file.data as OrderFile)
  return { order: order.data as Order, file: file.data as OrderFile, ...loaded }
}

export async function getOrderPrintPdf(orderId: string, fileId: string) {
  const loaded = await getVerifiedOrderFile(orderId, fileId)
  const key = createHash('sha256').update(loaded.bytes).update(loaded.file.file_name).update(JSON.stringify(loaded.order.service_options)).digest('hex')
  let pdf = cache.get(key)
  if (!pdf || Date.now() - pdf.createdAt > 300000) {
    const bytes = await prepareFilePdf(loaded.bytes, loaded.file.file_name, loaded.file.file_type, loaded.order.service_options)
    pdf = { bytes, createdAt: Date.now() }
    if (bytes.length < 15000000) { if (cache.size >= 6) cache.delete(cache.keys().next().value!); cache.set(key, pdf) }
  }
  return { ...loaded, pdf: pdf.bytes }
}
