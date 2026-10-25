import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { PDFDocument } from 'pdf-lib'
import * as mupdf from 'mupdf'
import {openOfficeDocument} from './load-office-editor.mjs'
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer
const base='http://127.0.0.1:3100', folder='../tmp/format-preservation'
await fs.mkdir(folder,{recursive:true});await fs.mkdir('../output/editor-format-audit',{recursive:true})
const results=[]
const post=async(route,file,extra={})=>{const form=new FormData();form.append('file',file);for(const [key,value]of Object.entries(extra))form.append(key,value);const response=await fetch(base+route,{method:'POST',headers:{Origin:base},body:form,signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error(await response.text());return response}
for(const kind of ['docx','xlsx','pptx']){
 const original=await fs.readFile('../tmp/preview-fixtures/layout.'+kind), opened=await openOfficeDocument(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength),kind)
 const target=opened.fields.find(field=>kind==='docx'?field.value==='Original customer document':kind==='xlsx'?field.label==='A2':field.value==='Original slide layout')
 assert.ok(target,kind+' editable field exists')
 const replacement=kind==='docx'?'Revised customer document':kind==='xlsx'?'Revised print job':'Revised slide layout'
 const edited=await(await opened.save({[target.id]:replacement})).arrayBuffer(), before=await JSZip.loadAsync(original),after=await JSZip.loadAsync(edited)
 const changed=[];for(const name of Object.keys(before.files).filter(name=>!before.files[name].dir)){if(!Buffer.from(await before.file(name).async('uint8array')).equals(Buffer.from(await after.file(name).async('uint8array'))))changed.push(name)}
 assert.ok(changed.every(name=>name===(kind==='xlsx'?target.id.split(':cell:')[0]:target.id.slice(0,target.id.lastIndexOf(':'))) || kind==='xlsx' && name==='xl/workbook.xml'))
 assert.deepEqual(Buffer.from(await(await opened.save({})).arrayBuffer()),original)
 await fs.writeFile(folder+'/edited.'+kind,Buffer.from(edited))
 const metadata=[]
 for(const [label,bytes] of [['original',original],['edited',edited]]){
  const response=await post('/api/files/preview',new File([bytes],'layout.'+kind))
  const pdf=Buffer.from(await response.arrayBuffer());await fs.writeFile(folder+'/'+kind+'-'+label+'.pdf',pdf)
  const document=await PDFDocument.load(pdf);metadata.push(document.getPages().map(page=>({size:page.getSize(),rotation:page.getRotation().angle})))
 }
 assert.deepEqual(metadata[1],metadata[0],kind+' retains page count and page sizes')
 results.push({format:kind,changedParts:changed,otherPartsByteIdentical:true,noOpByteIdentical:true,pages:metadata[1].length,pageSizesRetained:true})
 console.log(kind+' original/edited native previews verified.')
}
const original=await fs.readFile(folder+'/evaluation-original.pdf'),file=new File([original],'evaluation.pdf')
const layout=await(await post('/api/files/pdf-edit',file,{action:'inspect'})).json()
const name=layout.pages[0].spans.find(s=>s.text.includes('1. GigaMare')),date=layout.pages[0].spans.find(s=>s.text.includes('October 15,2026'))
const edits=[{id:name.id,text:'1. GigaMare Inc. EDITED'},{id:date.id,text:'October 18,2026'}]
const edited=Buffer.from(await(await post('/api/files/pdf-edit',file,{action:'save',edits:JSON.stringify(edits)})).arrayBuffer())
await fs.writeFile(folder+'/evaluation-edited.pdf',edited)
const a=mupdf.Document.openDocument(original,'application/pdf'),b=mupdf.Document.openDocument(edited,'application/pdf')
let changedPixels=0
for(let i=0;i<a.countPages();i++){
 const p=a.loadPage(i),q=b.loadPage(i),x=p.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false),y=q.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false),xp=x.getPixels(),yp=y.getPixels()
 assert.equal(xp.length,yp.length)
 for(let k=0;k<xp.length;k++)if(xp[k]!==yp[k]){const px=Math.floor(k/x.getNumberOfComponents())%x.getWidth()/1.5,py=Math.floor(k/x.getNumberOfComponents()/x.getWidth())/1.5;assert.equal(i,0);assert.ok([name,date].some(span=>px>=span.x-2&&px<=span.x+span.maxWidth+2&&py>=span.y-2&&py<=span.y+span.height+2),'No visual change outside edited table text');changedPixels++}
 if(i===0){await fs.writeFile('../output/editor-format-audit/pdf-original.png',x.asPNG());await fs.writeFile('../output/editor-format-audit/pdf-edited.png',y.asPNG())}
 x.destroy();y.destroy();p.destroy();q.destroy()
}
a.destroy();b.destroy();assert.ok(changedPixels>0)
const noop=Buffer.from(await(await post('/api/files/pdf-edit',file,{action:'save',edits:'[]'})).arrayBuffer());assert.deepEqual(noop,original)
const invalid=await fetch(base+'/api/files/pdf-edit',{method:'POST',body:new FormData()});assert.equal(invalid.status,403)
results.push({format:'pdf',pages:layout.pages.length,onlySelectedTextPixelsChanged:true,unchangedPagesByteForBytePixels:true,noOpByteIdentical:true,changedPixelComponents:changedPixels,crossOriginRejected:true})
await fs.writeFile('../output/editor-format-audit/verification.json',JSON.stringify({checkedAt:new Date().toISOString(),results,browserChecks:'Unavailable: browser use disabled in Work settings',liveOrdersModified:false,physicalPrintSubmitted:false},null,2))
console.log(JSON.stringify(results,null,2))
