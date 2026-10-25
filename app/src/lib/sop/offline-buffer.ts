import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {cachedValue,localDatabase,runtimePath} from './local-store'
import {intakeAvailability} from './policy'
import {loadSopSettings} from './settings-server'
import {filesFingerprint} from './quote-fingerprint'
import {quotePages,type PrintQuote} from './pricing'
import {encodePaymentNotes,paymentAccounts,paymentReceiptMatches,paymentReceiptError,validatePayment,type OrderPayment} from '@/lib/kiosk/payment'
import {validatePrintOptions} from '@/lib/kiosk/print-options'
import {validatePickupAt} from '@/lib/kiosk/pickup'
import {pickupDeadline} from '@/lib/queue/scheduling'
import type {SubmitOrderMeta} from '@/lib/actions/submit-order'
import type {Service,ServiceOption,Order,OrderFile} from '@/lib/types/database'

export type BufferedOrder = Order & {services:{name:string;slug:string};queue_entries:{queue_number:number}[];order_files:OrderFile[];offlineMeta?:SubmitOrderMeta;offlineError?:string;proofHashes?:{payment?:string;student?:string}}
export function readBufferedOrder(id:string):BufferedOrder|null {
  const row=localDatabase().prepare('SELECT payload FROM local_orders WHERE id=?').get(id)
  return row?JSON.parse(String(row.payload)):null
}
export function findBufferedNumber(number:string):BufferedOrder|null {
  const row=localDatabase().prepare("SELECT payload FROM local_orders WHERE json_extract(payload,'$.order_number')=?").get(number)
  return row?JSON.parse(String(row.payload)):null
}
export function saveOrderMirror(order:BufferedOrder,cloudUpdatedAt:string|null,pending=false) {
  localDatabase().prepare('INSERT INTO local_orders VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,cloud_updated_at=excluded.cloud_updated_at,pending=excluded.pending,updated_at=excluded.updated_at WHERE local_orders.pending=0 OR excluded.pending=1')
    .run(order.id,JSON.stringify(order),cloudUpdatedAt,pending?1:0,new Date().toISOString())
}
export async function bufferSubmission(form:FormData,meta:SubmitOrderMeta):Promise<BufferedOrder> {
  const existing=readBufferedOrder(meta.submissionKey)
  if(existing){if(existing.service_id!==meta.serviceId||existing.source!==meta.source)throw Error('Submission key belongs to another request.');return existing}
  if(cachedValue<number>('sop-contract')?.value!==3)throw Error('Reconnect this server before accepting offline requests.')
  const settings=await loadSopSettings(),available=intakeAvailability(settings.policy)
  if(!settings.configured || !available.accepting)throw Error(available.reason)
  const config=cachedValue<{service:Service;options:ServiceOption[]}>('catalog:'+meta.serviceSlug)?.value
  if(!config?.service.is_active || config.service.id!==meta.serviceId)throw Error('A verified local service configuration is unavailable.')
  if(config.service.slug!=='printing')throw Error('Offline buffering currently accepts document printing. Reconnect for other services.')
  const options=meta.serviceOptions,invalid=validatePrintOptions(options);if(invalid)throw Error(invalid)
  const pickup=pickupDeadline(options),pickupError=options['Transaction Type']==='schedule'?validatePickupAt(pickup,Date.now(),settings.policy):null
  if(pickupError)throw Error(pickupError)
  if(!['walk-in','schedule'].includes(String(options['Transaction Type'])))throw Error('Choose the transaction type.')
  const quoteRow=typeof meta.quoteId==='string'?localDatabase().prepare('SELECT payload,expires_at FROM quotes WHERE id=?').get(meta.quoteId):null
  if(!quoteRow || Date.parse(String(quoteRow.expires_at))<Date.now())throw Error('Refresh the print quote before submitting.')
  const {quote,hashes}=JSON.parse(String(quoteRow.payload)) as {quote:PrintQuote;hashes:{name:string;hash:string;pageCount:number}[]}
  const files=form.getAll('files') as File[]
  const actual=await Promise.all(files.map(async f=>({name:f.name,hash:createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')})))
  const pricingOptions=Object.fromEntries(Object.entries(options).filter(([key])=>!['Transaction Type','Pickup At','Pickup Date','Pickup Time'].includes(key)))
  if(filesFingerprint(actual,pricingOptions,quote.student)!==quote.fingerprint)throw Error('Files or options changed. Refresh the quote.')
  if(quotePages(quote.pages,pricingOptions,quote.student,settings.pricing).total!==quote.total)throw Error('The cached shop prices changed. Refresh the quote.')
  const proof=form.get('paymentReceipt'),student=form.get('studentProof'),method=meta.payment?.method ?? 'cash'
  const paymentError=validatePayment(method,meta.payment?.reference,proof instanceof File?proof:null,paymentAccounts(process.env))
  if(paymentError)throw Error(paymentError)
  if(form.getAll('paymentReceipt').length>1 || form.getAll('studentProof').length>1)throw Error('Attach one proof per verification type.')
  if(quote.student && paymentReceiptError(student instanceof File?student:null))throw Error('Attach a valid student ID proof, up to 10 MB.')
  if(files.reduce((n,f)=>n+f.size,0)+(proof instanceof File?proof.size:0)+(student instanceof File?student.size:0)>200*1024*1024)throw Error('Files and proofs exceed 200 MB combined.')
  const id=meta.submissionKey,folder=path.join(runtimePath(),'buffer',id),now=new Date().toISOString()
  await fs.mkdir(folder,{recursive:true})
  const keep=async(file:File,name:string)=>{
    const bytes=Buffer.from(await file.arrayBuffer()),destination=path.join(folder,name)
    try{const handle=await fs.open(destination,'wx');try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const previous=await fs.readFile(destination);if(!previous.equals(bytes))throw Error('A saved file conflicts with this retry.')}
    return destination
  }
  const payment:OrderPayment={method,status:method==='cash'?'unpaid':'pending-verification'}
  const proofHashes:{payment?:string;student?:string}={}
  if(proof instanceof File){const bytes=Buffer.from(await proof.arrayBuffer());if(!paymentReceiptMatches(bytes,proof.type))throw Error('Receipt content does not match its file type.');await keep(proof,'payment-proof');proofHashes.payment=createHash('sha256').update(bytes).digest('hex');const extension=({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[proof.type];Object.assign(payment,{reference:meta.payment?.reference?.trim(),receiptPath:id+'/payment/'+proofHashes.payment+'.'+extension,receiptName:proof.name.slice(0,255),receiptType:proof.type})}
  let studentProof:SubmitOrderMeta['studentProof']
  if(quote.student && student instanceof File){const bytes=Buffer.from(await student.arrayBuffer());if(!paymentReceiptMatches(bytes,student.type))throw Error('Student proof does not match its file type.');await keep(student,'student-proof');proofHashes.student=createHash('sha256').update(bytes).digest('hex');studentProof={path:id+'/student/'+proofHashes.student,name:student.name.slice(0,255),type:student.type}}
  const rows:OrderFile[]=[]
  for(const [index,file]of files.entries()){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100),name=index+'_'+hashes[index].hash+'_'+safe,local=await keep(file,name)
    rows.push({id:crypto.randomUUID(),order_id:id,file_name:file.name,file_type:file.type,file_size:file.size,storage_bucket:'order-files',storage_path:id+'/'+name,storage_url:null,local_path:local,is_downloaded:true,downloaded_at:now,page_count:hashes[index].pageCount,dimensions:null,metadata:{sha256:hashes[index].hash,pageCount:hashes[index].pageCount},created_at:now})
  }
  const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}),db=localDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const previous=readBufferedOrder(id);if(previous){db.exec('COMMIT');return previous}
    const sequence=db.prepare("INSERT INTO kv VALUES(?,'1',?) ON CONFLICT(key) DO UPDATE SET value=CAST(kv.value AS INTEGER)+1,updated_at=excluded.updated_at RETURNING value").get('offline-counter:'+date,now)
    const order={id,submission_key:id,order_number:'LAN-'+date.replaceAll('-','')+'-'+id.replaceAll('-','').toUpperCase(),source:meta.source,service_id:meta.serviceId,service_options:options,
      customer_id:null,customer_name:meta.customerName ?? null,customer_email:meta.customerEmail ?? null,customer_phone:meta.customerPhone ?? null,
      status:'pending',is_rush:false,priority_score:0,estimated_duration_minutes:config.service.estimated_duration_minutes,total_price:quote.total,is_paid:false,payment_method:method,
      customer_notes:encodePaymentNotes(payment),student_status:quote.student?'pending':'none',student_proof:studentProof ?? null,pricing_quote:quote,
      ticket_released_at:method==='cash' && options['Transaction Type']==='walk-in'&&!quote.student?now:null,
      payment_expires_at:method==='cash' && options['Transaction Type']==='schedule'?new Date(Date.now()+settings.policy.unpaidTimeoutMinutes*60000).toISOString():null,
      created_at:now,updated_at:now,started_at:null,completed_at:null,local_synced:true,local_path:folder,kiosk_station_id:null,processed_by:null,admin_notes:null,
      services:{name:config.service.name,slug:config.service.slug},queue_entries:[{queue_number:Number(sequence!.value)}],order_files:rows,
      proofHashes,offlineMeta:{...meta,customerId:null,pricingQuote:quote,studentProof,customerNotes:encodePaymentNotes(payment)}} as BufferedOrder
    saveOrderMirror(order,null,true);db.exec('COMMIT');return order
  }catch(e){db.exec('ROLLBACK');throw e}
}
