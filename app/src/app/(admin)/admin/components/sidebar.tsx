'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Home, Zap, CalendarDays, Clock, BarChart3, Settings, ReceiptText, ListOrdered, ArrowUpRight, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAdminAppearance } from '@/components/admin/appearance'

const links = [
  { name: 'Home', icon: Home, path: '/admin' },
  { name: 'Orders', icon: ReceiptText, path: '/admin/orders' },
  { name: 'Queue', icon: ListOrdered, path: '/admin/queue' },
  { name: 'Walk-ins', icon: Zap, path: '/admin/walk-ins' },
  { name: 'Scheduled', icon: CalendarDays, path: '/admin/scheduled' },
  { name: 'History', icon: Clock, path: '/admin/history' },
  { name: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
  { name: 'Settings', icon: Settings, path: '/admin/settings' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()
  const { appearance } = useAdminAppearance()
  const [leaving, setLeaving] = useState(false)
  const handleSignOut = async () => {
    setLeaving(true)
    try { await signOut(); router.replace('/login?redirect=/admin'); router.refresh() }
    finally { setLeaving(false) }
  }
  return (
    <aside className="admin-sidebar">
      <Link href="/admin" className="admin-logo-slot" aria-label="JandC admin home"><Image src={appearance.logo || '/jnconnect-ribbon.png'} alt="JNConnect" width={438} height={129} unoptimized={!!appearance.logo} priority /></Link>
      <nav className="admin-nav" aria-label="Administration">
        {links.map(link => {
          const Icon = link.icon
          const active = pathname === link.path || (link.path !== '/admin' && pathname.startsWith(link.path))
          return <Link key={link.path} href={link.path} title={link.name} aria-label={link.name} aria-current={active ? 'page' : undefined}><Icon size={19} /><span>{link.name}</span></Link>
        })}
      </nav>
      <div className="admin-sidebar-footer"><Link href="/order" title="View print shop"><ArrowUpRight size={17} /><span>View print shop</span></Link><button type="button" title="Sign out" onClick={() => void handleSignOut()} disabled={leaving}><LogOut size={17} /><span>{leaving ? 'Signing out…' : 'Sign out'}</span></button><p>JandC · Shop administration</p></div>
    </aside>
  )
}
