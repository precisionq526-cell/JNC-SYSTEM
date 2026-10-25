import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { PDFDocument } from 'pdf-lib'

const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const transpile = async file => ts.transpileModule(await fs.readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const pdfUrl = pathToFileURL(createRequire(import.meta.url).resolve('pdf-lib')).href
const optionsUrl = moduleUrl(await transpile('src/lib/kiosk/print-options.ts'))
const planUrl = moduleUrl((await transpile('src/lib/printing/print-plan.ts')).replace("'@/lib/kiosk/print-options'", JSON.stringify(optionsUrl)))
const ledgerUrl = moduleUrl(await transpile('src/lib/printing/print-ledger.ts'))
const spoolUrl = moduleUrl((await transpile('src/lib/printing/spool-document.ts')).replace("'pdf-lib'", JSON.stringify(pdfUrl)))
const uuidUrl = moduleUrl(await transpile('src/lib/utils/uuid.ts'))
globalThis.printSubmissionTest = {}
const paymentUrl=moduleUrl(await transpile('src/lib/kiosk/payment.ts'));const workflowUrl=moduleUrl((await transpile('src/lib/sop/workflow.ts')).replace("'../kiosk/payment'",JSON.stringify(paymentUrl)))
const dependencies = {
  '@/lib/sop/workflow':workflowUrl,
  'node:child_process': moduleUrl(`export function execFile(executable, args, options, callback) {
    const state = globalThis.printSubmissionTest;
    state.printCalls.push({ executable, args });
    import('node:fs/promises').then(fs => fs.readFile(args.at(-1))).then(bytes => {
      state.spoolBytes.push(bytes); callback(null, '', '');
    }, error => callback(error));
  }`),
  '@/lib/admin/require-admin': moduleUrl(`export async function requireAdmin() { return { ok: true, userId: 'test-admin' }; }`),
  '@/lib/supabase/admin': moduleUrl(`export const supabaseAdmin = { from: () => ({ select(){return this},eq(){return this},async maybeSingle(){return {data:globalThis.printSubmissionTest.payment || {is_paid:false,payment_method:'cash'},error:globalThis.printSubmissionTest.paymentError || null}},upsert: async event => {
    globalThis.printSubmissionTest.auditEvents.push(event); return { error: null };
  } }) };`),
  '@/lib/hardware/windows-printers': moduleUrl(`export async function scanWindowsPrinters() {
    globalThis.printSubmissionTest.scans++;
    return { printers: [{ name: 'Test printer', status: 'idle', supportsDuplex: true, supportsColor: true,
      paperSizes: [{ kind: 9, width: 827, height: 1169 }] }] };
  }`),
  './order-renderer': moduleUrl(`export async function getOrderPrintPdf() {
    globalThis.printSubmissionTest.renders++; return globalThis.printSubmissionTest.rendered;
  }`),
  '@/lib/utils/uuid': uuidUrl,
  '@/lib/kiosk/payment': moduleUrl(await transpile('src/lib/kiosk/payment.ts')),
  './print-plan': planUrl,
  './print-ledger': ledgerUrl,
  './spool-document': spoolUrl,
  'pdf-lib': pdfUrl,
}
let source = (await transpile('src/lib/printing/send-to-printer.ts')).replace("import 'server-only';", '')
for (const [name, replacement] of Object.entries(dependencies)) source = source.replace("'" + name + "'", JSON.stringify(replacement))
const { sendOrderToPrinter } = await import(moduleUrl(source))

async function fixture(t) {
  const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'kiosk-print-submission-test-'))
  const priorRuntime = process.env.KIOSK_RUNTIME_PATH, priorExecutable = process.env.SUMATRA_PDF_PATH
  process.env.KIOSK_RUNTIME_PATH = runtime
  process.env.SUMATRA_PDF_PATH = path.join(runtime, 'test-engine')
  await fs.writeFile(process.env.SUMATRA_PDF_PATH, 'Test only; never executed')
  t.after(async () => {
    if (priorRuntime === undefined) delete process.env.KIOSK_RUNTIME_PATH; else process.env.KIOSK_RUNTIME_PATH = priorRuntime
    if (priorExecutable === undefined) delete process.env.SUMATRA_PDF_PATH; else process.env.SUMATRA_PDF_PATH = priorExecutable
    await fs.rm(runtime, { recursive: true, force: true })
  })
  const pdf = await PDFDocument.create()
  pdf.addPage([595.28, 841.89]); pdf.addPage([595.28, 841.89])
  const request = { requestId: randomUUID(), orderId: randomUUID(), fileId: randomUUID(), printerName: 'Test printer', side: 'all', manualCopy: 1, reverseBacks: true }
  const state = globalThis.printSubmissionTest = { printCalls: [], spoolBytes: [], auditEvents: [], scans: 0, renders: 0,
    rendered: { pdf: Buffer.from(await pdf.save()), order: { order_number: 'TEST', service_options: { Copies: 1 } }, file: { file_name: 'test.pdf' }, source: 'test' } }
  return { runtime, request, state }
}

test('one-copy submissions across new browser IDs call the print engine and record history once', async t => {
  const { request, state } = await fixture(t)
  const receipt = await sendOrderToPrinter(request)
  for (let attempt = 0; attempt < 3; attempt++) assert.deepEqual(await sendOrderToPrinter({ ...request, requestId: randomUUID() }), receipt)
  assert.equal(state.printCalls.length, 1); assert.equal(state.auditEvents.length, 1)
  assert.equal(state.scans, 1); assert.equal(state.renders, 1)
  assert.equal((await PDFDocument.load(state.spoolBytes[0])).getPageCount(), 2)
  assert.match(state.printCalls[0].args[state.printCalls[0].args.indexOf('-print-settings') + 1], /,1x$/)
  assert.equal(receipt.copies, 1)
})

test('existing receipts protect an already-printed order before accessing the print engine', async t => {
  const { runtime, request, state } = await fixture(t)
  const folder = path.join(runtime, 'print-receipts')
  await fs.mkdir(folder)
  const fingerprint = createHash('sha256').update(JSON.stringify([request.orderId, request.fileId, request.printerName, request.side, request.manualCopy, request.reverseBacks])).digest('hex')
  const receipt = { ...request, copies: 1, pages: [1, 2] }
  await fs.writeFile(path.join(folder, request.requestId + '.json'), JSON.stringify({ fingerprint, status: 'submitted', receipt }))
  assert.deepEqual(await sendOrderToPrinter({ ...request, requestId: randomUUID() }), receipt)
  assert.equal(state.printCalls.length, 0); assert.equal(state.auditEvents.length, 0)
  assert.equal(state.scans, 0); assert.equal(state.renders, 0)
})

test('a deliberate reprint is sent once even when two tabs request it together', async t => {
  const { request, state } = await fixture(t)
  const original = await sendOrderToPrinter(request)
  const results = await Promise.allSettled([1, 2].map(() => sendOrderToPrinter({ ...request, requestId: randomUUID(), reprintOf: original.requestId })))
  const successful = results.filter(result => result.status === 'fulfilled')
  assert.ok(successful.length >= 1)
  const reprint = successful[0].value
  assert.deepEqual(await sendOrderToPrinter({ ...request, requestId: randomUUID(), reprintOf: original.requestId }), reprint)
  assert.equal(state.printCalls.length, 2); assert.equal(state.auditEvents.length, 2)
})

test('unverified online payments cannot reach printer discovery, rendering or the spooler',async t=>{
  const {request,state}=await fixture(t)
  state.payment={is_paid:false,payment_method:'gcash'}
  await assert.rejects(()=>sendOrderToPrinter(request),/Waiting for payment confirmation/)
  assert.equal(state.scans,0);assert.equal(state.renders,0);assert.equal(state.printCalls.length,0)
  state.payment={is_paid:true,payment_method:'gcash'}
  await sendOrderToPrinter(request)
  assert.equal(state.printCalls.length,1)
})

test('an unavailable payment record stops a new physical print',async t=>{
  const {request,state}=await fixture(t);state.paymentError={message:'Database unavailable'}
  await assert.rejects(()=>sendOrderToPrinter(request),/Could not verify/)
  assert.equal(state.printCalls.length,0);assert.equal(state.scans,0)
})
