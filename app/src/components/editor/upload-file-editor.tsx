'use client'

import { useEffect } from 'react'
import { getFileEditorKind } from '@/lib/editor/file-types'
import { PhotoEditor } from './photo-editor'
import { DocumentEditor } from './document-editor'
import { PdfEditor } from './pdf-editor'

export default function UploadFileEditor({ file, onSave, onCancel }: { file: File; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  const kind = getFileEditorKind(file.name)
  if (kind === 'image') return <PhotoEditor file={file} onSave={onSave} onCancel={onCancel} />
  if (kind === 'pdf') return <PdfEditor file={file} onSave={onSave} onCancel={onCancel} />
  if (kind === 'office' || kind === 'text') return <DocumentEditor file={file} onSave={onSave} onCancel={onCancel} />
  return null
}
