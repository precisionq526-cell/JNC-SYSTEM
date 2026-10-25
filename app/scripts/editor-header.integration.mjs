import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import * as mupdf from 'mupdf'
import {openOfficeDocument} from './load-office-editor.mjs'

const folder='../tmp/editor-header-check',output='../output/editor-header-check',base='http://127.0.0.1:3100'
await fs.mkdir(output,{recursive:true})
const original=await fs.readFile(folder+'/report-original.docx'),opened=await openOfficeDocument(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength),'docx')
assert.equal(opened.imageRepairs.length,1)
const edited=Buffer.from(await(await opened.save({}, {},[opened.imageRepairs[0].id])).arrayBuffer()),before=await JSZip.loadAsync(original),after=await JSZip.loadAsync(edited)
const changed=[]
for(const name of Object.keys(before.files).filter(name=>!before.files[name].dir))if(!Buffer.from(await before.file(name).async('uint8array')).equals(Buffer.from(await after.file(name).async('uint8array'))))changed.push(name)
assert.deepEqual(changed,['word/document.xml'])
assert.deepEqual(Buffer.from(await(await opened.save({})).arrayBuffer()),original)
await fs.writeFile(folder+'/report-repaired.docx',edited)
const form=new FormData();form.append('file',new File([edited],'report-repaired.docx'))
const response=await fetch(base+'/api/files/preview',{method:'POST',headers:{Origin:base},body:form,signal:AbortSignal.timeout(90000)})
if(!response.ok)throw Error(await response.text())
const pdf=Buffer.from(await response.arrayBuffer());await fs.writeFile(folder+'/word-repaired.pdf',pdf)
const a=mupdf.Document.openDocument(await fs.readFile(folder+'/word-original.pdf'),'application/pdf'),b=mupdf.Document.openDocument(pdf,'application/pdf')
assert.equal(b.countPages(),a.countPages());let changedComponents=0
for(let i=0;i<a.countPages();i++){
  const p=a.loadPage(i),q=b.loadPage(i);assert.deepEqual(p.getBounds(),q.getBounds())
  const x=p.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false),y=q.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false),xp=x.getPixels(),yp=y.getPixels()
  assert.equal(xp.length,yp.length)
  for(let k=0;k<xp.length;k++)if(xp[k]!==yp[k]){const px=Math.floor(k/x.getNumberOfComponents())%x.getWidth()/1.5,py=Math.floor(k/x.getNumberOfComponents()/x.getWidth())/1.5;assert.equal(i,0,'Only the first-page logo changes');assert.ok(px>=159 && px<=454 && py>=10 && py<=86,`Unexpected change at ${px},${py}`);changedComponents++}
  if(i===0){await fs.writeFile(output+'/before.png',x.asPNG());await fs.writeFile(output+'/after.png',y.asPNG())}
  x.destroy();y.destroy();p.destroy();q.destroy()
}
assert.ok(changedComponents>0)
const report={checkedAt:new Date().toISOString(),pages:b.countPages(),pageSizesRetained:true,changedParts:changed,otherPartsByteIdentical:true,noOpByteIdentical:true,onlyFirstPageLogoPixelsChanged:true,unchangedOtherPages:30,changedComponents,originalSourceModified:false}
a.destroy();b.destroy();await fs.writeFile(output+'/logo-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
