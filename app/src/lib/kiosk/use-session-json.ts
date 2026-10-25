'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const getServerSnapshot = () => ''

export function useSessionJson<T>(key: string): T | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => window.sessionStorage.getItem(key) ?? '',
    getServerSnapshot
  )

  if (!snapshot) return null

  try {
    return JSON.parse(snapshot) as T
  } catch {
    return null
  }
}
