/** Keep the source encoding, EXIF and profile when editing leaves the decoded pixels unchanged. */
export async function unchangedImage(original: File, edited: HTMLCanvasElement): Promise<boolean> {
  const bitmap = await createImageBitmap(original)
  try {
    if (bitmap.width !== edited.width || bitmap.height !== edited.height || bitmap.width * bitmap.height > 16_000_000) return false
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d'), editedContext = edited.getContext('2d')
    if (!context || !editedContext) return false
    context.drawImage(bitmap, 0, 0)
    // Compare strips to keep temporary memory bounded for full-resolution photos.
    for (let y = 0; y < bitmap.height; y += 128) {
      const height = Math.min(128, bitmap.height - y)
      const a = context.getImageData(0, y, bitmap.width, height).data, b = editedContext.getImageData(0, y, bitmap.width, height).data
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    }
    return true
  } finally { bitmap.close() }
}
