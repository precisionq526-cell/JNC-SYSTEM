import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createEditedUpload, getFileEditorKind, OFFICE_MIME } from '../src/lib/editor/file-types.ts'
import { savePdfTextEdits } from '../src/lib/editor/pdf-edits.ts'
import {openOfficeDocument} from './load-office-editor.mjs'

globalThis.DOMParser = DOMParser
globalThis.XMLSerializer = XMLSerializer
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const fixtures = path.resolve('../tmp/editor-fixtures')
fs.mkdirSync(fixtures, { recursive: true })
const pack = zip => zip.generateAsync({ type: 'arraybuffer' })

test('all accepted editable file formats select their editor', () => {
  for (const [name, kind] of [['photo.JPG', 'image'], ['p.pdf', 'pdf'], ['a.docx', 'office'], ['a.xlsx', 'office'], ['a.pptx', 'office'], ['notes.txt', 'text'], ['data.csv', 'text']]) assert.equal(getFileEditorKind(name), kind)
  assert.equal(getFileEditorKind('unknown.zip'), null)
})
test('edited images use the output MIME and matching file extension; empty output fails', () => {
  const original = new File(['original'], 'photo.jpeg', { type: 'image/jpeg' })
  const edited = createEditedUpload(original, new Blob(['image'], { type: 'image/png' }))
  assert.equal(edited.name, 'photo.png')
  assert.equal(edited.type, 'image/png')
  assert.throws(() => createEditedUpload(original, new Blob([])), /empty/)
})
test('Word text changes preserve styles, headers, images, and unrelated ZIP parts', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Original document text</w:t></w:r></w:p></w:body></w:document>')
  zip.file('word/header1.xml', '<w:hdr xmlns:w="' + W + '"><w:p><w:r><w:t>Header stays</w:t></w:r></w:p></w:hdr>')
  zip.file('word/media/image1.png', new Uint8Array([1, 2, 3, 4]))
  zip.file('word/styles.xml', 'unchanged style data')
  const bytes = await pack(zip)
  fs.writeFileSync(path.join(fixtures, 'sample.docx'), Buffer.from(bytes))
  const document = await openOfficeDocument(bytes, 'docx')
  const field = document.fields.find(field => field.group === 'Document')
  const blob = await document.save({ [field.id]: 'Edited document text & symbols < >' })
  assert.equal(blob.type, OFFICE_MIME.docx)
  const saved = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await saved.file('word/document.xml').async('string')
  assert.match(xml, /Edited document text &amp; symbols &lt; &gt;/)
  assert.match(xml, /<w:b\/>/)
  assert.equal(await saved.file('word/header1.xml').async('string'), await zip.file('word/header1.xml').async('string'))
  assert.deepEqual(await saved.file('word/media/image1.png').async('uint8array'), new Uint8Array([1, 2, 3, 4]))
  assert.equal(await saved.file('word/styles.xml').async('string'), 'unchanged style data')
})

test('Word formatting and line breaks survive export without replacing tables or page settings', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')
  const opened = await openOfficeDocument(await pack(zip), 'docx')
  const id = opened.fields[0].id
  const saved = await JSZip.loadAsync(await (await opened.save({ [id]: 'Edited\nNext line' }, { [id]: { bold: true, italic: true, underline: true, fontSize: 14 } })).arrayBuffer())
  const xml = await saved.file('word/document.xml').async('string')
  for (const pattern of [/<w:tbl>/, /<w:pgSz/, /w:b w:val="1"/, /w:i w:val="1"/, /w:u w:val="single"/, /w:sz w:val="28"/, /<w:br\/>/, /Next line/]) assert.match(xml, pattern)
})

test('the edited export supplies the actual multipart file bytes and the original stays unchanged', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '"><w:body><w:p><w:r><w:t>Original file</w:t></w:r></w:p></w:body></w:document>')
  const bytes = Buffer.from(await pack(zip))
  const original = new File([bytes], 'layout.docx', { type: OFFICE_MIME.docx })
  const opened = await openOfficeDocument(await original.arrayBuffer(), 'docx')
  const edited = createEditedUpload(original, await opened.save({ [opened.fields[0].id]: 'Saved customer edit' }))
  const form = new FormData(); form.append('files', edited)
  const uploaded = await JSZip.loadAsync(await form.get('files').arrayBuffer())
  assert.match(await uploaded.file('word/document.xml').async('string'), /Saved customer edit/)
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes)
})
test('PowerPoint edits preserve slide objects and images', async () => {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="' + A + '"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Original slide text</a:t></a:r></a:p></p:txBody></p:sp><p:pic/></p:spTree></p:cSld></p:sld>')
  zip.file('ppt/media/image1.png', 'image bytes stay')
  const bytes = await pack(zip)
  fs.writeFileSync(path.join(fixtures, 'sample.pptx'), Buffer.from(bytes))
  const document = await openOfficeDocument(bytes, 'pptx')
  const blob = await document.save({ [document.fields[0].id]: 'Edited slide text' })
  const saved = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await saved.file('ppt/slides/slide1.xml').async('string')
  assert.match(xml, /Edited slide text/)
  assert.match(xml, /<p:pic\/>/)
  assert.match(xml, /b="1"/)
  assert.equal(await saved.file('ppt/media/image1.png').async('string'), 'image bytes stay')
})
test('Excel shared strings change only their selected cell; formulas request recalculation', async () => {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook xmlns="' + S + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/><Relationship Id="rId2" Target="calcChain.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain"/></Relationships>')
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/calcChain.xml" ContentType="calcChain"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="worksheet"/></Types>')
  zip.file('xl/sharedStrings.xml', '<sst xmlns="' + S + '"><si><t>Original cell text</t></si></sst>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="' + S + '"><sheetData><row r="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c><c r="C1"><f>A2+1</f><v>5</v></c><c r="D1"><f t="shared" si="1">A2+2</f><v>6</v></c></row></sheetData></worksheet>')
  zip.file('xl/calcChain.xml', '<calcChain/>')
  const bytes = await pack(zip)
  fs.writeFileSync(path.join(fixtures, 'sample.xlsx'), Buffer.from(bytes))
  const document = await openOfficeDocument(bytes, 'xlsx')
  assert.equal(document.fields.find(field => field.label === 'A1').value, 'Original cell text')
  assert.equal(document.fields.some(field => field.label === 'D1'), false)
  const blob = await document.save({
    [document.fields.find(field => field.label === 'A1').id]: 'Edited cell text',
    [document.fields.find(field => field.label === 'C1').id]: '=A2+10',
  })
  const saved = await JSZip.loadAsync(await blob.arrayBuffer())
  const sheet = new DOMParser().parseFromString(await saved.file('xl/worksheets/sheet1.xml').async('string'), 'application/xml')
  const cells = Array.from(sheet.getElementsByTagNameNS(S, 'c'))
  assert.equal(cells[0].getAttribute('s'), '2')
  assert.equal(cells[0].getAttribute('t'), 'inlineStr')
  assert.match(cells[0].textContent, /Edited cell text/)
  assert.equal(cells[1].getAttribute('t'), 's')
  assert.equal(cells[1].textContent, '0')
  assert.equal(cells[2].getElementsByTagNameNS(S, 'f')[0].textContent, 'A2+10')
  assert.equal(cells[2].getElementsByTagNameNS(S, 'v').length, 0)
  assert.match(await saved.file('xl/workbook.xml').async('string'), /fullCalcOnLoad="1"/)
  assert.equal(saved.file('xl/calcChain.xml'), null)
  assert.doesNotMatch(await saved.file('xl/_rels/workbook.xml.rels').async('string'), /calcChain/)
  await assert.rejects(() => document.save({ [document.fields.find(field => field.label === 'C1').id]: '=' }), /empty/)
  const retry = await JSZip.loadAsync(await (await document.save({})).arrayBuffer())
  assert.equal(await retry.file('xl/worksheets/sheet1.xml').async('string'), await zip.file('xl/worksheets/sheet1.xml').async('string'))
})
test('PDF saves retain every original page and original page content', async () => {
  const source = await PDFDocument.create()
  source.setTitle('Original PDF title')
  const font = await source.embedFont(StandardFonts.Helvetica)
  source.addPage([400, 500]).drawText('Original page one', { x: 40, y: 440, font })
  source.addPage([500, 600]).drawText('Original page two', { x: 40, y: 540, font })
  const bytes = new Uint8Array(await source.save()).buffer
  fs.writeFileSync(path.join(fixtures, 'sample.pdf'), Buffer.from(bytes))
  const blob = await savePdfTextEdits(bytes, [{ id: 'one', pageIndex: 1, text: 'Added correction', x: 40, y: 480, size: 14, color: '#000000' }])
  const saved = await PDFDocument.load(await blob.arrayBuffer())
  assert.equal(saved.getPageCount(), 2)
  assert.equal(saved.getTitle(), 'Original PDF title')
  assert.deepEqual(saved.getPages().map(page => page.getSize()), [{ width: 400, height: 500 }, { width: 500, height: 600 }])
  assert.ok(saved.getPages()[1].node.Contents())
  await assert.rejects(() => savePdfTextEdits(bytes, [{ id: 'bad', pageIndex: 7, text: 'bad', x: 40, y: 40, size: 14, color: '#000000' }]), /placement/)
})
test('plain-text saves retain UTF-8 text and their format', async () => {
  const original = new File(['original'], 'notes.txt', { type: 'text/plain' })
  const saved = createEditedUpload(original, new Blob(['Café — edited text'], { type: 'text/plain' }))
  assert.equal(saved.name, 'notes.txt')
  assert.equal(await saved.text(), 'Café — edited text')
  fs.writeFileSync(path.join(fixtures, 'sample.txt'), 'Original plain text\\n')
})

test('saving Office files without edits keeps their original bytes exactly', async () => {
  for (const kind of ['docx','xlsx','pptx']) {
    const bytes=await fs.promises.readFile(path.join(fixtures,'sample.'+kind))
    const document=await openOfficeDocument(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),kind)
    const saved=await document.save(Object.fromEntries(document.fields.map(field=>[field.id,field.value])))
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()),bytes)
  }
})
test('Word merged cells, column widths, row heights, section breaks and run formatting survive a table edit', async()=>{
  const zip=new JSZip(), source='<w:document xmlns:w="'+W+'"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="500" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="9000" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>Original cell</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> stays italic</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:left="720" w:right="720" w:bottom="720"/></w:sectPr></w:body></w:document>'
  zip.file('word/document.xml',source);zip.file('word/styles.xml','original styles');zip.file('word/media/picture.png','original media')
  const opened=await openOfficeDocument(await pack(zip),'docx'),field=opened.fields.find(f=>f.value==='Original cell')
  assert.equal(opened.layout.blocks[0].rows[0].cells[0].colspan,2);assert.deepEqual(opened.layout.blocks[0].widths,[300,150])
  const saved=await JSZip.loadAsync(await (await opened.save({[field.id]:'Updated cell'})).arrayBuffer())
  assert.equal(await saved.file('word/document.xml').async('string'),source.replace('<w:t>Original cell</w:t>','<w:t xml:space="preserve">Updated cell</w:t>'))
  for(const name of ['word/styles.xml','word/media/picture.png'])assert.deepEqual(await saved.file(name).async('uint8array'),await zip.file(name).async('uint8array'))
})
test('editing one rich spreadsheet cell retains its runs, styles, merged cells, print area and unrelated shared cells',async()=>{
  const zip=new JSZip()
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('xl/workbook.xml','<workbook xmlns="'+S+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Report!$A$1:$B$5</definedName></definedNames></workbook>')
  zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/styles.xml','<styleSheet xmlns="'+S+'"><!-- styles remain byte for byte --></styleSheet>')
  zip.file('xl/sharedStrings.xml','<sst xmlns="'+S+'"><si><r><rPr><b/><color rgb="FFFF0000"/></rPr><t>Bold</t></r><r><rPr><i/></rPr><t> italic</t></r></si></sst>')
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="'+S+'"><sheetData><row r="1"><c r="A1" s="4" t="s"><v>0</v></c><c r="B1" s="4" t="s"><v>0</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells><pageSetup orientation="landscape" paperSize="9"/></worksheet>')
  const opened=await openOfficeDocument(await pack(zip),'xlsx'),field=opened.fields.find(f=>f.label==='A1')
  const saved=await JSZip.loadAsync(await(await opened.save({[field.id]:'Bold new italic'})).arrayBuffer()),xml=await saved.file('xl/worksheets/sheet1.xml').async('string')
  assert.match(xml,/<b\/>/);assert.match(xml,/<i\/>/);assert.match(xml,/FFFF0000/);assert.match(xml,/A2:B2/);assert.match(xml,/orientation="landscape"/);assert.match(xml,/s="4"/)
  for(const name of ['xl/styles.xml','xl/sharedStrings.xml'])assert.equal(await saved.file(name).async('string'),await zip.file(name).async('string'))
  const document=new DOMParser().parseFromString(xml,'application/xml'),cell=document.getElementsByTagNameNS(S,'c')[0]
  assert.equal(cell.getElementsByTagNameNS(S,'is')[0].textContent,'Bold new italic')
  // Numeric-looking replacements in a text cell must not discard its rich font runs.
  const numeric = await JSZip.loadAsync(await (await opened.save({[field.id]:'123'})).arrayBuffer())
  const numericXml = await numeric.file('xl/worksheets/sheet1.xml').async('string')
  assert.match(numericXml, /t="inlineStr"/)
  assert.match(numericXml, /<b\/>/)
  assert.match(numericXml, /FFFF0000/)
  const numericCell = new DOMParser().parseFromString(numericXml, 'application/xml').getElementsByTagNameNS(S,'c')[0]
  assert.equal(numericCell.getElementsByTagNameNS(S,'is')[0].textContent, '123')
})

test('blank Word table cells stay unchanged until edited and retain their existing run properties when filled', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:rPr><w:i/><w:color w:val="123456"/></w:rPr></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>')
  const bytes = await pack(zip), opened = await openOfficeDocument(bytes, 'docx')
  assert.equal(opened.fields.length, 2)
  assert.equal(opened.layout.blocks[0].rows[0].cells[0].blocks[0].runs[0].id, opened.fields[0].id)
  assert.deepEqual(Buffer.from(await (await opened.save({})).arrayBuffer()), Buffer.from(bytes))
  const [first, second] = opened.fields
  const saved = await JSZip.loadAsync(await (await opened.save({ [first.id]: 'Filled cell', [second.id]: 'Next cell' }, { [first.id]: { bold: true }, [second.id]: { fontSize: 14 } })).arrayBuffer())
  const xml = new DOMParser().parseFromString(await saved.file('word/document.xml').async('string'), 'application/xml')
  const cells = Array.from(xml.getElementsByTagNameNS(W, 'tc'))
  assert.equal(cells[0].textContent, 'Filled cell')
  assert.equal(cells[0].getElementsByTagNameNS(W, 'r').length, 1)
  assert.equal(cells[0].getElementsByTagNameNS(W, 'i').length, 1)
  assert.equal(cells[0].getElementsByTagNameNS(W, 'color')[0].getAttributeNS(W, 'val'), '123456')
  assert.equal(cells[0].getElementsByTagNameNS(W, 'b')[0].getAttributeNS(W, 'val'), '1')
  assert.equal(cells[1].getElementsByTagNameNS(W, 'sz')[0].getAttributeNS(W, 'val'), '28')
  assert.equal(xml.getElementsByTagNameNS(W, 'gridCol').length, 2)
})
