'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowRight, File as FileIcon, UploadCloud, X, Clock, Printer, SlidersHorizontal,
} from 'lucide-react'
import {
  calculateKioskTotal, getDefaultOptions,
  type KioskFileSummary, type KioskOptionSummary, type KioskOptionValue, type KioskServiceSummary,
} from '@/lib/kiosk/order-draft'
import { saveStagedFiles, loadStagedFiles, type StagedFileChannel } from '@/lib/kiosk/staged-files'
import { getServiceConfigurationAction } from '@/lib/actions/service-catalog'
import { normalizeService, normalizeOption, restoreConfiguredOptions, validatePrintOptions } from '@/lib/kiosk/print-options'
import dynamic from 'next/dynamic'
import { createEditedUpload, EDITABLE_UPLOAD_EXTENSIONS, getFileEditorKind } from '@/lib/editor/file-types'
import { formatFileSize } from '@/lib/utils/format'
import { getQueueTelemetryAction } from '@/lib/actions/submit-order'

import { PrintOptionField } from './print-option-field'
import { FlowHeading } from './flow-heading'

const UploadFileEditor = dynamic(() => import('@/components/editor/upload-file-editor'), { ssr: false })
const ALLOWED_EXTENSIONS = EDITABLE_UPLOAD_EXTENSIONS
const ACCEPTED_UPLOADS = ALLOWED_EXTENSIONS.join(',')

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export interface ServiceOrderClientProps {
  homeHref: string; reviewHref: string; draftStorageKey: string
  stagedChannel: StagedFileChannel; uploadSubline?: string
}

export function ServiceOrderClient({
  homeHref, reviewHref, draftStorageKey, stagedChannel,
}: ServiceOrderClientProps) {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const router = useRouter()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  const [service, setService] = useState<KioskServiceSummary | null>(null)
  const [options, setOptions] = useState<KioskOptionSummary[]>([])
  const [selectedOptions, setSelectedOptions] = useState<Record<string, KioskOptionValue>>({})
  const [files, setFiles] = useState<KioskFileSummary[]>([])
  const [rawFiles, setRawFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [savingFiles, setSavingFiles] = useState(false)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [queueTelemetry, setQueueTelemetry] = useState<Awaited<ReturnType<typeof getQueueTelemetryAction>> | null>(null)

  useEffect(() => {
    let ignore = false
    const fetchData = async () => {
      try {
        setLoading(true)
        setLoadError(null)
        const result = await getServiceConfigurationAction(slug)
        if (!result.ok) { if (!ignore) { setService(null); setOptions([]); setLoadError(result.error) } return }
        const normalizedService = normalizeService(result.data.service)
        const normalizedOptions = result.data.options.map(normalizeOption)
        if (!ignore) {
          setService(normalizedService)
          setOptions(normalizedOptions)
          let restoredOptions = {}
          try {
            const saved = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null')
            if (saved?.service?.slug === slug) restoredOptions = restoreConfiguredOptions(normalizedOptions, saved.options ?? {})
          } catch { /* Use service defaults if the saved draft cannot be read. */ }
          setSelectedOptions({ ...getDefaultOptions(normalizedOptions), ...restoredOptions })
        }
      } catch (err) {
        if (!ignore) { setService(null); setLoadError('Could not connect to the service database. Please retry.') }
        console.error(err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    fetchData()
    return () => { ignore = true }
  }, [slug, draftStorageKey, retry])

  // Persistence: Load existing draft from sessionStorage on mount
  useEffect(() => {
    const savedDraft = sessionStorage.getItem(draftStorageKey)
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft)
        if (parsed.files) setFiles(parsed.files)
        
        // Restore raw files from staging if they exist
        const restoreFiles = async () => {
          const staged = await loadStagedFiles(stagedChannel)
          if (staged.length > 0) {
            setRawFiles(staged)
          }
        }
        restoreFiles()
      } catch (e) {
        console.error('Failed to restore draft', e)
      }
    }
  }, [draftStorageKey, stagedChannel])

  useEffect(() => {
    let ignore = false
    const loadTelemetry = async () => {
      if (!service) return
      const telemetry = await getQueueTelemetryAction(service.estimatedDurationMinutes)
      if (!ignore) setQueueTelemetry(telemetry)
    }
    loadTelemetry()
    const id = setInterval(loadTelemetry, 30000)
    return () => {
      ignore = true
      clearInterval(id)
    }
  }, [service])

  const totalPrice = service ? calculateKioskTotal(service, options, selectedOptions) : 0
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !slug) return
    addFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const persistFiles = async (nextRawFiles: File[], nextFiles: KioskFileSummary[]) => {
    if (!service) throw new Error('The service is still loading.')
    await saveStagedFiles(stagedChannel, nextRawFiles)
    try {
      sessionStorage.setItem(draftStorageKey, JSON.stringify({
        service, options: selectedOptions, optionDefinitions: options, files: nextFiles,
        checkout: JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null')?.checkout,
        totalPrice, createdAt: new Date().toISOString(),
      }))
    } catch {
      await saveStagedFiles(stagedChannel, rawFiles)
      throw new Error('Your browser could not save the draft. The previous files have been kept. Free some browser storage and try again.')
    }
    setRawFiles(nextRawFiles)
    setFiles(nextFiles)
  }

  const addFiles = async (incomingFiles: File[]) => {
    if (savingFiles) return
    const validFiles = incomingFiles.filter(f => hasAllowedExtension(f.name) && f.size > 0 && f.size <= 200 * 1024 * 1024)
    const invalidCount = incomingFiles.length - validFiles.length

    if (invalidCount > 0) {
      toast.error(`${invalidCount} file(s) ignored. Choose non-empty PDF, DOCX, XLSX, PPTX, JPG, PNG, WEBP, TXT, or CSV files up to 200 MB.`)
    }

    if (validFiles.length === 0) {
      return
    }
    if (rawFiles.length + validFiles.length > 20 || [...rawFiles, ...validFiles].reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) {
      toast.error('Each order supports up to 20 files, with a combined size of at most 200 MB.')
      return
    }
    
    const newSummaries = validFiles.map(f => ({ name: f.name, size: f.size, type: f.type }))
    setSavingFiles(true)
    try {
      await persistFiles([...rawFiles, ...validFiles], [...files, ...newSummaries])
      toast.success(`${validFiles.length} file(s) added`)
    } catch { toast.error('Could not save uploaded files. Please try again.') }
    finally { setSavingFiles(false) }
  }

  const handleOptionChange = (name: string, value: KioskOptionValue) => {
    if (!service) return
    const next = { ...selectedOptions, [name]: value }
    try {
      const previous = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null')
      sessionStorage.setItem(draftStorageKey, JSON.stringify({ ...previous, service, files, optionDefinitions: options, options: next,
        totalPrice: calculateKioskTotal(service, options, next), createdAt: previous?.createdAt ?? new Date().toISOString() }))
      setSelectedOptions(next)
    } catch { toast.error('Your browser could not save this print choice. Please retry.') }
  }
  useEffect(() => {
    const urls: Record<string, string> = {}
    rawFiles.forEach((file, index) => {
      if (getFileEditorKind(file.name) === 'image') urls[String(index)] = URL.createObjectURL(file)
    })
    setThumbnails(urls)
    return () => { Object.values(urls).forEach(url => URL.revokeObjectURL(url)) }
  }, [rawFiles])

  const handleRemoveFile = async (index: number) => {
    setSavingFiles(true)
    try { await persistFiles(rawFiles.filter((_, position) => position !== index), files.filter((_, position) => position !== index)) }
    catch { toast.error('Could not remove the file. Please try again.') }
    finally { setSavingFiles(false) }
  }

  const handleSaveEdit = async (blob: Blob) => {
    if (editingIndex === null || !rawFiles[editingIndex] || !service) throw new Error('The original file is unavailable. Close the editor and upload it again.')
    const edited = createEditedUpload(rawFiles[editingIndex], blob)
    const nextRawFiles = rawFiles.map((file, index) => index === editingIndex ? edited : file)
    if (nextRawFiles.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('The edited files exceed the combined 200 MB order limit.')
    const nextFiles = files.map((file, index) => index === editingIndex ? { name: edited.name, size: edited.size, type: edited.type, edited: true } : file)
    await persistFiles(nextRawFiles, nextFiles)
    setEditingIndex(null)
    toast.success('Edits saved to your order.')
  }

  const handleNext = async () => {
    if (!service) return
    if (savingFiles || editingIndex !== null) return
    const optionError = validatePrintOptions(selectedOptions)
    if (optionError) { toast.error(optionError); return }
    if (service.slug === 'printing' && options.length === 0) { toast.error('Print options must be configured in the database before continuing.'); return }
    if (files.length === 0 && service.slug !== 'id-picture' && service.slug !== 'scanning') { toast.error('Please upload at least one file'); return }
    if (files.length !== rawFiles.length) { toast.error('Some files are unavailable. Please upload them again.'); return }
    try { await saveStagedFiles(stagedChannel, rawFiles) } catch { toast.error('Could not stage files'); return }
    sessionStorage.setItem(draftStorageKey, JSON.stringify({ 
      service, 
      checkout: JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null')?.checkout,
      options: selectedOptions,
      optionDefinitions: options,
      files, 
      totalPrice, 
      createdAt: new Date().toISOString(),
    }))
    
    if (service.slug === 'scanning') {
      router.push(`${reviewHref}?service=${service.slug}&autoSubmit=true`)
    } else {
      router.push(`${reviewHref}?service=${service.slug}`)
    }
  }

  if (loading) return (
    <div role="status" aria-label="Loading print service" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, padding: 40 }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', border: '4px solid #e7e5e0', borderTopColor: 'var(--jnc-red)', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!service) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, padding: 40, textAlign: 'center' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1c1917', marginBottom: 12 }}>Service unavailable</h1>
      <p>{loadError}</p>
      <button className="button button-outline" onClick={() => setRetry(v => v + 1)}>Retry</button>
      <Link href={homeHref} className="button button-navy">Back to services</Link>
    </div>
  )

  return (
    <div className="service-flow">
      <FlowHeading title={service.slug === 'printing' ? 'Document Printing' : service.name} subtitle={service.slug === 'printing' ? 'Upload your files and select print options.' : service.description} />
      <div className="service-workspace">
        {/* Upload */}
        {service.slug !== 'scanning' && (
          <div className="upload-panel bg-white shadow-sm">
            <h2 className="panel-heading"><UploadCloud size={20} /> Files to print</h2>
            <p className="upload-hint">PDF, Word, Excel, PowerPoint, images, or text · Up to 20 files and 200 MB total. Use Edit beside a file to change it before printing.</p>
            
            <label className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)) }}>
              <input 
                type="file" 
                multiple
                disabled={savingFiles}
                accept={ACCEPTED_UPLOADS}
                onChange={handleFileUpload} 
                className="upload-input"
                aria-label="Select files to print"
              />
              <UploadCloud size={28} className="text-[#12233F]" />
              <strong>Click to browse or drag and drop files here</strong>
              <small>Supported formats: PDF, DOCX, XLSX, PPTX, JPG, PNG, WEBP, TXT, CSV</small>
              <span className="button button-primary">
                Select files
              </span>
            </label>

            {files.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between bg-white rounded-xl border border-[#eee] p-3 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      {thumbnails[String(index)] ? (
                        <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-[#eee]">
                          <Image src={thumbnails[String(index)]} width={48} height={48} unoptimized className="w-full h-full object-cover" alt={`Preview of ${file.name}`} />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-[#f9f9f9] flex items-center justify-center shrink-0">
                          <FileIcon size={20} className="text-[#8e1b1b]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#333] truncate m-0">{file.name}</p>
                        <p className="text-xs text-[#888] m-0">{formatFileSize(file.size)}{file.edited && <span className="ml-2 text-[#1e8e3e]">Edits saved</span>}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getFileEditorKind(file.name) && (
                        <button type="button" aria-label={'Edit ' + file.name} disabled={savingFiles || !rawFiles[index]}
                          onClick={() => setEditingIndex(index)}
                          className="bg-[#8e1b1b] text-white rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-[#6c1414] disabled:opacity-50">
                          Edit
                        </button>
                      )}

                      <button type="button" aria-label={`Remove ${file.name}`} disabled={savingFiles} onClick={() => void handleRemoveFile(index)} className="text-[#ef4444] hover:bg-[#fee2e2] p-1.5 rounded-lg transition-colors">
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Options */}
        <div className="options-panel bg-white shadow-sm">
          <h2 className="panel-heading"><SlidersHorizontal size={19} /> Print options</h2><p className="panel-description">Choose how you’d like your documents printed.</p>
          
          <div className="service-options">
            {options.length === 0 ? <p className="helper-note">No additional options.</p> : options.map(option => <PrintOptionField key={option.id} option={option} value={selectedOptions[option.name]} onChange={value => handleOptionChange(option.name, value)} prefix="service" />)}
          </div>

          <div className="upload-reassurance"><Printer size={16} /><p>Check every page in the preview before placing your order.</p></div>
          <div className="service-continue">
            <button 
              type="button" 
              onClick={() => router.push(homeHref)}
              className="button button-outline"
            >
              Back
            </button>
            <button 
              type="button" 
              onClick={() => void handleNext()} 
              disabled={savingFiles || editingIndex !== null}
              className="button button-primary"
            >
              {service.slug === 'scanning' ? 'Continue' : 'Continue to review'} <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {queueTelemetry?.metrics && (
          <div className={`service-telemetry rounded-2xl p-5 border ${queueTelemetry.metrics.systemStatus === 'overloaded' ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-white border-[#eee]'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#888] uppercase tracking-wider mb-1">Queue estimate</p>
                <p className="text-sm text-[#555] m-0">
                  {!queueTelemetry.queueConfigured ? 'Queue setup unavailable' : queueTelemetry.metrics.isStable
                    ? `Estimated average wait is ~${Math.ceil(queueTelemetry.metrics.averageWaitQueueMinutes ?? service.estimatedDurationMinutes)} min`
                    : queueTelemetry.metrics.systemStatus === 'paused' ? 'Queue paused - waiting for staff' : 'High demand - wait time may increase'}
                </p>
              </div>
              <div className="text-right flex items-center gap-2">
                <Clock size={16} className="text-[#e85d04]" />
                <p className="text-sm font-bold text-[#333] m-0">
                  {queueTelemetry.metrics.utilization == null ? 'Capacity unavailable' : (queueTelemetry.metrics.utilization * 100).toFixed(0) + '% busy'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {editingIndex !== null && rawFiles[editingIndex] && (
        <UploadFileEditor file={rawFiles[editingIndex]} onSave={handleSaveEdit} onCancel={() => setEditingIndex(null)} />
      )}
    </div>
  )
}

