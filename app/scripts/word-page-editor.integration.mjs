import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { createHash } from 'node:crypto'

const bytes = await fs.readFile('output/word-page-editor-save.docx')
const form = new FormData()
form.append('file', new File([bytes], 'word-page-editor-save.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
const response = await fetch('http://127.0.0.1:3100/api/files/preview', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3100' }, body: form, signal: AbortSignal.timeout(90000) })
assert.equal(response.status, 200, await response.clone().text().then(text => response.ok ? '' : text))
const pdf = Buffer.from(await response.arrayBuffer())
const document = await PDFDocument.load(pdf)
assert.equal(document.getPageCount(), 2)
assert.equal(createHash('sha256').update(await fs.readFile('output/word-page-editor-save.docx')).digest('hex'), createHash('sha256').update(bytes).digest('hex'))
await fs.writeFile('output/word-page-editor-save.pdf', pdf)
await fs.writeFile('output/word-page-editor-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), sourceBytes: bytes.length, nativePreviewPages: document.getPageCount(), dimensions: document.getPages().map(page => page.getSize()), originalUnchanged: true, submittedToPrinter: false }, null, 2))
for (const url of ['/api/admin/orders/bbf48c5a-6800-4e72-9c84-14148ebf6e9b/files/00000000-0000-0000-0000-000000000000', '/api/admin/print']) {
  const denied = await fetch('http://127.0.0.1:3100' + url, { method: url.endsWith('print') ? 'POST' : 'GET', headers: { Origin: 'http://127.0.0.1:3100' } })
  assert.equal(denied.status, 401, 'Anonymous file/print access must fail before any file or printer operation')
}
console.log('Edited DOCX native preview: 2 pages. Anonymous admin download and printing rejected. No physical print submitted.')
