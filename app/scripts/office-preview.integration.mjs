import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'

const base = 'http://127.0.0.1:3100'
const results = []
for (const [extension, expectedPages] of [['docx', 2], ['xlsx', 1], ['pptx', 1]]) {
  const source = path.resolve('../tmp/preview-fixtures/layout.' + extension)
  const original = await fs.readFile(source)
  const checksum = bytes => createHash('sha256').update(bytes).digest('hex')
  const form = new FormData()
  form.append('file', new File([original], 'layout.' + extension))
  const response = await fetch(base + '/api/files/preview', { method: 'POST', headers: { Origin: base }, body: form, signal: AbortSignal.timeout(90000) })
  if (!response.ok) throw new Error(extension + ' preview failed: ' + await response.text())
  const pdf = Buffer.from(await response.arrayBuffer())
  const opened = await PDFDocument.load(pdf)
  assert.equal(opened.getPageCount(), expectedPages)
  assert.equal(checksum(await fs.readFile(source)), checksum(original))
  await fs.writeFile(path.resolve('../tmp/preview-fixtures/api-' + extension + '.pdf'), pdf)
  results.push({ format: extension, pages: opened.getPageCount(), dimensions: opened.getPages().map(page => page.getSize()), originalUnchanged: true })
}
const rejected = await fetch(base + '/api/files/preview', { method: 'POST', body: new FormData() })
assert.equal(rejected.status, 403)
await fs.mkdir('output', { recursive: true })
await fs.writeFile('output/office-preview-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), results, crossOriginRejected: true }, null, 2))
console.log(JSON.stringify(results))
