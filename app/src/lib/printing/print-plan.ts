import { parsePrintPages, validatePrintOptions } from '@/lib/kiosk/print-options'

export type PrintSide = 'all' | 'front' | 'back'
export const PAPER_POINTS: Record<string, [number, number]> = { A4: [595.28, 841.89], Short: [612, 792], Letter: [612, 792], Long: [612, 936], Legal: [612, 1008] }

// Match the printer's fit setting: keep the page's proportions and center it on
// the chosen sheet. Landscape pages keep their orientation, including mixed PDFs.
export function paperPreviewLayout(sourceWidth: number, sourceHeight: number, paperSize?: string) {
  const paper = paperSize ? PAPER_POINTS[paperSize] : [sourceWidth, sourceHeight]
  if (!paper || sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Choose a supported paper size to preview this page.')
  const [width, height] = sourceWidth > sourceHeight && paperSize ? [paper[1], paper[0]] : paper
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  return { width, height, scale, x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2 }
}

export function buildPrintPlan(options: Record<string, unknown>, pageCount: number, supportsDuplex: boolean | null | undefined,
  side: PrintSide = 'all', manualCopy = 1, reverseBacks = true) {
  const error = validatePrintOptions(options, [pageCount])
  if (error) throw new Error(error)
  const copies = Number(options.Copies ?? 1)
  const pages = parsePrintPages(options['Pages to print'] ?? 'All', pageCount) ?? Array.from({ length: pageCount }, (_, index) => index + 1)
  const twoSided = ['yes', 'true'].includes(String(options['Back to back'] ?? 'No').toLowerCase())
  const manualDuplex = twoSided && supportsDuplex !== true
  if (manualDuplex && side === 'all') throw new Error('This printer needs manual two-sided printing. Print the front sides, reload the sheets, then print the back sides.')
  if (!manualDuplex && side !== 'all') throw new Error('This order does not need the manual two-sided steps.')
  if (manualDuplex && (!Number.isInteger(manualCopy) || manualCopy < 1 || manualCopy > copies)) throw new Error('Choose a valid copy for manual two-sided printing.')
  let selectedPages = manualDuplex ? pages.filter((_, index) => index % 2 === (side === 'front' ? 0 : 1)) : pages
  if (manualDuplex && side === 'back' && reverseBacks) selectedPages = [...selectedPages].reverse()
  if (!selectedPages.length) throw new Error('There are no back pages in this page selection.')
  const paper = String(options['Paper Size'] ?? 'A4')
  const papers: Record<string, number> = { A4: 9, Short: 1, Letter: 1, Long: 14, Legal: 5 }
  if (!papers[paper]) throw new Error('Choose a supported paper size before printing.')
  const color = String(options['Print Color'] ?? options['Color Mode'] ?? 'B&W').toLowerCase()
  const monochrome = /b&w|black|monochrome/.test(color)
  const settings = [selectedPages.join(','), 'fit', 'collate', monochrome ? 'monochrome' : 'color',
    twoSided && !manualDuplex ? 'duplexlong' : 'simplex', 'paper=' + papers[paper], (manualDuplex ? 1 : copies) + 'x'].join(',')
  return { pages: selectedPages, copies: manualDuplex ? 1 : copies, paper, monochrome, twoSided, manualDuplex, manualCopy, side, settings }
}

export function printerPaperKind(paper: string, sizes: { kind: number; width: number; height: number }[]) {
  const points = PAPER_POINTS[paper]
  if (!points) throw new Error('Unsupported paper size.')
  const [width, height] = points.map(value => value / 72 * 100)
  const match = sizes.find(size => Math.abs(Math.min(size.width, size.height) - width) < 3 && Math.abs(Math.max(size.width, size.height) - height) < 3)
  if (!match) throw new Error(`The selected printer driver does not offer ${paper} paper. Add that size in Windows printer preferences or choose a compatible printer.`)
  return match.kind
}

export function imagePrintDimensions(imageWidth: number, imageHeight: number, paperWidth: number, paperHeight: number, photoSize?: unknown) {
  let width = paperWidth - 36, height = paperHeight - 36
  if (photoSize != null && String(photoSize).trim()) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?)?\s*$/i.exec(String(photoSize))
    if (!match) throw new Error('This photo size needs explicit dimensions, such as 2x2 inches. Use a print-ready PDF for other photo layouts.')
    const requestedWidth = Number(match[1]) * 72, requestedHeight = Number(match[2]) * 72
    if (requestedWidth < 18 || requestedHeight < 18 || requestedWidth > width || requestedHeight > height) throw new Error('The requested photo size does not fit the selected paper.')
    width = requestedWidth; height = requestedHeight
  }
  const scale = Math.min(width / imageWidth, height / imageHeight)
  return { width: imageWidth * scale, height: imageHeight * scale }
}
