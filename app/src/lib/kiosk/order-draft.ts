import type { ServiceOptionType } from '@/lib/types/database'

export const KIOSK_ORDER_DRAFT_KEY = 'printhub:kiosk-order-draft'
export const KIOSK_TICKET_KEY = 'printhub:kiosk-ticket'

export const ONLINE_ORDER_DRAFT_KEY = 'printhub:online-order-draft'
export const ONLINE_TICKET_KEY = 'printhub:online-ticket'

export type KioskOptionValue = string | number | boolean

export interface KioskServiceSummary {
  id: string
  name: string
  slug: string
  description: string
  icon: string | null
  basePrice: number
  estimatedDurationMinutes: number
}

export interface KioskOptionSummary {
  id: string
  name: string
  optionType: ServiceOptionType
  choices: string[]
  defaultValue: string | null
  priceModifier: number
  isRequired: boolean
  displayOrder: number
}

export interface KioskFileSummary {
  name: string
  size: number
  type: string
  edited?: boolean
}

export interface KioskOrderDraft {
  submissionKey?: string
  service: KioskServiceSummary
  options: Record<string, KioskOptionValue>
  files: KioskFileSummary[]
  totalPrice: number
  createdAt: string
  thumbnails?: Record<string, string>
  optionDefinitions?: KioskOptionSummary[]
  checkout?: {
    student?: boolean
    transactionType?: 'walk-in' | 'schedule'; pickupDate?: string; pickupTime?: string
    customerName?: string; customerEmail?: string; customerPhone?: string
    paymentMethod?: 'cash' | 'gcash' | 'maya'; paymentReference?: string
  }
}

export interface KioskTicket {
  offline?: boolean
  pickupToken?: string
  estimatedCompletionAt?: string | null
  holdReason?: string
  kind?: 'ticket'
  orderNumber: string
  queueNumber: number
  estimatedWaitMinutes: number | null
  waitEstimateLabel?: string
  estimatedDurationMinutes: number
  totalPrice: number
  createdAt: string
  serviceName: string
  /** Present when the ticket was issued from Supabase */
  orderId?: string
  synced?: boolean
  thumbnails?: Record<string, string>
  customerName?: string
  transactionType?: 'walk-in' | 'schedule'
  pickupAt?: string
  paymentMethod?: 'cash' | 'gcash' | 'maya'
  paymentStatus?: 'unpaid' | 'pending-verification' | 'approved'
}

export interface PendingPaymentRequest extends Omit<KioskTicket,'kind'|'orderNumber'|'queueNumber'|'paymentStatus'|'paymentMethod'> {
  kind:'payment-pending'
  orderId:string
  synced:true
  paymentStatus:'pending-verification'
  paymentMethod:'cash'|'gcash'|'maya'
}
export type OrderSubmission = KioskTicket | PendingPaymentRequest

export function getDefaultOptions(options: KioskOptionSummary[]): Record<string, KioskOptionValue> {
  return options.reduce<Record<string, KioskOptionValue>>((defaults, option) => {
    if (option.defaultValue !== null) {
      defaults[option.name] = option.optionType === 'number' ? Number(option.defaultValue) : option.defaultValue
    }
    return defaults
  }, {})
}

export function calculateKioskTotal(
  service: KioskServiceSummary,
  options: KioskOptionSummary[],
  selectedOptions: Record<string, KioskOptionValue>
): number {
  const copiesValue = selectedOptions.Copies
  const copies = typeof copiesValue === 'number' && copiesValue > 0 ? copiesValue : 1
  const optionTotal = options.reduce((total, option) => {
    const value = selectedOptions[option.name]
    const isSelected = value !== undefined && value !== '' && value !== 'No' && value !== false
    return total + (isSelected ? option.priceModifier : 0)
  }, 0)

  return Math.max(service.basePrice * copies + optionTotal, service.basePrice)
}

