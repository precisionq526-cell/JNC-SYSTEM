export type FileEditorKind = 'image' | 'pdf' | 'office' | 'text'
export const EDITABLE_UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.jpeg', '.jpg', '.png', '.webp', '.txt', '.csv']
export const OFFICE_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const

export function getFileEditorKind(name: string): FileEditorKind | null {
  const extension = name.toLowerCase().split('.').pop()
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (['docx', 'xlsx', 'pptx'].includes(extension || '')) return 'office'
  if (['txt', 'csv'].includes(extension || '')) return 'text'
  return null
}

export function createEditedUpload(original: File, blob: Blob): File {
  if (!blob.size) throw new Error('The editor produced an empty file. Your original file has been kept.')
  const mime = blob.type.split(';')[0].toLowerCase()
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
    [OFFICE_MIME.docx]: 'docx', [OFFICE_MIME.xlsx]: 'xlsx', [OFFICE_MIME.pptx]: 'pptx',
  }
  const extension = extensions[mime]
  if (!extension) throw new Error('The edited file format is not supported.')
  const oldExtension = original.name.toLowerCase().split('.').pop()
  const sameExtension = oldExtension === extension || (extension === 'jpg' && oldExtension === 'jpeg')
  const name = sameExtension ? original.name : original.name.replace(/\.[^/.]+$/, '') + '.' + extension
  return new File([blob], name, { type: mime, lastModified: Date.now() })
}

