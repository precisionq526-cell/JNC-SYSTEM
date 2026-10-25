'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, Copy, Eye, FileText, MoreHorizontal, Pencil, Search, Users, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getAdminOrdersAction, type AdminOrderRow } from '@/lib/actions/admin-data'
import { updateOrderStatusAction } from '@/lib/actions/submit-order'
import { getOrderFileSignedUrl } from '@/lib/actions/storage-signed'
import { customerLabel, money, timestamp } from '@/lib/admin/display'
import { pickupDeadline } from '@/lib/queue/scheduling'
import type { OrderStatus } from '@/lib/types/database'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import AdminDialog from '@/components/admin/admin-dialog'
import { STATUS_LABELS, StatusBadge } from '@/components/admin/order-ui'
import {ticketIsHeld as awaitingOnlinePayment} from '@/lib/sop/workflow'

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['queued', 'processing', 'cancelled', 'failed'], queued: ['pending', 'processing', 'cancelled', 'failed'],
  processing: ['finishing', 'cancelled', 'failed'],finishing:['completed','cancelled','failed'], completed: [],collected:[], cancelled: [], failed: [],
}
function manilaDate(value: string) { return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) }
export default function OrdersPage() {
  const state = useAdminData(getAdminOrdersAction)
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [source, setSource] = useState('all')
  const [date, setDate] = useState('all'), [page, setPage] = useState(1), [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminOrderRow | null>(null), [nextStatus, setNextStatus] = useState<OrderStatus>('pending')
  const now = state.updatedAt ? Date.parse(state.updatedAt) : 0
  const today = state.updatedAt ? manilaDate(state.updatedAt) : ''
  const pendingPayments=(state.data ?? []).filter(o=>awaitingOnlinePayment(o) && !['cancelled','failed'].includes(o.status))
  const filtered = (state.data ?? []).filter(o => (status === 'all' || (status==='payment-review'?pendingPayments.some(row=>row.id===o.id):o.status === status))
    && (source === 'all' || (source === 'scheduled' ? !!pickupDeadline(o.service_options) : source === 'walk-in' ? !pickupDeadline(o.service_options) : o.source === source))
    && (date === 'all' || (date === 'today' ? manilaDate(o.created_at) === today : Date.parse(o.created_at) >= now - Number(date) * 86400000 && Date.parse(o.created_at) <= now))
    && [o.order_number, o.customer_name, o.customer_email, o.services?.name].some(v => v?.toLowerCase().includes(search.trim().toLowerCase())))
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), current = Math.min(page, pages)
  const edit = (o: AdminOrderRow) => { setEditing(o); setNextStatus(o.status) }
  const changeStatus = async () => {
    if (!editing) return
    setBusy(editing.id)
    try {
      const result = await updateOrderStatusAction(editing.id, nextStatus)
      if (!result.ok) toast.error(result.error ?? 'Status was not saved.')
      else { toast.success('Status saved.'); setEditing(null); if (result.warning) toast.error(result.warning); await state.refresh() }
    } catch { toast.error('Could not confirm the status change. Refresh before retrying.') }
    finally { setBusy(null) }
  }
  const openFile = async (file: NonNullable<AdminOrderRow['order_files']>[number]) => {
    try {
      if (file.localAvailable) {
        const response = await fetch('/api/open-local-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.id }) })
        const result = await response.json()
        if (!response.ok) throw Error(result.error ?? 'Local file unavailable')
        toast.success('File opened on the kiosk PC.')
      } else {
        const result = await getOrderFileSignedUrl(file.storage_path, file.file_name)
        if (!result.url) throw Error(result.error ?? 'Cloud file unavailable')
        const a = document.createElement('a'); a.href = result.url; a.download = file.file_name; a.click()
        toast.success('Download started.')
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'File unavailable.'); await state.refresh() }
  }
  return <div className="admin-page ref-orders-page">
    <div className="ref-page-heading"><h1>Orders</h1><Link href="/admin/collection" className="button button-outline">Scan ticket / collect order</Link><DataStatus {...state} /></div>
    {!!pendingPayments.length && <div className="admin-payment-hold"><strong>{pendingPayments.length} {pendingPayments.length===1?'request needs':'requests need'} verification</strong><p>Review the required payment and student-ID checks. Release the ticket only after every required check is approved.</p><button type="button" onClick={()=>{setStatus('payment-review');setPage(1)}}>Review pending requests</button></div>}
    <div className="ref-order-filters">
      <label className="ref-search"><Search size={23} /><input aria-label="Search orders" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search orders or customer" /></label>
      <select aria-label="Filter order status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="all">All statuses</option><option value="payment-review">Awaiting verification</option>{Object.keys(transitions).map(s => <option value={s} key={s}>{STATUS_LABELS[s as OrderStatus]}</option>)}</select>
      <select aria-label="Filter source" value={source} onChange={e => { setSource(e.target.value); setPage(1) }}><option value="all">All sources</option><option value="walk-in">Walk-in</option><option value="scheduled">Scheduled</option><option value="kiosk">Kiosk</option><option value="online">Online</option></select>
      <label className="ref-date-filter"><CalendarDays size={23} /><select aria-label="Filter order date" value={date} onChange={e => { setDate(e.target.value); setPage(1) }}><option value="all">All dates</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
    </div>
    <section className="ref-orders-panel" aria-labelledby="orders-list-title">
      <div className="ref-orders-panel-heading"><h2 id="orders-list-title">Orders ({state.data ? filtered.length : '—'})</h2><span>Auto refresh every 15s {state.updatedAt && ` · Updated ${new Date(state.updatedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}`}</span></div>
      <div className="ref-table-scroll"><table className="ref-orders-table"><thead><tr>{['Customer / arrival', 'Order / service', 'Status', 'Order total', 'Files / queue', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{filtered.slice((current - 1) * 10, current * 10).map((o, i) => <tr key={o.id}>
          <td><div className="ref-customer-cell"><div className="ref-row-number"><b>{(current - 1) * 10 + i + 1}</b><small>#{String(o.queue_entries?.[0]?.queue_number ?? '—').padStart(3, '0')}</small></div><span className={`ref-avatar ref-avatar-${i % 3}`}>{customerLabel(o).charAt(0).toUpperCase()}</span><div><Link className="ref-customer-name" href={'/admin/orders/' + o.id}>{customerLabel(o)}</Link><small>{timestamp(o.created_at)}</small><b className="ref-order-number">{o.order_number}</b><span className={`ref-source-tag ${pickupDeadline(o.service_options) ? 'scheduled' : ''}`}>{pickupDeadline(o.service_options) ? 'Scheduled' : 'Walk-in'}{o.source === 'online' ? ' · Online' : ''}</span></div></div></td>
          <td><b className="ref-service-name">{o.services?.name ?? 'Service unavailable'}</b><div className="ref-service-options">{Object.entries(o.service_options ?? {}).filter(([key, value]) => !['Pickup At', 'Pickup Date', 'Pickup Time', 'Transaction Type'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => <small key={key}><FileText size={13} />{key}: {String(value)}</small>)}</div></td>
          <td><StatusBadge status={o.status} /><small className="ref-status-description">{awaitingOnlinePayment(o)?'Verification required · ticket not released':o.status === 'processing' ? 'Printing in progress' : o.status==='finishing'?'Finishing and quality checks':o.status === 'completed' ? 'Ready for collection' : ['pending', 'queued'].includes(o.status) ? `In queue · ${o.queue_entries?.[0]?.position ? `Position #${o.queue_entries[0].position}` : 'Awaiting assignment'}` : 'Order closed'}</small><small className="ref-status-description">Updated {timestamp(o.updated_at)}</small></td>
          <td><strong className="ref-order-total">{money(o.total_price)}</strong><span className={`ref-payment-tag ${o.is_paid ? 'paid' : ''}`}>{o.is_paid ? 'Paid & approved' : awaitingOnlinePayment(o)?'Awaiting verification':'Unpaid'}</span>{awaitingOnlinePayment(o) && <Link className="ref-file-link" href={'/admin/orders/'+o.id+'#payment-review'}>Review request</Link>}</td>
          <td><small className="ref-file-count"><FileText size={15} />{o.order_files?.length ?? 0} {(o.order_files?.length ?? 0) === 1 ? 'file' : 'files'}</small>{o.order_files?.map(f => <button className="ref-file-link" title={f.localAvailable ? 'Open verified local copy' : 'Download cloud copy'} key={f.id} onClick={() => void openFile(f)}>{f.file_name}</button>)}<Link className="ref-queue-link" href="/admin/queue"><Users size={17} />Queue #{o.queue_entries?.[0]?.queue_number ?? '—'}</Link></td>
          <td><div className="ref-row-actions"><Link title="View order and files" aria-label={`View ${o.order_number}`} href={'/admin/orders/' + o.id}><Eye size={17} /></Link><button title="Update order status" aria-label={`Edit ${o.order_number}`} onClick={() => edit(o)}><Pencil size={16} /></button><details className="ref-more-menu"><summary aria-label={`More actions for ${o.order_number}`} title="More actions"><MoreHorizontal size={17} /></summary><div><button onClick={() => { void navigator.clipboard.writeText(o.order_number).then(() => toast.success('Order number copied.'), () => toast.error('Could not copy.')); }}><Copy size={15} />Copy order number</button><Link href={'/admin/orders/' + o.id}>Review files & print</Link><Link href="/admin/queue">View processing queue</Link></div></details></div></td>
        </tr>)}</tbody></table></div>
      {!filtered.length && <p className="ref-empty-line">{state.loading ? 'Loading orders…' : state.error ? 'Could not load orders. Use Refresh now.' : 'No matching database orders.'}</p>}
      <div className="ref-pagination"><span>Showing {filtered.length ? (current - 1) * 10 + 1 : 0}–{Math.min(current * 10, filtered.length)} of {filtered.length} orders</span><div><button disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button><span>{current} / {pages}</span><button disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button></div></div>
    </section>
    {editing && <AdminDialog onClose={() => setEditing(null)} busy={!!busy} titleId="edit-order-title"><button aria-label="Close order editor" className="ref-modal-close" disabled={!!busy} onClick={() => setEditing(null)}><X size={20} /></button><h2 id="edit-order-title">Update {editing.order_number}</h2><p>{customerLabel(editing)} · {editing.services?.name}</p><label className="ref-field">Order status<select data-dialog-autofocus="" aria-label={`Status for ${editing.order_number}`} value={nextStatus} disabled={!transitions[editing.status].length || !!busy} onChange={e => setNextStatus(e.target.value as OrderStatus)}>{[editing.status, ...transitions[editing.status]].map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>{!transitions[editing.status].length && <p>This order is closed. Its status is retained in history.</p>}{nextStatus === 'completed' && <p>Confirm that printing, finishing, and quality checks are complete.</p>}{['cancelled', 'failed'].includes(nextStatus) && nextStatus !== editing.status && <p>This will close the order and remove it from the active queue.</p>}<div className="ref-modal-actions"><button className="button button-outline" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={!!busy || !!state.error || nextStatus === editing.status} onClick={() => void changeStatus()}>{busy ? 'Saving…' : 'Save status'}</button></div></AdminDialog>}
  </div>
}


