'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, ZoomIn, ZoomOut, Download } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { getFileEditorKind } from '@/lib/editor/file-types'
import { getDocumentPreviewBytes } from '@/lib/editor/document-preview'
import { PAPER_LABELS } from '@/lib/kiosk/print-options'
import { paperPreviewLayout } from '@/lib/printing/print-plan'

interface PreviewProps {
  printMargin?: number
  file: File
  width?: number
  height?: number
  grayscale?: boolean
  paperSize?: string
  photoSize?: string
  onPageCount?: (count: number) => void
}

export function DocumentPreview({ file, width = 460, height = 650, grayscale = false, paperSize, photoSize, onPageCount,printMargin=0 }: PreviewProps) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pageCountCallback = useRef(onPageCount)
  const renderTask = useRef<RenderTask | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableWidth, setAvailableWidth] = useState(width)
  const [zoom, setZoom] = useState(1)
  const [retry, setRetry] = useState(0)
  const kind = getFileEditorKind(file.name)
  const renderedPaper = printMargin || kind === 'image' || kind === 'text' ? paperSize ?? 'A4' : undefined
  const renderedPhotoSize = kind === 'image' ? photoSize : undefined

  useEffect(() => { pageCountCallback.current = onPageCount }, [onPageCount])
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(entries => setAvailableWidth(Math.min(width, entries[0].contentRect.width)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [width])

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null
    setPdf(null); setPdfBytes(null); setPageIndex(0); setZoom(1); setLoading(true); setRendering(false); setError(null)
    void (async () => {
      try {
        if (kind) {
          const bytes = await getDocumentPreviewBytes(file, { paperSize: renderedPaper, photoSize: renderedPhotoSize,printMargin })
          const pdfjs = await import('pdfjs-dist')
          if (cancelled) return
          setPdfBytes(bytes.slice(0))
          pdfjs.GlobalWorkerOptions.workerSrc = '/scripts/pdfjs/pdf.worker.min.mjs'
          task = pdfjs.getDocument({ data: bytes, cMapUrl: '/scripts/pdfjs/cmaps/', cMapPacked: true,
            standardFontDataUrl: '/scripts/pdfjs/standard_fonts/', wasmUrl: '/scripts/pdfjs/wasm/', iccUrl: '/scripts/pdfjs/iccs/' })
          const loaded = await task.promise
          if (!cancelled) { setPdf(loaded); pageCountCallback.current?.(loaded.numPages) }
        } else throw new Error('Preview unavailable for this format.')
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : 'Preview unavailable.') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; void task?.destroy() }
  }, [file, kind, retry, renderedPaper, renderedPhotoSize,printMargin])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let cancelled = false
    let task: RenderTask | null = null
    setRendering(true)
    setError(null)
    void (async () => {
      try {
        // Wait for a cancelled render before reusing the canvas when a customer
        // quickly changes sizes, pages or zoom levels.
        await renderTask.current?.promise.catch(() => undefined)
        if (cancelled) return
        const page = await pdf.getPage(pageIndex + 1)
        if (cancelled || !canvas.current) return
        const base = page.getViewport({ scale: 1 })
        const sheet = paperPreviewLayout(base.width, base.height, paperSize)
        const scale = Math.min(Math.max(1, availableWidth - 20) / sheet.width, height / sheet.height) * zoom
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: sheet.scale * scale * ratio })
        canvas.current.width = Math.ceil(sheet.width * scale * ratio)
        canvas.current.height = Math.ceil(sheet.height * scale * ratio)
        canvas.current.style.width = sheet.width * scale + 'px'
        canvas.current.style.height = sheet.height * scale + 'px'
        task = page.render({ canvas: canvas.current, canvasContext: canvas.current.getContext('2d')!, viewport,
          transform: [1, 0, 0, 1, sheet.x * scale * ratio, sheet.y * scale * ratio], background: '#ffffff' })
        renderTask.current = task
        await task.promise
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) setError('This page could not be rendered.')
      } finally {
        if (renderTask.current === task) renderTask.current = null
        if (!cancelled) setRendering(false)
      }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, pageIndex, availableWidth, height, zoom, paperSize])

  const downloadPreview = () => {
    if (!pdfBytes) return
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url; link.download = file.name.replace(/\.[^.]+$/, '') + '-preview.pdf'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  return <div ref={container} className="document-preview" style={{ width: '100%', maxWidth: width }}>
    {paperSize && <div className="preview-paper-info" aria-live="polite"><span>{PAPER_LABELS[paperSize] ?? paperSize}</span><small>Fit to paper</small></div>}
    <div className="preview-canvas-area" style={{ maxHeight: height + 20 }} aria-busy={loading || rendering}>
      {loading && <p role="status">{kind === 'office' ? 'Rendering the original document layout…' : 'Loading preview…'}</p>}
      {error && <div className="preview-error" role="alert"><FileText size={32} /><p>{error}</p><small>Your file is kept. A PDF exported from your document can also be uploaded.</small><p><button type="button" className="button button-outline" onClick={() => setRetry(value => value + 1)}>Retry preview</button></p></div>}
      <canvas ref={canvas} role="img" aria-label={'Page ' + (pageIndex + 1) + ' of ' + file.name + (paperSize ? ' on ' + paperSize + ' paper' : '')} style={{ display: pdf && !error ? 'block' : 'none', filter: grayscale ? 'grayscale(1)' : undefined }} />
    </div>
    {pdf && !error && <div className="preview-controls">
      <button type="button" aria-label="Previous preview page" onClick={() => setPageIndex(current => current - 1)} disabled={pageIndex === 0}><ChevronLeft size={18} /></button>
      <span>Page {pageIndex + 1} of {pdf.numPages}</span>
      <button type="button" aria-label="Next preview page" onClick={() => setPageIndex(current => current + 1)} disabled={pageIndex + 1 === pdf.numPages}><ChevronRight size={18} /></button>
      <button type="button" aria-label="Zoom out" onClick={() => setZoom(current => Math.max(1, current - .5))} disabled={zoom <= 1}><ZoomOut size={18} /></button>
      <button type="button" aria-label="Zoom in" onClick={() => setZoom(current => Math.min(3, current + .5))} disabled={zoom >= 3}><ZoomIn size={18} /></button>
      <button type="button" aria-label="Download PDF preview" title={paperSize && (kind === 'pdf' || kind === 'office') ? 'Download PDF with original page sizes' : 'Download PDF preview'} onClick={downloadPreview}><Download size={18} /></button>
    </div>}
  </div>
}
