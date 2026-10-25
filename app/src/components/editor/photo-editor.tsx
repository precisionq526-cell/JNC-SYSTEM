'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { Save, X } from 'lucide-react'
import type FilerobotImageEditor from 'filerobot-image-editor'
import styles from './editor-shell.module.css'
import { getEditedImageSize } from '@/lib/editor/image-edits'
import { unchangedImage } from '@/lib/editor/image-original'

interface PhotoEditorProps {
  file: File | { name: string; url: string }
  onSave: (blob: Blob) => Promise<void>
  onCancel: () => void
}

export function PhotoEditor({ file, onSave, onCancel }: PhotoEditorProps) {
  const [ready, setReady] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<FilerobotImageEditor | null>(null)
  const originalSize = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const Constructor = (window as unknown as { FilerobotImageEditor?: typeof FilerobotImageEditor }).FilerobotImageEditor
    if (!ready || !Constructor || !container.current) return
    let cancelled = false
    originalSize.current = null
    setCanvasReady(false)
    // The script loads before its image and canvas are usable. Keep our Save
    // control in sync with the editor's visible loader and decoded source.
    const syncReady = () => {
      if (cancelled) return
      const area = container.current
      const surface = area?.querySelector('canvas')
      setCanvasReady(!!originalSize.current && !!surface?.width && !area?.querySelector('.FIE_spinner-wrapper'))
    }
    const observer = new MutationObserver(syncReady)
    observer.observe(container.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] })
    const source = file instanceof File ? URL.createObjectURL(file) : file.url
    if (file instanceof File) {
      void createImageBitmap(file).then(bitmap => {
        if (!cancelled) { originalSize.current = { width: bitmap.width, height: bitmap.height }; syncReady() }
        bitmap.close()
      }).catch(() => { if (!cancelled) setError('The original image could not be decoded. Close the editor and try another image.') })
    } else {
      const originalImage = new window.Image()
      originalImage.onload = () => { if (!cancelled) { originalSize.current = { width: originalImage.naturalWidth, height: originalImage.naturalHeight }; syncReady() } }
      originalImage.onerror = () => { if (!cancelled) setError('The original image could not be loaded. Close the editor and try another image.') }
      originalImage.src = source
    }
    const instance = new Constructor(container.current, {
      source, tabsIds: ['Adjust', 'Annotate', 'Filters', 'Finetune', 'Resize'],
      // Opening the crop tool creates a crop box before the canvas settles,
      // which can silently trim a photo even when the customer makes no edits.
      defaultTabId: 'Adjust', defaultToolId: 'Rotate', removeSaveButton: true,
      Rotate: { angle: 90, componentType: 'buttons' },
      useBackendTranslations: false,
      savingPixelRatio: 1, previewPixelRatio: 1,
      defaultSavedImageType: 'png',
      theme: { typography: { fontFamily: 'Arial, sans-serif' } },
    })
    editor.current = instance
    instance.render()
    return () => { cancelled = true; observer.disconnect(); instance.terminate(); editor.current = null; if (file instanceof File) URL.revokeObjectURL(source) }
  }, [ready, file])

  const save = async () => {
    setSaving(true)
    setError(null)
    let hideSpinner: (() => void) | undefined
    try {
      if (!editor.current) throw new Error('The image editor is still loading.')
      if (!originalSize.current) throw new Error('The original image is still loading. Please try again.')
      const info = { extension: 'png', name: file.name.replace(/\.[^/.]+$/, '') }
      let result = editor.current.getCurrentImgData(info, 1)
      if (!result.designState || !result.imageData) throw new Error('The photo is still loading. Please wait a moment and try again.')
      const size = getEditedImageSize(originalSize.current.width, originalSize.current.height, result.designState)
      if (result.imageData.imageCanvas?.width !== size.width || result.imageData.imageCanvas?.height !== size.height) {
        result = editor.current.getCurrentImgData({ ...info, size }, 1)
      }
      hideSpinner = result.hideLoadingSpinner
      const canvas = result.imageData.imageCanvas
      let blob: Blob
      if (canvas) {
        blob = file instanceof File && await unchangedImage(file, canvas) ? file
          : await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not export the edited image.')), 'image/png'))
      } else if (result.imageData.imageBase64) {
        blob = await (await fetch(result.imageData.imageBase64)).blob()
      } else throw new Error('The image is not ready to save yet.')
      await onSave(blob)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save photo edits.') }
    finally { hideSpinner?.(); setSaving(false) }
  }

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="Photo editor">
      <Script src="/scripts/filerobot-image-editor.min.js" onReady={() => setReady(true)} onError={() => setError('The photo editor could not load. Close it and try again.')} />
      <header className={styles.header}>
        <div><h2>{file.name}</h2><p>Crop, rotate, adjust colors, and add text. Save the edited photo to your order.</p></div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onCancel} disabled={saving}><X size={16} />Cancel</button>
          <button type="button" className={styles.button + ' ' + styles.primary} onClick={() => void save()} disabled={!canvasReady || saving}><Save size={16} />{saving ? 'Saving…' : 'Save edits'}</button>
        </div>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.photoBody} aria-busy={!canvasReady || saving}>
        {!ready && !error && <p className={styles.notice} role="status">Opening photo editor…</p>}
        <div ref={container} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}
