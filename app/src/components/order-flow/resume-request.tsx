'use client'
import Link from 'next/link'
import {Clock3} from 'lucide-react'
import {ONLINE_TICKET_KEY,type OrderSubmission} from '@/lib/kiosk/order-draft'
import {useSessionJson} from '@/lib/kiosk/use-session-json'
import {isPendingPayment} from '@/lib/kiosk/order-release'

export function ResumeRequest() {
  const saved=useSessionJson<OrderSubmission>(ONLINE_TICKET_KEY)
  if(!saved?.orderId || !saved.synced)return null
  return <div className="resume-request"><Clock3 size={19}/><span>{isPendingPayment(saved)?'Your payment is awaiting admin confirmation.':'You have a submitted order.'}</span><Link href="/order/queue">{isPendingPayment(saved)?'Check confirmation':'View your order'}</Link></div>
}
