import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib'
import sharp from 'sharp'
import * as mupdf from 'mupdf'
import QRCode from 'qrcode'
import decodeQr from 'jsqr'
const req=createRequire(import.meta.url),modules=new Map()
const priorRuntime=process.env.KIOSK_RUNTIME_PATH
await fs.mkdir('../output/sop-verification',{recursive:true})
process.env.KIOSK_RUNTIME_PATH=await fs.mkdtemp(path.resolve('../output/sop-verification/runtime-'))
after(()=>{globalThis.sopDatabase?.close();delete globalThis.sopDatabase;if(priorRuntime===undefined)delete process.env.KIOSK_RUNTIME_PATH;else process.env.KIOSK_RUNTIME_PATH=priorRuntime})
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const overrides=new Map([
  [path.resolve('src/lib/editor/office-preview-server.ts'),url('export async function exportOfficePreview(){throw Error("Office is tested by the native integration suite")}')],
  [path.resolve('src/lib/supabase/admin.ts'),url('export const supabaseAdmin=globalThis.__sopCloud')],
])
async function moduleUrl(file){
  const resolved=path.resolve(file);if(overrides.has(resolved))return overrides.get(resolved)
  if(modules.has(resolved))return modules.get(resolved)
  let code=ts.transpileModule(await fs.readFile(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/import ['"]server-only['"];?/g,'')
  const matches=[...code.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)]
  for(const match of matches){const spec=match[2];if(spec.startsWith('node:'))continue;let replacement
    if(spec.startsWith('@/')||spec.startsWith('.')){let target=spec.startsWith('@/')?path.resolve('src',spec.slice(2)):path.resolve(path.dirname(resolved),spec);if(!path.extname(target))target+='.ts';replacement=await moduleUrl(target)}
    else replacement=pathToFileURL(req.resolve(spec)).href
    code=code.replaceAll(match[1]+spec+match[1],JSON.stringify(replacement))
  }
  const result=url(code);modules.set(resolved,result);return result
}
async function load(file){return import(await moduleUrl(file))}
const {quotePages,SOP_PRICING}=await load('src/lib/sop/pricing.ts')
const {intakeAvailability,DEFAULT_SHOP_POLICY,canExpireUnpaid,shopHoursLabel,policyClock}=await load('src/lib/sop/policy.ts')
const {ticketIsHeld}=await load('src/lib/sop/workflow.ts')
const {remainingSpoolPages}=await load('src/lib/printing/reroute-plan.ts')
const {prepareFilePdf}=await load('src/lib/printing/file-pdf.ts')
const {analyzePrintFiles,filesFingerprint}=await load('src/lib/sop/page-analysis.ts')
const options={'Paper Size':'A4',Copies:2,'Pages to print':'All','Print Color':'Color'}
async function fixture(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([612,792]).drawText('Complete header and original table',{x:35,y:740,font,size:14})
  const second=pdf.addPage([612,792]);second.drawRectangle({x:25,y:700,width:500,height:10,color:rgb(1,0,0)});second.drawText('Colored accents',{x:35,y:680,font,size:12})
  const png=await sharp({create:{width:80,height:80,channels:3,background:'#dc201f'}}).png().toBuffer(),image=await pdf.embedPng(png)
  pdf.addPage([612,792]).drawImage(image,{x:40,y:60,width:530,height:660})
  return Buffer.from(await pdf.save())}
const bytes=await fixture(),file=new File([bytes],'pricing.pdf',{type:'application/pdf'})
test('actual pages distinguish black text, colored accents and color images',async()=>{
  const a=await analyzePrintFiles([file],options);assert.deepEqual(a.pages.map(p=>p.category),['bw','accents','images']);assert.ok(a.pages[2].imageCoverage>.5);assert.ok(a.pages[0].textCoverage>0)
  const q=quotePages(a.pages,options,false);assert.equal(q.total,38);assert.equal(q.pages.length,3)
})
test('page ranges and grayscale affect the actual quote, not just the preview',async()=>{
  const a=await analyzePrintFiles([file],{...options,'Pages to print':'2-3','Print Color':'B&W'});assert.deepEqual(a.pages.map(p=>[p.page,p.category]),[[2,'bw'],[3,'bw']]);assert.equal(quotePages(a.pages,options,false).total,12)
})
test('student coverage thresholds, paper rates, copies and finishing match the SOP',()=>{
  const pages=[{fileIndex:0,page:1,category:'bw',textCoverage:.4999,imageCoverage:0},{fileIndex:0,page:2,category:'accents',textCoverage:.5,imageCoverage:0},{fileIndex:0,page:3,category:'images',textCoverage:0,imageCoverage:.4999},{fileIndex:0,page:4,category:'images',textCoverage:0,imageCoverage:.5}]
  const q=quotePages(pages,{...options,'Paper Size':'Legal',Finishing:'Stapling'},true,{...SOP_PRICING,finishing:{Stapling:7}})
  assert.deepEqual(q.pages.map(p=>p.discount),[1,.5,2,1]);assert.equal(q.total,(4+5+15+15)*2-4.5*2+7)
  assert.throws(()=>quotePages(pages,{...options,Finishing:'Unpriced'},false),/not been priced/)
  assert.throws(()=>quotePages(pages,{...options,Finishing:'Stapling,Stapling'},false,{...SOP_PRICING,finishing:{Stapling:7}}),/once/)
})
test('quote fingerprints reject changed bytes, options or student eligibility',()=>{const files=[{name:'a.pdf',hash:'one'}],a=filesFingerprint(files,options,false);assert.equal(a,filesFingerprint(files,Object.fromEntries(Object.entries(options).reverse()),false));assert.notEqual(a,filesFingerprint([{name:'a.pdf',hash:'two'}],options,false));assert.notEqual(a,filesFingerprint(files,{...options,Copies:3},false));assert.notEqual(a,filesFingerprint(files,options,true))})
test('intake observes Manila hours, working days and independent closed/offline flags',()=>{
  assert.equal(intakeAvailability(DEFAULT_SHOP_POLICY,new Date('2026-10-26T00:00:00Z')).accepting,true)
  assert.equal(intakeAvailability(DEFAULT_SHOP_POLICY,new Date('2026-10-26T10:00:00Z')).accepting,false)
  assert.equal(intakeAvailability(DEFAULT_SHOP_POLICY,new Date('2026-10-25T01:00:00Z')).accepting,false)
  assert.equal(intakeAvailability({...DEFAULT_SHOP_POLICY,intakeState:'closed',enforceHours:false}).accepting,false)
})

test('displayed hours and time input limits follow saved policy rather than fixed mockup hours',()=>{
  const policy={...DEFAULT_SHOP_POLICY,workingDays:[2,4,6],openingMinute:570,closingMinute:1140}
  assert.equal(shopHoursLabel(policy),'Tue, Thu, Sat, 9:30 AM–7:00 PM (Manila)')
  assert.equal(policyClock(policy.openingMinute),'09:30');assert.equal(policyClock(policy.closingMinute),'19:00')
})
test('submitted receipts are never expired while waiting for a person to verify them',()=>{
  const order={is_paid:false,status:'pending',payment_expires_at:'2000-01-01',customer_notes:'JNC_PAYMENT_V1:'+JSON.stringify({receiptPath:'x/payment/receipt'})};assert.equal(canExpireUnpaid(order),false);assert.equal(canExpireUnpaid({...order,customer_notes:''}),true)
})
test('scheduled cash and unverified student requests cannot enter production',()=>{
  assert.equal(ticketIsHeld({is_paid:false,payment_method:'cash',service_options:{'Transaction Type':'schedule'}}),true)
  assert.equal(ticketIsHeld({is_paid:false,payment_method:'cash',service_options:{'Transaction Type':'walk-in'}}),false)
  assert.equal(ticketIsHeld({is_paid:true,payment_method:'gcash',student_status:'pending'}),true)
})
test('remaining-side recovery rejects completed jobs and partial duplex sheets',()=>{assert.deepEqual(remainingSpoolPages(8,4,true),[5,6,7,8]);assert.deepEqual(remainingSpoolPages(5,1,false),[2,3,4,5]);assert.throws(()=>remainingSpoolPages(8,3,true),/even/);assert.throws(()=>remainingSpoolPages(4,4,false),/remain/)})
test('zero margins preserve the exact source bytes',async()=>assert.deepEqual(await prepareFilePdf(bytes,'source.pdf','application/pdf',{'Paper Size':'A4'}),bytes))

test('snapshot retention preserves originals, active jobs and uncertain print runs',async()=>{
  const {prunePrintSnapshots}=await load('src/lib/sop/print-retention.ts'),root=process.env.KIOSK_RUNTIME_PATH,folder=path.join(root,'print-receipts','snapshots')
  await fs.mkdir(folder,{recursive:true})
  const order=randomUUID(),closed=randomUUID(),active=randomUUID(),uncertain=randomUUID(),recent=randomUUID(),old=new Date(Date.now()-31*86400000)
  for(const [id,orderId,status]of [[closed,order,'submitted'],[active,randomUUID(),'submitted'],[uncertain,order,'uncertain'],[recent,order,'submitted']]){
    const file=path.join(folder,id+'.pdf');await fs.writeFile(file,bytes);if(id!==recent)await fs.utimes(file,old,old)
    await fs.writeFile(path.join(root,'print-receipts',id+'.json'),JSON.stringify({status,receipt:{orderId}}))
  }
  await fs.writeFile(path.join(folder,'customer-original.pdf'),bytes)
  assert.equal(await prunePrintSnapshots(root,new Set([order])),1)
  for(const id of [active,uncertain,recent])await fs.access(path.join(folder,id+'.pdf'))
  await fs.access(path.join(folder,'customer-original.pdf'))
})
test('derived margins preserve headers and all rotated pages within the sheet',async()=>{
  const original=await PDFDocument.load(bytes);for(const angle of [90,180,270]){const page=original.addPage([400,600]);page.setRotation(degrees(angle));page.drawText('Rotated complete header',{x:25,y:550,font:await original.embedFont(StandardFonts.Helvetica),size:15})}
  const source=Buffer.from(await original.save()),saved=await prepareFilePdf(source,'headers.pdf','application/pdf',{'Paper Size':'Legal','Print margin (mm)':12})
  const doc=mupdf.Document.openDocument(saved,'application/pdf');assert.equal(doc.countPages(),6)
  for(let i=0;i<doc.countPages();i++){const page=doc.loadPage(i),bounds=page.getBounds(),text=page.toStructuredText('preserve-images'),blocks=JSON.parse(text.asJSON()).blocks;for(const b of blocks){assert.ok(b.bbox.x>=32&&b.bbox.y>=32,JSON.stringify(b.bbox));assert.ok(b.bbox.x+b.bbox.w<=bounds[2]-32);assert.ok(b.bbox.y+b.bbox.h<=bounds[3]-32)}if(i>=3)assert.match(text.asText(),/Rotated complete header/);text.destroy();page.destroy()};doc.destroy()
})
test('signed pickup QR decodes and rejects a forged signature or another order',async()=>{
  const {pickupToken,readPickupToken}=await load('src/lib/sop/pickup-token.ts'),id=randomUUID(),token=pickupToken(id)
  assert.equal(readPickupToken('JNC:'+token),id);assert.equal(readPickupToken(token.slice(0,-3)+'abc'),null);assert.equal(readPickupToken(randomUUID()+'.'+token.split('.')[1]),null)
  const png=await QRCode.toBuffer('JNC:'+token,{width:350,margin:2}),raw=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const decoded=decodeQr(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height)
  assert.equal(readPickupToken(decoded.data),id)
})
test('offline files survive a retry and reconnect sync commits once without a physical print',async()=>{
  const service={id:randomUUID(),slug:'printing',name:'Fixture printing',is_active:true,base_price:3,estimated_duration_minutes:5}
  const policy={...DEFAULT_SHOP_POLICY,enforceHours:false},cloud={online:false,failCommit:true,orders:new Map(),files:new Map(),commits:0,expiryCalls:0}
  globalThis.__sopCloud={
    from(table){let filters={},update=null;const query={select(){return query},eq(key,value){filters[key]=value;return query},order(){return query},limit(){return query},abortSignal(){return query},update(value){update=value;return query},async single(){return query.maybeSingle()},async maybeSingle(){if(!cloud.online)return {data:null,error:{message:'Network unavailable'}};let row=table==='sop_settings'?{policy,pricing:SOP_PRICING}:table==='queue_settings'?{active_servers:1,atc_lookahead:2,page_penalty:0,max_wait_minutes:60}:table==='orders'?cloud.orders.get(filters.id):null;return {data:row,error:row?null:{message:'Not found'}}},then(resolve,reject){return(async()=>{if(!cloud.online)return {data:null,error:{message:'Network unavailable'}};if(table==='order_files'&&update){for(const order of cloud.orders.values())for(const f of order.order_files)if(f.order_id===filters.order_id&&f.storage_path===filters.storage_path)Object.assign(f,update)}const data=table==='services'?[service]:table==='service_options'?[]:table==='orders'?[...cloud.orders.values()]:[];return {data,error:null}})().then(resolve,reject)}};return query},
    storage:{from(){return {async upload(key,bytes){if(cloud.files.has(key))return {error:{message:'Already exists'}};cloud.files.set(key,Buffer.from(bytes));return {error:null}},async info(key){return cloud.files.has(key)?{data:{size:cloud.files.get(key).length},error:null}:{data:null,error:{message:'Missing'}}}}}},
    rpc(name,args){const query={abortSignal(){return query},then(resolve,reject){return(async()=>{
      if(!cloud.online)return {error:{message:'Network unavailable'}}
      if(name==='kiosk_data_contract_version')return {data:3,error:null}
      if(name==='expire_unpaid_requests'){cloud.expiryCalls++;return {data:0,error:null}}
      assert.equal(name,'commit_order_submission');cloud.commits++
      if(!cloud.orders.has(args.p_order_id))cloud.orders.set(args.p_order_id,{id:args.p_order_id,order_number:'ORD-20261025-001',offline_ticket_number:args.p_meta.offlineTicketNumber,service_id:service.id,source:args.p_meta.source,customer_notes:args.p_meta.customerNotes,student_proof:args.p_meta.studentProof,pricing_quote:args.p_meta.pricingQuote,total_price:args.p_meta.pricingQuote.total,service_options:args.p_meta.serviceOptions,created_at:args.p_meta.offlineSubmittedAt,updated_at:new Date().toISOString(),status:'pending',services:{name:service.name,slug:'printing'},queue_entries:[{queue_number:1}],order_files:args.p_files.map(f=>({...f,id:randomUUID(),order_id:args.p_order_id}))})
      if(cloud.failCommit){cloud.failCommit=false;return {error:{message:'Response lost after commit'}}}return {data:{orderId:args.p_order_id},error:null}
    })().then(resolve,reject)}};return query},
  }
  const {cacheValue,localDatabase}=await load('src/lib/sop/local-store.ts')
  cacheValue('sop-contract',3);cacheValue('sop-settings',{policy,pricing:SOP_PRICING,configured:true,offline:false});cacheValue('catalog:printing',{service,options:[]})
  const selected={'Paper Size':'A4',Copies:1,'Pages to print':'All','Print Color':'B&W'},analysis=await analyzePrintFiles([file],selected),quote={version:1,id:randomUUID(),fingerprint:filesFingerprint(analysis.hashes,selected,false),expiresAt:new Date(Date.now()+1800000).toISOString(),...quotePages(analysis.pages,selected,false)},id=randomUUID()
  localDatabase().prepare('INSERT INTO quotes VALUES(?,?,?)').run(quote.id,JSON.stringify({quote,hashes:analysis.hashes,options:selected}),quote.expiresAt)
  const meta={submissionKey:id,quoteId:quote.id,source:'online',serviceId:service.id,serviceSlug:'printing',serviceOptions:{...selected,'Transaction Type':'walk-in'},payment:{method:'cash'},totalPrice:0},form=new FormData();form.append('files',file)
  const {bufferSubmission,readBufferedOrder}=await load('src/lib/sop/offline-buffer.ts'),local=await bufferSubmission(form,meta),retry=await bufferSubmission(form,meta)
  assert.equal(local.order_number,retry.order_number);assert.equal(local.total_price,9);assert.deepEqual(await fs.readFile(local.order_files[0].local_path),bytes)
  const {runSopMaintenance}=await load('src/lib/sop/maintenance.ts');cloud.online=true
  await runSopMaintenance();assert.equal(cloud.orders.size,1);assert.match(readBufferedOrder(id).offlineError,/Response lost/)
  await runSopMaintenance();assert.equal(cloud.orders.size,1);assert.equal(cloud.files.size,1);assert.equal(cloud.commits,2);assert.equal(localDatabase().prepare('SELECT pending FROM local_orders WHERE id=?').get(id).pending,0)
  assert.equal(readBufferedOrder(id).order_number,local.order_number);assert.ok(cloud.expiryCalls>=1)
  const previousAccount={name:process.env.PAYMENT_GCASH_NAME,number:process.env.PAYMENT_GCASH_NUMBER}
  try{
    process.env.PAYMENT_GCASH_NAME='Isolated fixture';process.env.PAYMENT_GCASH_NUMBER='09123456789';cloud.online=false
    const walletId=randomUUID(),studentQuote={...quote,id:randomUUID(),fingerprint:filesFingerprint(analysis.hashes,selected,true),...quotePages(analysis.pages,selected,true)}
    localDatabase().prepare('INSERT INTO quotes VALUES(?,?,?)').run(studentQuote.id,JSON.stringify({quote:studentQuote,hashes:analysis.hashes,options:selected}),studentQuote.expiresAt)
    const image=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer(),walletForm=new FormData();walletForm.append('files',file);walletForm.append('paymentReceipt',new File([image],'receipt.png',{type:'image/png'}));walletForm.append('studentProof',new File([image],'student.png',{type:'image/png'}))
    const wallet=await bufferSubmission(walletForm,{...meta,submissionKey:walletId,quoteId:studentQuote.id,payment:{method:'gcash',reference:'FIXTURE123456'}})
    const {readPaymentNotes}=await load('src/lib/kiosk/payment.ts'),record=readPaymentNotes(wallet.customer_notes)
    assert.equal(record.method,'gcash');assert.match(record.receiptPath,/\/payment\/[a-f0-9]{64}\.png$/);assert.equal(ticketIsHeld(wallet),true)
    assert.ok(wallet.proofHashes.payment);assert.ok(wallet.proofHashes.student)
    cloud.online=true;await runSopMaintenance()
    assert.equal(cloud.orders.size,2);assert.equal(cloud.files.size,4);assert.equal(readPaymentNotes(cloud.orders.get(walletId).customer_notes).receiptPath,record.receiptPath)
    assert.deepEqual(cloud.files.get(record.receiptPath),image);assert.deepEqual(cloud.files.get(wallet.student_proof.path),image)
  }finally{
    if(previousAccount.name===undefined)delete process.env.PAYMENT_GCASH_NAME;else process.env.PAYMENT_GCASH_NAME=previousAccount.name
    if(previousAccount.number===undefined)delete process.env.PAYMENT_GCASH_NUMBER;else process.env.PAYMENT_GCASH_NUMBER=previousAccount.number
  }
})
