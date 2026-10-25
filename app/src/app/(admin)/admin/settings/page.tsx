'use client'

import Image from 'next/image'
import {SopSettingsPanel} from '@/components/admin/sop-settings-panel'
import {PrinterInspections} from '@/components/admin/printer-inspections'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowRight, Bell, Copy, ImagePlus, RotateCcw, ShieldCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getAdminSettingsAction, updateQueueCapacityAction } from '@/lib/actions/admin-data'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import AdminDialog from '@/components/admin/admin-dialog'
import PrinterStatusPanel from '@/components/admin/printer-status-panel'
import { useAdminAppearance, type AdminAppearance } from '@/components/admin/appearance'

export default function SettingsPage() {
  const state = useAdminData(getAdminSettingsAction)
  const { appearance, update } = useAdminAppearance()
  const [busy, setBusy] = useState(false), [qr, setQr] = useState(''), [posterOpen, setPosterOpen] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null), posterInput = useRef<HTMLInputElement>(null)
  const active = state.data?.settings.activeServers ?? 0
  useEffect(() => { let mounted = true; void QRCode.toDataURL(window.location.origin + '/login?redirect=/admin', { width: 120, margin: 1, color: { dark: '#15263f', light: '#ffffff' } }).then(value => { if (mounted) setQr(value) }); return () => { mounted = false } }, [])
  const preference = (patch: Partial<AdminAppearance>) => { try { update(patch); toast.success('Appearance preference saved on this browser.') } catch { toast.error('Browser storage is full or unavailable. Try a smaller image.') } }
  const capacity = async (value: number) => {
    setBusy(true)
    try { const result = await updateQueueCapacityAction(value); if (!result.ok) toast.error(result.error); else { toast.success(value ? 'Queue processing enabled.' : 'Queue processing paused.'); await state.refresh() } }
    catch { toast.error('Could not save queue capacity.') }
    finally { setBusy(false) }
  }
  const notification = async (value: AdminAppearance['notifications']) => {
    if (value === 'browser') {
      if (!('Notification' in window)) { toast.error('Browser notifications are not supported.'); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { toast.error('Notifications are blocked in browser settings.'); return }
    }
    preference({ notifications: value })
  }
  const image = async (file: File | undefined, kind: 'logo' | 'poster') => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) { toast.error('Choose a PNG, JPG or WebP image under 1 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { preference({ [kind]: String(reader.result) }); if (kind === 'poster') setPosterOpen(true) }
    reader.onerror = () => toast.error('The image could not be read.')
    reader.readAsDataURL(file)
  }
  return <div className="admin-page ref-settings-page">
    <div className="ref-page-heading"><h1>System customization & security</h1><DataStatus {...state} /></div>
    <div className="ref-settings-grid">
      <div className="ref-settings-stack">
        <section className="ref-settings-card"><h2>Queue management system state</h2>
          <div className="ref-setting-line"><span>{!state.data ? 'Loading queue status…' : !state.data.settings.isConfigured ? 'Queue setup pending' : active ? 'Online: processing enabled' : 'Paused: waiting for staff'}</span><button className="ref-toggle" role="switch" aria-label="Enable queue processing" aria-checked={active > 0} disabled={!state.data?.settings.isConfigured || !!state.error || busy} onClick={() => void capacity(active ? 0 : 1)}><span /></button></div>
          <p className="ref-setting-help">Processing capacity controls the queue; pickup hours are 8 AM–6 PM, Monday–Saturday.</p>
          <label className="ref-setting-line"><span>Active processing staff</span><select aria-label="Active processing staff" value={state.data ? active : ''} disabled={!state.data?.settings.isConfigured || !!state.error || busy} onChange={e => void capacity(Number(e.target.value))}>{!state.data && <option value="">Loading…</option>}<option value="0">0 — paused</option><option value="1">1 staff slot</option><option value="2">2 staff slots</option></select></label>
          <label className="ref-setting-line"><span><Bell size={21} />Notifications</span><select aria-label="Notification preference" value={appearance.notifications} onChange={e => void notification(e.target.value as AdminAppearance['notifications'])}><option value="sound">Sound only</option><option value="browser">Browser & sound</option><option value="silent">Silent</option></select></label>
        </section>
        <section className="ref-settings-card ref-profile-card"><h2>Admin profile</h2><dl><div><dt>Name</dt><dd>{state.data?.profile?.full_name || (state.loading ? 'Loading…' : 'Name not recorded')}</dd></div><div><dt>Operational role</dt><dd className="ref-profile-role"><ShieldCheck size={18} />{state.data?.profile?.role || 'Unavailable'}</dd></div><div><dt>Email</dt><dd>{state.data?.profile?.email || 'Not recorded'}</dd></div></dl></section>
      </div>
      <div className="ref-settings-stack">
        <section className="ref-settings-card"><h2>System theme</h2><div className="ref-theme-grid"><div><div className="ref-setting-line"><span>Light mode</span><button role="switch" aria-label="Light mode" aria-checked={appearance.theme === 'light'} className="ref-toggle" onClick={() => preference({ theme: appearance.theme === 'light' ? 'dark' : 'light' })}><span /></button></div><div className="ref-setting-line"><span>Color scheme</span><span className="ref-color-swatch" title="Navy and red reference color scheme" /></div><label className="ref-setting-line"><span>Font size</span><select aria-label="Admin font size" value={appearance.fontSize} onChange={e => preference({ fontSize: e.target.value as AdminAppearance['fontSize'] })}><option value="automatic">Automatic</option><option value="large">Large</option></select></label></div><div className="ref-brand-controls"><button onClick={() => logoInput.current?.click()}>Change logo<ImagePlus size={28} /></button><button onClick={() => posterInput.current?.click()}>Change poster<ImagePlus size={28} /></button><button onClick={() => setPosterOpen(true)}>View poster<ArrowRight size={20} /></button><button onClick={() => preference({ logo: null, poster: null, theme: 'light', fontSize: 'automatic' })}><RotateCcw size={15} />Restore reference style</button></div></div><p className="ref-setting-help">Appearance, logo, poster preview, and notification preferences are saved on this browser.</p><input hidden type="file" accept="image/png,image/jpeg,image/webp" ref={logoInput} onChange={e => { void image(e.target.files?.[0], 'logo'); e.target.value = '' }} /><input hidden type="file" accept="image/png,image/jpeg,image/webp" ref={posterInput} onChange={e => { void image(e.target.files?.[0], 'poster'); e.target.value = '' }} /></section>
        <section className="ref-settings-card ref-auth-card"><h2>Administrator authentication</h2><div className="ref-auth-grid"><div><p>Current access</p><div className="ref-auth-status"><ShieldCheck size={22} />{state.data?.profile?.role === 'admin' ? 'Authenticated administrator' : 'Checking session…'}</div><p className="ref-setting-help">Device authentication: {state.data ? state.data.deviceAuthConfigured ? 'Configured on server' : 'Not configured' : 'Checking…'}. Device secrets stay on the server.</p><button className="ref-copy-signin" onClick={() => { void navigator.clipboard.writeText(window.location.origin + '/login?redirect=/admin').then(() => toast.success('Sign-in link copied.'), () => toast.error('Could not copy the link.')) }}><Copy size={17} />Copy administrator sign-in link</button></div><div className="ref-auth-qr"><span>Sign-in QR</span>{qr && <Image src={qr} alt="QR code for administrator sign-in page" width={95} height={95} unoptimized />}<small>Sign-in required</small></div></div></section>
      </div>
    </div>
    <SopSettingsPanel/>
    <PrinterInspections/>
    <section className="ref-settings-card ref-settings-printers"><PrinterStatusPanel view="table" /></section>
    <div className="ref-management-links"><Link href="/admin/services">Services & pricing<ArrowRight size={17} /></Link><Link href="/admin/kiosks">Hardware & kiosk status<ArrowRight size={17} /></Link><Link href="/admin/customers">Customer accounts<ArrowRight size={17} /></Link></div>
    {posterOpen && <AdminDialog onClose={() => setPosterOpen(false)} label="Shop poster preview" className="ref-poster-modal"><button data-dialog-autofocus="" className="ref-modal-close" aria-label="Close poster preview" onClick={() => setPosterOpen(false)}><X size={22} /></button><h2>Shop poster preview</h2><Image src={appearance.poster || '/services-flyer.png'} alt="Shop services poster" width={650} height={900} unoptimized /><p className="ref-setting-help">This browser’s poster preview.</p></AdminDialog>}
  </div>
}



