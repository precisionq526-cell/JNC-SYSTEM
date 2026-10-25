import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

export interface PdfTextEdit {
  id: string
  pageIndex: number
  text: string
  x: number
  y: number
  size: number
  color: string
}

export async function savePdfTextEdits(original: ArrayBuffer, edits: PdfTextEdit[]): Promise<Blob> {
  const document = await PDFDocument.load(original)
  const font = await document.embedFont(StandardFonts.Helvetica)
  const pages = document.getPages()
  for (const edit of edits) {
    const page = pages[edit.pageIndex]
    if (!page || !Number.isFinite(edit.x) || !Number.isFinite(edit.y) || !Number.isFinite(edit.size) || edit.size < 6 || edit.size > 72) throw new Error('Invalid PDF text placement.')
    try { font.encodeText(edit.text) } catch { throw new Error('Some characters in the added text are unsupported by this PDF font. Use plain text and try again.') }
    if (!/^#[0-9a-f]{6}$/i.test(edit.color)) throw new Error('Invalid text color.')
    const color = edit.color.slice(1)
    page.drawText(edit.text, {
      x: edit.x, y: edit.y, size: edit.size, font,
      color: rgb(parseInt(color.slice(0, 2), 16) / 255, parseInt(color.slice(2, 4), 16) / 255, parseInt(color.slice(4, 6), 16) / 255),
      rotate: degrees(page.getRotation().angle),
    })
  }
  const bytes = await document.save()
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' })
}
