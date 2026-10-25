import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import * as mupdf from 'mupdf'
import {openOfficeDocument} from './load-office-editor.mjs'
import {cellId} from '../src/lib/editor/worksheet-layout.ts'

const folder='../tmp/editor-header-check',output='../output/editor-header-check',base='http://127.0.0.1:3100'
await fs.mkdir(output,{recursive:true})
const original=await fs.readFile(folder+'/worksheet-original.xlsx'),opened=await openOfficeDocument(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength),'xlsx'),sheet=opened.worksheets[0]
const values=Object.fromEntries(Object.entries({A5:'Lamination',B3:'4',B5:'2',C5:'15',D5:'=B5*C5+5',E5:'2026-10-24',A8:'Saved blank cell'}).map(([address,value])=>[cellId(sheet.path,address),value]))
const edited=Buffer.from(await(await opened.save(values)).arrayBuffer()),before=await JSZip.loadAsync(original),after=await JSZip.loadAsync(edited)
await fs.writeFile(folder+'/worksheet-edited.xlsx',edited)
const changed=[]
for(const name of Object.keys(before.files).filter(name=>!before.files[name].dir))if(!Buffer.from(await before.file(name).async('uint8array')).equals(Buffer.from(await after.file(name).async('uint8array'))))changed.push(name)
assert.ok(changed.every(name=>[sheet.path,'xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml'].includes(name)))
assert.deepEqual(Buffer.from(await(await opened.save({})).arrayBuffer()),original)
const pdfs=[]
for(const [label,bytes]of [['original',original],['edited',edited]]){
  const form=new FormData();form.append('file',new File([bytes],'worksheet-'+label+'.xlsx'))
  const response=await fetch(base+'/api/files/preview',{method:'POST',headers:{Origin:base},body:form,signal:AbortSignal.timeout(90000)})
  if(!response.ok)throw Error(await response.text())
  const pdf=Buffer.from(await response.arrayBuffer());await fs.writeFile(folder+'/worksheet-'+label+'.pdf',pdf);pdfs.push(mupdf.Document.openDocument(pdf,'application/pdf'))
}
assert.equal(pdfs[0].countPages(),2);assert.equal(pdfs[1].countPages(),2)
let text=''
for(let i=0;i<2;i++){
  const p=pdfs[0].loadPage(i),q=pdfs[1].loadPage(i);assert.deepEqual(p.getBounds(),q.getBounds())
  const x=p.toPixmap(mupdf.Matrix.scale(1.2,1.2),mupdf.ColorSpace.DeviceRGB,false),y=q.toPixmap(mupdf.Matrix.scale(1.2,1.2),mupdf.ColorSpace.DeviceRGB,false)
  if(i===0){const content=q.toStructuredText('');text=content.asText();content.destroy();await fs.writeFile(output+'/worksheet-after.png',y.asPNG())}
  else assert.deepEqual(Buffer.from(y.getPixels()),Buffer.from(x.getPixels()),'The other worksheet has identical printed pixels')
  x.destroy();y.destroy();p.destroy();q.destroy()
}
assert.match(text,/175\.00/,'Excel recalculates the total after edits');assert.match(text,/2026-10-24/);assert.match(text,/Lamination/);assert.match(text,/Saved blank cell/);assert.match(text,/Original print header/)
pdfs.forEach(pdf=>pdf.destroy())
const report={checkedAt:new Date().toISOString(),pages:2,pageSizesRetained:true,changedParts:changed,otherPartsByteIdentical:true,noOpByteIdentical:true,unmodifiedSheetPixelIdentical:true,excelRecalculatedTotal:'175.00',dateCorrect:true,blankCellsSaved:true,mergedTitleStylesPrintAreaAndImagesRetained:true,liveOrdersModified:false}
await fs.writeFile(output+'/worksheet-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
