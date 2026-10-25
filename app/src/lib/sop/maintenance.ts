import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {cacheValue,localDatabase,runtimePath} from './local-store'
import {loadSopSettings} from './settings-server'
import {readBufferedOrder,saveOrderMirror,type BufferedOrder} from './offline-buffer'
import {firstRelation,relationList} from '@/lib/supabase/relations'
import {prunePrintSnapshots} from './print-retention'
const state=globalThis as typeof globalThis & {sopWorkerStarted?:boolean;sopWorkerBusy?:boolean}
async function uploadBufferedFile(local:string,storage:string,type:string,hash?:string) {
  const root=await fs.realpath(path.join(runtimePath(),'buffer')),target=await fs.realpath(local),relative=path.relative(root,target)
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw Error('Buffered file is outside the recovery folder.')
  const bytes=await fs.readFile(target)
  if(hash && createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('A buffered file changed after acceptance. Reconciliation is required.')
  const upload=await supabaseAdmin.storage.from('order-files').upload(storage,bytes,{contentType:type,upsert:false})
  if(upload.error){const existing=await supabaseAdmin.storage.from('order-files').info(storage);if(!existing.data || Number(existing.data.size)!==bytes.length)throw Error('Buffered file upload could not be confirmed.')}
}
async function flushBufferedOrder(order:BufferedOrder) {
  if(!order.offlineMeta)throw Error('The offline submission metadata is missing.')
  const meta={...order.offlineMeta,offlineSubmittedAt:order.created_at,offlineTicketNumber:order.order_number}
  for(const file of order.order_files)await uploadBufferedFile(file.local_path!,file.storage_path,file.file_type,String(file.metadata.sha256))
  const payment=JSON.parse((order.customer_notes ?? '').replace(/^JNC_PAYMENT_V1:/,''))
  if(payment.receiptPath)await uploadBufferedFile(path.join(order.local_path!,'payment-proof'),payment.receiptPath,payment.receiptType,order.proofHashes?.payment)
  if(order.student_proof)await uploadBufferedFile(path.join(order.local_path!,'student-proof'),order.student_proof.path,order.student_proof.type,order.proofHashes?.student)
  const records=order.order_files.map(file=>({file_name:file.file_name,file_type:file.file_type,file_size:file.file_size,storage_bucket:file.storage_bucket,storage_path:file.storage_path,asset_classification:file.asset_classification ?? 'document',metadata:file.metadata}))
  const result=await supabaseAdmin.rpc('commit_order_submission',{p_submission_key:order.id,p_order_id:order.id,p_meta:meta,p_files:records})
  if(result.error)throw Error(result.error.message)
  const saved=await supabaseAdmin.from('orders').select('id,service_id,source,pricing_quote').eq('id',order.id).single()
  if(saved.error || saved.data.service_id!==order.service_id || saved.data.source!==order.source || saved.data.pricing_quote?.fingerprint!==order.pricing_quote?.fingerprint)throw Error('Cloud and local submissions need manual reconciliation.')
  for(const file of order.order_files){const linked=await supabaseAdmin.from('order_files').update({local_path:file.local_path,is_downloaded:true,downloaded_at:new Date().toISOString()}).eq('order_id',order.id).eq('storage_path',file.storage_path);if(linked.error)throw Error('The cloud order is recorded but local file links need another sync.')}
  localDatabase().prepare('UPDATE local_orders SET pending=0 WHERE id=?').run(order.id)
}
export async function runSopMaintenance() {
  if(state.sopWorkerBusy)return
  state.sopWorkerBusy=true
  try {
    const contract=await supabaseAdmin.rpc('kiosk_data_contract_version').abortSignal(AbortSignal.timeout(7000))
    if(contract.error || contract.data!==3){cacheValue('sop-sync',{connected:false,checkedAt:new Date().toISOString(),error:contract.error?'Cloud connection unavailable. Requests remain local.':'SOP database migration is required.'});return}
    cacheValue('sop-contract',3)
    await loadSopSettings()
    const [services,options,capacity]=await Promise.all([supabaseAdmin.from('services').select('*'),supabaseAdmin.from('service_options').select('*'),supabaseAdmin.from('queue_settings').select('*').eq('id',1).single()])
    if(services.error || options.error || capacity.error)throw Error('Verified service configuration could not be mirrored.')
    for(const service of services.data ?? [])cacheValue('catalog:'+service.slug,{service,options:options.data?.filter(option=>option.service_id===service.id) ?? []})
    cacheValue('queue-settings',capacity.data)
    const pending=localDatabase().prepare('SELECT id FROM local_orders WHERE pending=1 ORDER BY updated_at').all()
    let unresolved=0
    for(const row of pending){const order=readBufferedOrder(String(row.id));if(!order)continue;try{await flushBufferedOrder(order)}catch(error){unresolved++;order.offlineError=error instanceof Error?error.message:'Recovery synchronization failed.';saveOrderMirror(order,null,true)}}
    const rows=await supabaseAdmin.from('orders').select('*,services(name,slug),queue_entries(queue_number),order_files(*)').order('created_at',{ascending:false}).limit(1000)
    if(rows.error)throw Error('Order mirror could not be refreshed.')
    for(const row of rows.data ?? [])saveOrderMirror({...row,order_number:row.offline_ticket_number ?? row.order_number,services:firstRelation(row.services),queue_entries:relationList(row.queue_entries),order_files:relationList(row.order_files)} as BufferedOrder,row.updated_at)
    const expiry=await supabaseAdmin.rpc('expire_unpaid_requests');if(expiry.error)throw Error('Unpaid-request maintenance could not be completed.')
    localDatabase().prepare('DELETE FROM quotes WHERE expires_at<?').run(new Date(Date.now()-30*86400000).toISOString())
    await prunePrintSnapshots(runtimePath(),new Set((rows.data ?? []).filter(row=>['collected','cancelled','failed'].includes(row.status)).map(row=>row.id)))
    cacheValue('sop-sync',{connected:true,checkedAt:new Date().toISOString(),pending:unresolved,mirrored:rows.data?.length ?? 0,error:unresolved?'Some local requests need reconciliation. Open the recovery console.':null})
  }catch(error){cacheValue('sop-sync',{connected:false,checkedAt:new Date().toISOString(),error:error instanceof Error?error.message:'Cloud connection unavailable.'})}
  finally{state.sopWorkerBusy=false}
}
export function startSopMaintenance() {
  if(state.sopWorkerStarted || !process.env.SUPABASE_SERVICE_ROLE_KEY)return
  state.sopWorkerStarted=true
  void runSopMaintenance()
  const timer=setInterval(()=>void runSopMaintenance(),30000);timer.unref()
}
