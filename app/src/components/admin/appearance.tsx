'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export const ADMIN_APPEARANCE_KEY = 'jandc-admin-appearance-v1'
export type AdminAppearance = { theme: 'light' | 'dark'; fontSize: 'automatic' | 'large'; notifications: 'sound' | 'browser' | 'silent'; logo: string | null; poster: string | null }
const defaults: AdminAppearance = { theme: 'light', fontSize: 'automatic', notifications: 'sound', logo: null, poster: null }
const Context = createContext<{ appearance: AdminAppearance; update: (patch: Partial<AdminAppearance>) => void }>({ appearance: defaults, update: () => {} })

export function AdminAppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState(defaults)
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(ADMIN_APPEARANCE_KEY) || '{}')
      setAppearance({ theme: value.theme === 'dark' ? 'dark' : 'light', fontSize: value.fontSize === 'large' ? 'large' : 'automatic', notifications: ['sound', 'browser', 'silent'].includes(value.notifications) ? value.notifications : 'sound',
        logo: typeof value.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value.logo) ? value.logo : null,
        poster: typeof value.poster === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value.poster) ? value.poster : null })
    } catch { /* Use the reference appearance when storage is unavailable. */ }
  }, [])
  const update = (patch: Partial<AdminAppearance>) => {
    const next = { ...appearance, ...patch }
    // Persist before applying so failed quota writes can be reported by the caller.
    localStorage.setItem(ADMIN_APPEARANCE_KEY, JSON.stringify(next))
    setAppearance(next)
  }
  return <Context.Provider value={{ appearance, update }}><div className="admin-shell" data-admin-theme={appearance.theme} data-admin-font={appearance.fontSize}>{children}</div></Context.Provider>
}
export function useAdminAppearance() { return useContext(Context) }
