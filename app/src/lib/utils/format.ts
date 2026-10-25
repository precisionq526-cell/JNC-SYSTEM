import { format, formatDistanceToNow, parseISO } from 'date-fns'

/**
 * Format a date string to a readable format
 */
export function formatDate(dateString: string): string {
  return format(parseISO(dateString), 'MMM d, yyyy')
}

/**
 * Format a date string to include time
 */
export function formatDateTime(dateString: string): string {
  return format(parseISO(dateString), 'MMM d, yyyy h:mm a')
}

/**
 * Format a date string to time only
 */
export function formatTime(dateString: string): string {
  return format(parseISO(dateString), 'h:mm a')
}

/**
 * Format a date string to relative time (e.g., "5 minutes ago")
 */
export function formatRelativeTime(dateString: string): string {
  return formatDistanceToNow(parseISO(dateString), { addSuffix: true })
}

/**
 * Format currency in Philippine Peso
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Format minutes to human-readable duration
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return 'Less than a minute'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/**
 * Format order number for display
 */
export function formatOrderNumber(orderNumber: string): string {
  return orderNumber // Already formatted as ORD-YYYYMMDD-NNN
}

/**
 * Get status display properties
 */
export function getStatusDisplay(status: string): {
  label: string
  color: string
  bgColor: string
  icon: string
} {
  const statusMap: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
    pending: {
      label: 'Pending',
      color: 'text-amber-400',
      bgColor: 'bg-amber-400/10 border-amber-400/20',
      icon: '⏳',
    },
    queued: {
      label: 'Queued',
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10 border-blue-400/20',
      icon: '📋',
    },
    processing: {
      label: 'Processing',
      color: 'text-sky-400',
      bgColor: 'bg-sky-400/10 border-sky-400/20',
      icon: '🔄',
    },
    completed: {
      label: 'Completed',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10 border-emerald-400/20',
      icon: '✅',
    },
    cancelled: {
      label: 'Cancelled',
      color: 'text-gray-400',
      bgColor: 'bg-gray-400/10 border-gray-400/20',
      icon: '✕',
    },
    failed: {
      label: 'Failed',
      color: 'text-rose-400',
      bgColor: 'bg-rose-400/10 border-rose-400/20',
      icon: '⚠',
    },
  }
  return statusMap[status] || statusMap.pending
}

/**
 * Get source display properties
 */
export function getSourceDisplay(source: string): {
  label: string
  icon: string
  color: string
} {
  return source === 'kiosk'
    ? { label: 'Kiosk', icon: '🖥️', color: 'text-violet-400' }
    : { label: 'Online', icon: '🌐', color: 'text-cyan-400' }
}
