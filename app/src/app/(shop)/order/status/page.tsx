'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, CheckCheck, CircleAlert, Clock3, FileSearch, LoaderCircle, Printer, RefreshCw, Search, Ticket } from 'lucide-react'
import { getOrderTrackingByNumberAction } from '@/lib/actions/submit-order'
import {ShopHours} from '@/components/shop/shop-hours'

type Tracking = Extract<Awaited<ReturnType<typeof getOrderTrackingByNumberAction>>, { ok: true }>['data']
const statusDetails = {
  pending: { label: 'Pending', text: 'Your order is waiting to join the print queue.', icon: Clock3 },
  queued: { label: 'In queue', text: 'Your order is in line. We’ll start printing as soon as a printer is available.', icon: Clock3 },
  processing: { label: 'Printing', text: 'Your documents are being prepared and printed.', icon: Printer },
  finishing: {label:'Finishing',text:'Your prints are undergoing finishing and quality checks.',icon:Printer},
  collected: {label:'Collected',text:'This order has been collected and recorded in the transaction history.',icon:CheckCheck},
  completed: { label: 'Ready for pickup', text: 'Your prints are ready! Visit the shop during pickup hours to collect them.', icon: CheckCheck },
  cancelled: { label: 'Cancelled', text: 'This order was cancelled. Please contact the shop if you need help.', icon: CircleAlert },
  failed: { label: 'Needs attention', text: 'We couldn’t complete this order. Please contact the shop for assistance.', icon: CircleAlert },
}

export default function OnlineStatusPage() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [request, setRequest] = useState(0)
  const [data, setData] = useState<Tracking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  useEffect(() => {
    const order = new URLSearchParams(window.location.search).get('order')?.trim()
    if (order) { setQuery(order); setSearched(order.toUpperCase()) }
  }, [])
  useEffect(() => {
    if (!searched) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    setLoading(true); setData(null); setError(null); setUpdatedAt(null)
    const refresh = async () => {
      try {
        const result = await getOrderTrackingByNumberAction(searched)
        if (stopped) return
        if (result.ok) { setData(result.data); setError(null); setUpdatedAt(new Date()) }
        else setError(result.error)
      } catch { if (!stopped) setError('We couldn’t check your order. Check your connection and try again.') }
      finally { if (!stopped) { setLoading(false); timer = setTimeout(refresh, 15000) } }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [searched, request])
  const status = data?.status ? statusDetails[data.status] : null
  const StatusIcon = status?.icon ?? Clock3
  const finished = data?.status && ['completed', 'collected', 'cancelled', 'failed'].includes(data.status)
  return <div className="tracking-content">
    <section className="surface tracking-lookup">
      <div>
        <p className="eyebrow"><Search size={14} /> SIMPLE PRINTING. CLEAR STATUS.</p>
        <h1>Track your order</h1>
        <p className="panel-description">Enter the full order number from your ticket. Status refreshes from the database every 15 seconds.</p>
        <form className="lookup-form" onSubmit={event => { event.preventDefault(); setSearched(query.trim().toUpperCase()); setRequest(value => value + 1) }}>
          <div className="field"><label htmlFor="order-number">Order number</label><input id="order-number" value={query} onChange={event => setQuery(event.target.value)} placeholder="ORD-YYYYMMDD-001" required autoComplete="off" autoCapitalize="characters" spellCheck={false} /></div>
          <button type="submit" className="button button-primary" disabled={loading}>{loading ? <LoaderCircle size={17} className="loading-spin" /> : <Search size={17} />}{loading ? 'Finding…' : 'Find order'}</button>
        </form>
        <p className="lookup-refresh"><RefreshCw size={13} /> Automatically checks for updates every 15 seconds</p>
      </div>
      <div className="tracking-poster"><Image src="/order-assets/services-poster.png" alt="Printing and digital services offered at JandC Internet Cafe" width={950} height={621} sizes="(max-width: 760px) 90vw, 450px" /></div>
    </section>
    {loading && <div className="tracking-feedback surface" role="status"><LoaderCircle size={24} className="loading-spin" /><p>Finding the latest update for your order…</p></div>}
    {error && <div className="tracking-feedback tracking-error surface" role="alert"><CircleAlert size={25} /><div><h3>Let’s check that again</h3><p>{error} {data && 'The status below is the last successful update.'}</p></div><button type="button" className="button button-outline" onClick={() => setRequest(value => value + 1)} disabled={loading}><RefreshCw size={15} /> Try again</button></div>}
    {data?.offline && <p className="sop-closed-banner" role="status">This is the last status saved on the shop server. Live status and processing resume after reconnection. Keep your existing ticket.</p>}
    {data && status && <section className="surface tracking-card" aria-label="Order tracking result" aria-live="polite">
      <div className="tracking-top"><div><p>YOUR ORDER</p><h2>{data.orderNumber}</h2></div><span className="status-pill" data-status={data.status}>{status.label}</span></div>
      <div className="tracking-grid">
        <div className="tracking-state" data-status={data.status}>
          <div className="tracking-state-title"><StatusIcon size={23} /><h3>{status.label}</h3></div><p>{status.text}</p>
          {!finished && <dl className="tracking-metrics"><div><dt>Ticket in queue</dt><dd>{data.queueNumber == null ? '—' : `#${data.queueNumber}`}</dd></div><div><dt>Estimated wait</dt><dd>{data.estimatedWaitMinutes == null ? '—' : `~${data.estimatedWaitMinutes}m`}</dd></div></dl>}
          {!finished && <p className="tracking-wait-note">{data.waitEstimateLabel ?? 'Wait times may change as orders are processed.'}</p>}
        </div>
        <div className="tracking-details"><h3>Order details</h3><dl><div className="detail-row"><dt>Date ordered</dt><dd>{new Date(data.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd></div><div className="detail-row"><dt>Queue number</dt><dd>{data.queueNumber == null ? 'Not assigned' : `#${data.queueNumber}`}</dd></div></dl>
          <div className="pickup-detail"><Clock3 size={20} /><div><strong>{data.pickupAt?'Scheduled pickup':'Pickup hours'}</strong><p>{data.pickupAt ? new Date(data.pickupAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : <ShopHours/>}</p></div></div>
          <p className="lookup-refresh">Payment: {data.isPaid ? 'Verified and paid' : 'Awaiting payment or staff verification'}</p>
          {updatedAt && <p className="lookup-refresh"><RefreshCw size={12} /> Last checked {updatedAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>}
        </div>
      </div>
      <div className="tracking-result-footer"><Ticket size={15} /><span>Keep your order number handy when you collect your prints.</span></div>
    </section>}
    {!searched && <div className="tracking-empty"><FileSearch size={30} /><h3>Your next update starts here.</h3><p>Have your ticket number ready? Enter it above.</p></div>}
    <div className="tracking-new-order">Need something else printed? <Link href="/order/service/printing">Start a new order <ArrowRight size={14} /></Link></div>
  </div>
}
