import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scanWindowsPrinters } from '@/lib/hardware/windows-printers'
import { isUuid } from '@/lib/utils/uuid'
import { getOrderPrintPdf } from './order-renderer'
import { buildPrintPlan, printerPaperKind, type PrintSide } from './print-plan'
import { readPrintReceipt, readPrintRunReceipt, submitPrintOnce } from './print-ledger'
import { prepareSpoolDocument } from './spool-document'
import { ticketIsHeld,orderHoldReason } from '@/lib/sop/workflow'

interface PrintRequest { requestId: string; orderId: string; fileId: string; printerName: string; side?: PrintSide; manualCopy?: number; reverseBacks?: boolean; reprintOf?: string }
export interface PrintReceipt { requestId: string; orderId: string; fileId: string; printerName: string; pages: number[]; copies: number; paper: string; side: PrintSide; manualCopy: number; submittedAt: string; warning: string | null }
export async function sendOrderToPrinter(input: PrintRequest): Promise<PrintReceipt> {
  const auth = await requireAdmin()
  if (!auth.ok) throw new Error(auth.error)
  if (!input || !isUuid(input.requestId) || !isUuid(input.orderId) || !isUuid(input.fileId)
    || typeof input.printerName !== 'string' || input.printerName.length > 256
    || !['all', 'front', 'back'].includes(input.side ?? 'all')
    || (input.reverseBacks !== undefined && typeof input.reverseBacks !== 'boolean')
    || (input.reprintOf !== undefined && !isUuid(input.reprintOf))) throw new Error('Invalid print request.')
  const folder = path.join(process.env.KIOSK_RUNTIME_PATH || path.join(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles', '.runtime'), 'print-receipts')
  const fingerprint = createHash('sha256').update(JSON.stringify([input.orderId, input.fileId, input.printerName, input.side ?? 'all', input.manualCopy ?? 1, input.reverseBacks ?? true])).digest('hex')
  const cached = await readPrintReceipt<PrintReceipt>(folder, input.requestId, fingerprint)
  if (cached) return cached
  const previousRun = await readPrintRunReceipt<PrintReceipt>(folder, fingerprint, input.reprintOf)
  if (previousRun) return previousRun
  const payment=await supabaseAdmin.from('orders').select('*').eq('id',input.orderId).maybeSingle()
  if(payment.error || !payment.data)throw new Error('Could not verify the order payment. Printing was stopped.')
  if(ticketIsHeld(payment.data))throw new Error(orderHoldReason(payment.data)!)
  if(['cancelled','failed','collected','finishing'].includes(payment.data.status))throw new Error('This order is not in a printable stage.')
  const snapshot = await scanWindowsPrinters()
  const printer = snapshot.printers.find(printer => printer.name === input.printerName)
  if (!printer || ['offline', 'paused', 'error', 'attention'].includes(printer.status)) throw new Error('Select an available installed physical printer. Resolve paper or printer errors first.')
  const rendered = await getOrderPrintPdf(input.orderId, input.fileId)
  const document = await PDFDocument.load(rendered.pdf)
  const plan = buildPrintPlan(rendered.order.service_options, document.getPageCount(), printer.supportsDuplex, input.side, input.manualCopy, input.reverseBacks)
  const paperKind = printerPaperKind(plan.paper, printer.paperSizes ?? [])
  const settings = ['fit', plan.monochrome ? 'monochrome' : 'color', plan.twoSided && !plan.manualDuplex ? 'duplexlong' : 'simplex', 'paper=' + paperKind, '1x'].join(',')
  if (!plan.monochrome && printer.supportsColor === false) throw new Error('This printer cannot print color. Choose a color printer for this order.')
  const executable = process.env.SUMATRA_PDF_PATH || path.join(process.cwd(), 'vendor', 'sumatra', 'SumatraPDF-3.6.1-64.exe')
  await fs.access(executable).catch(() => { throw new Error('The local PDF print engine is unavailable on this server.') })
  const spoolPdf = await prepareSpoolDocument(rendered.pdf, plan.pages, plan.copies, plan.twoSided && !plan.manualDuplex)
  await fs.mkdir(folder, { recursive: true })
  const safeName = (rendered.order.order_number + '-' + rendered.file.file_name.replace(/\.[^.]+$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90)
  const prepared = path.join(folder, safeName + '-' + input.requestId + '.pdf')
  const receipt: PrintReceipt = { requestId: input.requestId, orderId: input.orderId, fileId: input.fileId, printerName: printer.name,
    pages: plan.pages, copies: plan.copies, paper: plan.paper, side: plan.side, manualCopy: plan.manualCopy, submittedAt: new Date().toISOString(), warning: null }
  const auditEvent = { id: input.requestId, event_type: 'print_submitted', entity_type: 'order_file', entity_id: input.fileId,
    actor_id: auth.userId, actor_role: 'admin', metadata: { ...receipt, settings, source: rendered.source,monochrome:plan.monochrome,spoolDuplex:plan.twoSided&&!plan.manualDuplex,spoolSnapshotName:input.requestId+'.pdf',spoolSha256:createHash('sha256').update(spoolPdf).digest('hex'), pdfSha256: createHash('sha256').update(rendered.pdf).digest('hex') } }
  let ownsPrepared = false
  if(rendered.order.status==='pending'||rendered.order.status==='queued'){
    const go=await supabaseAdmin.rpc('transition_queue_order',{p_order_id:input.orderId,p_status:'processing',p_actor_id:auth.userId})
    if(go.error)throw new Error(go.error.message)
  }
  try {
    const result = await submitPrintOnce(folder, input.requestId, fingerprint, async () => {
      await fs.mkdir(path.join(folder,'snapshots'),{recursive:true})
      const snapshotFile=await fs.open(path.join(folder,'snapshots',input.requestId+'.pdf'),'wx')
      try{await snapshotFile.writeFile(spoolPdf);await snapshotFile.sync()}finally{await snapshotFile.close()}
      await fs.writeFile(prepared, spoolPdf, { flag: 'wx' }); ownsPrepared = true
      await promisify(execFile)(executable, ['-print-to', printer.name, '-print-settings', settings, '-silent', prepared], { windowsHide: true, timeout: 120000 })
    }, receipt, auditEvent, input.reprintOf)
    if (result.requestId !== input.requestId) return result
    // A database outage after successful submission must never trigger a second physical print.
    try {
      const audit = await supabaseAdmin.from('audit_log').upsert(auditEvent, { onConflict: 'id', ignoreDuplicates: true })
      if (audit.error) throw new Error('History unavailable')
      await fs.writeFile(path.join(folder, input.requestId + '.json'), JSON.stringify({ fingerprint, reprintOf: input.reprintOf ?? null, status: 'submitted', receipt: result, auditEvent, auditSynced: true }))
    } catch {
      result.warning = 'The file was submitted to Windows. Database print history is pending; automatic sync will retry. A local receipt is kept.'
      await fs.writeFile(path.join(folder, input.requestId + '.json'), JSON.stringify({ fingerprint, reprintOf: input.reprintOf ?? null, status: 'submitted', receipt: result, auditEvent, auditSynced: false })).catch(() => {})
    }
    return result
  } finally { if (ownsPrepared) await fs.rm(prepared, { force: true }).catch(() => {}) }
}
