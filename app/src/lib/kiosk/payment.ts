export type PaymentMethod = 'cash' | 'gcash' | 'maya'
export interface PaymentAccount { method: Exclude<PaymentMethod, 'cash'>; name: string; number: string }
export interface OrderPayment { method: PaymentMethod; reference?: string; receiptPath?: string; receiptName?: string; receiptType?: string; status: 'unpaid' | 'pending-verification' | 'approved'; notes?: string; verifiedAt?:string; verifiedBy?:string; customerId?:string }
export interface PaymentRecord {is_paid?:boolean;payment_method?:string|null;customer_notes?:string|null}
const PREFIX = 'JNC_PAYMENT_V1:'

export function paymentAccounts(env: Record<string, string | undefined>): PaymentAccount[] {
  return (['gcash', 'maya'] as const).flatMap(method => {
    const name = env[`PAYMENT_${method.toUpperCase()}_NAME`]?.trim()
    const number = env[`PAYMENT_${method.toUpperCase()}_NUMBER`]?.replace(/[\s-]/g, '')
    return name && name.length <= 120 && number && /^(09\d{9}|\+639\d{9})$/.test(number) ? [{ method, name, number }] : []
  })
}

export function validatePayment(method: unknown, reference: unknown, receipt: {name:string;size:number;type:string} | null, accounts: PaymentAccount[]): string | null {
  if (method === 'cash') return receipt ? 'Choose an online payment method before attaching a receipt.' : null
  if (!['gcash', 'maya'].includes(String(method))) return 'Choose a payment method.'
  if (!accounts.some(account => account.method === method)) return 'This online payment method is currently unavailable. Choose payment at pickup.'
  if (typeof reference !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 -]{5,79}$/.test(reference.trim())) return 'Enter the payment reference number from your receipt (6–80 characters).'
  return paymentReceiptError(receipt)
}

export function paymentReceiptError(receipt: {name:string;size:number;type:string} | null): string | null {
  return !receipt || receipt.size < 1 || receipt.size > 10 * 1024 * 1024 || !/\.(pdf|png|jpe?g|webp)$/i.test(receipt.name) || !['application/pdf','image/png','image/jpeg','image/webp'].includes(receipt.type) ? 'Upload a PDF, JPG, PNG, or WEBP payment receipt up to 10 MB.' : null
}

export function paymentReceiptMatches(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'application/pdf') return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((value,i)=>bytes[i] === value)
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return mime === 'image/webp' && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP'
}

export function encodePaymentNotes(payment: OrderPayment): string { return PREFIX + JSON.stringify(payment) }
export function readPaymentNotes(notes: string | null | undefined): OrderPayment | null {
  if (!notes?.startsWith(PREFIX)) return null
  try {
    const value = JSON.parse(notes.slice(PREFIX.length))
    if (!['cash','gcash','maya'].includes(value.method) || !['unpaid','pending-verification','approved'].includes(value.status)) return null
    if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length>2000)) return null
    if (value.reference !== undefined && (typeof value.reference !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 -]{5,79}$/.test(value.reference))) return null
    if (value.receiptName !== undefined && (typeof value.receiptName !== 'string' || value.receiptName.length>255)) return null
    if (value.receiptType !== undefined && !['application/pdf','image/png','image/jpeg','image/webp'].includes(value.receiptType)) return null
    if (value.receiptPath && (typeof value.receiptPath !== 'string' || !/^[a-f0-9-]{36}\/payment\/[a-f0-9]{64}\.(pdf|png|jpg|webp)$/.test(value.receiptPath))) return null
    if (value.verifiedAt !== undefined && (typeof value.verifiedAt!=='string' || !Number.isFinite(Date.parse(value.verifiedAt)))) return null
    if (value.verifiedBy !== undefined && (typeof value.verifiedBy!=='string' || !/^[a-f0-9-]{36}$/i.test(value.verifiedBy))) return null
    if (value.customerId !== undefined && (typeof value.customerId!=='string' || !/^[a-f0-9-]{36}$/i.test(value.customerId))) return null
    return value as OrderPayment
  } catch { return null }
}

export function recordedPaymentMethod(order:PaymentRecord):PaymentMethod {
  const recorded=readPaymentNotes(order.customer_notes)?.method
  const method=order.payment_method?.toLowerCase()
  return recorded ?? (method==='gcash' || method==='maya'?method:'cash')
}

/** Only server-recorded receipt/paid data controls release; never the submitted payment choice. */
export function awaitingOnlinePayment(order:PaymentRecord):boolean {
  return order.is_paid!==true && recordedPaymentMethod(order)!=='cash'
}
