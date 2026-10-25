import {
  ONLINE_ORDER_DRAFT_KEY,
} from '@/lib/kiosk/order-draft'
import { ServiceOrderClient } from '@/components/order-flow/service-order-client'

export default function OnlineServicePage() {
  return (
    <ServiceOrderClient
      homeHref="/order"
      reviewHref="/order/review"
      draftStorageKey={ONLINE_ORDER_DRAFT_KEY}
      stagedChannel="online"
      uploadSubline="Photos, PDFs, and documents from your device"
    />
  )
}
