import { readPaymentNotes, recordedPaymentMethod, type PaymentRecord } from '../kiosk/payment'
export type SopOrder = PaymentRecord & { status?: string; service_options?: Record<string, unknown>; student_status?: string | null; payment_expires_at?: string | null }
export function orderHoldReason(order: SopOrder): string | null {
  if (order.student_status === 'rejected') return 'Student verification was declined. Contact staff before paying or printing.'
  if (order.student_status === 'pending') return 'Waiting for student ID verification'
  if (order.is_paid !== true && (recordedPaymentMethod(order) !== 'cash' || order.service_options?.['Transaction Type'] === 'schedule')) {
    return recordedPaymentMethod(order) === 'cash' ? 'Waiting for counter prepayment confirmation' : 'Waiting for payment confirmation'
  }
  return null
}
export function ticketIsHeld(order: SopOrder) { return orderHoldReason(order) !== null }
export function receiptSubmitted(order: PaymentRecord) { return !!readPaymentNotes(order.customer_notes)?.receiptPath }
export const SOP_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued', 'processing', 'cancelled', 'failed'], queued: ['pending', 'processing', 'cancelled', 'failed'],
  processing: ['finishing', 'completed', 'cancelled', 'failed'], finishing: ['completed', 'cancelled', 'failed'],
  completed: ['collected'], collected: [], cancelled: [], failed: [],
}
