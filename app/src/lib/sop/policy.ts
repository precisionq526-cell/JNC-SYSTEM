export type IntakeState = 'online' | 'offline' | 'closed'
export interface ShopPolicy {
  intakeState: IntakeState
  enforceHours: boolean
  openingMinute: number
  closingMinute: number
  workingDays: number[]
  completionBufferMinutes: number
  dispatchMode: 'walkins-first' | 'deadline-aware'
  unpaidTimeoutMinutes: number
  uncollectedHours: number
}
export const DEFAULT_SHOP_POLICY: ShopPolicy = {
  intakeState: 'online', enforceHours: true, openingMinute: 480, closingMinute: 1080,
  workingDays: [1, 2, 3, 4, 5, 6], completionBufferMinutes: 2,
  dispatchMode: 'walkins-first', unpaidTimeoutMinutes: 15, uncollectedHours: 48,
}
export function policyClock(value:number) { return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0') }
export function shopHoursLabel(policy:ShopPolicy) {
  const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],days=[...new Set(policy.workingDays)].sort((a,b)=>a-b)
  const label=days.join(',')==='1,2,3,4,5,6'?'Mon–Sat':days.length===7?'Every day':days.map(day=>names[day]).join(', ')
  const time=(minute:number)=>`${Math.floor(minute/60)%12||12}:${String(minute%60).padStart(2,'0')} ${minute<720?'AM':'PM'}`
  return `${label}, ${time(policy.openingMinute)}–${time(policy.closingMinute)} (Manila)`
}
export function manilaClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    minute: Number(parts.hour) * 60 + Number(parts.minute) }
}
export function intakeAvailability(policy: ShopPolicy, now = new Date()) {
  if (policy.intakeState !== 'online') return { accepting: false, reason: policy.intakeState === 'closed' ? 'The shop has closed order intake.' : 'Order intake is temporarily offline.' }
  const clock = manilaClock(now)
  if (policy.enforceHours && (!policy.workingDays.includes(clock.day) || clock.minute < policy.openingMinute || clock.minute >= policy.closingMinute)) {
    return { accepting: false, reason: 'Order intake is closed outside shop hours (Asia/Manila). Please return during opening hours.' }
  }
  return { accepting: true, reason: 'Accepting orders' }
}
export function requiresPrepayment(options: Record<string, unknown>) { return options['Transaction Type'] === 'schedule' }
export function canExpireUnpaid(order: { is_paid: boolean; status: string; payment_expires_at?: string | null; customer_notes?: string | null }, now = Date.now()) {
  // A receipt can represent money already transferred. Never expire it while staff review it.
  if (order.is_paid || !['pending', 'queued'].includes(order.status) || !order.payment_expires_at) return false
  try { if (JSON.parse((order.customer_notes ?? '').replace(/^JNC_PAYMENT_V1:/, '')).receiptPath) return false } catch {}
  return Date.parse(order.payment_expires_at) <= now
}
