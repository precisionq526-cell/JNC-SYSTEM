'use server'
import {requireAdmin} from '@/lib/admin/require-admin'
import {supabaseAdmin} from '@/lib/supabase/admin'
export async function getDailyOperationsReportAction(date:string) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00+08:00')))return {ok:false as const,error:'Choose a valid report date.'}
  const start=new Date(date+'T00:00:00+08:00'),end=new Date(start.getTime()+86400000)
  const [orders,receipts,prints,assignments]=await Promise.all([
    supabaseAdmin.from('orders').select('id,order_number,created_at,status,total_price,is_paid,payment_method,pricing_quote,collected_at').gte('created_at',start.toISOString()).lt('created_at',end.toISOString()).order('created_at').limit(5000),
    supabaseAdmin.from('audit_log').select('id,entity_id,created_at,metadata').eq('event_type','payment_approved').gte('created_at',start.toISOString()).lt('created_at',end.toISOString()).order('created_at').limit(5000),
    supabaseAdmin.from('audit_log').select('id,created_at,metadata').eq('event_type','print_submitted').gte('created_at',start.toISOString()).lt('created_at',end.toISOString()).order('created_at').limit(5000),
    supabaseAdmin.from('print_job_assignments').select('device_id,started_at,completed_at,hardware_devices(device_name)').gte('completed_at',start.toISOString()).lt('started_at',end.toISOString()).limit(5000),
  ])
  if([orders,receipts,prints,assignments].some(r=>r.error || (r.data?.length ?? 0)>=5000))return {ok:false as const,error:'The report could not read all records. Check the connection or use a database export for this volume.'}
  const payments=(receipts.data ?? []).map(r=>({id:r.id,orderId:r.entity_id,receivedAt:r.created_at,method:String(r.metadata?.method ?? 'unknown'),amount:Number(r.metadata?.amount ?? 0)}))
  if(payments.some(p=>!Number.isFinite(p.amount) || p.amount<0))return {ok:false as const,error:'A payment audit has an invalid amount. Reconcile it before exporting.'}
  const printerRows=new Map<string,{name:string;pagesSpooled:number;submissions:number;assignedMinutes:number}>()
  for(const print of prints.data ?? []){
    const m=print.metadata,name=String(m?.printerName ?? 'Unrecorded printer'),row=printerRows.get(name) ?? {name,pagesSpooled:0,submissions:0,assignedMinutes:0}
    row.pagesSpooled+=(Array.isArray(m?.pages)?m.pages.length:0)*Number(m?.copies ?? 1);row.submissions++;printerRows.set(name,row)
  }
  for(const a of assignments.data ?? []){
    const relation=Array.isArray(a.hardware_devices)?a.hardware_devices[0]:a.hardware_devices
    const name=relation?.device_name ?? 'Unrecorded printer',row=printerRows.get(name) ?? {name,pagesSpooled:0,submissions:0,assignedMinutes:0}
    const from=Math.max(start.getTime(),Date.parse(a.started_at ?? '')),to=Math.min(end.getTime(),Date.parse(a.completed_at ?? ''))
    if(Number.isFinite(from)&&Number.isFinite(to)&&to>from)row.assignedMinutes+=(to-from)/60000
    printerRows.set(name,row)
  }
  return {ok:true as const,data:{date,orders:orders.data ?? [],payments,printers:[...printerRows.values()],receivedTotal:payments.reduce((sum,p)=>sum+p.amount,0),cashTotal:payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.amount,0),walletTotal:payments.filter(p=>p.method!=='cash').reduce((sum,p)=>sum+p.amount,0),pagesSpooled:[...printerRows.values()].reduce((sum,p)=>sum+p.pagesSpooled,0)}}
}
