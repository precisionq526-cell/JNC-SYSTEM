'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, CheckCircle2, Download, Filter, Printer, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { getAdminDashboardAction, getAdminQueueAction, updateQueueCapacityAction } from '@/lib/actions/admin-data'
import { customerLabel, exportCsv, timestamp } from '@/lib/admin/display'
import { pickupDeadline } from '@/lib/queue/scheduling'
import { useAdminData } from './use-admin-data'
import DataStatus from './data-status'
import { compactSpecs, EmptyOrders, OrderProgressAction, OrderTimeline, QueueMetrics, StatusBadge } from './order-ui'

export function QueueManager({ lane = 'all' }: { lane?: 'all' | 'walk-in' | 'schedule' }) {
  const state = useAdminData(getAdminQueueAction)
  const completedState = useAdminData(getAdminDashboardAction, 30000)
  const [sort, setSort] = useState('dispatch'), [busy, setBusy] = useState(false)
  const data = state.data
  const refresh = async () => { await Promise.all([state.refresh(), completedState.refresh()]) }
  const orders = (data?.orders.filter(order => lane === 'all' || (lane === 'schedule' ? !!order.pickupAt : !order.pickupAt)) ?? []).slice().sort((a, b) => sort === 'recent' ? Date.parse(b.created_at) - Date.parse(a.created_at) : sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : (a.dispatch.position ?? 0) - (b.dispatch.position ?? 0))
  const processing = data?.orders.filter(order => order.status === 'processing' || order.status==='finishing').length ?? 0
  const completed = completedState.data?.filter(o => o.status === 'completed' && !!pickupDeadline(o.service_options)) ?? []
  const changeCapacity = async (value: number) => {
    setBusy(true)
    try { const result = await updateQueueCapacityAction(value); if (!result.ok) toast.error(result.error); else { toast.success('Staff availability saved.'); await state.refresh() } }
    catch { toast.error('Staff availability could not be saved. Refresh and try again.') }
    finally { setBusy(false) }
  }
  const exportStudy = () => {
    if (!data) return
    exportCsv('jandc-queue-time-study.csv', [['Order number', 'Channel', 'Arrival time', 'Service start', 'Service end', 'Waiting minutes', 'Service minutes', 'Total minutes'], ...data.observations.map(row => [row.orderNumber, row.source, row.arrivalAt, row.startedAt, row.completedAt, row.waitMinutes, row.serviceMinutes, row.totalMinutes])])
  }
  const estimate = (minutes: number | null) => minutes !== null && state.updatedAt ? timestamp(new Date(Date.parse(state.updatedAt) + minutes * 60000).toISOString()) : null
  const groups = [
    { label: 'Confirm print', tone: 'red', Icon: Printer, rows: orders.filter(o => ['pending','queued'].includes(o.status)) },
    { label: 'Printing / finishing', tone: 'purple', Icon: Printer, rows: orders.filter(o => o.status === 'processing' || o.status==='finishing') },
    { label: 'Complete orders', tone: 'green', Icon: CheckCircle2, rows: completed },
  ]
  return <div className="admin-page ref-queue-page">
    <div className="ref-page-heading"><div><h1>Queue summary</h1><p>{data?.settings.dispatchMode==='walkins-first'?'Walk-ins stay in arrival order; scheduled work follows ATC-P priority when walk-ins clear.':'Deadline-aware dispatch protects long waits and urgent pickups.'}</p></div><DataStatus {...state} refresh={refresh} /></div>
    <QueueMetrics metrics={data?.telemetry} />
    <div className="ref-queue-toolbar"><label className="ref-sort"><Filter size={22} /><span>Sort by</span><select aria-label="Sort queue" value={sort} onChange={e => setSort(e.target.value)}><option value="dispatch">Dispatch priority</option><option value="recent">Most recent</option><option value="oldest">Oldest arrival</option></select></label><details className="ref-queue-options"><summary><Users size={16} />Queue controls</summary><div><label>Active processing staff<select aria-label="Active processing staff" value={data?.settings.activeServers ?? ''} disabled={!data?.settings.isConfigured || busy || !!state.error} onChange={e => void changeCapacity(Number(e.target.value))}>{!data && <option value="">Loading…</option>}<option value="0">0 — Queue paused</option><option value="1">1 staff slot</option><option value="2">2 staff slots</option></select></label><span>{processing} currently processing</span><Link href={lane === 'all' ? '/admin/walk-ins' : '/admin/queue'}>{lane === 'all' ? 'View walk-ins' : 'View combined queue'}</Link><button onClick={exportStudy} disabled={!data?.observations.length || !!state.error}><Download size={16} />Export time study</button></div></details></div>
    {data && !data.settings.isConfigured && <p className="ref-error" role="alert">Queue setup pending. Staff capacity and wait estimates are unavailable.</p>}
    {lane === 'schedule' ? <div className="ref-board ref-scheduled-board">{groups.map(group => <section key={group.tone} className={`ref-board-column ref-tone-${group.tone}`}><h2 className="ref-board-heading"><span><group.Icon size={24} />{group.label}</span><b>{group.tone === 'green' ? completedState.data ? group.rows.length : '—' : data ? group.rows.length : '—'}</b></h2><div className="ref-board-scroll">{group.rows.map(o => {
      const planned = orders.find(row => row.id === o.id)
      return <article className="ref-scheduled-card" key={o.id}><div className="ref-scheduled-card-heading"><Link href={'/admin/orders/' + o.id}>{o.order_number}</Link><StatusBadge status={o.status} history /></div><p className="ref-customer-caption">{customerLabel(o)}</p><p className="ref-compact-specs"><Printer size={14} />{compactSpecs(o.service_options)}</p><OrderTimeline order={o} estimate={planned ? estimate(planned.dispatch.estimatedCompletionMinutes) : null} /><div className="ref-preferred-pickup"><CalendarDays size={25} /><div><small>Customer preferred pickup</small><b>{timestamp(pickupDeadline(o.service_options))}</b><span>Customer-selected pickup time</span></div></div><OrderProgressAction order={o} refresh={refresh} disabled={!!state.error || !data?.settings.isConfigured} /></article>
    })}{!group.rows.length && <EmptyOrders>{state.loading || (group.tone === 'green' && completedState.loading) ? 'Loading orders…' : group.tone === 'green' && completedState.error ? 'Completed orders unavailable.' : 'No scheduled orders in this stage.'}</EmptyOrders>}</div></section>)}</div>
      : <div className="ref-walkin-grid">{orders.map(order => <article className={`ref-walkin-card ${order.status === 'processing' ? 'ref-border-red' : 'ref-border-purple'}`} key={order.id}>
        <div className="ref-walkin-heading"><div><Link href={'/admin/orders/' + order.id}>Order {order.order_number}</Link><p>{customerLabel(order)}</p></div><StatusBadge status={order.status} /></div>
        <dl className="ref-walkin-details"><div><dt>Position in queue</dt><dd>{order.dispatch.position ? `#${order.dispatch.position}` : 'In service'}</dd></div><div><dt>Specifications</dt><dd>{compactSpecs(order.service_options)}</dd></div><div><dt>Customer order</dt><dd>{order.pickupAt ? 'Scheduled' : 'Walk-in'}{order.source === 'online' ? ' · Online' : ''}</dd></div><div><dt>Priority status</dt><dd>{order.dispatch.reason}</dd></div></dl>
        <div className="ref-walkin-timeline"><h3>Order timeline</h3><div><span>Arrival time<b>{timestamp(order.created_at)}</b></span><span>Service time<b>{order.started_at ? timestamp(order.started_at) : 'Not started'}</b></span><span>{order.completed_at ? 'Service end' : 'Estimated end'}<b>{order.completed_at ? timestamp(order.completed_at) : estimate(order.dispatch.estimatedCompletionMinutes) || 'Unavailable'}</b></span></div></div>
        <div className="ref-walkin-footer"><span>{order.dispatch.estimatedWaitMinutes === null ? 'Waiting estimate unavailable' : ['processing','finishing'].includes(order.status) ? 'Currently in service' : `Estimated wait: ${order.dispatch.estimatedWaitMinutes} min`}</span><OrderProgressAction order={order} refresh={refresh} disabled={!!state.error || !data?.settings.isConfigured} /></div>
      </article>)}{!orders.length && <EmptyOrders>{state.loading ? 'Loading queue…' : state.error ? 'Queue unavailable. Use Refresh now.' : `No active ${lane === 'walk-in' ? 'walk-in ' : ''}orders.`}</EmptyOrders>}</div>}
    {lane === 'schedule' && completedState.error && <p className="ref-error" role="alert">Completed orders: {completedState.error}</p>}
    <details className="ref-model-details"><summary>Queue estimates and timing data</summary><p>{data?.telemetry.systemStatus === 'paused' ? 'Queue paused. Existing work can finish; waiting jobs need staff.' : data?.telemetry.systemStatus === 'overloaded' ? 'Demand exceeds capacity. Long-term average wait is unavailable.' : `${data?.telemetry.utilization == null ? 'Unavailable' : Math.round(data.telemetry.utilization * 100) + '%'} estimated capacity used.`} {data?.telemetry.calibration === 'provisional' ? 'Provisional model: more timing samples are needed.' : 'The model uses observed arrival and service variability.'} Estimates may change.</p><p>G/G/{data?.telemetry.serverCount || 'c'} estimates occupied processing slots. Staff and printers are separate resources. Arrivals use the last 60 minutes; completed timings use the last 7 days, up to 500 jobs. Fewer than 10 samples use a variability assumption of 1.</p><p>{data?.settings.dispatchMode==='walkins-first'?'Walk-ins are served first in arrival order. Scheduled ATC-P uses pickup slack, setup time, and print duration after walk-ins clear.':`Deadline-aware mode prioritizes urgent pickups and protects the oldest job after ${data?.settings.maxWaitMinutes ?? 60} minutes.`} Completion projections include a {data?.settings.completionBufferMinutes ?? 2}-minute buffer. Queue numbers stay unchanged.</p>{data && <dl><div><dt>Arrival variability (Cₐ²)</dt><dd>{data.telemetry.arrivalScv.toFixed(2)} · {data.telemetry.arrivalSampleCount} intervals</dd></div><div><dt>Service variability (Cₛ²)</dt><dd>{data.telemetry.serviceScv.toFixed(2)} · {data.telemetry.serviceSampleCount} completed jobs</dd></div></dl>}</details>
  </div>
}
