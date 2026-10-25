'use client'
import { RefreshCw } from 'lucide-react'

export default function DataStatus({ error, loading, updatedAt, refresh, refreshIntervalSeconds = 15 }: {
  error: string | null; loading: boolean; updatedAt: string | null; refresh: () => Promise<void>; refreshIntervalSeconds?: number
}) {
  return <div className={`data-status ${error ? 'data-status-error' : loading || !updatedAt ? 'data-status-loading' : ''}`} role={error ? 'alert' : 'status'}>
    <span><span><b>{error ? 'Refresh unsuccessful' : loading ? 'Loading database records…' : `Auto refresh every ${refreshIntervalSeconds}s`}</b><small>{error ? `${error} Previously loaded values may be out of date.`
      : updatedAt ? `Last updated: ${new Date(updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}` : 'Waiting for a database response.'}</small></span></span>
    <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={21} className={loading ? 'loading-spin' : undefined} />{loading ? 'Refreshing…' : 'Refresh now'}</button>
  </div>
}
