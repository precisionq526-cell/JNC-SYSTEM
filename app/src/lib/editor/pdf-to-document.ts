import JSZip from 'jszip'
import { OFFICE_MIME } from './file-types'

export interface EditablePdfRun { text: string; size: number; font: string; bold: boolean; italic: boolean }
export interface EditablePdfLine { x: number; top: number; width: number; height: number; runs: EditablePdfRun[] }
export interface EditablePdfPage { width: number; height: number; lines: EditablePdfLine[]; background?: Uint8Array }
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const twips = (points: number) => Math.max(0, Math.round(points * 20))

function paragraphs(page: EditablePdfPage, left: number, bodyWidth: number) {
  const blocks: { x: number; top: number; bottom: number; height: number; runs: EditablePdfRun[] }[] = []
  let previous: EditablePdfLine | null = null
  for (const line of page.lines) {
    const block = blocks.at(-1)
    const sameStyle = previous && line.runs[0] && previous.runs[0] && Math.abs(line.runs[0].size - previous.runs[0].size) < 1 && line.runs[0].bold === previous.runs[0].bold
    const wraps = block && previous && sameStyle && Math.abs(line.x - previous.x) < 12 && previous.width > bodyWidth * .65 && line.top - previous.top < previous.height * 2 && line.top > previous.top
    if (wraps) {
      block.runs.push({ ...line.runs[0], text: ' ' }, ...line.runs)
      block.bottom = line.top + line.height
    } else blocks.push({ x: Math.max(0, line.x - left), top: line.top, bottom: line.top + line.height, height: line.height, runs: [...line.runs] })
    previous = line
  }
  return blocks
}

/** Build an actual paginated Word document; existing text becomes editable text. */
export async function buildEditablePdfDocument(pages: EditablePdfPage[]): Promise<Blob> {
  if (!pages.length || !pages.some(page => page.lines.some(line => line.runs.some(run => run.text.trim())))) throw new Error('This PDF has no editable text. Upload the original Word document or a PDF with recognized text.')
  const zip = new JSZip()
  const body: string[] = []
  const relationships = [`<Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>`]
  const overrides = [`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`, `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`]
  pages.forEach((page, index) => {
    const left = Math.max(18, Math.min(page.width * .3, ...page.lines.map(line => line.x)))
    const top = Math.max(18, Math.min(page.height * .3, ...page.lines.map(line => line.top)))
    const right = Math.max(18, Math.min(page.width * .3, page.width - Math.max(0, ...page.lines.map(line => line.x + line.width))))
    const section = `<w:headerReference w:type="default" r:id="header${index}"/><w:type w:val="nextPage"/><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"/><w:pgMar w:top="${twips(top)}" w:right="${twips(right)}" w:bottom="360" w:left="${twips(left)}" w:header="0" w:footer="0"/>`
    const blocks = paragraphs(page, left, page.width - left - right)
    if (!blocks.length) blocks.push({ x: 0, top, bottom: top, height: 12, runs: [] })
    let bottom = top
    blocks.forEach((block, blockIndex) => {
      const first = block.runs[0]
      const lineHeight = Math.max(8, first?.size ?? block.height) * 1.15
      const before = Math.max(0, block.top - bottom)
      const sectionBreak = index < pages.length - 1 && blockIndex === blocks.length - 1 ? `<w:sectPr>${section}</w:sectPr>` : ''
      const runs = block.runs.map(run => `<w:r><w:rPr><w:rFonts w:ascii="${xml(run.font)}" w:hAnsi="${xml(run.font)}" w:cs="${xml(run.font)}"/><w:sz w:val="${Math.round(run.size * 2)}"/>${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`).join('')
      body.push(`<w:p><w:pPr><w:spacing w:before="${twips(before)}" w:after="0" w:line="${twips(lineHeight)}" w:lineRule="atLeast"/><w:ind w:left="${twips(block.x)}"/>${sectionBreak}</w:pPr>${runs}</w:p>`)
      bottom = block.bottom
    })
    if (index === pages.length - 1) body.push(`<w:sectPr>${section}</w:sectPr>`)
    relationships.push(`<Relationship Id="header${index}" Type="${R}/header" Target="header${index}.xml"/>`)
    overrides.push(`<Override PartName="/word/header${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`)
    let drawing = ''
    if (page.background) {
      zip.file(`word/media/page${index}.png`, page.background)
      zip.file(`word/_rels/header${index}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="background" Type="${R}/image" Target="media/page${index}.png"/></Relationships>`)
      const cx = Math.round(page.width * 12700), cy = Math.round(page.height * 12700)
      drawing = `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/><wp:docPr id="${index + 1}" name="Original page graphics"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="page.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="background"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
    }
    zip.file(`word/header${index}.xml`, `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${drawing}</w:p></w:hdr>`)
  })
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join('')}</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}</w:body></w:document>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}">${relationships.join('')}</Relationships>`)
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`)
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return new Blob([bytes], { type: OFFICE_MIME.docx })
}

export async function convertPdfToDocument(file: File): Promise<File> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/scripts/pdfjs/pdf.worker.min.mjs'
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), cMapUrl: '/scripts/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/scripts/pdfjs/standard_fonts/', wasmUrl: '/scripts/pdfjs/wasm/', iccUrl: '/scripts/pdfjs/iccs/' })
  try {
    const pdf = await task.promise
    const pages: EditablePdfPage[] = []
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const operations = await page.getOperatorList()
      const items = content.items.flatMap(item => {
        if (!('str' in item) || !item.str.trim()) return []
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const size = Math.max(6, Math.min(100, Math.hypot(transform[2], transform[3])))
        const style = content.styles[item.fontName]
        let name = style?.fontFamily ?? ''
        try { const font: unknown = page.commonObjs.get(item.fontName); if (font && typeof font === 'object' && 'name' in font && typeof font.name === 'string') name = font.name } catch { /* Use the PDF font family. */ }
        const family = /courier|mono/i.test(name) ? 'Courier New' : /times|(^|[^-])serif/i.test(name) && !/sans/i.test(name) ? 'Times New Roman' : 'Arial'
        const run = { text: item.str, size, font: family, bold: /bold|black|heavy/i.test(name), italic: /italic|oblique/i.test(name) }
        return [{ x: transform[4], top: transform[5] - size * (style?.ascent ?? .8), width: Math.max(0, item.width), height: size, runs: [run] }]
      }).sort((a, b) => Math.abs(a.top - b.top) < Math.min(a.height, b.height) * .3 ? a.x - b.x : a.top - b.top)
      const lines: EditablePdfLine[] = []
      for (const item of items) {
        const last = lines.at(-1)
        if (last && Math.abs(last.top - item.top) < Math.min(last.height, item.height) * .35 && item.x >= last.x) {
          if (item.x - last.x - last.width > item.height * .15) last.runs.push({ ...item.runs[0], text: ' ' })
          last.runs.push(...item.runs); last.width = item.x + item.width - last.x; last.height = Math.max(last.height, item.height)
        } else lines.push(item)
      }
      let background: Uint8Array | undefined
      const drawingOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.constructPath, pdfjs.OPS.shadingFill])
      if (operations.fnArray.some(operation => drawingOps.has(operation))) {
        const scale = Math.min(1.5, Math.sqrt(16000000 / (viewport.width * viewport.height)))
        const graphicsViewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(graphicsViewport.width); canvas.height = Math.ceil(graphicsViewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('The page graphics could not be prepared. Please try again.')
        const textOps = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText])
        await page.render({ canvas, canvasContext: context, viewport: graphicsViewport, operationsFilter: operation => !textOps.has(operations.fnArray[operation]) }).promise
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The page graphics could not be prepared.')), 'image/png'))
        background = new Uint8Array(await png.arrayBuffer()); canvas.width = 0; canvas.height = 0
      }
      pages.push({ width: viewport.width, height: viewport.height, lines, background })
      page.cleanup()
    }
    const editedDocument = await buildEditablePdfDocument(pages)
    return new File([editedDocument], file.name.replace(/\.pdf$/i, '.docx'), { type: OFFICE_MIME.docx })
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password protected. Upload an unlocked PDF or the original Word document.')
    throw error
  } finally { await task.destroy() }
}
