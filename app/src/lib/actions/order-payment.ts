'use server'
import { paymentAccounts } from '@/lib/kiosk/payment'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/utils/uuid'
import { readPaymentNotes } from '@/lib/kiosk/payment'

export async function getOrderPaymentAccountsAction() { return paymentAccounts(process.env) }

export async function verifyOrderPaymentAction(orderId: string) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!isUuid(orderId)) return {ok:false as const,error:'Invalid order.'}
  const order = await supabaseAdmin.from('orders').select('customer_notes,is_paid,status,total_price,order_number').eq('id',orderId).maybeSingle()
  if (order.error || !order.data) return {ok:false as const,error:'Could not load the payment record.'}
  const payment = readPaymentNotes(order.data.customer_notes)
  if (!payment) return {ok:false as const,error:'No payment method was recorded for this order.'}
  if(['cancelled','failed'].includes(order.data.status))return {ok:false as const,error:'This request is closed. Resolve it before approving payment.'}
  if(order.data.is_paid)return {ok:true as const}
  if (payment.method !== 'cash' && (!payment.reference || !payment.receiptPath)) return {ok:false as const,error:'Review the reference and receipt before confirming payment.'}
  if (payment.receiptPath) {
    if (!payment.receiptPath.startsWith(orderId+'/payment/')) return {ok:false as const,error:'The receipt does not belong to this order.'}
    const proof = await supabaseAdmin.storage.from('order-files').info(payment.receiptPath)
    if (proof.error || !proof.data) return {ok:false as const,error:'The uploaded receipt is unavailable. Resolve it before confirming payment.'}
  }
  const verified={...payment,status:'approved' as const,verifiedAt:new Date().toISOString(),verifiedBy:auth.userId}
  const saved = await supabaseAdmin.rpc('approve_sop_payment',{p_order_id:orderId,p_record:verified,p_actor_id:auth.userId})
  if(saved.error)return {ok:false as const,error:'Payment approval could not be saved. Refresh and retry.'}
  const confirmed=await supabaseAdmin.from('orders').select('is_paid').eq('id',orderId).maybeSingle()
  return confirmed.error || confirmed.data?.is_paid!==true ? {ok:false as const,error:'Payment approval was not confirmed. The request may have changed. Refresh before retrying.'} : {ok:true as const}
}
