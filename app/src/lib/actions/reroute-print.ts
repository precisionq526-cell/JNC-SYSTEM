'use server'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {PDFDocument} from 'pdf-lib'
import {requireAdmin} from '@/lib/admin/require-admin'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {scanWindowsPrinters} from '@/lib/hardware/windows-printers'
import {isUuid} from '@/lib/utils/uuid'
import {runtimePath} from '@/lib/sop/local-store'
import {ticketIsHeld} from '@/lib/sop/workflow'
import {remainingSpoolPages} from '@/lib/printing/reroute-plan'
import {printerPaperKind} from '@/lib/printing/print-plan'
import {readPrintReceipt,submitPrintOnce} from '@/lib/printing/print-ledger'
export async function reroutePrintAction(input:{requestId:string;sourceRequestId:string;orderId:string;targetPrinter:string;jobId:number;printedSides:number;confirmed:boolean}) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  try{
    if(![input.requestId,input.sourceRequestId,input.orderId].every(isUuid)||typeof input.targetPrinter!=='string'||input.targetPrinter.length>256||!Number.isInteger(input.jobId)||input.jobId<1||input.confirmed!==true)throw Error('Confirm the source job, actual printed output, and target printer.')
    const folder=path.join(runtimePath(),'print-receipts'),fingerprint=createHash('sha256').update(JSON.stringify(['reroute',input.sourceRequestId,input.targetPrinter,input.printedSides])).digest('hex')
    const cached=await readPrintReceipt<Record<string,unknown>>(folder,input.requestId,fingerprint);if(cached)return {ok:true as const,receipt:cached}
    const [source,order,scan]=await Promise.all([supabaseAdmin.from('audit_log').select('metadata').eq('id',input.sourceRequestId).eq('event_type','print_submitted').single(),supabaseAdmin.from('orders').select('*').eq('id',input.orderId).single(),scanWindowsPrinters()])
    const metadata=source.data?.metadata as Record<string,unknown>|undefined
    if(source.error || !metadata || metadata.orderId!==input.orderId || order.error || !order.data)throw Error('The original print receipt could not be verified.')
    if(ticketIsHeld(order.data)||!['processing','pending','queued'].includes(order.data.status))throw Error('This order is not eligible for print recovery.')
    const printer=scan.printers.find(p=>p.name===input.targetPrinter)
    if(!printer||['error','offline','paused','attention','unknown'].includes(printer.status)||printer.name===metadata.printerName)throw Error('Choose another available physical printer.')
    const duplex=metadata.spoolDuplex===true
    if(duplex && printer.supportsDuplex!==true)throw Error('Automatic duplex recovery requires a duplex-capable target. Reconcile manual sides separately.')
    if(metadata.monochrome===false && printer.supportsColor===false)throw Error('The target cannot print this color job.')
    if(metadata.spoolSnapshotName!==input.sourceRequestId+'.pdf'||typeof metadata.spoolSha256!=='string')throw Error('This older print has no retained spool snapshot. Use the staff-reviewed reprint procedure.')
    const sourcePdf=await fs.readFile(path.join(folder,'snapshots',input.sourceRequestId+'.pdf'))
    if(createHash('sha256').update(sourcePdf).digest('hex')!==metadata.spoolSha256)throw Error('The saved spool snapshot changed. Reconcile it before reprinting.')
    const document=await PDFDocument.load(sourcePdf),pages=remainingSpoolPages(document.getPageCount(),input.printedSides,duplex),remaining=await PDFDocument.create()
    for(const page of await remaining.copyPages(document,pages.map(n=>n-1)))remaining.addPage(page)
    const bytes=Buffer.from(await remaining.save()),paper=String(metadata.paper),kind=printerPaperKind(paper,printer.paperSizes ?? [])
    const settings=['fit',metadata.monochrome===true?'monochrome':'color',duplex?'duplexlong':'simplex','paper='+kind,'1x'].join(',')
    const spoolName='recovery-'+input.requestId+'.pdf',prepared=path.join(folder,spoolName),snapshot=path.join(folder,'snapshots',input.requestId+'.pdf')
    const receipt={requestId:input.requestId,orderId:input.orderId,fileId:metadata.fileId,printerName:printer.name,pages,copies:1,paper,side:metadata.side ?? 'all',manualCopy:metadata.manualCopy ?? 1,submittedAt:new Date().toISOString(),warning:null,sourceRequestId:input.sourceRequestId,confirmedPrintedSides:input.printedSides}
    const audit={id:input.requestId,event_type:'print_submitted',entity_type:'order_file',entity_id:String(metadata.fileId),actor_id:auth.userId,actor_role:'admin',metadata:{...receipt,monochrome:metadata.monochrome===true,spoolDuplex:duplex,spoolSnapshotName:input.requestId+'.pdf',spoolSha256:createHash('sha256').update(bytes).digest('hex'),recovery:true}}
    const executable=process.env.SUMATRA_PDF_PATH || path.join(process.cwd(),'vendor','sumatra','SumatraPDF-3.6.1-64.exe');await fs.access(executable)
    let ownsPrepared=false
    try{
      const result=await submitPrintOnce(folder,input.requestId,fingerprint,async()=>{
        await fs.mkdir(path.dirname(snapshot),{recursive:true});await fs.writeFile(snapshot,bytes,{flag:'wx'});await fs.writeFile(prepared,bytes,{flag:'wx'});ownsPrepared=true
        await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'scripts','cancel-order-print-job.ps1'),'-PrinterName',String(metadata.printerName),'-JobId',String(input.jobId),'-ExpectedRequestId',input.sourceRequestId,'-MaximumPrintedSides',String(input.printedSides)],{windowsHide:true,timeout:15000})
        await promisify(execFile)(executable,['-print-to',printer.name,'-print-settings',settings,'-silent',prepared],{windowsHide:true,timeout:120000})
      },receipt,audit)
      // The existing ledger sync uploads this audit if a cloud interruption occurs here.
      await supabaseAdmin.from('audit_log').upsert(audit,{onConflict:'id',ignoreDuplicates:true})
      return {ok:true as const,receipt:result}
    }finally{if(ownsPrepared)await fs.rm(prepared,{force:true}).catch(()=>{})}
  }catch(error){return {ok:false as const,error:error instanceof Error?error.message:'Re-routing could not be confirmed. Check both Windows queues before retrying.'}}
}
