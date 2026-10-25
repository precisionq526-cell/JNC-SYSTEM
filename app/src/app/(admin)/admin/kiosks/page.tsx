'use client'

import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import { getAdminHardwareSnapshotAction } from '@/lib/actions/admin-data'
import { AlertTriangle, MonitorSmartphone, Printer, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react'
import type { HardwareDevice } from '@/lib/types/database'

export default function HardwarePage() {
  const state = useAdminData(getAdminHardwareSnapshotAction)
  const devices = state.data?.devices ?? []
  const events = state.data?.events ?? []
  const loading = state.loading
  const load = state.refresh
  const checkedAt = state.updatedAt ? Date.parse(state.updatedAt) : 0
  const fresh = (device: HardwareDevice) => !!device.last_heartbeat && checkedAt - Date.parse(device.last_heartbeat) < 180_000

  const online = devices.filter((device) => fresh(device) && device.is_enabled && device.status === 'online').length
  const issues = devices.filter((device) => !fresh(device) || device.status === 'offline' || device.status === 'error').length

  return (
    <div className="admin-page">
      <DataStatus {...state} />
      <div className="admin-page-heading">
        <div><h1>Hardware status</h1><p>Connected devices and recent failover events.</p></div>
        <button onClick={() => void load()} style={buttonStyle}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="hardware-metrics">
        <Metric label="Registered Devices" value={state.data ? String(devices.length) : '—'} />
        <Metric label="Available" value={state.data ? String(online) : '—'} />
        <Metric label="Issues" value={state.data ? String(issues) : '—'} danger={issues > 0} />
      </div>

      <div className="hardware-panels">
        <div style={panelStyle}>
          <h2 style={panelTitleStyle}>Unified Device Panel</h2>
          {loading ? (
            <p style={emptyStyle}>Loading hardware...</p>
          ) : devices.length === 0 ? (
            <p style={emptyStyle}>{state.error ? 'Hardware database unavailable.' : 'No devices have reported telemetry. Start the hardware bridge on the kiosk PC.'}</p>
          ) : (
            <div className="hardware-devices">
              {devices.map((device) => <DeviceCard key={device.id} device={device} checkedAt={checkedAt} />)}
            </div>
          )}
        </div>

        <div style={panelStyle}>
          <h2 style={panelTitleStyle}>Failover Events</h2>
          {events.length === 0 ? (
            <p style={emptyStyle}>No failovers recorded.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {events.map((event) => (
                <div key={event.id} style={{ border: '1px solid #e7e5e0', borderRadius: 10, padding: 12, background: event.status === 'unassigned' ? '#fef2f2' : '#fafaf8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <AlertTriangle size={14} color={event.status === 'unassigned' ? '#dc2626' : '#f59e0b'} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#333', textTransform: 'uppercase' }}>{event.status}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                    {event.from_device?.device_name ?? 'Unknown'} to {event.to_device?.device_name ?? 'No device'}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#999' }}>{event.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeviceCard({ device, checkedAt }: { device: HardwareDevice; checkedAt: number }) {
  const Icon = device.device_type === 'printer' ? Printer : device.device_type === 'computer' ? Server : MonitorSmartphone
  const stale = !device.last_heartbeat || checkedAt - Date.parse(device.last_heartbeat) >= 180_000
  const hasIssue = stale || device.status === 'offline' || device.status === 'error'
  const heartbeat = device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Never'

  return (
    <div style={{ border: '1px solid #e7e5e0', borderRadius: 12, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: hasIssue ? '#fef2f2' : '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={hasIssue ? '#ef4444' : '#10b981'} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1c1917' }}>{device.device_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {hasIssue ? <WifiOff size={12} color="#ef4444" /> : <Wifi size={12} color="#10b981" />}
            <span style={{ fontSize: 12, fontWeight: 700, color: hasIssue ? '#ef4444' : '#10b981' }}>{stale ? 'No recent heartbeat' : device.status}</span>
          </div>
        </div>
      </div>
      <p style={detailStyle}>Type: {device.device_type}</p>
      <p style={detailStyle}>Location: {device.location || '-'}</p>
      <p style={detailStyle}>Last heartbeat: {heartbeat}</p>
      {device.error_message && <p style={{ ...detailStyle, color: '#dc2626' }}>{device.error_message}</p>}
    </div>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e7e5e0', padding: '20px 24px' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#999' }}>{label}</span>
      <div style={{ fontSize: 28, fontWeight: 700, color: danger ? '#dc2626' : '#1c1917', marginTop: 6 }}>{value}</div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#555' }
const panelStyle: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e7e5e0', padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }
const panelTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 800, color: '#333', margin: '0 0 14px' }
const emptyStyle: React.CSSProperties = { color: '#999', fontSize: 13, textAlign: 'center', padding: 32 }
const detailStyle: React.CSSProperties = { margin: '4px 0', fontSize: 12, color: '#888' }
