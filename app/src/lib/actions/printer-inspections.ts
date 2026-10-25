'use server'
import {requireAdmin} from '@/lib/admin/require-admin'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {scanWindowsPrinters} from '@/lib/hardware/windows-printers'
export async function getPrinterInspectionsAction(){const auth=await requireAdmin();if(!auth.ok)return auth;try{const [printers,history]=await Promise.all([scanWindowsPrinters(),supabaseAdmin.from('audit_log').select('id,created_at,metadata').eq('event_type','printer_inspection').order('created_at',{ascending:false}).limit(30)]);if(history.error)throw Error('Inspection history unavailable.');return {ok:true as const,data:{printers:printers.printers,history:history.data}}}catch(e){return {ok:false as const,error:e instanceof Error?e.message:'Printer checks unavailable.'}}}
export async function recordPrinterInspectionAction(input:{printerName:string;paperSheets:number|null;inkPercent:number|null;maintenance:'check'|'refill'|'clean';notes:string}){
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(!input||typeof input.printerName!=='string'||input.printerName.length>256||typeof input.notes!=='string'||input.notes.length>500||!['check','refill','clean'].includes(input.maintenance)||input.paperSheets!==null&&(!Number.isInteger(input.paperSheets)||input.paperSheets<0||input.paperSheets>10000)||input.inkPercent!==null&&(!Number.isFinite(input.inkPercent)||input.inkPercent<0||input.inkPercent>100))return {ok:false as const,error:'Check the observed paper, ink, and maintenance values.'}
  const scan=await scanWindowsPrinters();if(!scan.printers.some(p=>p.name===input.printerName))return {ok:false as const,error:'Choose an installed physical printer.'}
  const result=await supabaseAdmin.from('audit_log').insert({event_type:'printer_inspection',entity_type:'printer',actor_id:auth.userId,actor_role:'admin',metadata:{...input,source:'manual inspection'}})
  return result.error?{ok:false as const,error:'The inspection was not saved.'}:{ok:true as const}
}
