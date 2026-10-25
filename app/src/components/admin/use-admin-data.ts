'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useAdminData<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, intervalMs = 15000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const requestId = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)
  const refreshAgain = useRef(false)
  const mounted = useRef(false)
  const supabase = useMemo(() => createClient(), [])

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) { refreshAgain.current = true; return inFlight.current }
    const id = ++requestId.current
    const run = async () => {
      try {
        const result = await action()
        if (!mounted.current || id !== requestId.current) return
        if (result.ok) { setData(result.data); setError(null); setUpdatedAt(new Date().toISOString()) }
        else setError(result.error)
      } catch { if (mounted.current && id === requestId.current) setError('Database connection unavailable. Automatic refresh will retry.') }
      finally { if (mounted.current && id === requestId.current) setLoading(false) }
    }
    inFlight.current = run()
    try { await inFlight.current } finally { inFlight.current = null }
    if (refreshAgain.current && mounted.current) { refreshAgain.current = false; await refresh() }
  }, [action])

  useEffect(() => {
    mounted.current = true
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, intervalMs) }
    void poll()
    const wake = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true; mounted.current = false; clearTimeout(timer)
      // Invalidate the current asynchronous request; this ref is a counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++
      window.removeEventListener('online', wake); window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [refresh, intervalMs])

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout>
    const changed = () => { clearTimeout(debounce); debounce = setTimeout(() => void refresh(), 400) }
    const channel = supabase.channel('admin-live-' + crypto.randomUUID())
    for (const table of ['orders', 'order_files', 'queue_entries', 'queue_settings', 'hardware_devices']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed)
    }
    channel.subscribe()
    return () => { clearTimeout(debounce); void supabase.removeChannel(channel) }
  }, [supabase, refresh])

  return { data, error, loading, updatedAt, refresh, refreshIntervalSeconds: intervalMs / 1000 }
}
