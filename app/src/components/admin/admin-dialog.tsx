'use client'

import { useEffect, useRef } from 'react'

export default function AdminDialog({ children, onClose, busy = false, titleId, label, className = '' }: {
  children: React.ReactNode; onClose: () => void; busy?: boolean; titleId?: string; label?: string; className?: string
}) {
  const dialog = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  const locked = useRef(busy)
  useEffect(() => { close.current = onClose; locked.current = busy }, [onClose, busy])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])
    if (!dialog.current?.contains(document.activeElement)) (dialog.current?.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? focusable()[0] ?? dialog.current)?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!locked.current) close.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus() }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <div className="ref-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}><section ref={dialog} tabIndex={-1} className={`ref-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-label={label}>{children}</section></div>
}
