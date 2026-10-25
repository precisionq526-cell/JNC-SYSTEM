'use client'
import Image from 'next/image'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  QrCode, Smartphone, Wifi, CheckCircle2, RefreshCw, X,
  File, Image as ImageIcon, FileText, Clock,
} from 'lucide-react'
import QRCode from 'qrcode'
import { createTransferSession, getTransferFiles, closeTransferSession } from '@/lib/actions/transfer-session'
import { type TransferFile, type TransferSession } from '@/lib/transfer/types'
import { createClient } from '@/lib/supabase/client'
import { formatFileSize } from '@/lib/utils/format'

interface MobileBridgeProps {
  /** Callback when files are received and user clicks "Use Files" */
  onFilesReceived: (files: TransferFile[]) => void
  /** Whether to show as a modal overlay */
  isOpen: boolean
  onClose: () => void
}

export function MobileBridge({ onFilesReceived, isOpen, onClose }: MobileBridgeProps) {
  const [session, setSession] = useState<TransferSession | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [receivedFiles, setReceivedFiles] = useState<TransferFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const initRef = useRef(false)

  // Generate QR code
  const startSession = useCallback(async () => {
    setLoading(true)
    setReceivedFiles([])

    setError(null)
    setSession(null)
    setQrDataUrl('')
    const result = await createTransferSession()
    if (!result.ok || !result.session) { setError(result.error ?? 'Could not create a transfer session.'); setLoading(false); return }
    const sess = result.session
    setSession(sess)

    // Build URL for mobile page — always prefer LAN IP so phones can connect
    const baseUrl = getLanBaseUrl()
    const mobileUrl = `${baseUrl}/transfer/${sess.id}?code=${sess.shortCode}`

    try {
      const url = await QRCode.toDataURL(mobileUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#1E2D1A', light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      })
      setQrDataUrl(url)
    } catch {
      setError('QR code could not be generated. Retry or enter the session code manually.')
    }

    setLoading(false)
  }, [])

  // Set up realtime listener or polling for incoming files
  useEffect(() => {
    if (!session) return

    let pollInterval: ReturnType<typeof setInterval> | null = null

    pollInterval = setInterval(async () => {
      const result = await getTransferFiles(session.id)
      if (result.ok && result.files) { setReceivedFiles(result.files); setError(null) }
      else setError(result.error ?? 'Transfer refresh failed.')
    }, 3000)
    {
      // Real Supabase mode: Use Realtime
      const supabase = createClient()
      const channel = supabase
        .channel(`transfer-${session.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'transfer_files',
            filter: `session_id=eq.${session.id}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>
            const newFile: TransferFile = {
              id: row.id as string,
              sessionId: row.session_id as string,
              fileName: row.file_name as string,
              fileSize: (row.size ?? row.file_size) as number,
              fileType: row.file_type as string,
              storagePath: row.storage_path as string,
              uploadedAt: row.uploaded_at as string,
            }
            setReceivedFiles((prev) => [...prev, newFile])
          }
        )
        .subscribe()

      channelRef.current = channel
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval)
      if (channelRef.current) {
        const supabase = createClient()
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [session])

  // Timer countdown
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))
      setTimeLeft(diff)
      if (diff <= 0) {
        clearInterval(interval)
        setSession(null)
        initRef.current = false
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [session])

  // Auto-start ONCE when opening (ref prevents infinite loop)
  useEffect(() => {
    if (isOpen && !initRef.current) {
      initRef.current = true
      startSession()
    }
    if (!isOpen) {
      initRef.current = false
    }
  }, [isOpen, startSession])

  const handleUseFiles = () => {
    onFilesReceived(receivedFiles)
    if (session) {
      closeTransferSession(session.id)
    }
    onClose()
  }

  const handleClose = () => {
    if (session) {
      closeTransferSession(session.id)
    }
    if (channelRef.current) {
      const supabase = createClient()
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setSession(null)
    setReceivedFiles([])
    onClose()
  }

  // Pull files on demand (fallback for when Realtime isn't available)
  const handleRefresh = async () => {
    if (!session) return
    const result = await getTransferFiles(session.id)
    if (result.ok && result.files) {
      setReceivedFiles(result.files)
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon size={16} color="#3b82f6" />
    if (type.includes('pdf')) return <FileText size={16} color="#ef4444" />
    return <File size={16} color="#FF6B00" />
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 480, background: '#fff', borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.2)', overflow: 'hidden',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', background: '#1E2D1A', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Smartphone size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Mobile Bridge</div>
              <div style={{ fontSize: 11, color: '#8BA485' }}>Transfer files from your phone</div>
            </div>
          </div>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
            <X size={20} color="#8BA485" />
          </button>
        </div>

        {error && <p role="alert" style={{ color: '#b91c1c', padding: 16 }}>{error}</p>}
        {/* Content */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 180, padding: '20px 0' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #e7e5e0', borderTopColor: '#FF6B00', animation: 'spin 1s linear infinite', marginBottom: 16 }} />
              <p style={{ fontSize: 14, color: '#888', margin: 0 }}>Generating QR code...</p>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : session ? (
            <>
              {/* QR + Instructions */}
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                {/* Timer */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: timeLeft < 60 ? '#fef2f2' : '#ecfdf5',
                  color: timeLeft < 60 ? '#dc2626' : '#10b981',
                  borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700,
                  marginBottom: 16,
                }}>
                  <Clock size={12} /> Expires in {formatTime(timeLeft)}
                </div>

                {/* QR Image */}
                {qrDataUrl && (
                  <div style={{
                    display: 'inline-block', padding: 16, background: '#fff',
                    borderRadius: 16, border: '2px solid #e7e5e0', marginBottom: 16,
                    boxShadow: '0 4px 16px rgba(0,0,0,.06)',
                  }}>
                    <Image src={qrDataUrl} unoptimized alt="Scan to upload" width={240} height={240} style={{ display: 'block' }} />
                  </div>
                )}

                {/* Short code */}
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#999', marginBottom: 6 }}>
                    Or enter code manually
                  </p>
                  <div style={{
                    display: 'inline-block', background: '#fafaf8', borderRadius: 10,
                    border: '2px dashed #d4d2cc', padding: '10px 24px',
                    fontSize: 28, fontWeight: 900, letterSpacing: '6px', color: '#1c1917',
                  }}>
                    {session.shortCode}
                  </div>
                </div>

                {/* Steps */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {[
                    { icon: <QrCode size={14} />, text: '1. Scan QR' },
                    { icon: <Smartphone size={14} />, text: '2. Select files' },
                    { icon: <Wifi size={14} />, text: '3. Auto-synced' },
                  ].map((step, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, fontWeight: 600, color: '#888',
                      background: '#fafaf8', borderRadius: 8, padding: '6px 10px',
                    }}>
                      {step.icon} {step.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* Received files */}
              <div style={{ borderTop: '1px solid #e7e5e0', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#333', margin: 0 }}>
                    Received Files ({receivedFiles.length})
                  </h3>
                  <button onClick={handleRefresh} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, color: '#FF6B00',
                  }}>
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>

                {receivedFiles.length === 0 ? (
                  <div style={{
                    background: '#fafaf8', borderRadius: 12, border: '1px solid #e7e5e0',
                    padding: '24px 16px', textAlign: 'center',
                  }}>
                    <Wifi size={28} color="#ccc" style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: 13, color: '#999' }}>Waiting for files from phone...</p>
                    <p style={{ fontSize: 11, color: '#ccc', marginTop: 4 }}>Files refresh every few seconds</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {receivedFiles.map((file) => (
                      <div key={file.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: '#ecfdf5', borderRadius: 10, border: '1px solid #bbf7d0',
                        padding: '10px 14px',
                      }}>
                        <CheckCircle2 size={16} color="#10b981" />
                        {getFileIcon(file.fileType)}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, margin: 0 }}>{file.fileName}</p>
                          <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{formatFileSize(file.fileSize)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e7e5e0', display: 'flex', gap: 12 }}>
          {receivedFiles.length > 0 ? (
            <button onClick={handleUseFiles} style={{
              flex: 1, padding: '14px 0', borderRadius: 12,
              background: '#FF6B00', color: '#fff', border: 'none',
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 16px rgba(255,107,0,.25)',
            }}>
              <CheckCircle2 size={18} /> Use {receivedFiles.length} File{receivedFiles.length > 1 ? 's' : ''}
            </button>
          ) : (
            <button onClick={() => { setSession(null); startSession() }} style={{
              flex: 1, padding: '14px 0', borderRadius: 12,
              background: '#fafaf8', color: '#555', border: '1px solid #e7e5e0',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <RefreshCw size={16} /> New QR Code
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Returns a base URL that phones on the same LAN can reach.
 * If the kiosk is accessed via localhost/127.0.0.1, we swap it out
 * for the machine's actual LAN IP so the QR code works on phones.
 */
function getLanBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000'

  const { hostname, port, protocol } = window.location

  // Already using a real IP or hostname — use as-is
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
  }

  // Try to discover LAN IP via WebRTC (sync fallback from env)
  // First check if Next.js exposed the network IP via env
  const envIp = process.env.NEXT_PUBLIC_LAN_IP
  if (envIp) {
    return `${protocol}//${envIp}${port ? `:${port}` : ''}`
  }

  // Fallback: scan common private IP patterns from the page URL
  // If we're on localhost, try to get LAN IP from a pre-injected global
  if (typeof (window as any).__KIOSK_LAN_IP === 'string') {
    return `${protocol}//${(window as any).__KIOSK_LAN_IP}${port ? `:${port}` : ''}`
  }

  // Last resort: use the origin as-is but warn
  console.warn(
    '⚠️ QR code will use localhost URL. For phone scanning, access the kiosk via your LAN IP instead.\n' +
    'Tip: Set NEXT_PUBLIC_LAN_IP in .env.local to your machine\'s IP (e.g., 172.16.135.79)'
  )
  return window.location.origin
}
