'use client'

import AdminSidebar from './components/sidebar'
import AdminHeader from './components/header'
import { AdminAppearanceProvider } from '@/components/admin/appearance'
import './reference.css'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAppearanceProvider>
      <a href="#admin-content" className="skip-link">Skip to content</a>
      <AdminSidebar />
      <main id="admin-content" className="admin-main">
        <AdminHeader />
        {children}
      </main>
    </AdminAppearanceProvider>
  )
}
