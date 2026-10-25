import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import sharp from 'sharp'
import { exportOfficePreview } from '@/lib/editor/office-preview-server'
import { getFileEditorKind } from '@/lib/editor/file-types'
import { PAPER_POINTS, imagePrintDimensions } from './print-plan'
import { readTextDocument } from '../editor/text-document'

async function prepareSourcePdf(bytes: Buffer, name: string, type: string, options: Record<string, unknown>): Promise<Buffer> {
  const kind = getFileEditorKind(name)
  if (kind === 'pdf') { await PDFDocument.load(bytes); return bytes }
  if (kind === 'office') return exportOfficePreview(new File([new Uint8Array(bytes)], name, { type }))
  const pdf = await PDFDocument.create()
  const dimensions = PAPER_POINTS[String(options['Paper Size'] ?? 'A4')] ?? PAPER_POINTS.A4
  if (kind === 'image') {
    const png = await sharp(bytes).rotate().png().toBuffer()
    const image = await pdf.embedPng(png)
    const page = pdf.addPage(dimensions)
    const { width, height } = imagePrintDimensions(image.width, image.height, page.getWidth(), page.getHeight(), options['Photo Size'])
    page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height })
  } else if (kind === 'text') {
    pdf.registerFontkit(fontkit)
    const fontBytes = await fs.readFile(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf')).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return fs.readFile(path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf'))
    })
    const font = await pdf.embedFont(fontBytes, { subset: true })
    const fontSize = 11, lineHeight = 16, margin = 36
    let page = pdf.addPage(dimensions), y = page.getHeight() - margin - fontSize
    const lines: string[] = []
    for (const line of readTextDocument(bytes).text.replace(/\t/g, '    ').split(/\r?\n/)) {
      let wrapped = ''
      for (const character of line) {
        if (font.widthOfTextAtSize(wrapped + character, fontSize) > page.getWidth() - margin * 2 && wrapped) { lines.push(wrapped); wrapped = '' }
        wrapped += character
      }
      lines.push(wrapped)
    }
    for (const line of lines) {
      if (y < margin) { page = pdf.addPage(dimensions); y = page.getHeight() - margin - fontSize }
      page.drawText(line, { x: margin, y, size: fontSize, font }); y -= lineHeight
    }
  } else throw new Error('This format cannot be printed here. Upload a PDF version.')
  return Buffer.from(await pdf.save())
}

/** Add print margins to a derived PDF. Source text, tables, logos and files never reflow. */
export async function prepareFilePdf(bytes: Buffer, name: string, type: string, options: Record<string, unknown>): Promise<Buffer> {
  const marginMm = Number(options['Print margin (mm)'] ?? 0)
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 40) throw new Error('Print margin must be between 0 and 40 mm.')
  const original = await prepareSourcePdf(bytes, name, type, options)
  if (!marginMm) return original
  const input = await PDFDocument.load(original), output = await PDFDocument.create(), margin = marginMm * 72 / 25.4
  for (const source of input.getPages()) {
    const box = source.getCropBox(), rotation = ((source.getRotation().angle % 360) + 360) % 360
    const width = rotation % 180 ? box.height : box.width, height = rotation % 180 ? box.width : box.height
    const requested = PAPER_POINTS[String(options['Paper Size'] ?? 'A4')] ?? PAPER_POINTS.A4
    const sheet = width > height ? [requested[1], requested[0]] : requested
    const page = output.addPage(sheet as [number,number])
    const scale = Math.min((sheet[0] - margin * 2) / width, (sheet[1] - margin * 2) / height)
    if (scale <= 0) throw new Error('The print margin leaves no printable area.')
    const embedded = await output.embedPage(source, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height })
    const x = (sheet[0] - width * scale) / 2, y = (sheet[1] - height * scale) / 2
    page.drawPage(embedded, { x: x + (rotation === 180 ? box.width * scale : rotation === 270 ? box.height * scale : 0),
      y: y + (rotation === 90 ? box.width * scale : rotation === 180 ? box.height * scale : 0),
      width: box.width * scale, height: box.height * scale, rotate: degrees(-rotation) })
  }
  return Buffer.from(await output.save())
}
