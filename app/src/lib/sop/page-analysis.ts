import 'server-only'
import { createHash } from 'node:crypto'
import { prepareFilePdf } from '@/lib/printing/file-pdf'
import { parsePrintPages } from '@/lib/kiosk/print-options'
import type { AnalyzedPage } from './pricing'
export {filesFingerprint} from './quote-fingerprint'

interface TextBlock { type?: string; bbox?: { x: number; y: number; w: number; h: number }; lines?: { bbox?: { x: number; y: number; w: number; h: number } }[] }
function coverage(blocks: TextBlock[], kind: string, bounds: number[]) {
  const grid = new Set<number>(), columns = 100, rows = 100
  const [x0, y0, x1, y1] = bounds, width = x1 - x0, height = y1 - y0
  for (const block of blocks.filter(block => block.type === kind)) {
    const boxes = kind === 'text' ? block.lines?.map(line => line.bbox) ?? [block.bbox] : [block.bbox]
    for (const box of boxes) {
      if (!box) continue
      const left = Math.max(0, Math.floor((box.x - x0) / width * columns)), right = Math.min(columns, Math.ceil((box.x + box.w - x0) / width * columns))
      const top = Math.max(0, Math.floor((box.y - y0) / height * rows)), bottom = Math.min(rows, Math.ceil((box.y + box.h - y0) / height * rows))
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) grid.add(y * columns + x)
    }
  }
  return grid.size / (columns * rows)
}
export async function analyzePrintFiles(files: File[], options: Record<string, unknown>) {
  const mupdf = await import('mupdf'), pages: AnalyzedPage[] = [], hashes: { name: string; hash: string; pageCount: number }[] = []
  const monochrome = /b&w|black|monochrome|grayscale/i.test(String(options['Print Color'] ?? options['Color Mode'] ?? 'B&W'))
  for (const [fileIndex, file] of files.entries()) {
    const bytes = Buffer.from(await file.arrayBuffer()), hash = createHash('sha256').update(bytes).digest('hex')
    const pdf = await prepareFilePdf(bytes, file.name, file.type, options)
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
    try {
      const count = doc.countPages()
      if (count < 1 || count > 10000) throw new Error('A document must contain between 1 and 10,000 pages.')
      const selected = parsePrintPages(options['Pages to print'] ?? 'All', count) ?? Array.from({ length: count }, (_, i) => i + 1)
      // Bound the work instead of silently billing unanalysed pages.
      if (pages.length + selected.length > 1000) throw new Error('This order exceeds 1,000 selected pages. Split it into smaller print requests.')
      hashes.push({ name: file.name, hash, pageCount: count })
      for (const number of selected) {
        const page = doc.loadPage(number - 1), bounds = page.getBounds()
        const text = page.toStructuredText('preserve-images')
        try {
          const blocks = (JSON.parse(text.asJSON()).blocks ?? []) as TextBlock[]
          const textCoverage = coverage(blocks, 'text', bounds), imageCoverage = coverage(blocks, 'image', bounds)
          let category: AnalyzedPage['category'] = 'bw'
          if (!monochrome) {
            const scale = Math.min(1, 512 / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]))
            const pixels = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false)
            try {
              const rgb = pixels.getPixels(); let chromatic = 0
              for (let p = 0; p < rgb.length; p += 3) {
                const max = Math.max(rgb[p], rgb[p + 1], rgb[p + 2]), min = Math.min(rgb[p], rgb[p + 1], rgb[p + 2])
                if (max - min > 18 && min < 235) chromatic++
              }
              const proportion = chromatic / (pixels.getWidth() * pixels.getHeight())
              if (proportion >= 0.001) category = imageCoverage >= 0.05 || proportion >= 0.2 ? 'images' : 'accents'
            } finally { pixels.destroy() }
          }
          pages.push({ fileIndex, page: number, category, textCoverage, imageCoverage })
        } finally { text.destroy(); page.destroy() }
      }
    } finally { doc.destroy() }
  }
  return { pages, hashes }
}
