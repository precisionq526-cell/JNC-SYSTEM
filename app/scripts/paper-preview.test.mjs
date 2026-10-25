import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import path from 'node:path'
import * as mupdf from 'mupdf'

const require = createRequire(import.meta.url)
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const optionsUrl = url(transpile('src/lib/kiosk/print-options.ts'))
const planUrl = url(transpile('src/lib/printing/print-plan.ts').replace("'@/lib/kiosk/print-options'", JSON.stringify(optionsUrl)))
const filesUrl = url(transpile('src/lib/editor/file-types.ts'))
const officeUrl = url('export function exportOfficePreview() { throw new Error("Office is not used in these image/text tests.") }')
let renderer = transpile('src/lib/printing/file-pdf.ts').replace("import 'server-only';", '')
for (const dependency of ['pdf-lib', '@pdf-lib/fontkit', 'sharp']) renderer = renderer.replace(`'${dependency}'`, JSON.stringify(pathToFileURL(require.resolve(dependency)).href))
renderer = renderer.replace("'./print-plan'", JSON.stringify(planUrl)).replace("'@/lib/editor/file-types'", JSON.stringify(filesUrl)).replace("'@/lib/editor/office-preview-server'", JSON.stringify(officeUrl))
renderer = renderer.replace("'../editor/text-document'", JSON.stringify(url(transpile('src/lib/editor/text-document.ts'))))
const { prepareFilePdf } = await import(url(renderer))
const sizes = { A4: [595.28, 841.89], Short: [612, 792], Long: [612, 936], Legal: [612, 1008] }

test('image preview PDFs use the same selected paper and photo layout as printing', async () => {
  const bytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#b9212d' } }).png().toBuffer()
  for (const [paper, dimensions] of Object.entries(sizes)) {
    const preview = await PDFDocument.load(await prepareFilePdf(bytes, 'photo.png', 'image/png', { 'Paper Size': paper }))
    assert.equal(preview.getPageCount(), 1)
    assert.deepEqual([preview.getPage(0).getWidth(), preview.getPage(0).getHeight()], dimensions)
  }
  await assert.rejects(prepareFilePdf(bytes, 'photo.png', 'image/png', { 'Paper Size': 'Short', 'Photo Size': '9x13' }), /does not fit/)
})

test('plain text preview reflows and counts pages using the selected print sheet', async () => {
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, index) => `Line ${index + 1}: Print preview and printer use the same layout.`).join('\n'))
  const counts = {}
  for (const [paper, dimensions] of Object.entries(sizes)) {
    const preview = await PDFDocument.load(await prepareFilePdf(bytes, 'notes.txt', 'text/plain', { 'Paper Size': paper }))
    counts[paper] = preview.getPageCount()
    for (const page of preview.getPages()) assert.deepEqual([page.getWidth(), page.getHeight()], dimensions)
  }
  assert.ok(counts.Long < counts.Short)
})

test('fitting a preview does not alter the customer PDF or its page count', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 600]); pdf.addPage([800, 600])
  const bytes = Buffer.from(await pdf.save())
  const preview = await prepareFilePdf(bytes, 'original.pdf', 'application/pdf', { 'Paper Size': 'Legal' })
  assert.deepEqual(preview, bytes)
  const original = await PDFDocument.load(preview)
  assert.equal(original.getPageCount(), 2)
  assert.deepEqual(original.getPages().map(page => [page.getWidth(), page.getHeight()]), [[400, 600], [800, 600]])
})

test('plain text preview retains Unicode when the Windows font is unavailable', async () => {
  const prior = process.env.WINDIR
  process.env.WINDIR = path.resolve('../tmp/absent-windows-font-directory')
  try {
    const text = 'Bundled font: café, niño, résumé — ready to print.'
    const bytes = await prepareFilePdf(Buffer.from(text), 'unicode.txt', 'text/plain', { 'Paper Size': 'A4' })
    const pdf = mupdf.Document.openDocument(bytes, 'application/pdf'), page = pdf.loadPage(0), extracted = page.toStructuredText('')
    try { assert.match(extracted.asText(), /café, niño, résumé — ready to print/); assert.equal(pdf.countPages(), 1) }
    finally { extracted.destroy(); page.destroy(); pdf.destroy() }
  } finally {
    if (prior === undefined) delete process.env.WINDIR
    else process.env.WINDIR = prior
  }
})
