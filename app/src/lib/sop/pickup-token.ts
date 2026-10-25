import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { localSecret } from './local-store'
import { isUuid } from '@/lib/utils/uuid'
export function pickupToken(orderId: string) {
  if (!isUuid(orderId)) throw new Error('Invalid order.')
  return orderId + '.' + createHmac('sha256', localSecret()).update('pickup-v1:' + orderId).digest('base64url')
}
export function readPickupToken(input: string): string | null {
  let token = input.trim()
  try { if (/^https?:/.test(token)) token = new URL(token).searchParams.get('ticket') ?? '' } catch { return null }
  if (token.startsWith('JNC:')) token = token.slice(4)
  const id = token.split('.')[0]
  if (!isUuid(id) || token.length > 150) return null
  const expected = Buffer.from(pickupToken(id)), actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null
}
