import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { computeGGCMetrics, interArrivalMinutes, sampleMoments } from './ggc-model'
import { pickupDeadline, planQueue, type DispatchSettings, type SchedulingJob } from './scheduling'
import { relationList, firstRelation } from '@/lib/supabase/relations'
import { ticketIsHeld } from '@/lib/sop/workflow'
import { loadSopSettings } from '@/lib/sop/settings-server'

export interface QueueSettings extends DispatchSettings { isConfigured: boolean }

export async function loadQueueSettings(): Promise<QueueSettings> {
  const { data, error } = await supabaseAdmin.from('queue_settings').select('*').eq('id', 1).single()
  if (['PGRST205', '42P01', 'PGRST116'].includes(error?.code ?? '')) {
    return { activeServers: 0, atcLookahead: 2, pagePenalty: 0, maxWaitMinutes: 60, isConfigured: false }
  }
  if (error || !data) throw new Error('Queue connection unavailable. Check the Supabase project and try again.')
  const sop=await loadSopSettings()
  return { activeServers: data.active_servers, atcLookahead: Number(data.atc_lookahead), pagePenalty: Number(data.page_penalty), maxWaitMinutes: Number(data.max_wait_minutes), isConfigured: true,dispatchMode:sop.policy.dispatchMode,completionBufferMinutes:sop.policy.completionBufferMinutes }
}

export function schedulingJob(order: {
  id: string; created_at: string; estimated_duration_minutes: number | null; service_options: Record<string, unknown>
  status: string; started_at: string | null; is_rush: boolean; order_files?: { page_count: number | null }[] | null; setup_duration_minutes?:number;ticket_released_at?:string|null
}): SchedulingJob {
  const knownPages = order.order_files?.flatMap(file => file.page_count === null ? [] : [file.page_count]) ?? []
  if (!order.estimated_duration_minutes || order.estimated_duration_minutes <= 0) throw new Error('An active order has no valid processing duration. Correct its service configuration before planning the queue.')
  return { id: order.id, createdAt: order.ticket_released_at ?? order.created_at, serviceMinutes: Number(order.estimated_duration_minutes),setupMinutes:Number(order.setup_duration_minutes ?? 0),
    dueAt: pickupDeadline(order.service_options), pageCount: knownPages.length ? knownPages.reduce((sum, count) => sum + count, 0) * Math.max(1, Number(order.service_options.Copies) || 1) : null,
    weight: 1, status: order.status, startedAt: order.started_at }
}

export async function loadQueueSnapshot(fallbackServiceMinutes?: number) {
  const settings = await loadQueueSettings()
  const now = Date.now(), windowMinutes = 60
  const [{ data: orders, error: ordersError }, { data: arrivals, error: arrivalsError }, { data: completed, error: completedError }, services] = await Promise.all([
    supabaseAdmin.from('orders').select('*, services(name, slug), queue_entries(queue_number, position, wait_time_minutes, estimated_wait_minutes, status), order_files(id, file_name, page_count, asset_classification)')
      .in('status', ['pending', 'queued', 'processing','finishing']).order('created_at').limit(2000),
    supabaseAdmin.from('orders').select('created_at,ticket_released_at,is_paid,payment_method,customer_notes,service_options,student_status').or(`ticket_released_at.gte.${new Date(now-windowMinutes*60000).toISOString()},and(ticket_released_at.is.null,created_at.gte.${new Date(now-windowMinutes*60000).toISOString()})`).order('created_at').limit(5000),
    supabaseAdmin.from('orders').select('id, order_number, source, created_at,ticket_released_at, started_at, completed_at, estimated_duration_minutes')
      .in('status', ['completed','collected']).gte('completed_at', new Date(now - 7 * 24 * 60 * 60_000).toISOString()).order('completed_at', { ascending: false }).limit(500),
    supabaseAdmin.from('services').select('estimated_duration_minutes').eq('is_active', true),
  ])
  if (ordersError || arrivalsError || completedError || services.error) throw new Error('Queue data unavailable. Check the Supabase connection and queue migration.')
  if ((orders?.length ?? 0) === 2000) throw new Error('Queue exceeds the planning limit. Contact the administrator before processing more orders.')
  const eligibleArrivals=(arrivals ?? []).filter(row=>!ticketIsHeld(row))
  const arrivalMoments = sampleMoments(interArrivalMinutes(eligibleArrivals.map(row => row.ticket_released_at ?? row.created_at)))
  const observations = (completed ?? []).flatMap(row => {
    const arrival = Date.parse(row.ticket_released_at ?? row.created_at), start = Date.parse(row.started_at ?? ''), end = Date.parse(row.completed_at ?? '')
    if (![arrival, start, end].every(Number.isFinite) || start < arrival || end <= start) return []
    return [{ orderNumber: row.order_number, source: row.source, arrivalAt: row.ticket_released_at ?? row.created_at, startedAt: row.started_at!, completedAt: row.completed_at!,
      waitMinutes: (start - arrival) / 60_000, serviceMinutes: (end - start) / 60_000, totalMinutes: (end - arrival) / 60_000 }]
  })
  const serviceMoments = sampleMoments(observations.map(row => row.serviceMinutes))
  const durations = (services.data ?? []).map(row => Number(row.estimated_duration_minutes)).filter(value => Number.isFinite(value) && value > 0)
  const configuredDuration = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null
  const serviceMinutes = serviceMoments.count ? serviceMoments.mean : fallbackServiceMinutes ?? configuredDuration
  if (!serviceMinutes || !Number.isFinite(serviceMinutes) || serviceMinutes <= 0) throw new Error('No observed or configured service duration is available for queue estimates.')
  const metrics = computeGGCMetrics({ arrivalRatePerMinute: arrivalMoments.count>0 && arrivalMoments.mean>0 ? 1/arrivalMoments.mean : eligibleArrivals.length / windowMinutes,
    averageServiceMinutes: serviceMinutes,
    arrivalScv: arrivalMoments.count >= 10 ? arrivalMoments.scv : 1,
    serviceScv: serviceMoments.count >= 10 ? serviceMoments.scv : 1, serverCount: settings.activeServers })
  metrics.arrivalSampleCount = arrivalMoments.count
  metrics.serviceSampleCount = serviceMoments.count
  metrics.calibration = settings.isConfigured && arrivalMoments.count >= 10 && serviceMoments.count >= 10 ? 'observed' : 'provisional'
  const normalizedOrders = (orders ?? []).filter(order=>!ticketIsHeld(order)).map(order => ({...order,services:firstRelation(order.services),queue_entries:relationList(order.queue_entries)}))
  const plan = planQueue(normalizedOrders.map(schedulingJob), settings, now)
  const meanWait = sampleMoments(observations.map(row => row.waitMinutes)).mean
  const meanTotal = sampleMoments(observations.map(row => row.totalMinutes)).mean
  return { orders: normalizedOrders, settings, metrics, plan, observations, updatedAt: new Date(now).toISOString(),
    empiricalWaitingBurdenRatio: meanTotal > 0 ? meanWait / meanTotal : null }
}
