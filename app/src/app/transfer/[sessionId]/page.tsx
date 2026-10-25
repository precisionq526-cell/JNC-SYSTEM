'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2, File, Image as ImageIcon, FileText, Printer,
  Upload, Smartphone, Wifi, X, AlertCircle, Loader2,
} from 'lucide-react'
import { getTransferSessionByCode, getTransferSessionById, uploadTransferFiles } from '@/lib/actions/transfer-session'
import { type TransferSession } from '@/lib/transfer/types'
import { formatFileSize } from '@/lib/utils/format'

function MobileUploadContent() {
  const params = useParams<{ sessionId: string }>()
  const searchParams = useSearchParams()
  const code = searchParams.get('code') ?? ''

  const [session, setSession] = useState<TransferSession | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'uploading' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadedCount, setUploadedCount] = useState(0)

  // Validate the session
  useEffect(() => {
    async function validate() {

      try {
        const result = code ? await getTransferSessionByCode(code) : await getTransferSessionById(params.sessionId)
        if (result.ok && result.session && result.session.id === params.sessionId) {
          setSession(result.session)
          setStatus('ready')
        } else {
          setError(result.error ?? 'Transfer session does not match this link.')
          setStatus('error')
        }
      } catch {
        setError('Could not verify this transfer session. Please retry.')
        setStatus('error')
      }
    }
    validate()
  }, [params.sessionId, code])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)])
    e.target.value = ''
  }

  const handleRemove = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = useCallback(async () => {
    if (!session || selectedFiles.length === 0) return
    setStatus('uploading')

    const formData = new FormData()
    formData.append('sessionId', session.id)
    for (const file of selectedFiles) {
      formData.append('files', file)
    }

    try {
      const result = await uploadTransferFiles(formData)
      if (!result.ok) {
        throw new Error(result.error ?? 'Upload failed')
      }
      setUploadedCount(result.files?.length ?? 0)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please retry.')
      setStatus('error')
    }
  }, [session, selectedFiles])

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon size={18} color="#3b82f6" />
    if (type.includes('pdf')) return <FileText size={18} color="#ef4444" />
    return <File size={18} color="#FF6B00" />
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F0EFE9',
      fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        padding: '16px 20px', background: '#1E2D1A', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Printer size={16} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>JandC QMS</div>
          <div style={{ fontSize: 10, color: '#8BA485' }}>Mobile File Transfer</div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '20px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: '40px 0' }}>
            <Loader2 size={40} color="#FF6B00" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
            <p style={{ fontSize: 14, color: '#888', margin: 0 }}>Connecting to kiosk...</p>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fef2f2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <AlertCircle size={28} color="#dc2626" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1c1917', marginBottom: 8 }}>Connection Failed</h2>
            <p style={{ fontSize: 14, color: '#888', marginBottom: 24, lineHeight: 1.6 }}>{error}</p>
            <p style={{ fontSize: 13, color: '#bbb' }}>
              Please scan the QR code again or ask the kiosk attendant for a new code.
            </p>
          </div>
        )}

        {status === 'ready' && (
          <>
            {/* Connected badge */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#ecfdf5', borderRadius: 999, padding: '6px 16px',
                fontSize: 12, fontWeight: 700, color: '#10b981',
              }}>
                <Wifi size={12} /> Connected to Kiosk
              </div>
            </div>

            {/* Instructions */}
            <div style={{
              background: '#fff', borderRadius: 16, border: '1px solid #e7e5e0',
              padding: '32px 24px', marginBottom: 16, textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.04)',
              display: 'flex', flexDirection: 'column', alignItems: 'center'
            }}>
              <Smartphone size={40} color="#FF6B00" style={{ marginBottom: 16 }} />
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1c1917', margin: '0 0 8px' }}>
                Upload Your Files
              </h1>
              <p style={{ fontSize: 13, color: '#888', lineHeight: 1.6, maxWidth: 320 }}>
                Select photos, documents, or any files you need printed. They will appear on the kiosk screen instantly.
              </p>
            </div>

            {/* Upload area */}
            <label style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              minHeight: 140, borderRadius: 14, border: '2px dashed #d4d2cc', background: '#fff',
              cursor: 'pointer', textAlign: 'center', padding: 24, position: 'relative',
              marginBottom: 16,
            }}>
              <input type="file" multiple onChange={handleFileSelect} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              <Upload size={32} color="#ccc" style={{ marginBottom: 8 }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#555' }}>Tap to select files</span>
              <span style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>Photos, PDFs, Word, Excel, etc.</span>
            </label>

            {/* Selected files list */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 10 }}>
                Files to Transfer {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}
              </h3>
              
              {selectedFiles.length === 0 ? (
                <div style={{ 
                  padding: '20px', borderRadius: 12, background: '#fafaf8', 
                  border: '1px dashed #e7e5e0', textAlign: 'center', color: '#bbb',
                  fontSize: 13, marginBottom: 16
                }}>
                  No files selected yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {selectedFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: '#fff', borderRadius: 10, border: '1px solid #e7e5e0',
                      padding: '10px 12px',
                    }}>
                      {getFileIcon(file.type)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, margin: 0 }}>{file.name}</p>
                        <p style={{ fontSize: 11, color: '#bbb', margin: 0 }}>{formatFileSize(file.size)}</p>
                      </div>
                      <button onClick={() => handleRemove(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <X size={16} color="#ef4444" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Send button (Always visible, disabled if empty) */}
              <button 
                onClick={handleUpload} 
                disabled={selectedFiles.length === 0}
                style={{
                  width: '100%', padding: '16px 0', borderRadius: 12,
                  background: selectedFiles.length > 0 ? '#FF6B00' : '#e7e5e0', 
                  color: selectedFiles.length > 0 ? '#fff' : '#999', 
                  border: 'none',
                  fontSize: 16, fontWeight: 700, 
                  cursor: selectedFiles.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: selectedFiles.length > 0 ? '0 4px 16px rgba(255,107,0,.25)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                <Upload size={18} /> 
                {selectedFiles.length > 0 
                  ? `Send ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''} to Kiosk` 
                  : 'Select files to continue'}
              </button>
            </div>
          </>
        )}

        {status === 'uploading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 240, padding: '40px 0' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: '4px solid #e7e5e0', borderTopColor: '#FF6B00',
              animation: 'spin 1s linear infinite', marginBottom: 24,
            }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1c1917', margin: '0 0 8px' }}>Sending to Kiosk...</h2>
            <p style={{ fontSize: 14, color: '#888', margin: 0 }}>Please wait while your files are being transferred.</p>
          </div>
        )}

        {status === 'done' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18, background: '#ecfdf5',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20, border: '2px solid #bbf7d0',
            }}>
              <CheckCircle2 size={36} color="#10b981" />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1c1917', marginBottom: 8 }}>
              Files Sent!
            </h2>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>
              {uploadedCount} file{uploadedCount > 1 ? 's' : ''} transferred successfully
            </p>
            <p style={{ fontSize: 14, color: '#888', lineHeight: 1.6, maxWidth: 300, margin: '0 auto 24px' }}>
              Your files are now on the kiosk screen. You can close this page and proceed at the kiosk.
            </p>
            <button onClick={() => { setSelectedFiles([]); setStatus('ready') }} style={{
              background: '#fff', border: '1px solid #e7e5e0', borderRadius: 10,
              padding: '12px 24px', fontSize: 14, fontWeight: 600, color: '#555', cursor: 'pointer',
            }}>
              Send More Files
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '12px 20px', textAlign: 'center',
        fontSize: 11, color: '#bbb', background: '#F0EFE9',
      }}>
        JandC QMS © 2026 — Secure File Transfer
      </footer>
    </div>
  )
}

export default function MobileUploadPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#F0EFE9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={36} color="#FF6B00" style={{ animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    }>
      <MobileUploadContent />
    </Suspense>
  )
}
