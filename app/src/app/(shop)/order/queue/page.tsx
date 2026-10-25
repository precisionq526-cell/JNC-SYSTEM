'use client'

import { ONLINE_TICKET_KEY } from '@/lib/kiosk/order-draft'
import { OrderQueueClient } from '@/components/order-flow/order-queue-client'

export default function OnlineQueuePage() {
  return <OrderQueueClient ticketStorageKey={ONLINE_TICKET_KEY} homeHref="/order" />
}
