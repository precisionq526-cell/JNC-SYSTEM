'use client'

import { useEffect, useRef } from 'react'
import { FileText, X } from 'lucide-react'
import { DocumentPreview } from '@/components/preview/document-preview'

export function ExpandedPreview({ file, grayscale, paperSize, photoSize, onClose,printMargin=0 }: { file: File; grayscale: boolean; paperSize?: string; photoSize?: string; printMargin?:number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement as HTMLElement | null
    element?.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { element?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [])
  return <dialog ref={dialog} className="expanded-preview" aria-labelledby="expanded-preview-title" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="expanded-preview-header"><div><FileText size={19} /><h2 id="expanded-preview-title">{file.name}</h2></div><button type="button" className="button button-outline" onClick={onClose} autoFocus><X size={17} /> Close preview</button></div>
    <div className="expanded-preview-body"><DocumentPreview file={file} grayscale={grayscale} paperSize={paperSize} photoSize={photoSize} printMargin={printMargin} width={1000} height={1200} /></div>
  </dialog>
}
