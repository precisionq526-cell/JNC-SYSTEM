import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

dotenv.config({ path: '.env.local', quiet: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase environment is missing.')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const tables = ['profiles', 'services', 'service_options', 'orders', 'order_files', 'queue_entries', 'queue_settings', 'hardware_devices', 'print_job_assignments', 'failover_events', 'transfer_sessions']
const report = { checkedAt: new Date().toISOString(), tables: {}, consistency: {}, storage: {}, runtime: {} }
await Promise.all(tables.map(async table => {
  const result = await client.from(table).select('*', { count: 'exact', head: true })
  if (result.count === null && !result.error) {
    const check = await client.from(table).select('*').limit(1)
    report.tables[table] = check.error ? { available: false, error: check.error.message, code: check.error.code } : { available: true, count: null }
  } else report.tables[table] = result.error ? { available: false, error: result.error.message, code: result.error.code } : { available: true, count: result.count }
}))
const [ordersResult, filesResult, queueResult, settingsResult] = await Promise.all([
  client.from('orders').select('id,order_number,status,source,created_at,started_at,completed_at,local_synced,total_price,estimated_duration_minutes,service_options').limit(5000),
  client.from('order_files').select('id,order_id,file_name,file_type,file_size,storage_bucket,storage_path,is_downloaded,local_path').limit(5000),
  client.from('queue_entries').select('id,order_id,status,queue_number,position').limit(5000),
  client.from('queue_settings').select('*').eq('id', 1).maybeSingle(),
])
const orders = ordersResult.data || []
const files = filesResult.data || []
const queues = queueResult.data || []
const orderIds = new Set(orders.map(order => order.id))
const queuedOrderIds = new Set(queues.map(queue => queue.order_id))
const counts = values => values.reduce((result, value) => ({ ...result, [value]: (result[value] || 0) + 1 }), {})
const fileCounts = counts(files.map(file => file.order_id))
const queueCounts = counts(queues.map(queue => queue.order_id))
report.consistency = {
  readErrors: [ordersResult.error, filesResult.error, queueResult.error].filter(Boolean).map(error => error.message),
  orderStatuses: counts(orders.map(order => order.status)),
  activeOrdersMissingQueue: orders.filter(order => ['pending', 'queued', 'processing'].includes(order.status) && !queuedOrderIds.has(order.id)).length,
  duplicateQueueEntries: Object.values(queueCounts).filter(count => count > 1).length,
  queueStatusMismatches: queues.filter(queue => {
    const order = orders.find(order => order.id === queue.order_id)
    const expected = { pending:'waiting',queued:'waiting',processing:'serving',completed:'served',cancelled:'cancelled',failed:'cancelled' }
    return order && queue.status !== expected[order.status]
  }).length,
  orphanQueueEntries: queues.filter(queue => !orderIds.has(queue.order_id)).length,
  orphanFileRecords: files.filter(file => !orderIds.has(file.order_id)).length,
  ordersWithoutFiles: orders.filter(order => !fileCounts[order.id]).length,
  processingOrdersWithoutStart: orders.filter(order => order.status === 'processing' && !order.started_at).length,
  completedOrdersWithoutCompletion: orders.filter(order => order.status === 'completed' && !order.completed_at).length,
  completedOrdersWithoutStart: orders.filter(order => order.status === 'completed' && !order.started_at).length,
  unSyncedOrders: orders.filter(order => !order.local_synced).length,
  scheduledOrders: orders.filter(order => order.service_options?.['Transaction Type'] === 'schedule').length,
  invalidServiceDurations: orders.filter(order => !Number.isFinite(Number(order.estimated_duration_minutes)) || Number(order.estimated_duration_minutes) <= 0).length,
}
report.runtime.queueSettings = settingsResult.error ? { available: false, error: settingsResult.error.message } : settingsResult.data
const contract = await client.rpc('kiosk_data_contract_version')
report.runtime.dataContractVersion = contract.error ? null : contract.data
try {
  const response = await fetch(url + '/rest/v1/', { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) })
  const schema = await response.json()
  report.runtime.transitionRpcListed = Boolean(schema.paths?.['/rpc/transition_queue_order'])
  report.runtime.atomicSubmissionRpcListed = Boolean(schema.paths?.['/rpc/commit_order_submission'])
  report.runtime.rpcNames = Object.keys(schema.paths || {}).filter(name => name.startsWith('/rpc/')).map(name => name.slice(5))
} catch { report.runtime.transitionRpcListed = null }
let cloudPresent = 0, cloudMissing = 0, cloudErrors = 0, localPresent = 0, localMissing = 0
const unavailableFiles = [], sourceSizeMismatches = [], cloudOnlyFiles = []
await Promise.all(files.slice(0, 100).map(async file => {
  const localExists = Boolean(file.local_path && fs.existsSync(file.local_path))
  if (file.local_path) { if (localExists) localPresent++; else localMissing++ }
  const { data, error } = await client.storage.from(file.storage_bucket || 'order-files').info(file.storage_path)
  const order = orders.find(order => order.id === file.order_id)
  const reference = { fileId: file.id, orderNumber: order?.order_number ?? null, status: order?.status ?? null }
  const missingCloud = String(error?.statusCode) === '404' || error?.message?.toLowerCase().includes('not found')
  if (!localExists && missingCloud) unavailableFiles.push(reference)
  if (!localExists && data) cloudOnlyFiles.push(reference)
  if (data && Number(data.size ?? data.metadata?.size) !== Number(file.file_size)) sourceSizeMismatches.push({ ...reference, expectedBytes: Number(file.file_size), storedBytes: Number(data.size ?? data.metadata?.size) })
  if (data) cloudPresent++
  else if (missingCloud) cloudMissing++
  else cloudErrors++
}))
report.storage = {
  checkedFiles: Math.min(files.length, 100), cloudPresent, cloudMissing, cloudErrors, localPresent, localMissing,
  downloadedRecords: files.filter(file => file.is_downloaded).length,
  pendingDownloads: files.filter(file => !file.is_downloaded).length,
  missingEverywhere: unavailableFiles.length, unavailableFiles, sourceSizeMismatches, cloudOnlyFiles,
}
const target = path.resolve('../output/database-audit-current.json')
fs.writeFileSync(target, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
