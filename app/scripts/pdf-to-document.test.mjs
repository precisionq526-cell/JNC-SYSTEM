import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/lib/editor/pdf-to-document.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'jszip'", JSON.stringify(pathToFileURL(require.resolve('jszip')).href)).replace("'./file-types'", JSON.stringify(new URL('../src/lib/editor/file-types.ts', import.meta.url).href))
const { buildEditablePdfDocument } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const line = (text, top = 60, width = 450) => ({ x: 60, top, width, height: 12, runs: [{ text, font: 'Arial', size: 12, bold: false, italic: false }] })
const read = async pages => {
  const blob = await buildEditablePdfDocument(pages)
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml')
  return { zip, document }
}
test('PDF text becomes editable Unicode Word runs with XML escaping and font formatting', async () => {
  const content = line('Café & <print> "ready" — 你好'); content.runs[0].bold = true; content.runs[0].italic = true; content.runs[0].size = 18
  const { document } = await read([{ width: 595, height: 842, lines: [content] }])
  assert.equal(document.getElementsByTagNameNS(W, 't')[0].textContent, content.runs[0].text)
  assert.equal(document.getElementsByTagNameNS(W, 'b').length, 1)
  assert.equal(document.getElementsByTagNameNS(W, 'i').length, 1)
  assert.equal(document.getElementsByTagNameNS(W, 'sz')[0].getAttributeNS(W, 'val'), '36')
})
test('page sizes, page sections and graphics-only pages are retained', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0N8AAAAASUVORK5CYII=', 'base64')
  const { zip, document } = await read([{ width: 595, height: 842, lines: [line('First page')], background: png }, { width: 842, height: 595, lines: [], background: png }, { width: 612, height: 792, lines: [line('Third page')] }])
  assert.equal(document.getElementsByTagNameNS(W, 'sectPr').length, 3)
  assert.deepEqual([...document.getElementsByTagNameNS(W, 'pgSz')].map(n => [n.getAttributeNS(W, 'w'), n.getAttributeNS(W, 'h')]), [['11900', '16840'], ['16840', '11900'], ['12240', '15840']])
  assert.equal(document.getElementsByTagNameNS(W, 'headerReference').length, 3)
  assert.deepEqual(Buffer.from(await zip.file('word/media/page1.png').async('uint8array')), png)
  assert.ok(zip.file('word/header2.xml'))
  assert.match(await zip.file('word/header0.xml').async('string'), /behindDoc="1"/)
})
test('wrapped lines join into editable paragraphs while headings stay separate', async () => {
  const title = line('Heading', 60, 100); title.runs[0].bold = true; title.runs[0].size = 20
  const { document } = await read([{ width: 595, height: 842, lines: [title, line('First wrapped line', 100), line('continued text', 116, 160)] }])
  const paragraphs = [...document.getElementsByTagNameNS(W, 'p')]
  assert.equal(paragraphs.length, 2)
  assert.match(paragraphs[1].textContent, /First wrapped line continued text/)
})
test('image-only PDFs fail clearly instead of opening blank documents', async () => {
  await assert.rejects(() => buildEditablePdfDocument([{ width: 595, height: 842, lines: [] }]), /no editable text/)
  await assert.rejects(() => buildEditablePdfDocument([]), /no editable text/)
})
