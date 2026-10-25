const previews = new WeakMap<File, Map<string, Promise<ArrayBuffer>>>()

export function getDocumentPreviewBytes(file: File, options?: { paperSize?: string; photoSize?: string; printMargin?: number }): Promise<ArrayBuffer> {
  if (file.name.toLowerCase().endsWith('.pdf') && !options?.printMargin) return file.arrayBuffer()
  // Office documents retain their original layout. Images and plain text are
  // laid out by the same renderer used for printing, for each selected sheet.
  const needsPaper = !!options?.printMargin || /\.(?:jpe?g|png|webp|txt|csv)$/i.test(file.name)
  const paperSize = needsPaper ? options?.paperSize ?? 'A4' : undefined
  const photoSize = needsPaper ? options?.photoSize : undefined
  const key = JSON.stringify([paperSize, photoSize, options?.printMargin ?? 0])
  const variants = previews.get(file) ?? new Map<string, Promise<ArrayBuffer>>()
  previews.set(file, variants)
  const cached = variants.get(key)
  if (cached) return cached.then(bytes => bytes.slice(0))
  const promise = (async () => {
    const form = new FormData()
    form.append('file', file)
    if (paperSize) form.append('paperSize', paperSize)
    if (photoSize) form.append('photoSize', photoSize)
    if (options?.printMargin) form.append('printMargin',String(options.printMargin))
    const response = await fetch('/api/files/preview', { method: 'POST', body: form })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error ?? 'The document preview is unavailable. Please try a PDF version.')
    }
    return response.arrayBuffer()
  })()
  variants.set(key, promise)
  void promise.catch(() => variants.delete(key))
  return promise.then(bytes => bytes.slice(0))
}
