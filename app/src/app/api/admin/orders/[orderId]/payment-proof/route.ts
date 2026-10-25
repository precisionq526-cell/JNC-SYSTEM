import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/utils/uuid'
import { readPaymentNotes } from '@/lib/kiosk/payment'

export async function GET(_request: Request, {params}:{params:Promise<{orderId:string}>}) {
  const auth = await requireAdmin()
  if (!auth.ok) return Response.json({error:auth.error},{status:403})
  const {orderId} = await params
  if (!isUuid(orderId)) return Response.json({error:'Invalid order.'},{status:400})
  const order = await supabaseAdmin.from('orders').select('customer_notes').eq('id',orderId).maybeSingle()
  const payment = readPaymentNotes(order.data?.customer_notes)
  if (!payment?.receiptPath || !payment.receiptPath.startsWith(orderId+'/payment/')) return Response.json({error:'No receipt was recorded.'},{status:404})
  const file = await supabaseAdmin.storage.from('order-files').download(payment.receiptPath)
  if (file.error || !file.data) return Response.json({error:'The receipt is unavailable.'},{status:404})
  return new Response(file.data,{headers:{'Content-Type':payment.receiptType || 'application/octet-stream','Content-Disposition':'inline; filename="payment-receipt.'+(payment.receiptPath.split('.').pop() || 'pdf')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}
