import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { PDFDocument } from 'pdf-lib'

const code = ts.transpileModule(fs.readFileSync('src/lib/printing/spool-document.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace("'pdf-lib'", JSON.stringify(new URL('../node_modules/pdf-lib/es/index.js', import.meta.url).href))
// Use the package's Node entry point from this script's resolver, rather than the library's extensionless ESM internals.
const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
const moduleCode = code.replace(JSON.stringify(new URL('../node_modules/pdf-lib/es/index.js', import.meta.url).href), JSON.stringify(new URL('file:///' + require.resolve('pdf-lib').replaceAll('\\','/')).href))
const { prepareSpoolDocument } = await import('data:text/javascript;base64,' + Buffer.from(moduleCode).toString('base64'))
const original = await PDFDocument.create()
for (let i = 1; i <= 5; i++) original.addPage([300 + i, 500 + i])
const bytes = await original.save()
test('selected pages are collated as complete copies with actual original page dimensions', async () => {
  const output = await PDFDocument.load(await prepareSpoolDocument(bytes, [2,4], 3, false))
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [302,304,302,304,302,304])
})
test('odd duplex copies insert a blank separator before the next copy', async () => {
  const output = await PDFDocument.load(await prepareSpoolDocument(bytes, [1,2,3], 2, true))
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [301,302,303,303,301,302,303])
})
test('manual backs retain the operator-selected reverse page order and produce one copy', async () => {
  const output = await PDFDocument.load(await prepareSpoolDocument(bytes, [4,2], 1, false))
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [304,302])
})
test('out-of-range selections and excessive runs stop before spooling', async () => {
  await assert.rejects(prepareSpoolDocument(bytes, [6], 1, false), /Invalid/)
  await assert.rejects(prepareSpoolDocument(bytes, [1,2,3,4,5], 10000, true), /20,000/)
})
test('a single complete copy retains the original PDF byte for byte', async () => {
  assert.deepEqual(await prepareSpoolDocument(bytes, [1,2,3,4,5], 1, true), Buffer.from(bytes))
})
test('filled form appearances are flattened for collated copies without changing the saved upload', async () => {
  const source = await PDFDocument.create(), page = source.addPage([300,500])
  const field = source.getForm().createTextField('customer')
  field.setText('Saved customer text'); field.addToPage(page, { x:20,y:400,width:200,height:30 })
  const saved = await source.save()
  const output = await PDFDocument.load(await prepareSpoolDocument(saved, [1], 2, false))
  assert.equal(output.getPageCount(), 2)
  assert.equal(output.getForm().getFields().length, 0)
  assert.equal((await PDFDocument.load(saved)).getForm().getTextField('customer').getText(), 'Saved customer text')
})
