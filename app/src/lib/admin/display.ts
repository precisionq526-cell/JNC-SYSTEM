import type { Order } from '@/lib/types/database'

export function money(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value)) : 'Not recorded'
}

export function timestamp(value: string | null | undefined): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded'
}

export function specifications(options: Order['service_options']): string {
  return Object.entries(options ?? {}).filter(([key, value]) => !['Pickup At', 'Pickup Date', 'Pickup Time', 'Transaction Type'].includes(key)
    && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => `${key}: ${String(value)}`).join('; ') || 'No options recorded'
}

export function customerLabel(order: Pick<Order, 'customer_name' | 'source'>): string {
  return order.customer_name || (order.source === 'kiosk' ? 'Walk-in (name not recorded)' : 'Online (name not recorded)')
}

export function exportCsv(name: string, rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = String(value ?? '')
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
