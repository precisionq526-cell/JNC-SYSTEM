import { AdminOrderDetail } from '@/components/admin/order-detail'

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  return <AdminOrderDetail orderId={orderId} />
}
