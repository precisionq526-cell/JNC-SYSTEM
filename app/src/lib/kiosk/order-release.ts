import type {SubmitOrderResult} from '@/lib/actions/submit-order'
import type {KioskTicket,OrderSubmission,PendingPaymentRequest} from './order-draft'

export function isPendingPayment(submission:OrderSubmission):submission is PendingPaymentRequest {return submission.kind==='payment-pending'}

/** Never persist a number for pending payments or reuse one from an older snapshot. */
export function submissionFromResult(result:SubmitOrderResult,details:Partial<OrderSubmission>={}):OrderSubmission {
  if(!result.ok || !result.orderId || !result.createdAt || !result.serviceName || !Number.isFinite(result.totalPrice))throw new Error(result.error || 'The saved request could not be confirmed.')
  const common={orderId:result.orderId,synced:true as const,totalPrice:result.totalPrice!,createdAt:result.createdAt,serviceName:result.serviceName,
    estimatedDurationMinutes:result.estimatedDurationMinutes ?? 0,estimatedWaitMinutes:result.estimatedWaitMinutes ?? null,waitEstimateLabel:result.waitEstimateLabel,
    customerName:details.customerName,transactionType:details.transactionType,pickupAt:details.pickupAt,thumbnails:details.thumbnails,
    pickupToken:result.pickupToken,estimatedCompletionAt:result.estimatedCompletionAt,holdReason:result.holdReason,offline:result.offline}
  if(result.paymentStatus==='pending-verification'){
    if(!['cash','gcash','maya'].includes(result.paymentMethod ?? ''))throw new Error('The pending payment method is unavailable.')
    return {...common,kind:'payment-pending',paymentStatus:'pending-verification',paymentMethod:result.paymentMethod!}
  }
  if(!result.orderNumber || !result.queueNumber || (result.paymentMethod!=='cash' && (result.paymentStatus!=='approved' || result.isPaid!==true)))throw new Error('Your ticket has not been released. Keep waiting for payment confirmation.')
  return {...common,kind:'ticket',orderNumber:result.orderNumber,queueNumber:result.queueNumber,paymentMethod:result.paymentMethod,paymentStatus:result.paymentStatus} satisfies KioskTicket
}
