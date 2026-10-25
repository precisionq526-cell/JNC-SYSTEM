/** Business hours use Manila time even when the customer's device uses another zone. */
export function validatePickupAt(value: string | null | undefined, now = Date.now(),hours?:{workingDays:number[];openingMinute:number;closingMinute:number}): string | null {
  const timestamp = value ? Date.parse(value) : NaN
  if (!Number.isFinite(timestamp)) return 'Choose a pickup date and time.'
  if (timestamp <= now) return 'Choose a pickup time in the future.'
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(timestamp)
  const part = (type:string)=>parts.find(part=>part.type === type)?.value
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(part('weekday') ?? '')
  if (!(hours?.workingDays ?? [1,2,3,4,5,6]).includes(day)) return hours?'Choose a pickup date on a configured working day.':'The shop is open Monday to Saturday.'
  const seconds = Number(part('hour'))*3600 + Number(part('minute'))*60 + Number(part('second'))
  return seconds < (hours?.openingMinute ?? 480)*60 || seconds > (hours?.closingMinute ?? 1080)*60 ? hours?'Choose a pickup time during the shop’s configured hours.':'Choose a pickup time between 8:00 AM and 6:00 PM.' : null
}
