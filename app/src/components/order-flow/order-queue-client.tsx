'use client'

import Link from 'next/link'
import Image from 'next/image'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Ticket, Search, ArrowRight, Clock3, RefreshCw, ShieldCheck } from 'lucide-react'
import type { OrderSubmission } from '@/lib/kiosk/order-draft'
import { isPendingPayment, submissionFromResult } from '@/lib/kiosk/order-release'
import { useSessionJson } from '@/lib/kiosk/use-session-json'
import { getOrderReleaseAction } from '@/lib/actions/submit-order'
import { formatCurrency } from '@/lib/utils/format'
import type { OrderStatus } from '@/lib/types/database'

export function OrderQueueClient({
  ticketStorageKey,
  homeHref,
  initialSubmission,
}: {
  ticketStorageKey: string
  homeHref: string
  initialSubmission?: OrderSubmission
}) {
  const stored = useSessionJson<OrderSubmission>(ticketStorageKey)
  const [updated,setUpdated] = useState<OrderSubmission|null>(null)
  const ticket = updated ?? initialSubmission ?? stored
  const [qr,setQr] = useState('')
  useEffect(()=>{let active=true;setQr('');if(ticket?.pickupToken && ticket.kind!=='payment-pending')void QRCode.toDataURL('JNC:'+ticket.pickupToken,{width:220,margin:2}).then(url=>{if(active)setQr(url)});return()=>{active=false}},[ticket?.pickupToken,ticket?.kind])
  const [checking,setChecking] = useState(false), [checkedAt,setCheckedAt] = useState<string|null>(null)
  const refreshRef = useRef<()=>Promise<void>>(async()=>{})
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<OrderStatus | null>(null)
  const [liveWait, setLiveWait] = useState<number | null>(null)
  const [liveWaitLabel, setLiveWaitLabel] = useState<string | null>(null)
  const [hasLiveUpdate, setHasLiveUpdate] = useState(false)
  const [isPaid,setIsPaid] = useState(false)
  const [notified, setNotified] = useState(false)

  useEffect(() => {
    if (!ticket?.orderId || !ticket.synced) return

    let stopped = false
    let refreshing = false
    const refresh = async () => {
      if (stopped || refreshing) return
      refreshing = true;setChecking(true)
      try {
        const result = await getOrderReleaseAction(ticket.orderId!)
        if (stopped) return
        if (!result.ok) { setTrackingError(result.error ?? 'Status refresh failed.'); return }
        const next = submissionFromResult(result,ticket)
        setTrackingError(null)
        setUpdated(next);setCheckedAt(new Date().toISOString())
        try {sessionStorage.setItem(ticketStorageKey,JSON.stringify(next))} catch {setTrackingError('Your request is saved. Keep this page open; this browser could not save the latest confirmation locally.')}
        setHasLiveUpdate(true)
        setIsPaid(result.isPaid === true)
        setLiveWaitLabel(result.waitEstimateLabel ?? null)
        setLiveStatus(result.status ?? null)
        setLiveWait(typeof result.estimatedWaitMinutes === 'number' ? result.estimatedWaitMinutes : null)
        if (!result.offline && result.status === 'completed' && !isPendingPayment(next) && !notified) {
          setNotified(true)
          if ('Notification' in window) {
            if (Notification.permission === 'granted') {
              new Notification('Your print order is ready', {
                body: `${next.orderNumber} is finished. You may now walk to the shop.`,
              })
            } else if (Notification.permission === 'default') {
              Notification.requestPermission().then((permission) => {
                if (permission === 'granted') {
                  new Notification('Your print order is ready', {
                    body: `${next.orderNumber} is finished. You may now walk to the shop.`,
                  })
                }
              })
            }
          }
        }
      } catch {
        if (!stopped) setTrackingError('We could not check your request. We will retry automatically. Please do not send another payment.')
      } finally { refreshing = false;if(!stopped)setChecking(false) }
    }

    refreshRef.current=refresh
    void refresh()
    const interval = setInterval(refresh, 15000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
    // Poll by the private request ID; approval and ticket release come from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notified, ticket?.orderId, ticket?.synced,ticketStorageKey])

  if (!ticket?.orderId || !ticket.synced) return (
    <div className="empty-state"><Ticket size={44} /><h1>No active ticket</h1><p>Submit an order to receive your ticket number.</p><Link href={homeHref} className="button button-primary">Start an order <ArrowRight size={17} /></Link></div>
  )

  const ready = liveStatus === 'completed'
  const collected = liveStatus === 'collected'
  const closed = liveStatus === 'cancelled' || liveStatus === 'failed'
  const waiting=isPendingPayment(ticket) || (ticket.paymentMethod!==undefined && ticket.paymentMethod!=='cash' && (!hasLiveUpdate || !isPaid))
  if(waiting)return <div className="ticket-screen payment-waiting-screen" aria-live="polite">
    <div className="payment-waiting-icon"><Clock3 size={34}/></div>
    <h1>{closed?'Print request '+liveStatus:ticket.holdReason ?? 'Waiting for payment confirmation'}</h1>
    <p className="ticket-subtitle">{closed?'Contact the shop about this request and your payment.':'Your request has been saved and is waiting for the required staff verification.'}</p>
    <p className="sop-closed-banner" hidden={!ticket.offline}>Saved on this shop server. Staff verification and live status resume after reconnection; your files and proofs will synchronize automatically.</p>
    <section className="payment-waiting-card" aria-label="Payment confirmation pending">
      <div className="payment-pending-label"><ShieldCheck size={21}/><strong>{closed?'Request closed':'Awaiting admin approval'}</strong></div>
      <p>{closed?'This request was closed before a ticket was released. Contact the shop to resolve any payment.':ticket.holdReason ?? `The admin must confirm your payment was received. Your order number will appear after approval.`}</p>
      <dl><div><dt>Payment method</dt><dd>{ticket.paymentMethod==='cash'?'Counter prepayment / cash':ticket.paymentMethod==='maya'?'Maya':'GCash'}</dd></div><div><dt>Order total</dt><dd>{formatCurrency(ticket.totalPrice)}</dd></div><div><dt>Submitted</dt><dd>{new Date(ticket.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</dd></div></dl>
      <p className="payment-waiting-note">This page checks automatically every 15 seconds. Approval time depends on staff availability. Please do not submit another request or send payment again.</p>
      {checkedAt && <small>Last checked: {new Date(checkedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})}</small>}
      {trackingError && <p role="alert" className="payment-waiting-error">{trackingError}</p>}
      <button type="button" className="button button-outline" disabled={checking} onClick={()=>void refreshRef.current()}><RefreshCw size={17} className={checking?'animate-spin':''}/>{checking?'Checking confirmation…':'Check confirmation now'}</button>
    </section>
    <Link href={homeHref} className="button button-outline">Back to home</Link>
  </div>
  if(isPendingPayment(ticket))return null
  const waitMinutes = hasLiveUpdate ? liveWait : ticket.estimatedWaitMinutes
  const waitLabel = waitMinutes === null ? liveWaitLabel ?? ticket.waitEstimateLabel ?? 'Wait estimate unavailable' : `~${waitMinutes} minutes before processing`
  return (
    <div className="ticket-screen">
      <div className="ticket-success"><CheckCircle2 size={29} /></div>
      <h1>{collected?'Order collected':ready ? 'Ready for pickup!' : closed ? 'Order ' + liveStatus : 'Order received!'}</h1>
      {ticket.offline && <p className="sop-closed-banner" role="status">This is a saved local status. Live status and processing resume after reconnection. Your files synchronize automatically; keep this ticket.</p>}
      {trackingError && <p role="alert" className="text-red-700">{trackingError} The ticket below is the saved receipt; the latest status could not be verified.</p>}
      <p className="ticket-subtitle">{collected?'Your prints have been collected. Thank you.':ready ? 'Your prints are ready. You can collect them at the shop.' : closed ? 'Contact the shop about this order.' : isPaid && ticket.paymentMethod!=='cash' ? 'Your payment is approved and your order number has been released.' : 'Your order has been placed in the queue.'}</p>
      <section className="ticket-card" aria-label="Your order ticket">
        <p className="ticket-label">Your order number</p>
        <p className="ticket-code">{ticket.orderNumber}</p>
        {qr && <div className="sop-ticket-qr"><Image src={qr} alt="Signed ticket QR for pickup verification" width={180} height={180} unoptimized/><p>Show this QR at the counter when collecting your prints.</p></div>}
        {ticket.estimatedCompletionAt && !ready && !collected && !closed && <p className="ticket-note">Estimated completion: {new Date(ticket.estimatedCompletionAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}. Estimates may change.</p>}
        <div className="ticket-wait"><span>{ready || collected ? 'Order status' : 'Estimated wait time'}</span><strong>{collected?'Collected':ready ? 'Ready to collect' : closed ? liveStatus : trackingError ? 'Latest estimate unavailable' : waitLabel}</strong></div>
        <p className="ticket-note">Keep this number to track your order. Return to the tracking page anytime to check its status.</p>
        {ticket.paymentMethod && <p className="ticket-payment">{isPaid?'Payment verified and approved':ticket.paymentMethod==='cash'?'Payment due at pickup':'Payment confirmation unavailable'}</p>}
        {ticket.pickupAt && <p className="ticket-note">Pickup: {new Date(ticket.pickupAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</p>}
      </section>
      <div className="actions-row"><Link href={`/order/status?order=${encodeURIComponent(ticket.orderNumber)}`} className="button button-outline"><Search size={16} /> Track status</Link><Link href={homeHref} className="button button-primary">Order another <ArrowRight size={17} /></Link></div>
    </div>
  )
}
