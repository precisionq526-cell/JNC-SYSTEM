import fs from 'node:fs/promises'
import path from 'node:path'
import * as mupdf from 'mupdf'
import type { PdfLayout, PdfLayoutEdit, PdfLayoutSpan } from './pdf-layout-types'

type Character = { value: string; quad: mupdf.Quad; origin: mupdf.Point }
type SourceSpan = PdfLayoutSpan & { fontObject: mupdf.Font; chars: Character[]; pageIndex: number }
const box = (q: mupdf.Quad): mupdf.Rect => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])]
const colorHex = (c: mupdf.Color) => '#' + (c.length === 1 ? [c[0], c[0], c[0]] : c.slice(0, 3)).map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')
function open(bytes: Uint8Array) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()
  if (!document || document.needsPassword()) { document?.destroy(); throw new Error('Upload an unlocked PDF to edit it.') }
  if (!document.hasPermission('edit')) { document.destroy(); throw new Error('This PDF does not permit editing. Upload an editable original.') }
  if (document.countPages() > 100) { document.destroy(); throw new Error('Edit PDFs with up to 100 pages here.') }
  return document
}

function readPage(document: mupdf.PDFDocument, pageIndex: number) {
  const page = document.loadPage(pageIndex), bounds = page.getBounds()
  const spans: SourceSpan[] = [], verticals: { x: number; top: number; bottom: number }[] = []
  const device = new mupdf.Device({ strokePath(p, _stroke, matrix) {
    let previous: mupdf.Point | null = null
    const transform = (x: number, y: number): mupdf.Point => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
    p.walk({ moveTo(x, y) { previous = transform(x, y) }, lineTo(x, y) { const next = transform(x, y); if (previous && Math.abs(previous[0] - next[0]) < .5 && Math.abs(previous[1] - next[1]) > 5) verticals.push({ x: next[0], top: Math.min(previous[1], next[1]), bottom: Math.max(previous[1], next[1]) }); previous = next }, curveTo() { previous = null }, closePath() { previous = null } })
  } })
  try { page.runPageContents(device, mupdf.Matrix.identity) } finally { device.close(); device.destroy() }
  const text = page.toStructuredText('preserve-whitespace')
  let current: SourceSpan | null = null, horizontal = true
  try {
    text.walk({
      beginLine(_bbox, wmode, direction) { current = null; horizontal = wmode === 0 && Math.abs(direction[0] - 1) < .001 && Math.abs(direction[1]) < .001 },
      onChar(c, origin, font, size, quad, color) {
        const rect = box(quad), name = font.getName(), colorValue = colorHex(color)
        const last = current?.chars.at(-1)
        const same = current && current.font === name && Math.abs(current.size - size) < .01 && current.color === colorValue && last && rect[0] - box(last.quad)[2] < size * .65 && Math.abs(origin[1] - last.origin[1]) < size * .15
        if (!same) {
          current = { id: `${pageIndex}:${spans.length}`, pageIndex, text: '', x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1], baseline: origin[1], font: name, fontObject: font, size, bold: font.isBold(), italic: font.isItalic(), color: colorValue, maxWidth: rect[2] - rect[0], editable: horizontal, chars: [] }
          spans.push(current)
        }
        current!.text += c; current!.chars.push({ value: c, quad, origin })
        current!.width = Math.max(current!.width, rect[2] - current!.x)
        current!.height = Math.max(current!.height, rect[3] - current!.y)
        if (same) font.destroy()
      }, endLine() { current = null },
    })
  } finally { text.destroy() }
  for (const span of spans) {
    const nextText = spans.filter(other => other !== span && other.x >= span.x + span.width - .5 && Math.abs(other.baseline - span.baseline) < span.size * .5).map(other => other.x - 1)
    const borders = verticals.filter(line => line.x >= span.x + span.width - .5 && line.top <= span.baseline && line.bottom >= span.baseline).map(line => line.x - 2)
    span.maxWidth = Math.max(span.width, Math.min(bounds[2] - 8, ...nextText, ...borders) - span.x)
  }
  return { page, spans, width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }
}

export function inspectPdfLayout(bytes: Uint8Array): PdfLayout {
  const document = open(bytes)
  try {
    const pages: PdfLayout['pages'] = []; let count = 0
    for (let index = 0; index < document.countPages(); index++) {
      const source = readPage(document, index)
      try {
        count += source.spans.reduce((sum, span) => sum + span.text.length, 0)
        if (count > 300000) throw new Error('This PDF contains too much text for the page editor.')
        pages.push({ width: source.width, height: source.height, spans: source.spans.filter(span => span.text.trim()).map(span => ({ id:span.id,text:span.text,x:span.x,y:span.y,width:span.width,height:span.height,baseline:span.baseline,font:span.font,size:span.size,bold:span.bold,italic:span.italic,color:span.color,maxWidth:span.maxWidth,editable:span.editable })) })
      } finally { for (const span of source.spans) span.fontObject.destroy(); source.page.destroy() }
    }
    return { pages }
  } finally { document.destroy() }
}

async function replacementFont(span: SourceSpan, edit: PdfLayoutEdit) {
  const bold = edit.bold ?? span.bold, italic = edit.italic ?? span.italic
  const name = span.font.replace(/^[A-Z]{6}\+/, '').replace(/[^a-z]/gi, '').toLowerCase()
  const families: [RegExp, string, string[]][] = [
    [/arialnarrow/, 'Arial Narrow', ['ARIALN.TTF', 'ARIALNB.TTF', 'ARIALNI.TTF', 'ARIALNBI.TTF']],
    [/arial|helvetica/, 'Arial', ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf']],
    [/times/, 'Times New Roman', ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf']],
    [/calibri/, 'Calibri', ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf']],
    [/courier|cour/, 'Courier New', ['cour.ttf', 'courbd.ttf', 'couri.ttf', 'courbi.ttf']],
  ]
  const family = families.find(([pattern]) => pattern.test(name))
  if (family) {
    try { return { font: new mupdf.Font(family[1], new Uint8Array(await fs.readFile(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', family[2][(bold ? 1 : 0) + (italic ? 2 : 0)])))), owned: true } } catch { /* Embedded font is used only if it supports every replacement glyph. */ }
  }
  if (bold !== span.bold || italic !== span.italic) throw new Error('This embedded font has no matching style available. Keep its original style or edit the source document.')
  return { font: span.fontObject, owned: false }
}

/** Change only selected text. No conversion, page reflow, image rasterization, or table reconstruction. */
export async function savePdfLayoutEdits(bytes: Uint8Array, edits: PdfLayoutEdit[]): Promise<Uint8Array> {
  if (!Array.isArray(edits) || edits.length > 1000) throw new Error('Too many PDF edits. Save up to 1,000 changes at a time.')
  if (!edits.length) return bytes.slice()
  const document = open(bytes)
  try {
    const grouped = new Map<number, PdfLayoutEdit[]>(), seen = new Set<string>()
    for (const edit of edits) {
      if (!edit || typeof edit.id !== 'string' || !/^\d+:\d+$/.test(edit.id) || seen.has(edit.id) || typeof edit.text !== 'string' || edit.text.length > 10000 || /[\r\n\u0000-\u0008\u000b-\u001f]/.test(edit.text)) throw new Error('Invalid PDF text edit. Keep each edit within its original text line.')
      const index = Number(edit.id.split(':')[0]); seen.add(edit.id)
      if (index >= document.countPages()) throw new Error('PDF page not found.')
      grouped.set(index, [...(grouped.get(index) ?? []), edit])
    }
    for (const [index, changes] of grouped) {
      const { page, spans } = readPage(document, index)
      const ownedFonts: mupdf.Font[] = []
      try {
        if (page.getAnnotations().some(annotation => annotation.getType() === 'Redact')) throw new Error('This page has pending redactions. Apply them in the original PDF application before editing here.')
        if (page.getWidgets().some(widget => widget.getFieldType() === 'signature')) throw new Error('Signed PDF pages must be edited in the original signing application.')
        const planned = []
        for (const edit of changes) {
          const span = spans.find(span => span.id === edit.id)
          if (!span?.editable) throw new Error('This text direction is not supported for safe editing. Use the source document.')
          const size = edit.size ?? span.size, color = edit.color ?? span.color
          if (!Number.isFinite(size) || size < 4 || size > Math.max(span.size, span.height) || !/^#[0-9a-f]{6}$/i.test(color) || edit.bold !== undefined && typeof edit.bold !== 'boolean' || edit.italic !== undefined && typeof edit.italic !== 'boolean') throw new Error('Keep the font size within the original line height and choose a valid color.')
          if (edit.text === span.text && size === span.size && (edit.bold ?? span.bold) === span.bold && (edit.italic ?? span.italic) === span.italic && color === span.color) continue
          const { font, owned } = await replacementFont(span, edit); if (owned) ownedFonts.push(font)
          let width = 0, encoded = ''
          const unicode = new Map<number, string>()
          for (const c of edit.text) {
            const gid = font.encodeCharacter(c)
            if (!gid) throw new Error(`The original font cannot display “${c}”. Use the original Word file to change its font.`)
            width += font.advanceGlyph(gid) * size; encoded += gid.toString(16).padStart(4, '0')
            unicode.set(gid, Array.from({ length:c.length }, (_, i) => c.charCodeAt(i).toString(16).padStart(4,'0')).join(''))
          }
          if (width > span.maxWidth + .5) throw new Error('The edited text does not fit this cell or line. Shorten it or reduce the font size; the table will not be stretched.')
          planned.push({ span, font, size, color, encoded, unicode })
        }
        if (!planned.length) continue
        // Tiny rectangles inside each glyph avoid touching adjacent rows. Do not paint a white box:
        // existing cell fills, vector rules and images remain intact.
        for (const { span } of planned) for (const char of span.chars) {
          const r = box(char.quad), inset = Math.min(.2, (r[2] - r[0]) / 4, (r[3] - r[1]) / 4)
          if (r[2] <= r[0] || r[3] <= r[1]) continue
          const annotation = page.createAnnotation('Redact'); annotation.setRect([r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset]); annotation.getObject().delete('IC'); annotation.update()
        }
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
        const object = page.getObject(), resources = document.newDictionary(), fonts = document.newDictionary()
        object.getInheritable('Resources').forEach((value, key) => resources.put(key, value))
        resources.get('Font').forEach((value, key) => fonts.put(key, value)); resources.put('Font', fonts); object.put('Resources', resources)
        const operations = ['q']
        planned.forEach(({ span, font, size, color, encoded, unicode }, i) => {
          let name = `LayoutEdit${i}`; while (!fonts.get(name).isNull()) name += '_'
          // A glyph can represent both space and NBSP. Keep the actual typed Unicode
          // rather than allowing the font's default cmap to change copy/search text.
          const resource = document.newDictionary()
          document.addFont(font).forEach((value, key) => resource.put(key, value))
          const mappings = [...unicode].map(([gid, value]) => `<${gid.toString(16).padStart(4,'0')}> <${value}>`)
          const chunks = []
          for (let start=0;start<mappings.length;start+=100) { const group=mappings.slice(start,start+100); chunks.push(`${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`) }
          resource.put('ToUnicode', document.addStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /EditedUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`, {}))
          fonts.put(name, document.addObject(resource))
          const origin = span.chars[0].origin
          const matrix = mupdf.Matrix.concat([size, 0, 0, -size, origin[0], origin[1]], mupdf.Matrix.invert(page.getTransform()))
          const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255)
          operations.push(`BT /${name} 1 Tf ${rgb.join(' ')} rg ${matrix.join(' ')} Tm <${encoded}> Tj ET`)
        })
        operations.push('Q')
        const contents = object.get('Contents'), updated = document.newArray()
        if (contents.isArray()) contents.forEach(value => updated.push(value)); else if (!contents.isNull()) updated.push(contents)
        updated.push(document.addStream(operations.join('\n'), {})); object.put('Contents', updated)
      } finally { for (const font of ownedFonts) font.destroy(); for (const span of spans) span.fontObject.destroy(); page.destroy() }
    }
    const output = document.saveToBuffer('garbage=3,compress')
    try { return output.asUint8Array().slice() } finally { output.destroy() }
  } finally { document.destroy() }
}
