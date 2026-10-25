'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CircleDollarSign, CreditCard, Download, FileText, Filter } from 'lucide-react'
import { getAdminHistoryAction, getAdminQueueAction } from '@/lib/actions/admin-data'
import { customerLabel, exportCsv, money, specifications } from '@/lib/admin/display'
import { pickupDeadline } from '@/lib/queue/scheduling'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import { EmptyOrders, OrderTimeline, QueueMetrics, StatusBadge } from '@/components/admin/order-ui'

export default function HistoryPage() {
  const state = useAdminData(getAdminHistoryAction)
  const queue = useAdminData(getAdminQueueAction, 30000)
  const [sort, setSort] = useState('recent')
  const rows = (state.data ?? []).slice().sort((a, b) => sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : sort === 'total' ? Number(b.total_price) - Number(a.total_price) : Date.parse(b.completed_at || b.updated_at) - Date.parse(a.completed_at || a.updated_at))
  const groups = [{ title: 'Walk-in print history', scheduled: false }, { title: 'Scheduled print history', scheduled: true }]
  const exportHistory = (scheduled: boolean) => exportCsv(scheduled ? 'scheduled-print-history.csv' : 'walk-in-print-history.csv', [
    ['Order', 'Customer', 'Source', 'Status', 'Arrival', 'Started', 'Finished', 'Pickup', 'Specifications', 'Order total', 'Paid', 'Payment method'],
    ...rows.filter(o => !!pickupDeadline(o.service_options) === scheduled).map(o => [o.order_number, customerLabel(o), o.source, o.status, o.created_at, o.started_at, o.completed_at, pickupDeadline(o.service_options), specifications(o.service_options), o.total_price, o.is_paid, o.payment_method]),
  ])
  return <div className="admin-page ref-history-page">
    <div className="ref-page-heading"><div><h1>Queue summary</h1><p>Completed jobs and past transactions, recorded directly from your orders.</p></div><DataStatus {...state} /></div>
    <QueueMetrics metrics={queue.data?.telemetry} />
    {queue.error && <p className="ref-error" role="alert">Queue statistics: {queue.error}</p>}
    {groups.map(group => {
      const orders = rows.filter(o => !!pickupDeadline(o.service_options) === group.scheduled)
      return <section className="ref-history-section" key={group.title}>
        <div className="ref-history-heading"><h2>{group.title}</h2><button onClick={() => exportHistory(group.scheduled)} disabled={!orders.length} title={`Export ${group.title.toLowerCase()}`} aria-label={`Export ${group.title.toLowerCase()}`}><Download size={21} /></button></div>
        <label className="ref-sort ref-history-sort"><Filter size={16} /><span>Sort by</span><select aria-label={`Sort ${group.title.toLowerCase()}`} value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Most recent completion</option><option value="oldest">Oldest arrival</option><option value="total">Highest order total</option></select></label>
        <div className="ref-history-list">{orders.map(o => <article className={`ref-history-card ${group.scheduled ? 'ref-border-purple' : 'ref-border-red'}`} key={o.id}>
          <div className="ref-history-card-heading"><FileText size={27} /><div><Link href={'/admin/orders/' + o.id}>{o.order_number}</Link><p>{customerLabel(o)}</p></div><StatusBadge status={o.status} history /></div>
          <div className="ref-history-card-body"><OrderTimeline order={o} /><div className="ref-history-specs"><FileText size={27} /><div><h3>Specifications</h3>{Object.entries(o.service_options ?? {}).filter(([key, value]) => !['Pickup At', 'Pickup Date', 'Pickup Time', 'Transaction Type'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => <p key={key}>{key}: {String(value)}</p>)}{!Object.keys(o.service_options ?? {}).length && <p>No specifications recorded.</p>}</div></div><div className="ref-history-payment"><div><CircleDollarSign size={27} /><span>Total<strong>{money(o.total_price)}</strong></span></div><div><CreditCard size={27} /><span>Payment<b className={`ref-payment-tag ${o.is_paid ? 'paid' : ''}`}>{o.is_paid ? 'Paid' : 'Unpaid'}</b>{o.payment_method && <small>{o.payment_method}</small>}</span></div></div></div>
        </article>)}{!orders.length && <EmptyOrders>{state.loading ? 'Loading history…' : state.error ? 'History unavailable. Use Refresh now.' : 'No recorded orders in this history.'}</EmptyOrders>}</div>
      </section>
    })}
  </div>
}
