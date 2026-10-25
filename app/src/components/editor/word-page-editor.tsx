'use client'

import { DocumentEditor } from './document-editor'
import { PdfEditor } from './pdf-editor'

// Keep earlier imports compatible while routing every upload through the source-preserving editors.
export function WordPageEditor({ file, sourcePdf, onSave, onCancel }: { file: File; sourcePdf?: File; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  return sourcePdf ? <PdfEditor file={sourcePdf} onSave={onSave} onCancel={onCancel} /> : <DocumentEditor file={file} onSave={onSave} onCancel={onCancel} />
}
