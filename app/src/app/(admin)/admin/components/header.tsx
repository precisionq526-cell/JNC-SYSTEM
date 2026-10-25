'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Bell, CheckCheck, RefreshCw, X, Printer, Users, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import { getAdminNotificationsAction, getAdminOperationalStatusAction, type AdminNotification } from '@/lib/actions/admin-data'
import { useAdminAppearance } from '@/components/admin/appearance'

const READ_STORAGE_KEY = 'printhub-admin-read-notifications'

export default function AdminHeader() {
  const { profile } = useAuth()
  const { appearance } = useAdminAppearance()
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loadingNotifications, setLoadingNotifications] = useState(true)
  const previousLatestIdRef = useRef<string | null>(null)
  const [operationStatus, setOperationStatus] = useState<{ activeStaff: number | null; availablePrinters: number;totalPrinters:number;intakeState:string } | null>(null)
  const [statusUnavailable, setStatusUnavailable] = useState(false)
  const loadStatus = useCallback(async () => {
    try {
      const result = await getAdminOperationalStatusAction()
      setStatusUnavailable(!result.ok)
      if (result.ok) setOperationStatus(result.data)
    } catch { setStatusUnavailable(true) }
  }, [])

  useEffect(() => {
    void loadStatus()
    const refresh = () => { if (document.visibilityState === 'visible') void loadStatus() }
    const poll = setInterval(refresh, 30000)
    const channel = supabase.channel('admin-operational-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_settings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hardware_devices' }, refresh).subscribe()
    return () => { clearInterval(poll); void supabase.removeChannel(channel) }
  }, [loadStatus, supabase])

  const loadNotifications = useCallback(async (announceNew = false) => {
    setLoadingNotifications(true)
    const result = await getAdminNotificationsAction()
    setLoadingNotifications(false)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    const latest = result.data[0]
    const previousLatestId = previousLatestIdRef.current

    setNotifications(result.data)
    previousLatestIdRef.current = latest?.id ?? null

    if (announceNew && latest && previousLatestId && latest.id !== previousLatestId) {
      toast.success(latest.title)
      if (appearance.notifications !== 'silent' && navigator.userActivation?.hasBeenActive) {
        try {
          const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain()
          oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 660; gain.gain.value = 0.06
          oscillator.start(); oscillator.stop(context.currentTime + 0.15); oscillator.onended = () => { void context.close() }
        } catch { /* A blocked audio device does not interrupt notifications. */ }
      }
      if (appearance.notifications === 'browser' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(latest.title, { body: latest.body })
      }
    }
  }, [appearance.notifications])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || '[]') as string[]
      setReadIds(new Set(saved))
    } catch {
      setReadIds(new Set())
    }
  }, [])

  useEffect(() => {
    void loadNotifications(false)
    const channel = supabase.channel('admin-header-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => void loadNotifications(true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => void loadNotifications(false))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'failover_events' }, () => void loadNotifications(true))
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadNotifications, supabase])

  const persistReadIds = (ids: Set<string>) => {
    setReadIds(ids)
    try { localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids].slice(-100))) }
    catch { toast.error('Read status could not be saved on this browser.') }
  }

  const markAllRead = () => {
    persistReadIds(new Set([...readIds, ...notifications.map((notification) => notification.id)]))
  }

  const handleBellClick = async () => {
    setOpen((value) => !value)
  }

  const unreadCount = notifications.filter((notification) => !readIds.has(notification.id)).length

  return (
    <header className="admin-header">
      <div className="header-group">
        <div className="header-stat"><span>Intake:</span><strong>{statusUnavailable ? 'Unavailable' : operationStatus?.intakeState ?? 'Checking…'}</strong>{operationStatus?.intakeState==='Online' && !statusUnavailable && <i className="header-status" aria-hidden="true" />}</div>
        <div className="header-stat"><span>Available printers</span><Printer size={15} /><strong>{statusUnavailable ? '—' : operationStatus?.availablePrinters ?? '—'}</strong></div>
        <div className="header-stat"><span>Active servers</span><Users size={15} /><strong>{statusUnavailable ? '—' : operationStatus?.activeStaff ?? 'Not set'}</strong></div>
      </div>
      <div className="header-group">
        <div className="header-notifications">
          <button type="button" onClick={() => void handleBellClick()} aria-expanded={open} aria-label={loadingNotifications && !notifications.length ? 'Notifications, loading' : `Notifications, ${unreadCount} unread`}><span>Notifications</span><Bell size={22} /><strong>{loadingNotifications && !notifications.length ? '—' : unreadCount}</strong></button>
          {open && (
            <div className="absolute top-10 right-0 w-[360px] max-w-[calc(100vw-32px)] bg-white border border-[#eee] rounded-xl shadow-2xl overflow-hidden z-[100] cursor-default" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f5f5f5]">
                <div>
                  <div className="text-sm font-black text-[#12233f]">Notifications</div>
                  <div className="text-xs text-[#888] mt-0.5">{unreadCount} unread</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void loadNotifications(false)} title="Refresh" className="w-8 h-8 rounded-lg border border-[#eee] bg-[#f9f9f9] flex items-center justify-center hover:bg-[#eee] transition-colors">
                    <RefreshCw size={14} className={loadingNotifications ? 'text-[#8e1b1b]' : 'text-[#777]'} />
                  </button>
                  <button type="button" onClick={markAllRead} title="Mark all read" className="w-8 h-8 rounded-lg border border-[#eee] bg-[#f9f9f9] flex items-center justify-center hover:bg-[#eee] transition-colors">
                    <CheckCheck size={14} className="text-[#777]" />
                  </button>
                  <button type="button" onClick={() => setOpen(false)} title="Close" className="w-8 h-8 rounded-lg border border-[#eee] bg-[#f9f9f9] flex items-center justify-center hover:bg-[#eee] transition-colors">
                    <X size={14} className="text-[#777]" />
                  </button>
                </div>
              </div>
              <div className="max-h-[380px] overflow-y-auto">
                {loadingNotifications && notifications.length === 0 ? (
                  <p className="m-0 p-8 text-center text-[#999] text-sm">Loading notifications...</p>
                ) : notifications.length === 0 ? (
                  <p className="m-0 p-8 text-center text-[#999] text-sm">No notifications yet.</p>
                ) : notifications.map((notification) => {
                  const unread = !readIds.has(notification.id)
                  return (
                    <Link
                      key={notification.id}
                      href={notification.href}
                      onClick={() => {
                        persistReadIds(new Set([...readIds, notification.id]))
                        setOpen(false)
                      }}
                      className={`block px-5 py-4 border-b border-[#f9f9f9] no-underline transition-colors ${unread ? 'bg-[#fef2f2] hover:bg-[#fde2e2]' : 'bg-white hover:bg-[#f5f5f5]'}`}
                    >
                      <div className="flex items-center gap-2">
                        {unread && <span className="w-2 h-2 rounded-full bg-[#8e1b1b] shrink-0" />}
                        <span className="text-sm font-black text-[#12233f]">{notification.title}</span>
                      </div>
                      <p className="mt-1 mb-0 text-xs leading-relaxed text-[#555]">{notification.body}</p>
                      <p className="mt-1.5 mb-0 text-[11px] text-[#999]">{formatNotificationTime(notification.createdAt)}</p>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <Link href="/admin/settings" className="admin-profile-link"><span>{profile?.full_name || 'Administrator'}</span><UserRound size={18} /></Link>
      </div>
    </header>
  )
}

function formatNotificationTime(value: string): string {
  return new Date(value).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
