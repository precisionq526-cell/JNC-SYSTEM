import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
import {PDFDocument} from 'pdf-lib'
const req=createRequire(import.meta.url),url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'),transpile=async file=>ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const payment=url(await transpile('src/lib/kiosk/payment.ts')),workflow=url((await transpile('src/lib/sop/workflow.ts')).replace("'../kiosk/payment'",JSON.stringify(payment))),options=url(await transpile('src/lib/kiosk/print-options.ts'))
const dependencies={
  'node:child_process':url(`export function execFile(executable,args,options,callback){const s=globalThis.rerouteFixture;s.calls.push({executable,args});if(executable==='powershell.exe')return callback(s.failCancel?new Error('Original job was not confirmed cancelled'):null,'','');import('node:fs/promises').then(fs=>fs.readFile(args.at(-1))).then(bytes=>{s.printed.push(bytes);callback(null,'','')},callback)}`),
  '@/lib/admin/require-admin':url(`export async function requireAdmin(){return {ok:true,userId:'fixture-admin'}}`),
  '@/lib/supabase/admin':url(`export const supabaseAdmin={from(table){const q={select(){return q},eq(){return q},async single(){return {data:table==='audit_log'?{metadata:globalThis.rerouteFixture.metadata}:globalThis.rerouteFixture.order,error:null}},async upsert(event){globalThis.rerouteFixture.audits.push(event);return {error:null}}};return q}}`),
  '@/lib/hardware/windows-printers':url(`export async function scanWindowsPrinters(){return {printers:[{name:'Replacement',status:'idle',supportsDuplex:true,supportsColor:true,paperSizes:[{kind:9,width:827,height:1169}]}]}}`),
  '@/lib/sop/local-store':url(`export function runtimePath(){return process.env.KIOSK_RUNTIME_PATH}`),
  '@/lib/sop/workflow':workflow,
  '@/lib/utils/uuid':url(await transpile('src/lib/utils/uuid.ts')),
  '@/lib/printing/reroute-plan':url(await transpile('src/lib/printing/reroute-plan.ts')),
  '@/lib/printing/print-plan':url((await transpile('src/lib/printing/print-plan.ts')).replace("'@/lib/kiosk/print-options'",JSON.stringify(options))),
  '@/lib/printing/print-ledger':url(await transpile('src/lib/printing/print-ledger.ts')),
  'pdf-lib':pathToFileURL(req.resolve('pdf-lib')).href,
}
let code=(await transpile('src/lib/actions/reroute-print.ts')).replace(/['"]use server['"];?/,'')
for(const [name,target]of Object.entries(dependencies))code=code.replace("'"+name+"'",JSON.stringify(target))
const {reroutePrintAction}=await import(url(code))
async function fixture(t){
  const root=path.resolve('../output/sop-verification'),folder=path.join(root,'reroute-'+randomUUID());await fs.mkdir(path.join(folder,'print-receipts','snapshots'),{recursive:true})
  const prior=process.env.KIOSK_RUNTIME_PATH,executable=process.env.SUMATRA_PDF_PATH;process.env.KIOSK_RUNTIME_PATH=folder;process.env.SUMATRA_PDF_PATH=path.join(folder,'mock-print-engine');await fs.writeFile(process.env.SUMATRA_PDF_PATH,'Never executed: mocked execFile')
  t.after(()=>{if(prior===undefined)delete process.env.KIOSK_RUNTIME_PATH;else process.env.KIOSK_RUNTIME_PATH=prior;if(executable===undefined)delete process.env.SUMATRA_PDF_PATH;else process.env.SUMATRA_PDF_PATH=executable})
  const source=randomUUID(),order=randomUUID(),pdf=await PDFDocument.create();for(let i=0;i<6;i++)pdf.addPage([612,792]);const bytes=Buffer.from(await pdf.save());await fs.writeFile(path.join(folder,'print-receipts','snapshots',source+'.pdf'),bytes)
  globalThis.rerouteFixture={calls:[],printed:[],audits:[],order:{id:order,status:'processing',is_paid:false,payment_method:'cash',service_options:{}},metadata:{orderId:order,fileId:randomUUID(),printerName:'Original',paper:'A4',spoolDuplex:true,monochrome:true,spoolSnapshotName:source+'.pdf',spoolSha256:createHash('sha256').update(bytes).digest('hex')}}
  return {requestId:randomUUID(),sourceRequestId:source,orderId:order,targetPrinter:'Replacement',jobId:17,printedSides:2,confirmed:true}
}
test('re-route cancels only the identified source before sending remaining sides and deduplicates retries',async t=>{
  const input=await fixture(t),result=await reroutePrintAction(input),s=globalThis.rerouteFixture
  assert.equal(result.ok,true);assert.equal(s.calls.length,2);assert.equal(s.calls[0].executable,'powershell.exe');assert.ok(s.calls[0].args.includes(input.sourceRequestId));assert.ok(s.calls[0].args.includes('17'))
  assert.deepEqual(result.receipt.pages,[3,4,5,6]);assert.equal((await PDFDocument.load(s.printed[0])).getPageCount(),4)
  assert.equal((await reroutePrintAction(input)).ok,true);assert.equal((await reroutePrintAction({...input,requestId:randomUUID()})).ok,true);assert.equal(s.calls.length,2)
})
test('an odd duplex boundary is rejected before any Windows action',async t=>{const input=await fixture(t),result=await reroutePrintAction({...input,printedSides:3});assert.equal(result.ok,false);assert.match(result.error,/even/);assert.equal(globalThis.rerouteFixture.calls.length,0)})
test('failed source cancellation never submits to the replacement printer',async t=>{const input=await fixture(t);globalThis.rerouteFixture.failCancel=true;const result=await reroutePrintAction(input);assert.equal(result.ok,false);assert.equal(globalThis.rerouteFixture.calls.length,1);assert.equal(globalThis.rerouteFixture.printed.length,0);const retry=await reroutePrintAction(input);assert.equal(retry.ok,false);assert.equal(globalThis.rerouteFixture.calls.length,1)})
