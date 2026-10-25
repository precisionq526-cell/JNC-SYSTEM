'use client'

import { useEffect, useState } from 'react'
import { Loader2, Save, X, RefreshCw, Bold, Italic, Underline } from 'lucide-react'
import { openOfficeDocument, type OfficeDocument, type OfficeTextFormat } from '@/lib/editor/office-document'
import { createEditedUpload } from '@/lib/editor/file-types'
import { DocumentPreview } from '@/components/preview/document-preview'
import styles from './editor-shell.module.css'
import { WordSourcePage } from './word-source-page'
import { readTextDocument, saveTextDocument, type TextDocument } from '@/lib/editor/text-document'
import { SpreadsheetEditor } from './spreadsheet-editor'

interface DocumentEditorProps {
  file: File
  onSave: (blob: Blob) => Promise<void>
  onCancel: () => void
}

export function DocumentEditor({ file, onSave, onCancel }: DocumentEditorProps) {
  const [document, setDocument] = useState<OfficeDocument | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formats, setFormats] = useState<Record<string, OfficeTextFormat>>({})
  const [activeField, setActiveField] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [textSource, setTextSource] = useState<TextDocument | null>(null)
  const [previewFile, setPreviewFile] = useState(file)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [previewStale, setPreviewStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [imageRepairs,setImageRepairs] = useState<string[]>([])
  const extension = file.name.toLowerCase().split('.').pop() || ''
  const plainText = ['txt', 'csv'].includes(extension)

  useEffect(() => {
    let cancelled = false
    setInitialized(false); setLoading(true); setError(null);setImageRepairs([]);setFormats({})
    void (async () => {
      try {
        if (plainText) {
          const source = readTextDocument(new Uint8Array(await file.arrayBuffer()))
          if (!cancelled) { setText(source.text); setOriginalText(source.text); setTextSource(source) }
        } else {
          const opened = await openOfficeDocument(await file.arrayBuffer(), extension)
          if (!cancelled) {
            setDocument(opened)
            setValues(Object.fromEntries(opened.fields.map(field => [field.id, field.value])))
            setActiveField(opened.fields[0]?.id ?? null)
          }
        }
        if (!cancelled) setInitialized(true)
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : 'This document could not be opened. Your original file is kept.')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [file, extension, plainText])

  const exportEdits = () => plainText
    ? Promise.resolve(text === originalText ? file : new Blob([new Uint8Array(saveTextDocument(textSource!,text)).buffer], { type: extension === 'csv' ? 'text/csv' : 'text/plain' }))
    : document!.save(values, formats,imageRepairs)

  const save = async () => {
    setSaving(true); setError(null)
    try { await onSave(await exportEdits()) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save edits. Please try again.') }
    finally { setSaving(false) }
  }

  const refreshPreview = async () => {
    setRefreshing(true); setError(null)
    try { setPreviewFile(createEditedUpload(file, await exportEdits())); setPreviewStale(false) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update the preview.') }
    finally { setRefreshing(false) }
  }
  const toggleLogoRepair = async (id:string) => {
    const next=imageRepairs.includes(id)?imageRepairs.filter(value=>value!==id):[...imageRepairs,id]
    setImageRepairs(next);setRefreshing(true);setError(null);setPreviewStale(true)
    try {setPreviewFile(createEditedUpload(file,await document!.save(values,formats,next)));setPreviewStale(false)}
    catch(error){setError(error instanceof Error?error.message:'Could not preview this logo repair.')}
    finally{setRefreshing(false)}
  }

  const changeValue = (id: string, value: string) => {
    setValues(current => ({ ...current, [id]: value })); setPreviewStale(true)
  }
  const field = document?.fields.find(field => field.id === activeField)
  const activeFormat = { ...field?.format, ...(activeField ? formats[activeField] : {}) }
  const changeFormat = (format: OfficeTextFormat) => {
    if (!activeField) return
    setFormats(current => ({ ...current, [activeField]: { ...current[activeField], ...format } }))
    setPreviewStale(true)
  }

  let previousGroup = ''

  return <div className={styles.shell} role="dialog" aria-modal="true" aria-label={document?.kind === 'xlsx' ? 'Excel editor' : extension === 'docx' ? 'Word editor' : 'Document editor'}>
    <header className={styles.header}>
      <div><h2>{file.name}</h2><p>{plainText ? 'Edit your text, then save it to this order.' : document?.kind === 'xlsx'
        ? 'Edit cells in the worksheet grid. Merged cells, styles, formulas, images, and print areas are kept.'
        : document?.kind === 'docx' ? 'Edit text directly in its original table structure. Only your changed text and selected formatting are saved.' : 'Edit existing text. Slide objects, tables, pictures and formatting are kept.'}</p></div>
      <div className={styles.actions}>
        {!plainText && <button type="button" className={styles.button} onClick={() => void refreshPreview()} disabled={loading || saving || refreshing || !initialized}><RefreshCw size={16} />Update preview</button>}
        <button type="button" className={styles.button} onClick={onCancel} disabled={saving}><X size={16} />Cancel</button>
        <button type="button" className={styles.button + ' ' + styles.primary} onClick={() => void save()} disabled={loading || saving || refreshing || !initialized}>
          {saving ? <Loader2 size={16} /> : <Save size={16} />}{saving ? 'Saving…' : 'Save edits to order'}
        </button>
      </div>
    </header>
    {document?.kind === 'docx' && <div className={styles.toolbar} aria-label="Text formatting">
      <span className={styles.formatLabel}>{field?.label ?? 'Select some text below'}</span>
      <button type="button" className={styles.button} aria-label="Bold" aria-pressed={!!activeFormat.bold} disabled={!activeField || saving} onClick={() => changeFormat({ bold: !activeFormat.bold })}><Bold size={16} /></button>
      <button type="button" className={styles.button} aria-label="Italic" aria-pressed={!!activeFormat.italic} disabled={!activeField || saving} onClick={() => changeFormat({ italic: !activeFormat.italic })}><Italic size={16} /></button>
      <button type="button" className={styles.button} aria-label="Underline" aria-pressed={!!activeFormat.underline} disabled={!activeField || saving} onClick={() => changeFormat({ underline: !activeFormat.underline })}><Underline size={16} /></button>
      <label className={styles.field}>Font<input aria-label="Font family" list="editor-fonts" value={activeFormat.fontFamily ?? ''} placeholder="Keep document font" disabled={!activeField || saving} onChange={e => changeFormat({ fontFamily: e.target.value })} /></label>
      <datalist id="editor-fonts">{['Arial', 'Calibri', 'Times New Roman', 'Cambria', 'Aptos'].map(font => <option key={font}>{font}</option>)}</datalist>
      <label className={styles.field}>Size<input aria-label="Font size" type="number" min={1} max={200} value={activeFormat.fontSize ?? ''} placeholder="Keep size" disabled={!activeField || saving} onChange={e => { if (e.target.value) changeFormat({ fontSize: Number(e.target.value) }) }} /></label>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!!document?.imageRepairs?.length && <div className={styles.logoRepair} role="status"><div><strong>A blank floating shape covers a header logo in Word.</strong><p>Restore the full logo and check the updated page preview. Other content and image files are preserved.</p></div>{document.imageRepairs.map(repair=><button key={repair.id} type="button" className={styles.button} aria-pressed={imageRepairs.includes(repair.id)} disabled={saving || refreshing} onClick={()=>void toggleLogoRepair(repair.id)}>{imageRepairs.includes(repair.id)?'Undo logo repair':'Restore full logo'}</button>)}</div>}
    <main className={styles.body} aria-busy={loading || saving}>
      {loading ? <p className={styles.notice} role="status">Opening document…</p> : initialized && <div className={plainText ? '' : styles.documentLayout+(document?.kind==='xlsx'?' '+styles.spreadsheetLayout:'')}>
        <div className={document?.kind === 'docx' ? styles.wordSourceContainer : document?.kind==='xlsx'?styles.sheetContainer:styles.fields}>
          {document?.kind === 'docx' && document.layout ? <><WordSourcePage layout={document.layout} parts={document.wordParts} fields={document.fields} formats={formats} disabled={saving} onChange={changeValue} onFocus={setActiveField}/><p className={styles.notice}>Edit the text and tables above. Pictures and headers are included; the page preview shows the exact Word pagination and floating-object placement.</p>{document.fields.some(field=>field.group!=='Document' && !/^(header|footer)\d+$/.test(field.group)) && <details className={styles.fields}><summary>Footnotes and endnotes</summary>{document.fields.filter(field=>field.group!=='Document' && !/^(header|footer)\d+$/.test(field.group)).map(field=><label className={styles.field} key={field.id}>{field.group} · {field.label}<textarea aria-label={field.group+' '+field.label} value={values[field.id]??''} disabled={saving} onFocus={()=>setActiveField(field.id)} onChange={e=>changeValue(field.id,e.target.value)}/></label>)}</details>}</> : plainText ? <textarea aria-label="Document text" className={styles.textArea} value={text} onChange={event => setText(event.target.value)} disabled={saving} /> : document?.kind === 'xlsx' && document.worksheets ? <SpreadsheetEditor sheets={document.worksheets} fields={document.fields} values={values} disabled={saving || refreshing} onChange={changes=>{setValues(current=>({...current,...changes}));setPreviewStale(true)}}/> : document?.fields.length ? document.fields.map(field => {
            const showGroup = previousGroup !== field.group
            previousGroup = field.group
            const format = { ...field.format, ...formats[field.id] }
            return <div key={field.id}>
              {showGroup && <h3 className={styles.group}>{field.group}</h3>}
              <label className={styles.field}>{field.label}
                <textarea aria-label={field.group + ' ' + field.label} value={values[field.id] ?? ''}
                  style={{ fontWeight: format.bold ? 700 : undefined, fontStyle: format.italic ? 'italic' : undefined, textDecoration: format.underline ? 'underline' : undefined, fontFamily: format.fontFamily }}
                  onFocus={() => setActiveField(field.id)} onChange={event => changeValue(field.id, event.target.value)} disabled={saving} />
              </label>
            </div>
          }) : <p className={styles.notice}>There is no editable text in this document. The original file remains available.</p>}
        </div>
        {!plainText && <aside className={styles.editorPreview}>
          <h3>Document preview</h3>
          <p>{previewStale ? 'Click Update preview to see your latest edits.' : 'Rendered from this document’s page layout.'}</p>
          <DocumentPreview file={previewFile} width={500} height={660} />
        </aside>}
      </div>}
    </main>
  </div>
}
