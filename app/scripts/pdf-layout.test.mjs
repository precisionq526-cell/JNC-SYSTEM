import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
import {PDFDocument, StandardFonts, rgb, degrees} from 'pdf-lib'
import * as mupdf from 'mupdf'
const req=createRequire(import.meta.url)
const source=await fs.readFile('src/lib/editor/pdf-layout-server.ts','utf8')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'mupdf'",JSON.stringify(pathToFileURL(req.resolve('mupdf')).href))
const {inspectPdfLayout,savePdfLayoutEdits}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
async function fixture(){
  const pdf=await PDFDocument.create();pdf.setTitle('Tables remain intact')
  const font=await pdf.embedFont(StandardFonts.Helvetica)
  const page=pdf.addPage([612,792]);page.drawRectangle({x:45,y:450,width:520,height:80,color:rgb(.9,.94,1),borderColor:rgb(0,0,0),borderWidth:1})
  page.drawLine({start:{x:320,y:450},end:{x:320,y:530},thickness:1});page.drawLine({start:{x:45,y:490},end:{x:565,y:490},thickness:1})
  page.drawText('Original table value',{x:55,y:505,size:12,font});page.drawText('Neighbor stays',{x:330,y:505,size:12,font});page.drawText('Next row stays',{x:55,y:465,size:12,font})
  pdf.addPage([420,595]).drawText('Untouched second page',{x:50,y:500,size:14,font})
  const rotated=pdf.addPage([400,600]);rotated.setRotation(degrees(90));rotated.drawText('Rotated page remains',{x:30,y:500,size:12,font})
  return new Uint8Array(await pdf.save())
}
function pixels(bytes,index){const pdf=mupdf.Document.openDocument(bytes,'application/pdf');const page=pdf.loadPage(index);const pix=page.toPixmap(mupdf.Matrix.scale(2,2),mupdf.ColorSpace.DeviceRGB,false);const result={pixels:pix.getPixels().slice(),width:pix.getWidth(),height:pix.getHeight(),channels:pix.getNumberOfComponents()};pix.destroy();page.destroy();pdf.destroy();return result}
function text(bytes,index){const pdf=mupdf.Document.openDocument(bytes,'application/pdf');const page=pdf.loadPage(index),txt=page.toStructuredText('');const result=txt.asText();txt.destroy();page.destroy();pdf.destroy();return result}

test('PDF no-op returns the exact original file bytes',async()=>{const bytes=await fixture();assert.deepEqual(await savePdfLayoutEdits(bytes,[]),bytes)})
test('editing a table value preserves every pixel outside that text region, other pages, and page rotations',async()=>{
  const bytes=await fixture(),layout=inspectPdfLayout(bytes),span=layout.pages[0].spans.find(s=>s.text==='Original table value');assert.ok(span);assert.ok(span.maxWidth<270)
  const saved=await savePdfLayoutEdits(bytes,[{id:span.id,text:'Edited table value'}])
  assert.match(text(saved,0),/Edited table value/);assert.doesNotMatch(text(saved,0),/Original table value/);assert.match(text(saved,0),/Neighbor stays/);assert.match(text(saved,0),/Next row stays/)
  const a=pixels(bytes,0),b=pixels(saved,0);let changed=0
  for(let i=0;i<a.pixels.length;i++)if(a.pixels[i]!==b.pixels[i]){const x=Math.floor(i/a.channels)%a.width,y=Math.floor(i/(a.width*a.channels));assert.ok(x>=(span.x-2)*2&&x<(span.x+span.maxWidth+2)*2&&y>=(span.y-2)*2&&y<(span.y+span.height+2)*2,`Unexpected pixel change at ${x},${y}`);changed++}
  assert.ok(changed>0);for(const i of [1,2])assert.deepEqual(pixels(saved,i).pixels,pixels(bytes,i).pixels)
  const before=await PDFDocument.load(bytes),after=await PDFDocument.load(saved);assert.equal(after.getTitle(),before.getTitle());assert.deepEqual(after.getPages().map(p=>[p.getSize(),p.getRotation().angle]),before.getPages().map(p=>[p.getSize(),p.getRotation().angle]))
})
test('PDF rejects overflow, duplicate edits, multiline text and unsupported glyphs instead of breaking the page',async()=>{
 const bytes=await fixture(),span=inspectPdfLayout(bytes).pages[0].spans.find(s=>s.text==='Original table value')
 for(const edits of [[{id:span.id,text:'Too long '.repeat(100)}],[{id:span.id,text:'line\nbreak'}],[{id:span.id,text:'one'},{id:span.id,text:'two'}],[{id:'999:1',text:'bad'}],[{id:span.id,text:'你好'}]])await assert.rejects(()=>savePdfLayoutEdits(bytes,edits))
})
test('PDF cell fills and ruling lines survive text removal and repeated edits',async()=>{
 const bytes=await fixture(),span=inspectPdfLayout(bytes).pages[0].spans.find(s=>s.text==='Original table value')
 const blank=await savePdfLayoutEdits(bytes,[{id:span.id,text:''}]);assert.doesNotMatch(text(blank,0),/Original table value/);assert.match(text(blank,0),/Neighbor stays/)
 const first=await savePdfLayoutEdits(bytes,[{id:span.id,text:'First edit'}]),next=inspectPdfLayout(first).pages[0].spans.find(s=>s.text.trim()==='First edit')
 assert.ok(next,JSON.stringify(inspectPdfLayout(first).pages[0].spans.map(s=>s.text))); const second=await savePdfLayoutEdits(first,[{id:next.id,text:'Second edit'}]);assert.match(text(second,0),/Second edit/);assert.doesNotMatch(text(second,0),/First edit/)
})


