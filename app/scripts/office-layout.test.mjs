import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {DOMParser} from '@xmldom/xmldom'
import {openOfficeDocument} from './load-office-editor.mjs'
import {cellId,displayCell,styleForCell,worksheetPaste,writableCell} from '../src/lib/editor/worksheet-layout.ts'
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const xml=value=>new DOMParser().parseFromString(value,'application/xml')
async function workbook(){
  const zip=new JSZip()
  zip.file('[Content_Types].xml','<Types/>')
  zip.file('xl/workbook.xml','<workbook xmlns="'+S+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Protected" sheetId="2" r:id="r2"/><sheet name="Main" sheetId="1" r:id="r1"/></sheets><definedNames><definedName name="_xlnm.Print_Area">Main!$A$1:$D$10</definedName></definedNames></workbook>')
  zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
  zip.file('xl/styles.xml','<styleSheet xmlns="'+S+'"><numFmts><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts><fonts><font><name val="Calibri"/><sz val="11"/></font><font><name val="Arial"/><sz val="12"/><b/><color rgb="FFFFFFFF"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17304D"/></patternFill></fill></fills><cellXfs><xf fontId="0" fillId="0" numFmtId="0"/><xf fontId="1" fillId="1" numFmtId="0"><alignment horizontal="center"/></xf><xf fontId="0" fillId="0" numFmtId="164"/><xf fontId="0" fillId="0" numFmtId="14"/><xf fontId="0" fillId="0" numFmtId="0"><protection locked="0"/></xf></cellXfs></styleSheet>')
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="'+S+'"><dimension ref="A1:D9"/><cols><col min="1" max="1" width="28"/><col min="2" max="2" width="16" style="2"/></cols><sheetData><row r="1" ht="30" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>Invoice</t></is></c></row><row r="3"><c r="B3" s="2"><v>25</v></c><c r="C3" s="3"><v>45000</v></c><c r="D3"><f>B3*2</f><v>50</v></c></row><row r="4"><c r="A4" s="1"/></row><row r="8"><c r="A8"><f t="array" ref="A8:B9">ROW(A8:B9)</f><v>8</v></c><c r="B8"><v>8</v></c></row><row r="9"><c r="A9"><v>9</v></c><c r="B9"><v>9</v></c></row></sheetData><mergeCells><mergeCell ref="A1:C1"/></mergeCells><pageSetup paperSize="9" orientation="landscape"/></worksheet>')
  zip.file('xl/worksheets/sheet2.xml','<worksheet xmlns="'+S+'"><cols><col min="2" max="2" style="4"/></cols><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c><c r="B1" s="4" t="inlineStr"><is><t>Editable</t></is></c></row></sheetData><sheetProtection sheet="1"/></worksheet>')
  zip.file('xl/media/image1.png',new Uint8Array([1,2,3,4]))
  return {zip,bytes:await zip.generateAsync({type:'arraybuffer'})}
}

test('worksheet metadata retains real sheet order, merged cells, column widths, row heights and styles',async()=>{
  const {bytes}=await workbook(),doc=await openOfficeDocument(bytes,'xlsx')
  assert.deepEqual(doc.worksheets.map(sheet=>sheet.name),['Protected','Main'])
  const sheet=doc.worksheets[1]
  assert.equal(sheet.widths[1],201);assert.equal(sheet.heights[1],40)
  assert.deepEqual(sheet.merges,[{startRow:1,startColumn:1,endRow:1,endColumn:3}])
  assert.equal(styleForCell(sheet,'A1').background,'#17304D');assert.equal(styleForCell(sheet,'A1').bold,true)
  assert.equal(displayCell('1234.5',styleForCell(sheet,'B3'),false),'$1,234.50')
  assert.equal(writableCell(sheet,'B1'),false);assert.equal(writableCell(sheet,'B8'),false)
})
test('blank worksheet cells and new rows save in cell order without changing styles, merges, images or another sheet',async()=>{
  const {zip,bytes}=await workbook(),doc=await openOfficeDocument(bytes,'xlsx'),sheet=doc.worksheets[1]
  const saved=await JSZip.loadAsync(await(await doc.save({[cellId(sheet.path,'B2')]:'12.5',[cellId(sheet.path,'A2')]:'New label',[cellId(sheet.path,'A4')]:'Filled blank'})).arrayBuffer())
  const source=await saved.file(sheet.path).async('string'),document=xml(source),rows=Array.from(document.getElementsByTagNameNS(S,'row'))
  assert.deepEqual(rows.map(row=>Number(row.getAttribute('r'))),[1,2,3,4,8,9])
  assert.deepEqual(Array.from(rows[1].getElementsByTagNameNS(S,'c')).map(cell=>cell.getAttribute('r')),['A2','B2'])
  assert.equal(rows[1].getElementsByTagNameNS(S,'c')[1].getAttribute('s'),'2')
  assert.match(source,/A1:C1/);assert.match(source,/orientation="landscape"/);assert.match(source,/Filled blank/)
  for(const part of ['xl/styles.xml','xl/media/image1.png','xl/worksheets/sheet2.xml'])assert.deepEqual(await saved.file(part).async('uint8array'),await zip.file(part).async('uint8array'))
  assert.deepEqual(Buffer.from(await(await doc.save({[cellId(sheet.path,'D7')]:''})).arrayBuffer()),Buffer.from(bytes))
})
test('worksheet formulas request recalculation, dates keep numeric storage and unsafe cells reject edits',async()=>{
  const {bytes}=await workbook(),doc=await openOfficeDocument(bytes,'xlsx'),sheet=doc.worksheets[1]
  const saved=await JSZip.loadAsync(await(await doc.save({[cellId(sheet.path,'C3')]:'2026-10-24',[cellId(sheet.path,'D3')]:'=SUM(B2,B3)'})).arrayBuffer())
  const document=xml(await saved.file(sheet.path).async('string')),cells=Array.from(document.getElementsByTagNameNS(S,'c'))
  const date=cells.find(cell=>cell.getAttribute('r')==='C3'),formula=cells.find(cell=>cell.getAttribute('r')==='D3')
  assert.equal(date.getAttribute('s'),'3');assert.equal(date.getElementsByTagNameNS(S,'v')[0].textContent,'46319')
  assert.equal(formula.getElementsByTagNameNS(S,'f')[0].textContent,'SUM(B2,B3)');assert.equal(formula.getElementsByTagNameNS(S,'v').length,0)
  assert.match(await saved.file('xl/workbook.xml').async('string'),/fullCalcOnLoad="1"/)
  await assert.rejects(()=>doc.save({[cellId(sheet.path,'B1')]:'Overwritten merge'}),/protected|merged/)
  await assert.rejects(()=>doc.save({[cellId(sheet.path,'B8')]:'Overwrite array'}),/shared formula/)
  const protectedSheet=doc.worksheets[0];assert.equal(writableCell(protectedSheet,'A1'),false);assert.equal(writableCell(protectedSheet,'B2'),true)
  await assert.rejects(()=>doc.save({[cellId(protectedSheet.path,'A1')]:'overwrite'}),/protected/)
})
test('range paste understands quoted tabs/newlines and rejects a whole paste into protected or merged cells',async()=>{
  const {bytes}=await workbook(),doc=await openOfficeDocument(bytes,'xlsx'),sheet=doc.worksheets[1]
  const changes=worksheetPaste(sheet,'A4','"one\ttwo"\t37.5\n"line1\nline2"\t4')
  assert.equal(changes[cellId(sheet.path,'A4')],'one\ttwo');assert.equal(changes[cellId(sheet.path,'A5')],'line1\nline2')
  assert.throws(()=>worksheetPaste(sheet,'A1','one\ttwo'),/merged/)
  assert.throws(()=>worksheetPaste(doc.worksheets[0],'A1','overwrite'),/protected/)
})
test('Word pictures and header images are present in the editable layout and unchanged saves retain original bytes',async()=>{
  const zip=new JSZip(),a='http://schemas.openxmlformats.org/drawingml/2006/main',wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const picture='<w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr name="Logo"/><a:graphic><a:blip r:embed="img"/></a:graphic></wp:inline></w:drawing></w:r>'
  const namespaces='xmlns:w="'+W+'" xmlns:a="'+a+'" xmlns:wp="'+wp+'" xmlns:r="'+r+'" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
  zip.file('word/document.xml','<w:document '+namespaces+'><w:body><w:p>'+picture+'</w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>')
  const alternatePicture=picture.replace('<w:drawing>','<mc:AlternateContent><mc:Choice><w:drawing>').replace('</w:drawing>','</w:drawing></mc:Choice></mc:AlternateContent>')
  zip.file('word/header1.xml','<w:hdr '+namespaces+'><w:p>'+alternatePicture+'<w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>')
  for(const part of ['document','header1'])zip.file('word/_rels/'+part+'.xml.rels','<Relationships><Relationship Id="img" Target="media/logo.png"/></Relationships>')
  zip.file('word/media/logo.png',new Uint8Array([137,80,78,71,13,10,26,10]))
  const bytes=await zip.generateAsync({type:'arraybuffer'}),doc=await openOfficeDocument(bytes,'docx')
  assert.equal(doc.layout.blocks[0].runs[0].image.width,100);assert.equal(doc.wordParts[0].layout.blocks[0].runs[0].image.height,50)
  assert.ok(doc.wordParts[0].layout.blocks[0].runs.find(run=>run.text==='Header text').id)
  assert.deepEqual(Buffer.from(await(await doc.save({})).arrayBuffer()),Buffer.from(bytes))
  assert.deepEqual(doc.imageRepairs,[])
})

test('a covered header logo can be raised without removing its mask, changing its crop or altering other parts',async()=>{
  const zip=new JSZip(),a='http://schemas.openxmlformats.org/drawingml/2006/main',wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const position='<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>127000</wp:posOffset></wp:positionV>'
  const logo='<w:r><w:drawing><wp:anchor relativeHeight="0">'+position+'<wp:extent cx="1270000" cy="635000"/><wp:docPr name="Institution logo"/><a:graphic><a:blip r:embed="img"/><a:srcRect t="1000" b="2000"/></a:graphic></wp:anchor></w:drawing></w:r>'
  const mask='<w:r><w:drawing><wp:anchor relativeHeight="0">'+position+'<wp:extent cx="1270000" cy="254000"/><a:graphic><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:graphic></wp:anchor></w:drawing></w:r>'
  zip.file('word/document.xml','<w:document xmlns:w="'+W+'" xmlns:a="'+a+'" xmlns:wp="'+wp+'" xmlns:r="'+r+'"><w:body><w:p>'+logo+mask+'</w:p><w:p><w:r><w:t>Keep body text</w:t></w:r></w:p></w:body></w:document>')
  zip.file('word/_rels/document.xml.rels','<Relationships><Relationship Id="img" Target="media/logo.png"/></Relationships>')
  zip.file('word/media/logo.png',new Uint8Array([137,80,78,71,13,10,26,10]));zip.file('word/styles.xml','<styles/>')
  const bytes=await zip.generateAsync({type:'arraybuffer'}),doc=await openOfficeDocument(bytes,'docx')
  assert.equal(doc.imageRepairs.length,1)
  const saved=await JSZip.loadAsync(await(await doc.save({}, {},[doc.imageRepairs[0].id])).arrayBuffer()),document=xml(await saved.file('word/document.xml').async('string'))
  const anchors=Array.from(document.getElementsByTagNameNS(wp,'anchor'))
  assert.equal(anchors.length,2);assert.equal(anchors[0].getElementsByTagNameNS(a,'solidFill').length,1)
  assert.equal(anchors[1].getElementsByTagNameNS(wp,'docPr')[0].getAttribute('name'),'Institution logo')
  assert.ok(Number(anchors[1].getAttribute('relativeHeight'))>=251658240)
  assert.equal(anchors[1].getElementsByTagNameNS(a,'srcRect')[0].getAttribute('t'),'1000')
  assert.match(document.documentElement.textContent,/Keep body text/)
  for(const part of ['word/styles.xml','word/media/logo.png','word/_rels/document.xml.rels'])assert.deepEqual(await saved.file(part).async('uint8array'),await zip.file(part).async('uint8array'))
  assert.deepEqual(Buffer.from(await(await doc.save({}, {},[])).arrayBuffer()),Buffer.from(bytes))
  await assert.rejects(()=>doc.save({}, {},['untrusted-repair']),/not available/)
})
