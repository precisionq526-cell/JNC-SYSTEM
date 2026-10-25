import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'

const originalWord = await JSZip.loadAsync(await fs.readFile('../tmp/preview-fixtures/layout.docx'))
const word = await JSZip.loadAsync(await fs.readFile('C:/Users/Brian Ocampo/Downloads/layout.docx'))
const xml = await word.file('word/document.xml').async('string')
assert.match(xml, /Saved customer edit: preserve the table, image and second page/)
assert.match(xml, /w:b w:val="1"/)
assert.match(xml, /w:sz w:val="28"/)
assert.match(xml, /<w:tbl>/)
assert.match(xml, /w:type="page"/)
const unchanged = []
for (const name of Object.keys(originalWord.files).filter(name => !originalWord.files[name].dir && name !== 'word/document.xml')) {
  assert.deepEqual(await word.file(name).async('uint8array'), await originalWord.file(name).async('uint8array'))
  unchanged.push(name)
}
const excel = await JSZip.loadAsync(await fs.readFile('C:/Users/Brian Ocampo/Downloads/layout.xlsx'))
const sheet = await excel.file('xl/worksheets/sheet1.xml').async('string')
assert.match(sheet, /Saved spreadsheet edit/)
assert.match(sheet, /r="B2"[^>]*><v>3<\/v>/)
assert.match(sheet, /B2\*C2/)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { checkedAt: new Date().toISOString(), word: { savedText: true, bold: true, fontSize: 14, tableAndPageBreakKept: true, unchangedPackageParts: unchanged.length,
  sha256: hash(await fs.readFile('C:/Users/Brian Ocampo/Downloads/layout.docx')) }, excel: { savedText: true, savedCellB2: 3, formulaKept: true, sha256: hash(await fs.readFile('C:/Users/Brian Ocampo/Downloads/layout.xlsx')) } }
await fs.writeFile('output/saved-edit-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
