'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, ChevronLeft, ChevronRight, Eye, FileText, Italic, LoaderCircle, RotateCcw, Save, Undo2, Redo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { PdfLayout, PdfLayoutEdit } from '@/lib/editor/pdf-layout-types'
import { ExpandedPreview } from '@/components/order-flow/expanded-preview'
import styles from './editor-shell.module.css'

async function requestPdf(file: File, action: 'inspect' | 'save', edits: PdfLayoutEdit[] = [], signal?: AbortSignal) {
  const form = new FormData(); form.append('file', file); form.append('action', action)
  if (action === 'save') form.append('edits', JSON.stringify(edits))
  const response = await fetch('/api/files/pdf-edit', { method: 'POST', body: form, signal })
  if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error || 'The PDF could not be edited. Your original file is kept.') }
  return response
}
export function PdfEditor({ file, onSave, onCancel }: { file: File; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  const [layout, setLayout] = useState<PdfLayout | null>(null), [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, PdfLayoutEdit>>({}), [selected, setSelected] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0), [zoom, setZoom] = useState(1), [width, setWidth] = useState(800)
  const [renderFile, setRenderFile] = useState(file), [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [rendering, setRendering] = useState(true)
  const [originalOpen, setOriginalOpen] = useState(false), [printPreview, setPrintPreview] = useState<File | null>(null)
  const [undo, setUndo] = useState<Record<string, PdfLayoutEdit>[]>([]), [redo, setRedo] = useState<Record<string, PdfLayoutEdit>[]>([])
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), renderTask = useRef<RenderTask | null>(null)
  const page = layout?.pages[pageIndex], span = page?.spans.find(span => span.id === selected)
  const value = span ? { ...span, ...edits[span.id] } : null
  const scale = page ? Math.min(1.35, Math.max(150, width - 50) / page.width) * zoom : 1
  const dirty = Object.values(edits).filter(edit => {
    const original = layout?.pages[Number(edit.id.split(':')[0])]?.spans.find(span => span.id === edit.id)
    return original && (edit.text !== original.text || edit.size !== undefined && edit.size !== original.size || edit.bold !== undefined && edit.bold !== original.bold || edit.italic !== undefined && edit.italic !== original.italic || edit.color !== undefined && edit.color !== original.color)
  })
  const dirtyKey = JSON.stringify(dirty)
  useEffect(() => {
    const controller = new AbortController()
    void requestPdf(file, 'inspect', [], controller.signal).then(response => response.json()).then((data: PdfLayout) => { setLayout(data); setError(null) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [file])
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    if (dirtyKey === '[]') { setRenderFile(file); setRefreshing(false); setError(null); return }
    setRefreshing(true)
    const timer = setTimeout(() => {
      void requestPdf(file, 'save', JSON.parse(dirtyKey), controller.signal).then(response => response.blob()).then(blob => { if (!controller.signal.aborted) { setRenderFile(new File([blob], file.name, {type:'application/pdf'})); setError(null) } }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setRefreshing(false) })
    }, 650)
    return () => { clearTimeout(timer); controller.abort() }
  }, [file, dirtyKey])
  useEffect(() => {
    let stopped = false
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null
    void (async () => {
      const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = '/scripts/pdfjs/pdf.worker.min.mjs'
      if (stopped) return
      task = pdfjs.getDocument({ data:await renderFile.arrayBuffer(), cMapUrl:'/scripts/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/scripts/pdfjs/standard_fonts/',wasmUrl:'/scripts/pdfjs/wasm/',iccUrl:'/scripts/pdfjs/iccs/' })
      const loaded = await task.promise; if (!stopped) setPdf(loaded)
    })().catch(error => { if (!stopped) setError(error.message) })
    return () => { stopped = true; setPdf(null); void task?.destroy() }
  }, [renderFile])
  useEffect(() => {
    if (!pdf || !canvas.current) return
    let stopped = false, task: RenderTask | null = null
    setRendering(true)
    void (async () => {
      await renderTask.current?.promise.catch(() => undefined)
      const source = await pdf.getPage(pageIndex + 1)
      if (stopped || !canvas.current) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2), viewport = source.getViewport({scale:scale * ratio})
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
      canvas.current.style.width = viewport.width / ratio + 'px'; canvas.current.style.height = viewport.height / ratio + 'px'
      task = source.render({canvas:canvas.current,canvasContext:canvas.current.getContext('2d')!,viewport}); renderTask.current = task
      await task.promise
    })().catch(error => { if (!stopped && error.name !== 'RenderingCancelledException') setError('This PDF page could not be displayed.') }).finally(() => { if (renderTask.current === task) renderTask.current = null; if (!stopped) setRendering(false) })
    return () => { stopped = true; task?.cancel() }
  }, [pdf, pageIndex, scale])
  const change = (patch: Partial<PdfLayoutEdit>) => {
    if (!span) return
    setUndo(history => [...history.slice(-49), edits]); setRedo([])
    setEdits(current => ({...current,[span.id]:{...(current[span.id] ?? {id:span.id,text:span.text}),...patch}}))
  }
  const save = useCallback(async (previewOnly: boolean) => {
    setBusy(true)
    try {
      const changes: PdfLayoutEdit[] = JSON.parse(dirtyKey)
      const blob = changes.length ? await (await requestPdf(file, 'save', changes)).blob() : file
      if (previewOnly) setPrintPreview(new File([blob],file.name,{type:'application/pdf'})); else await onSave(blob)
    } catch (error) { setError(error instanceof Error ? error.message : 'The PDF was not saved. Your original file is kept.') }
    finally { setBusy(false) }
  }, [dirtyKey,file,onSave])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (layout && !busy && !refreshing && !error) void save(false) } }
    window.addEventListener('keydown',key,true); return () => window.removeEventListener('keydown',key,true)
  }, [layout,busy,refreshing,error,save])
  return <div className={styles.shell} role="dialog" aria-modal="true" aria-label="PDF page editor">
    <header className={`${styles.header} ${styles.documentHeader}`}><div className={styles.documentIdentity}><span className={styles.documentIcon}><FileText size={23}/></span><div><h2>{file.name}</h2><p><span className={styles.documentBadge}>PDF</span>Original page layout · Tables, graphics, and page sizes are kept</p></div></div><div className={styles.actions}><button className={styles.button} onClick={() => setOriginalOpen(true)} disabled={busy}><FileText size={16}/>Original PDF</button><button className={styles.button} onClick={() => void save(true)} disabled={!layout || busy || refreshing || !!error}><Eye size={16}/>Print preview</button><button className={styles.button} onClick={onCancel} disabled={busy}><X size={16}/>Cancel</button><button className={`${styles.button} ${styles.primary}`} onClick={() => void save(false)} disabled={!layout || busy || refreshing || !!error}><Save size={16}/>{busy ? 'Saving…' : 'Save PDF to order'}</button></div></header>
    <div className={styles.documentGuidance}>Click text or a table value on the page to edit it. Changes stay within the original line or cell; longer text must fit before it can be saved.</div>
    <div className={styles.pdfToolbar}><button className={styles.button} aria-label="Undo PDF edit" disabled={!undo.length || busy} onClick={() => { setRedo(history => [...history,edits]); setEdits(undo.at(-1)!); setUndo(history => history.slice(0,-1)) }}><Undo2 size={16}/></button><button className={styles.button} aria-label="Redo PDF edit" disabled={!redo.length || busy} onClick={() => { setUndo(history => [...history,edits]); setEdits(redo.at(-1)!); setRedo(history => history.slice(0,-1)) }}><Redo2 size={16}/></button><span className={styles.pdfFont}>{value?.font.replace(/^[A-Z]{6}\+/,'') || 'Select text'}</span><label>Size<input aria-label="PDF font size" type="number" min={4} max={value ? Math.max(value.size,span?.height || 0) : 72} step="0.5" value={value?.size ?? ''} disabled={!span || busy} onChange={e => change({size:Number(e.target.value)})}/></label><button className={styles.button} aria-label="Bold PDF text" aria-pressed={value?.bold || false} disabled={!span || busy} onClick={() => change({bold:!value?.bold})}><Bold size={16}/></button><button className={styles.button} aria-label="Italic PDF text" aria-pressed={value?.italic || false} disabled={!span || busy} onClick={() => change({italic:!value?.italic})}><Italic size={16}/></button><label>Color<input aria-label="PDF text color" type="color" value={value?.color || '#000000'} disabled={!span || busy} onChange={e => change({color:e.target.value})}/></label><button className={styles.button} aria-label="Zoom out PDF editor" onClick={() => setZoom(n=>Math.max(.5,n-.25))} disabled={zoom<=.5}><ZoomOut size={16}/></button><span>{Math.round(scale*100)}%</span><button className={styles.button} aria-label="Zoom in PDF editor" onClick={() => setZoom(n=>Math.min(2,n+.25))} disabled={zoom>=2}><ZoomIn size={16}/></button><div className={styles.pdfPagination}><button className={styles.button} aria-label="Previous PDF page" disabled={pageIndex===0} onClick={() => {setPageIndex(n=>n-1);setSelected(null)}}><ChevronLeft size={17}/></button><span>Page {pageIndex+1} of {layout?.pages.length || '…'}</span><button className={styles.button} aria-label="Next PDF page" disabled={!layout || pageIndex+1>=layout.pages.length} onClick={() => {setPageIndex(n=>n+1);setSelected(null)}}><ChevronRight size={17}/></button></div></div>
    {span && value && <div className={styles.pdfTextBar}><label htmlFor="pdf-selected-text">Selected text</label><input id="pdf-selected-text" aria-label="Selected PDF text" value={value.text} onChange={e=>change({text:e.target.value})} disabled={busy}/><button className={styles.button} onClick={() => {setUndo(history=>[...history,edits]);setEdits(current=>{const next={...current};delete next[span.id];return next});setRedo([])}} disabled={!edits[span.id] || busy}><RotateCcw size={15}/>Reset text</button><button className={styles.button} aria-label="Close PDF text selection" onClick={()=>setSelected(null)}><X size={16}/></button></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <main ref={container} className={styles.pdfWorkspace} aria-busy={!layout || busy || refreshing || rendering}>{!layout && <p className={styles.notice}><LoaderCircle size={25} className="loading-spin"/>Opening the original PDF pages…</p>}{layout && !page?.spans.some(span=>span.editable) && <p className={styles.notice}>No editable text was found on this page. Upload the original document to edit scanned text.</p>}<div className={styles.pdfPage} style={page ? {width:page.width*scale,height:page.height*scale} : undefined}><canvas ref={canvas} role="img" aria-label={`Original-layout page ${pageIndex+1} of ${file.name}`}/>{page?.spans.filter(span=>span.editable).map(span=><button type="button" className={styles.pdfTextTarget} key={span.id} aria-label={`Edit text: ${span.text.trim()}`} title={span.text.trim()} aria-pressed={selected===span.id} disabled={busy} style={{left:span.x*scale,top:span.y*scale,width:Math.max(8,span.width*scale),height:span.height*scale}} onClick={()=>setSelected(span.id)}/>)}</div></main>
    <footer className={styles.documentFooter}><span role="status">{refreshing ? 'Updating the original page preview…' : error ? 'Fix the selected text before saving.' : dirty.length ? `${dirty.length} text change${dirty.length===1?'':'s'} · Preview updated` : 'Original layout · No changes'}</span><span>Ctrl+S to save</span></footer>
    {originalOpen && <ExpandedPreview file={file} grayscale={false} onClose={()=>setOriginalOpen(false)}/>}{printPreview && <ExpandedPreview file={printPreview} grayscale={false} onClose={()=>setPrintPreview(null)}/>}
  </div>
}
