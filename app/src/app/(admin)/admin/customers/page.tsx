'use client'

import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import { getAdminProfilesAction } from '@/lib/actions/admin-data'

export default function CustomersPage() {
  const state = useAdminData(getAdminProfilesAction)
  const profiles = state.data ?? []
  const loading = state.loading

  const roleBg: Record<string, string> = { admin: '#fef2f2', kiosk: '#fffbeb', customer: '#ecfdf5' }
  const roleColor: Record<string, string> = { admin: '#dc2626', kiosk: '#f59e0b', customer: '#10b981' }

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })

  return (
    <div className="admin-page">
      <DataStatus {...state} />
      <div className="admin-page-heading">
        <div><h1>Customer accounts</h1><p>People registered with your shop and their account roles.</p></div>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e7e5e0', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              {['USER', 'EMAIL', 'PHONE', 'ROLE', 'JOINED'].map(h => (
                <th key={h} style={{ padding: '14px 20px', fontSize: 11, fontWeight: 700, letterSpacing: '.8px', color: '#999', textAlign: 'left' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: '60px 0', textAlign: 'center', color: '#999' }}>Loading...</td></tr>
            ) : profiles.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '60px 0', textAlign: 'center', color: '#999', fontSize: 14 }}>{state.error ? 'Database unavailable.' : 'No users found.'}</td></tr>
            ) : profiles.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f5f4f0' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafaf8')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e7e5e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#666' }}>
                      {(p.full_name || p.email || '??').substring(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{p.full_name || 'Unnamed'}</span>
                  </div>
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: '#666' }}>{p.email || '—'}</td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: '#666' }}>{p.phone || '—'}</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', background: roleBg[p.role] || '#f5f4f0', color: roleColor[p.role] || '#555', padding: '3px 8px', borderRadius: 4, letterSpacing: '.5px' }}>{p.role}</span>
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: '#888' }}>{fmtDate(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
