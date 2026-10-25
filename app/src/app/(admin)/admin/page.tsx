'use client'

import Link from 'next/link'
import { CalendarDays, CheckCircle2, FileCheck2, Printer } from 'lucide-react'
import { getAdminDashboardAction, type AdminDashboardRow } from '@/lib/actions/admin-data'
import { ticketIsHeld } from '@/lib/sop/workflow'
import { pickupDeadline } from '@/lib/queue/scheduling'
import { customerLabel, money, timestamp } from '@/lib/admin/display'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import PrinterStatusPanel from '@/components/admin/printer-status-panel'
import DataHealthPanel from '@/components/admin/data-health-panel'
import { compactSpecs, EmptyOrders, OrderProgressAction } from '@/components/admin/order-ui'

export default function AdminDashboardPage() {
  const state = useAdminData(getAdminDashboardAction)
  const held = (state.data ?? []).filter(o=>ticketIsHeld(o) && !['cancelled','failed','collected'].includes(o.status))
  const orders = (state.data ?? []).filter(o=>!ticketIsHeld(o))
  const active = (o: AdminDashboardRow) => ['pending', 'queued', 'processing','finishing'].includes(o.status)
  const groups = [
    { label: 'Confirm print', icon: FileCheck2, tone: 'red', rows: orders.filter(o => ['pending', 'queued'].includes(o.status)) },
    { label: 'Printing / finishing', icon: Printer, tone: 'purple', rows: orders.filter(o => o.status === 'processing' || o.status==='finishing') },
    { label: 'Complete orders', icon: CheckCircle2, tone: 'green', rows: orders.filter(o => o.status === 'completed') },
    { label: 'Scheduled orders', icon: CalendarDays, tone: 'yellow', rows: orders.filter(o => active(o) && pickupDeadline(o.service_options)).sort((a,b) => Date.parse(pickupDeadline(a.service_options)!) - Date.parse(pickupDeadline(b.service_options)!)) },
  ]
  return <div className="admin-page ref-home">
    <PrinterStatusPanel />
    <div className="ref-section-heading"><h1>Order overview</h1><DataStatus {...state} /></div>
    <div>{held.length>0 && <p className="admin-payment-hold"><strong>{held.length} requests awaiting verification.</strong> <Link href="/admin/orders">Review payment and student checks</Link></p>}</div>
    <div className="ref-board ref-home-board">
      {groups.map(group => <section key={group.label} className={`ref-board-column ref-tone-${group.tone}`}>
        <h2 className="ref-board-heading"><span><group.icon size={23} />{group.label}</span><b>{state.data ? group.rows.length : '—'}</b></h2>
        <div className="ref-board-scroll">
          {group.rows.map(o => <article key={o.id} className="ref-home-card">
            <div className="ref-card-title"><Link href={'/admin/orders/' + o.id}>{group.tone === 'yellow' ? customerLabel(o) : o.order_number}</Link><strong>{money(o.total_price)}</strong></div>
            {group.tone === 'yellow' && <><p>{o.customer_phone || 'Phone not recorded'}</p><p className="ref-contact">{o.customer_email || 'Email not recorded'}</p></>}
            <p className="ref-compact-specs" title={compactSpecs(o.service_options)}>{compactSpecs(o.service_options)}</p>
            {group.tone === 'yellow' ? <Link className="ref-pickup-date" href={'/admin/orders/' + o.id}><CalendarDays size={18} />{timestamp(pickupDeadline(o.service_options))}</Link>
              : <OrderProgressAction order={o} refresh={state.refresh} disabled={!!state.error} />}
          </article>)}
          {!group.rows.length && <EmptyOrders>{state.loading ? 'Loading orders…' : state.error ? 'Orders unavailable. Use Refresh now.' : 'No orders in this stage.'}</EmptyOrders>}
        </div>
      </section>)}
    </div>
    <details className="ref-health-disclosure"><summary>Database connection & sync health</summary><DataHealthPanel /></details>
  </div>
}
