'use client'

import {
  ONLINE_ORDER_DRAFT_KEY,
  ONLINE_TICKET_KEY,
} from '@/lib/kiosk/order-draft'
import { OrderReviewClient } from '@/components/order-flow/order-review-client'

export default function OnlineReviewPage() {
  return (
    <OrderReviewClient
      draftStorageKey={ONLINE_ORDER_DRAFT_KEY}
      ticketStorageKey={ONLINE_TICKET_KEY}
      stagedChannel="online"
      orderSource="online"
      serviceBaseHref="/order/service"
      homeHref="/order"
      queueHref="/order/queue"
      showCustomerFields
    />
  )
}
