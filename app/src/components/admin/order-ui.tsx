'use client'

import Link from 'next/link'
import { useState } from 'react'
import { BarChart3, CalendarDays, CheckCircle2, Clock3, Cog, FileText, Printer, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateOrderStatusAction } from '@/lib/actions/submit-order'
import { timestamp } from '@/lib/admin/display'
import type { Order, OrderStatus } from '@/lib/types/database'
import type { GGCMetrics } from '@/lib/queue/ggc-model'
import AdminDialog from './admin-dialog'
import {type PaymentRecord} from '@/lib/kiosk/payment'
import {ticketIsHeld as awaitingOnlinePayment} from '@/lib/sop/workflow'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending', queued: 'In queue', processing: 'Printing', finishing:'Finishing', completed: 'Ready for pickup', collected:'Collected', cancelled: 'Cancelled', failed: 'Failed',
}

export function StatusBadge({ status, history = false }: { status: OrderStatus; history?: boolean }) {
  const Icon = status === 'completed' ? CheckCircle2 : status === 'processing' ? Printer : Clock3
  return <span className="ref-status" data-status={status}><Icon size={17} />{history && status === 'collected' ? 'Collected / archived' : STATUS_LABELS[status]}</span>
}

export function compactSpecs(options: Order['service_options']) {
  return [options?.['Paper Size'], options?.['Print Color'] ?? options?.['Color Mode'], options?.['Pages to print'] ? `Pages: ${options['Pages to print']}` : null,
    options?.Copies ? `${options.Copies} ${Number(options.Copies) === 1 ? 'copy' : 'copies'}` : null].filter(Boolean).join(' · ') || 'Specifications not recorded'
}

export function QueueMetrics({ metrics }: { metrics?: GGCMetrics }) {
  const minutes = (n: number | null | undefined) => n != null && Number.isFinite(n) ? `${n.toFixed(1)} min` : 'Unavailable'
  return <div className="ref-queue-metrics">
    {([
      ['Estimated mean waiting time', metrics?.averageWaitQueueMinutes, Clock3],
      ['Mean service time', metrics?.averageServiceMinutes, Cog],
      ['Mean total time in the system', metrics?.averageSystemMinutes, BarChart3],
    ] as const).map(([label, value, Icon], i) => <div className={`ref-queue-metric ref-metric-${i}`} key={label}>
      <Icon size={42} strokeWidth={i === 1 ? 3 : 2.2} /><div><span>{label}</span><strong>{minutes(value)}</strong></div>
    </div>)}
  </div>
}

export function OrderTimeline({ order, estimate }: { order: Pick<Order, 'created_at' | 'started_at' | 'completed_at'>; estimate?: string | null }) {
  return <div className="ref-timeline">
    <div><CalendarDays size={23} /><span><b>Order arrival</b><small>{timestamp(order.created_at)}</small></span></div>
    <div><Clock3 size={23} /><span><b>Processing start</b><small>{order.started_at ? timestamp(order.started_at) : 'Not started'}</small></span></div>
    <div><CheckCircle2 size={23} /><span><b>{order.completed_at ? 'Completed' : 'Estimated end'}</b><small>{order.completed_at ? timestamp(order.completed_at) : estimate || 'Not available yet'}</small></span></div>
  </div>
}

export function OrderProgressAction({ order, refresh, disabled = false }: { order: Pick<Order, 'id' | 'order_number' | 'status'> & PaymentRecord; refresh: () => Promise<void>; disabled?: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const finish = async () => {
    setBusy(true)
    try {
      const result = await updateOrderStatusAction(order.id, order.status==='processing'?'finishing':'completed')
      if (!result.ok) { toast.error(result.error || 'Order could not be updated.'); return }
      toast.success(order.status==='processing'?'Moved to finishing.':'Order marked ready for pickup.'); setConfirm(false); await refresh()
      if (result.warning) toast.error(result.warning)
    } catch { toast.error('Could not confirm the update. Refresh before retrying.') }
    finally { setBusy(false) }
  }
  const completed = order.status === 'completed'
  if(awaitingOnlinePayment(order))return <Link className="ref-stage-action" href={'/admin/orders/'+order.id+'#payment-review'}><Clock3 size={21}/>Review request</Link>
  return <>
    {order.status === 'processing' || order.status==='finishing' ? <button className="ref-stage-action" disabled={disabled || busy} onClick={() => setConfirm(true)}><Printer size={21} />{order.status==='processing'?'Move to finishing':'Mark for pickup'}</button>
      : <Link className="ref-stage-action" href={'/admin/orders/' + order.id}>{completed ? <CheckCircle2 size={21} /> : <Printer size={21} />}{completed ? 'View completed order' : 'Confirm print'}</Link>}
    {confirm && <AdminDialog onClose={() => setConfirm(false)} busy={busy} titleId={`finish-${order.id}`}>
        <button aria-label="Close confirmation" className="ref-modal-close" disabled={busy} onClick={() => setConfirm(false)}><X size={20} /></button>
        <h2 id={`finish-${order.id}`}>{order.status==='processing'?'Move to finishing?':'Ready for pickup?'}</h2><p>{order.status==='processing'?'Confirm printing is complete. Continue with finishing and quality checks for ':'Confirm printing, finishing, and quality checks are complete for '}<b>{order.order_number}</b>.</p>
        <div className="ref-modal-actions"><button data-dialog-autofocus="" className="button button-outline" disabled={busy} onClick={() => setConfirm(false)}>Keep processing</button><button className="button button-primary" disabled={busy || disabled} onClick={() => void finish()}>{busy ? 'Saving…' : order.status==='processing'?'Confirm finishing':'Confirm ready'}</button></div>
    </AdminDialog>}
  </>
}

export function EmptyOrders({ children = 'No orders in this stage.' }: { children?: React.ReactNode }) {
  return <div className="ref-empty"><FileText size={28} /><p>{children}</p></div>
}

