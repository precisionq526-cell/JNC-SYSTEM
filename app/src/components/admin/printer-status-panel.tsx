'use client'

import { useId, useState } from 'react'
import { Printer, RefreshCw, Settings } from 'lucide-react'
import { scanAdminPrintersAction } from '@/lib/actions/admin-data'
import type { ScannedPrinter, ScannedPrinterStatus } from '@/lib/hardware/windows-printers'
import { useAdminData } from './use-admin-data'
import DataStatus from './data-status'

const STATUS: Record<ScannedPrinterStatus, { label: string; tone: string }> = {
  idle: { label: 'Online · idle', tone: 'online' }, printing: { label: 'Printing', tone: 'printing' },
  warming_up: { label: 'Warming up', tone: 'warming' }, offline: { label: 'Offline', tone: 'offline' },
  paused: { label: 'Paused', tone: 'warming' }, attention: { label: 'Needs attention', tone: 'warming' },
  error: { label: 'Error', tone: 'offline' }, unknown: { label: 'Unknown', tone: 'unknown' },
}
function PrinterState({ printer }: { printer: ScannedPrinter }) {
  const status = STATUS[printer.status]
  return <span className={`ref-printer-status ${status.tone}`}><i />{status.label}</span>
}
export default function PrinterStatusPanel({ view = 'cards' }: { view?: 'cards' | 'table' }) {
  const headingId = useId(), state = useAdminData(scanAdminPrintersAction, 30000)
  const [selected, setSelected] = useState<ScannedPrinter | null>(null)
  const snapshot = state.data
  return <section className={`ref-printers ref-printers-${view}`} aria-labelledby={headingId} aria-busy={state.loading}>
    <div className="ref-section-heading"><h2 id={headingId}>{view === 'table' ? 'Manage connected printers' : 'Printer status'}</h2><DataStatus {...state} /></div>
    {snapshot && snapshot.printers.length > 0 && (view === 'table' ? <div className="ref-table-scroll"><table className="ref-printers-table"><thead><tr><th>Printer name</th><th>Printer status</th><th>PPM</th><th>Supported sizes</th><th>Manage</th></tr></thead><tbody>{snapshot.printers.map(printer => <tr key={printer.name}><td><strong>{printer.name}</strong>{printer.isDefault && <small>Default printer</small>}</td><td><PrinterState printer={printer} /></td><td>{printer.pagesPerMinute ?? 'Not reported'}</td><td>{printer.paperNames.length ? printer.paperNames.join(', ') : 'Not reported'}</td><td><button aria-label={`Printer details for ${printer.name}`} title="Printer details" onClick={() => setSelected(selected?.name === printer.name ? null : printer)}><Settings size={24} /></button></td></tr>)}</tbody></table></div>
      : <div className="ref-printer-grid">{snapshot.printers.map(printer => <article key={printer.name} className="ref-printer-card"><div className="ref-printer-illustration"><Printer size={59} strokeWidth={1.3} /></div><div><h3>{printer.name}</h3><PrinterState printer={printer} /><p>Issues: <span className={printer.issues.length ? 'ref-printer-issue' : ''}>{printer.issues.length ? printer.issues.join(', ') : printer.status === 'unknown' ? 'Not reported' : 'None reported'}</span></p></div></article>)}</div>)}
    {!snapshot && !state.error && <p className="ref-printer-empty"><RefreshCw size={24} className="loading-spin" />Checking installed printers…</p>}
    {snapshot?.printers.length === 0 && <div className="ref-printer-empty"><Printer size={34} /><div><strong>No physical printers connected</strong><p>Add a printer in Windows, then refresh. Installed virtual drivers are listed separately.</p></div>{view === 'table' && <a className="button button-outline" href="ms-settings:printers">Open printer settings</a>}</div>}
    {selected && view === 'table' && <div className="ref-printer-inspector"><h3>{selected.name}</h3><p>Driver: {selected.driverName || 'Not reported'}</p><p>Issues: {selected.issues.join(', ') || 'None reported'}</p><p>Color: {selected.supportsColor == null ? 'Not reported' : selected.supportsColor ? 'Supported' : 'Not supported'} · Automatic duplex: {selected.supportsDuplex == null ? 'Not reported' : selected.supportsDuplex ? 'Supported' : 'Not supported'}</p><a className="button button-outline" href="ms-settings:printers">Manage in Windows</a><button className="button button-outline" onClick={() => setSelected(null)}>Close details</button></div>}
    {snapshot && <details className="ref-virtual-printers"><summary>{snapshot.virtualPrinters.length} virtual printer{snapshot.virtualPrinters.length === 1 ? '' : 's'} · Windows driver status · {snapshot.computerName}</summary><ul>{snapshot.virtualPrinters.map(printer => <li key={printer.name}>{printer.name}</li>)}</ul><p>Virtual printers are excluded from physical printer counts. Paper and ink levels depend on the driver.</p>{view === 'table' && <a href="ms-settings:printers">Manage printers in Windows</a>}</details>}
  </section>
}
