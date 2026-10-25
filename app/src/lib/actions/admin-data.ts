'use server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import { loadQueueSettings, loadQueueSnapshot } from '@/lib/queue/queue-service'
import { pickupDeadline, type PlannedJob } from '@/lib/queue/scheduling'
import { scanWindowsPrinters, type PrinterScanSnapshot } from '@/lib/hardware/windows-printers'
import type { FailoverEvent, HardwareDevice, Order, OrderFile, Profile, QueueEntry, Service, ServiceOption } from '@/lib/types/database'
import { z } from 'zod'
import { relationList, firstRelation } from '@/lib/supabase/relations'
import { readAutomaticSyncStatus } from '@/lib/sync/automatic-sync'
import {ticketIsHeld as awaitingOnlinePayment} from '@/lib/sop/workflow'
import {loadSopSettings} from '@/lib/sop/settings-server'
import {intakeAvailability} from '@/lib/sop/policy'

export async function checkAdminDataHealthAction() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const [settings, orders, files, queues, contract] = await Promise.all([
    loadQueueSettings(),
    supabaseAdmin.from('orders').select('id,status').limit(1000),
    supabaseAdmin.from('order_files').select('id,order_id,local_path,file_size,storage_bucket,storage_path').limit(1000),
    supabaseAdmin.from('queue_entries').select('order_id,status').limit(1000),
    supabaseAdmin.rpc('kiosk_data_contract_version'),
  ])
  if (orders.error || files.error || queues.error) return { ok:false as const,error:'Data consistency check could not read the database.' }
  if ([orders.data?.length,files.data?.length,queues.data?.length].some(n=>n===1000)) return {ok:false as const,error:'Data check exceeds 1,000 records. Use a database audit.'}
  const queued = new Set(queues.data?.map(q=>q.order_id))
  const automaticSync = await readAutomaticSyncStatus()
  const expectedQueueStatus: Record<string,string> = {pending:'waiting',queued:'waiting',processing:'serving',finishing:'serving',completed:'served',collected:'served',cancelled:'cancelled',failed:'cancelled'}
  const queueStatusMismatches = queues.data?.filter(queue => {
    const order = orders.data?.find(order => order.id === queue.order_id)
    return order && queue.status !== expectedQueueStatus[order.status]
  }).length ?? 0
  let localAvailable=0,cloudAvailable=0,missingEverywhere=0,storageErrors=0
  for (const file of files.data ?? []) {
    let local=false
    try {local=!!file.local_path&&fs.statSync(file.local_path).isFile()&&fs.statSync(file.local_path).size===Number(file.file_size)}catch{}
    const cloud=await supabaseAdmin.storage.from(file.storage_bucket).info(file.storage_path)
    const missing=String(cloud.error?.statusCode)==='404'||cloud.error?.message?.toLowerCase().includes('not found')
    if(local)localAvailable++
    if(cloud.data)cloudAvailable++
    if(!local&&missing)missingEverywhere++
    if(cloud.error&&!missing)storageErrors++
  }
  return {ok:true as const,data:{orders:orders.data?.length??0,files:files.data?.length??0,
    ordersWithoutQueue:orders.data?.filter(o=>['pending','queued','processing'].includes(o.status)&&!queued.has(o.id)).length??0,queueStatusMismatches,
    localAvailable,cloudAvailable,missingEverywhere,storageErrors,queueConfigured:settings.isConfigured,
    atomicSubmissionAvailable:!contract.error&&contract.data===3,automaticSync,checkedAt:new Date().toISOString()}}
}
import type { GGCMetrics } from '@/lib/queue/ggc-model'
import type { QueueSettings } from '@/lib/queue/queue-service'
import fs from 'node:fs'

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export type AdminNotification = {
  id: string
  type: 'order' | 'failover'
  title: string
  body: string
  href: string
  createdAt: string
}

export type AdminOrderRow = Order & {
  services: Pick<Service, 'name' | 'slug'> | null
  queue_entries: Pick<QueueEntry, 'queue_number' | 'position'>[] | null
  order_files: (Pick<OrderFile, 'id' | 'file_name' | 'storage_path'> & { localAvailable: boolean })[] | null
}

export type AdminQueueRow = Order & {
  dispatch: PlannedJob
  pickupAt: string | null
  services: Pick<Service, 'name' | 'slug'> | null
  queue_entries: Pick<QueueEntry, 'queue_number' | 'position' | 'wait_time_minutes' | 'estimated_wait_minutes' | 'status'>[] | null
  order_files: Pick<OrderFile, 'id' | 'file_name' | 'page_count' | 'asset_classification'>[] | null
}

export type AdminDashboardRow = Order & {
  services: Pick<Service, 'name' | 'slug'> | null
  queue_entries: Pick<QueueEntry, 'queue_number' | 'position' | 'status'>[] | null
}

export type AdminFailoverRow = FailoverEvent & {
  from_device: Pick<HardwareDevice, 'device_name'> | null
  to_device: Pick<HardwareDevice, 'device_name'> | null
}

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  if (!hasServiceRoleConfig()) {
    return { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin') return { ok: false, error: 'Unauthorized' }

  return { ok: true, userId: user.id }
}

export async function getAdminOrdersAction(): Promise<ActionResult<AdminOrderRow[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, services ( name, slug ), queue_entries ( queue_number, position ), order_files ( id, file_name, storage_path, local_path, file_size )')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return { ok: false, error: error.message }
  if (data?.length === 1000) return { ok: false, error: 'Order list exceeds 1,000 records. Use a narrower database report.' }
  const rows = (data ?? []).map(order => ({ ...order, services: firstRelation(order.services), queue_entries: relationList(order.queue_entries), order_files: order.order_files?.map((file: OrderFile) => {
    let localAvailable = false
    try { localAvailable = !!file.local_path && fs.statSync(file.local_path).isFile() && fs.statSync(file.local_path).size === Number(file.file_size) } catch {}
    return { id: file.id, file_name: file.file_name, storage_path: file.storage_path, localAvailable }
  }) }))
  return { ok: true, data: rows as AdminOrderRow[] }
}

export async function getAdminDashboardAction(): Promise<ActionResult<AdminDashboardRow[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, services ( name, slug ), queue_entries ( queue_number, position, status )')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return { ok: false, error: error.message }
  if (data?.length === 1000) return { ok: false, error: 'Dashboard exceeds 1,000 records. Use a narrower database report.' }
  return { ok: true, data: (data ?? []).map(order => ({ ...order,services:firstRelation(order.services),queue_entries:relationList(order.queue_entries) })) as AdminDashboardRow[] }
}

export async function scanAdminPrintersAction(): Promise<ActionResult<PrinterScanSnapshot>> {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth
    return { ok: true, data: await scanWindowsPrinters() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not scan printers. Please try again.' }
  }
}

export async function getAdminQueueAction(): Promise<ActionResult<{
  orders: AdminQueueRow[]; telemetry: GGCMetrics; settings: QueueSettings; updatedAt: string
  empiricalWaitingBurdenRatio: number | null
  observations: { orderNumber: string; source: string; arrivalAt: string; startedAt: string; completedAt: string; waitMinutes: number; serviceMinutes: number; totalMinutes: number }[]
}>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  try {
    const snapshot = await loadQueueSnapshot()
    const byId = new Map(snapshot.plan.map(item => [item.id, item]))
    const orders = snapshot.orders.map(order => ({ ...order, dispatch: byId.get(order.id)!, pickupAt: pickupDeadline(order.service_options) })) as AdminQueueRow[]
    orders.sort((a, b) => (a.dispatch.position ?? 0) - (b.dispatch.position ?? 0))
    return { ok: true, data: { orders, telemetry: snapshot.metrics, settings: snapshot.settings, updatedAt: snapshot.updatedAt,
      observations: snapshot.observations, empiricalWaitingBurdenRatio: snapshot.empiricalWaitingBurdenRatio } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not refresh queue' }
  }
}

export async function updateQueueCapacityAction(activeServers: number): Promise<ActionResult<null>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!Number.isInteger(activeServers) || activeServers < 0 || activeServers > 2) return { ok: false, error: 'Choose zero, one, or two active staff slots.' }
  const { error } = await supabaseAdmin.from('queue_settings').update({ active_servers: activeServers, updated_at: new Date().toISOString() }).eq('id', 1).select('id').single()
  return error ? { ok: false, error: 'Staff availability could not be saved. Check the connection and queue setup.' } : { ok: true, data: null }
}

export async function getAdminOperationalStatusAction(): Promise<ActionResult<{ activeStaff: number | null; availablePrinters: number; totalPrinters:number; intakeState:string }>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  try {
    const [settings, devices,sop] = await Promise.all([
      loadQueueSettings(),
      scanWindowsPrinters(),loadSopSettings(),
    ])
    return { ok: true, data: { activeStaff: settings.isConfigured ? settings.activeServers : null, availablePrinters: devices.printers.filter(p=>p.status==='idle'||p.status==='warming_up').length,totalPrinters:devices.printers.length,intakeState:intakeAvailability(sop.policy).accepting?'Online':sop.policy.intakeState==='offline'?'Offline':'Closed' } }
  } catch { return { ok: false, error: 'Connection unavailable' } }
}

export async function getAdminHardwareSnapshotAction(): Promise<ActionResult<{
  devices: HardwareDevice[]
  events: AdminFailoverRow[]
}>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const [{ data: deviceRows, error: devicesError }, { data: eventRows, error: eventsError }] = await Promise.all([
    supabaseAdmin.from('hardware_devices').select('*').order('device_type').order('device_name'),
    supabaseAdmin
      .from('failover_events')
      .select('*, from_device:from_device_id(device_name), to_device:to_device_id(device_name)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (devicesError) return { ok: false, error: devicesError.message }
  if (eventsError) return { ok: false, error: eventsError.message }

  return {
    ok: true,
    data: {
      devices: (deviceRows ?? []) as HardwareDevice[],
      events: (eventRows ?? []) as AdminFailoverRow[],
    },
  }
}

export async function getAdminServicesAction(): Promise<ActionResult<Service[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data, error } = await supabaseAdmin
    .from('services')
    .select('*')
    .order('display_order')

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as Service[] }
}

export async function getAdminServiceConfigurationAction(): Promise<ActionResult<(Service & { service_options: ServiceOption[] })[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const result = await supabaseAdmin.from('services').select('*,service_options(*)').order('display_order')
  return result.error ? { ok: false, error: result.error.message } : { ok: true, data: result.data ?? [] }
}

const serviceConfiguration = z.object({
  id: z.string().uuid(), base_price: z.number().finite().min(0).max(999999),
  estimated_duration_minutes: z.number().int().min(1).max(1440), is_active: z.boolean(),
  options: z.array(z.object({ name: z.string().trim().min(1).max(80), option_type: z.enum(['select','number','toggle','text']),
    choices: z.array(z.string().trim().min(1).max(100)).max(50), default_value: z.string().max(2000).nullable(),
    price_modifier: z.number().finite().min(0).max(999999), is_required: z.boolean(), display_order: z.number().int().min(0).max(100) })).max(30),
})

export async function saveAdminServiceConfigurationAction(input: unknown): Promise<ActionResult<null>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const parsed = serviceConfiguration.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Check option names, prices and processing duration.' }
  const { options, ...service } = parsed.data
  const names = new Set<string>()
  for (const option of options) {
    if (names.has(option.name) || ['Transaction Type','Pickup At','Pickup Date','Pickup Time'].includes(option.name)) return { ok: false, error: 'Use distinct option names; pickup fields are managed by the order form.' }
    names.add(option.name)
    if (option.option_type === 'select' && (!option.choices.length || (option.default_value && !option.choices.includes(option.default_value)))) return { ok: false, error: 'Select options need choices and a matching default.' }
    if (option.option_type === 'number' && option.default_value && (!/^\d+$/.test(option.default_value) || Number(option.default_value) < 1)) return { ok: false, error: 'Numeric defaults must be positive whole numbers.' }
    if (option.option_type === 'toggle' && option.default_value && !['Yes','No'].includes(option.default_value)) return { ok: false, error: 'Toggle defaults must be Yes or No.' }
  }
  const result = await supabaseAdmin.rpc('save_service_configuration', { p_service: service, p_options: options, p_actor_id: auth.userId })
  return result.error ? { ok: false, error: result.error.code === 'PGRST202' ? 'Apply the database migration before saving service configuration.' : result.error.message } : { ok: true, data: null }
}

export async function getAdminProfilesAction(): Promise<ActionResult<Profile[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as Profile[] }
}

export async function getAdminHistoryAction(): Promise<ActionResult<Order[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const { data, error } = await supabaseAdmin.from('orders').select('*')
    .in('status', ['collected', 'cancelled', 'failed']).order('created_at', { ascending: false }).limit(1000)
  if (error) return { ok: false, error: error.message }
  if (data?.length === 1000) return { ok: false, error: 'History exceeds 1,000 records. Use a narrower database report.' }
  return { ok: true, data: data ?? [] }
}

export async function getAdminSettingsAction() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  try {
    const [settings, profile] = await Promise.all([loadQueueSettings(), supabaseAdmin.from('profiles').select('*').eq('id', auth.userId).single()])
    if (profile.error) return { ok: false as const, error: profile.error.message }
    return { ok: true as const, data: { settings, profile: profile.data as Profile, deviceAuthConfigured: !!process.env.KIOSK_DEVICE_TOKEN } }
  } catch { return { ok: false as const, error: 'Could not load system settings.' } }
}

export async function getAdminAnalyticsAction() {
  const queue = await getAdminQueueAction()
  if (!queue.ok) return queue
  let orders = 0, completed = 0, paidTotal = 0, unpaidTotal = 0
  for (let start = 0; start < 100_000; start += 500) {
    const { data, error } = await supabaseAdmin.from('orders').select('status,is_paid,total_price').range(start, start + 499)
    if (error) return { ok: false as const, error: error.message }
    for (const row of data ?? []) {
      orders++
      if (row.status === 'completed' || row.status === 'collected') completed++
      if (!['cancelled', 'failed'].includes(row.status)) {
        if (row.is_paid) paidTotal += Number(row.total_price)
        else unpaidTotal += Number(row.total_price)
      }
    }
    if ((data?.length ?? 0) < 500) {
      const observations = queue.data.observations
      return { ok: true as const, data: { orders, completed, paidTotal, unpaidTotal, queue: queue.data,
        meanServiceMinutes: observations.length ? observations.reduce((sum, row) => sum + row.serviceMinutes, 0) / observations.length : null,
        meanWaitMinutes: observations.length ? observations.reduce((sum, row) => sum + row.waitMinutes, 0) / observations.length : null } }
    }
  }
  return { ok: false as const, error: 'Analytics exceeds the report limit.' }
}

export async function getAdminNotificationsAction(): Promise<ActionResult<AdminNotification[]>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const [{ data: orderRows, error: ordersError }, { data: failoverRows, error: failoverError }] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select('id, order_number, customer_name, source, status, created_at,is_paid,payment_method,customer_notes,service_options,student_status')
      .order('created_at', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('failover_events')
      .select('id, reason, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if (ordersError) return { ok: false, error: ordersError.message }

  const notifications: AdminNotification[] = (orderRows ?? []).map((order) => ({
    id: `order-${order.id}`,
    type: 'order',
    title: awaitingOnlinePayment(order)?'Request verification required':`Order ${order.order_number}`,
    body: awaitingOnlinePayment(order)?`${order.customer_name || 'Customer'} has a request awaiting payment or student verification. Review the required checks before ticket release.`:`${order.customer_name || (order.source === 'kiosk' ? 'Walk-in' : 'Online customer')} is ${order.status}.`,
    href: '/admin/orders/'+order.id+(awaitingOnlinePayment(order)?'#payment-review':''),
    createdAt: order.created_at,
  }))

  if (!failoverError) {
    notifications.push(...(failoverRows ?? []).map((event) => ({
      id: `failover-${event.id}`,
      type: 'failover' as const,
      title: event.status === 'rerouted' ? 'Job rerouted' : 'Job needs assignment',
      body: event.reason,
      href: '/admin/kiosks',
      createdAt: event.created_at,
    })))
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return { ok: true, data: notifications.slice(0, 12) }
}
