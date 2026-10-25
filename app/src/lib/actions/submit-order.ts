'use server'

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import { loadQueueSnapshot } from '@/lib/queue/queue-service'
import { pickupDeadline } from '@/lib/queue/scheduling'
import type { GGCMetrics } from '@/lib/queue/ggc-model'
import { createClient } from '@/lib/supabase/server'
import type { OrderSource, OrderStatus } from '@/lib/types/database'
import { isUuid } from '@/lib/utils/uuid'
import { getFileEditorKind } from '@/lib/editor/file-types'
import { firstRelation } from '@/lib/supabase/relations'
import { validatePrintOptions } from '@/lib/kiosk/print-options'
import { recordedPaymentMethod, encodePaymentNotes, paymentAccounts, paymentReceiptMatches, validatePayment, type OrderPayment, type PaymentMethod } from '@/lib/kiosk/payment'
import { validatePickupAt } from '@/lib/kiosk/pickup'
import { localDatabase } from '@/lib/sop/local-store'
import { loadSopSettings } from '@/lib/sop/settings-server'
import { intakeAvailability, requiresPrepayment } from '@/lib/sop/policy'
import { filesFingerprint } from '@/lib/sop/quote-fingerprint'
import { orderHoldReason, ticketIsHeld, type SopOrder } from '@/lib/sop/workflow'
import { pickupToken } from '@/lib/sop/pickup-token'
import type { PrintQuote } from '@/lib/sop/pricing'
import { paymentReceiptError } from '@/lib/kiosk/payment'
import {bufferSubmission,readBufferedOrder,findBufferedNumber} from '@/lib/sop/offline-buffer'

const BUCKET = 'order-files'
const SETUP_ERROR = 'Apply 20261025_sop_operations.sql before accepting SOP orders. Your draft is kept.'

export interface SubmitOrderMeta {
  quoteId?: string
  pricingQuote?: PrintQuote
  studentProof?: {path:string;name:string;type:string}
  submissionKey: string
  source: OrderSource
  serviceId: string
  serviceSlug: string
  serviceOptions: Record<string, unknown>
  totalPrice: number
  estimatedDurationMinutes: number
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerNotes?: string
  customerId?: string | null
  payment?: {method: PaymentMethod; reference?: string}
}

export interface SubmitOrderResult {
  offline?: boolean
  pickupToken?: string; estimatedCompletionAt?: string | null; holdReason?: string
  ok: boolean; error?: string; orderId?: string; orderNumber?: string; queueNumber?: number
  totalPrice?: number; createdAt?: string; estimatedDurationMinutes?: number; serviceName?: string; estimatedWaitMinutes?: number | null; waitEstimateLabel?: string
  paymentStatus?: 'unpaid'|'pending-verification'|'approved'; paymentMethod?:PaymentMethod; isPaid?:boolean; status?:OrderStatus; completedAt?:string|null
}

type Receipt = Required<Pick<SubmitOrderResult, 'orderId' | 'orderNumber' | 'queueNumber' | 'totalPrice' | 'createdAt' | 'estimatedDurationMinutes' | 'serviceName'>>

async function receiptResult(receipt: Receipt, order:SopOrder & {status:OrderStatus;completed_at?:string|null}, offline=false): Promise<SubmitOrderResult> {
  const paymentMethod=recordedPaymentMethod(order)
  if(ticketIsHeld(order))return {
    ok:true,offline,orderId:receipt.orderId,totalPrice:receipt.totalPrice,createdAt:receipt.createdAt,
    estimatedDurationMinutes:receipt.estimatedDurationMinutes,serviceName:receipt.serviceName,
    paymentMethod,paymentStatus:'pending-verification',isPaid:false,status:order.status,
    estimatedWaitMinutes:null,waitEstimateLabel:orderHoldReason(order)!,holdReason:orderHoldReason(order)!,
  }
  const snapshot = offline ? null : await loadQueueSnapshot().catch(() => null)
  const planned = snapshot?.plan.find(row => row.id === receipt.orderId)
  return { ok: true, offline, ...receipt, pickupToken:pickupToken(receipt.orderId), estimatedCompletionAt:planned?.estimatedCompletionMinutes == null ? null : new Date(Date.now()+planned.estimatedCompletionMinutes*60000).toISOString(),paymentMethod,paymentStatus:order.is_paid?'approved':'unpaid',isPaid:order.is_paid===true,status:order.status,completedAt:order.completed_at,
    estimatedWaitMinutes: planned?.estimatedWaitMinutes ?? null,
    waitEstimateLabel: offline ? 'Saved locally. Live status and processing resume after reconnection.' : !snapshot?.settings.isConfigured ? 'Queue setup unavailable' : snapshot.settings.activeServers === 0
      ? 'Queue paused - waiting for staff' : planned?.estimatedWaitMinutes == null
        ? 'Wait estimate unavailable' : 'About ' + planned.estimatedWaitMinutes + ' min before processing' }
}

// The random submission/order ID is a private polling handle. A pending response never
// includes an order/queue number, even on retry or when a client changes its payment choice.
export async function getOrderReleaseAction(orderId:string):Promise<SubmitOrderResult> {
  if(!isUuid(orderId))return {ok:false,error:'Invalid request identifier.'}
  if(!hasServiceRoleConfig())return {ok:false,error:'Order database is unavailable.'}
  const result=await supabaseAdmin.from('orders').select('*,services(name),queue_entries(queue_number)').eq('id',orderId).maybeSingle()
  if(result.error || !result.data){const local=readBufferedOrder(orderId);if(local && (result.error || local.offlineMeta))return receiptResult({orderId:local.id,orderNumber:local.order_number,queueNumber:local.queue_entries[0].queue_number,totalPrice:local.total_price,createdAt:local.created_at,estimatedDurationMinutes:local.estimated_duration_minutes ?? 0,serviceName:local.services.name},local,true);return {ok:false,error:'Could not check your request. Keep this page open and retry.'}}
  const row=result.data,queue=firstRelation(row.queue_entries)
  if(!queue?.queue_number)return {ok:false,error:'Your request is recorded, but its queue entry is unavailable. Contact staff; do not submit another payment.'}
  return receiptResult({orderId:row.id,orderNumber:row.offline_ticket_number ?? row.order_number,queueNumber:queue.queue_number,totalPrice:Number(row.total_price),createdAt:row.created_at,
    estimatedDurationMinutes:row.estimated_duration_minutes,serviceName:firstRelation(row.services)?.name ?? 'Service unavailable'},row)
}

export async function submitOrderFormAction(formData: FormData): Promise<SubmitOrderResult> {
  if (!hasServiceRoleConfig()) return { ok: false, error: 'Database connection is not configured.' }
  let meta: SubmitOrderMeta
  try {
    const raw = formData.get('meta')
    if (typeof raw !== 'string' || raw.length > 30_000) throw new Error()
    meta = JSON.parse(raw)
    if (!meta || !isUuid(meta.submissionKey) || !isUuid(meta.serviceId) || !['online','kiosk'].includes(meta.source)
      || !meta.serviceOptions || typeof meta.serviceOptions !== 'object' || Array.isArray(meta.serviceOptions)) throw new Error()
  } catch { return { ok: false, error: 'Invalid order payload. Return to your files and try again.' } }
  const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : undefined
  meta.customerName = cleanText(meta.customerName,120)
  meta.customerEmail = cleanText(meta.customerEmail,254)
  meta.customerPhone = cleanText(meta.customerPhone,30)
  meta.customerNotes = cleanText(meta.customerNotes,2000)
  // Quotes and proof paths are server-owned, never accepted from posted JSON.
  delete meta.pricingQuote; delete meta.studentProof
  Reflect.deleteProperty(meta,'offlineSubmittedAt');Reflect.deleteProperty(meta,'offlineTicketNumber')
  if (meta.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(meta.customerEmail)) return { ok:false,error:'Enter a valid email address.' }
  const files = formData.getAll('files')
  if (files.length > 20 || files.some(file => !(file instanceof File) || file.size < 1 || file.size > 200 * 1024 * 1024 || !getFileEditorKind(file.name))
    || files.reduce((sum, file) => sum + (file instanceof File ? file.size : 0), 0) > 200 * 1024 * 1024) {
    return { ok:false,error:'Attach up to 20 supported files, with a combined size of at most 200 MB.' }
  }
  // An absent RPC must stop submission before any file upload or database write.
  const contract = await supabaseAdmin.rpc('kiosk_data_contract_version').abortSignal(AbortSignal.timeout(7000))
  if(contract.error && (!contract.error.code || /fetch|network|abort|timeout/i.test(contract.error.message))){
    try{const local=await bufferSubmission(formData,meta);return receiptResult({orderId:local.id,orderNumber:local.order_number,queueNumber:local.queue_entries[0].queue_number,totalPrice:local.total_price,createdAt:local.created_at,estimatedDurationMinutes:local.estimated_duration_minutes ?? 0,serviceName:local.services.name},local,true)}catch(error){return {ok:false,error:error instanceof Error?error.message:'Your files remain in the browser. Retry when the server reconnects.'}}
  }
  if (contract.error || contract.data !== 3) return { ok: false, error: contract.error?.code === 'PGRST202' || !contract.error ? SETUP_ERROR : 'Database connection unavailable. Your files remain saved for retry.' }

  const existing = await supabaseAdmin.from('orders').select('*,services(name),queue_entries(queue_number)')
    .eq('submission_key',meta.submissionKey).maybeSingle()
  if (existing.error) return { ok:false,error:'Could not verify your previous submission. Retry with the same saved draft.' }
  if (existing.data) {
    const row = existing.data
    if (row.service_id !== meta.serviceId || row.source !== meta.source) return { ok:false,error:'This submission key belongs to a different order.' }
    const queue = firstRelation(row.queue_entries)
    if (!queue?.queue_number) return { ok:false,error:'The order is recorded but its queue entry is missing. Contact staff; do not submit a duplicate.' }
    return receiptResult({orderId:row.id,orderNumber:row.order_number,queueNumber:queue.queue_number,totalPrice:Number(row.total_price),createdAt:row.created_at,
      estimatedDurationMinutes:row.estimated_duration_minutes,serviceName:firstRelation(row.services)?.name ?? 'Service unavailable'},row)
  }

  const proof = formData.get('paymentReceipt')
  const studentProof = formData.get('studentProof')
  if (formData.getAll('studentProof').length > 1 || studentProof && !(studentProof instanceof File)) return {ok:false,error:'Attach one student ID proof.'}
  const sop = await loadSopSettings()
  const availability = intakeAvailability(sop.policy)
  if (!availability.accepting) return {ok:false,error:availability.reason}
  if (formData.getAll('paymentReceipt').length > 1 || proof && !(proof instanceof File)) return {ok:false,error:'Attach one payment receipt.'}
  const paymentMethod = meta.payment?.method ?? 'cash'
  const paymentError = validatePayment(paymentMethod, meta.payment?.reference, proof instanceof File ? proof : null, paymentAccounts(process.env))
  if (paymentError) return {ok:false,error:paymentError}
  if (files.reduce((sum,file)=>sum+(file instanceof File ? file.size : 0),0) + (proof instanceof File ? proof.size : 0) > 200*1024*1024) return {ok:false,error:'Order files and the payment receipt must fit within 200 MB combined.'}
  const proofBytes = proof instanceof File ? Buffer.from(await proof.arrayBuffer()) : null
  if (proofBytes && proof instanceof File && !paymentReceiptMatches(proofBytes,proof.type)) return {ok:false,error:'The payment receipt content does not match its file type. Upload the original image or PDF.'}

  const svc = await supabaseAdmin.from('services').select('id,slug,is_active').eq('id',meta.serviceId).eq('is_active',true).maybeSingle()
  if (svc.error || !svc.data) return { ok:false,error:'This service is unavailable. Return to the service list.' }
  let verifiedFiles: {name:string;hash:string;pageCount:number}[] = []
  if (svc.data.slug === 'printing') {
    if (!meta.quoteId || !isUuid(meta.quoteId)) return {ok:false,error:'Calculate the itemized print quote before submitting.'}
    const stored = localDatabase().prepare('SELECT payload,expires_at FROM quotes WHERE id=?').get(meta.quoteId)
    if (!stored || Date.parse(String(stored.expires_at)) < Date.now()) return {ok:false,error:'The print quote expired. Refresh it before paying.'}
    const {quote,hashes} = JSON.parse(String(stored.payload)) as {quote:PrintQuote;hashes:typeof verifiedFiles}
    const actual = await Promise.all((files as File[]).map(async f=>({name:f.name,hash:createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')})))
    const pricingOptions = Object.fromEntries(Object.entries(meta.serviceOptions).filter(([key])=>!['Transaction Type','Pickup At','Pickup Date','Pickup Time'].includes(key)))
    if (filesFingerprint(actual,pricingOptions,quote.student)!==quote.fingerprint) return {ok:false,error:'Files or print choices changed. Refresh the quote before paying.'}
    if (quote.student) {
      const invalid = paymentReceiptError(studentProof instanceof File ? studentProof : null)
      if (invalid) return {ok:false,error:'Student discount requires a PDF or image of a valid student ID, up to 10 MB.'}
    } else if (studentProof) return {ok:false,error:'Select student verification before attaching an ID.'}
    meta.pricingQuote=quote; meta.totalPrice=quote.total; verifiedFiles=hashes
  }
  if ((studentProof instanceof File ? studentProof.size : 0) + (proof instanceof File ? proof.size : 0) + files.reduce((sum,file)=>sum+(file instanceof File?file.size:0),0)>200*1024*1024) return {ok:false,error:'Print files and verification proofs must fit within 200 MB combined.'}
  const printError = validatePrintOptions(meta.serviceOptions)
  if (printError) return { ok: false, error: printError }
  if (!files.length && !['id-picture','scanning'].includes(svc.data.slug)) return { ok:false,error:'At least one file is required.' }
  const pickupAt = pickupDeadline(meta.serviceOptions)
  const pickupError = meta.serviceOptions['Transaction Type'] === 'schedule' ? validatePickupAt(pickupAt,Date.now(),sop.policy) : null
  if (pickupError) return {ok:false,error:pickupError}
  if (pickupAt) meta.serviceOptions['Pickup At'] = pickupAt
  const auth = await createClient()
  const { data:{user} } = await auth.auth.getUser()
  // Customer SELECT policies must not expose reserved wallet ticket numbers.
  meta.customerId = paymentMethod==='cash' && !requiresPrepayment(meta.serviceOptions) && !meta.pricingQuote?.student ? user?.id ?? null : null
  const orderId = meta.submissionKey
  const records: Record<string,unknown>[] = []
  try {
    if (studentProof instanceof File) {
      const body = Buffer.from(await studentProof.arrayBuffer())
      if (!paymentReceiptMatches(body,studentProof.type)) throw new Error('The student proof content does not match its file type.')
      const studentPath=orderId+'/student/'+createHash('sha256').update(body).digest('hex')
      const uploaded=await supabaseAdmin.storage.from(BUCKET).upload(studentPath,body,{contentType:studentProof.type,upsert:false})
      if(uploaded.error){const existing=await supabaseAdmin.storage.from(BUCKET).info(studentPath);if(!existing.data || Number(existing.data.size)!==body.length)throw new Error('Student proof upload failed. Retry with the saved draft.')}
      meta.studentProof={path:studentPath,name:studentProof.name.slice(0,255),type:studentProof.type}
    }
    {
      const payment: OrderPayment = {method:paymentMethod,status:paymentMethod === 'cash' ? 'unpaid' : 'pending-verification',...(!meta.customerId && user?.id?{customerId:user.id}:{}),...(meta.customerNotes ? {notes:meta.customerNotes} : {})}
      if (proof instanceof File && proofBytes) {
        const extension = ({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[proof.type]
        const receiptPath = orderId+'/payment/'+createHash('sha256').update(proofBytes).digest('hex')+'.'+extension
        const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(receiptPath,proofBytes,{contentType:proof.type,upsert:false})
        if (uploaded.error) {
          const prior = await supabaseAdmin.storage.from(BUCKET).info(receiptPath)
          if (!prior.data || Number(prior.data.size) !== proof.size) throw new Error('Payment receipt upload failed. Retry with the same draft.')
        }
        Object.assign(payment,{reference:meta.payment?.reference!.trim(),receiptPath,receiptName:proof.name.slice(0,255),receiptType:proof.type})
      }
      meta.customerNotes = encodePaymentNotes(payment)
    }
    for (const [index, value] of files.entries()) {
      const file = value as File
      const body = Buffer.from(await file.arrayBuffer())
      const sha256 = createHash('sha256').update(body).digest('hex')
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120) || 'file'
      const storagePath = orderId + '/' + index + '_' + sha256 + '_' + safeName
      const result = await supabaseAdmin.storage.from(BUCKET).upload(storagePath,body,{contentType:file.type || 'application/octet-stream',upsert:false})
      if (result.error) {
        // Deterministic paths make an interrupted upload safe to retry. Never overwrite another file.
        const info = await supabaseAdmin.storage.from(BUCKET).info(storagePath)
        if (!info.data || Number(info.data.size) !== file.size) throw new Error('File upload failed: ' + result.error.message)
      }
      records.push({file_name:file.name.slice(0,255),file_type:file.type || 'application/octet-stream',file_size:file.size,
        storage_bucket:BUCKET,storage_path:storagePath,asset_classification:getFileEditorKind(file.name) === 'image' ? 'image' : 'document',
        metadata:{sha256,...(verifiedFiles[index]?{pageCount:verifiedFiles[index].pageCount}:{})}})
    }
    const committed = await supabaseAdmin.rpc('commit_order_submission',{p_submission_key:meta.submissionKey,p_order_id:orderId,p_meta:meta,p_files:records})
    if (committed.error) throw new Error(committed.error.code === 'PGRST202' ? SETUP_ERROR : committed.error.message)
    const receipt = committed.data as Receipt
    if (!receipt?.orderId || !receipt.orderNumber || !receipt.queueNumber) throw new Error('No confirmed order receipt was returned.')
    return getOrderReleaseAction(receipt.orderId)
  } catch (error) {
    // Retain deterministic uploads for retry. Another request may still be committing the same key.
    // Uncommitted uploads can be removed later only after a separate retention audit.
    return {ok:false,error:(error instanceof Error ? error.message : 'Submission could not be confirmed.') + ' Your draft is kept. Retry to retrieve the same order without duplicating it.'}
  }
}

export async function getQueueTelemetryAction(fallbackServiceMinutes?: number): Promise<{
  metrics: GGCMetrics | null; activeQueueLength: number | null; queueConfigured: boolean; error?: string
}> {
  try {
    const snapshot = await loadQueueSnapshot(fallbackServiceMinutes)
    return { metrics: snapshot.metrics, activeQueueLength: snapshot.orders.length, queueConfigured: snapshot.settings.isConfigured }
  } catch (error) {
    return { metrics: null, activeQueueLength: null, queueConfigured: false, error: error instanceof Error ? error.message : 'Queue data unavailable' }
  }
}

export async function updateOrderStatusAction(
  orderId: string,
  status: OrderStatus
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  if (!hasServiceRoleConfig()) {
    return { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: 'Unauthorized' }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Unauthorized' }
  }

  if(!isUuid(orderId))return {ok:false,error:'Invalid order.'}
  if(status==='collected')return {ok:false,error:'Use ticket verification and collection to archive this order.'}
  if(['queued','processing','finishing','completed','collected'].includes(status)){
    const payment=await supabaseAdmin.from('orders').select('*').eq('id',orderId).maybeSingle()
    if(payment.error || !payment.data)return {ok:false,error:'Could not verify payment. Retry before starting this request.'}
    if(ticketIsHeld(payment.data))return {ok:false,error:orderHoldReason(payment.data)!}
  }

  const { error } = await supabaseAdmin.rpc('transition_queue_order', {
    p_order_id: orderId, p_status: status, p_actor_id: user.id,
  })
  if (error) return { ok: false, error: error.code === 'PGRST202' ? 'Queue setup pending. Apply the queue migration before updating orders.' : error.message }

  // Order, queue and print assignment were updated by the same database transaction.
  if (status === 'processing') {
    const assignment = await supabaseAdmin.from('print_job_assignments').select('status,device_id').eq('order_id',orderId).maybeSingle()
    if (assignment.error) return {ok:true,warning:'Order processing started; printer assignment could not be checked.'}
    if (assignment.data?.status === 'pending') return {ok:true,warning:'Order processing started, but no available physical printer could be assigned. Staff must resolve the printer assignment.'}
  }

  return { ok: true }
}

export async function getOrderTrackingAction(orderId: string): Promise<{
  ok: boolean
  offline?: boolean
  error?: string
  status?: OrderStatus
  estimatedWaitMinutes?: number | null
  waitEstimateLabel?: string
  completedAt?: string | null
  isPaid?: boolean
  paymentStatus?: 'unpaid'|'pending-verification'|'approved'
  holdReason?: string
}> {
  if (!isUuid(orderId)) return { ok: false, error: 'Invalid order identifier.' }
  if (!hasServiceRoleConfig()) {
    return { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }
  }

  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: 'Order status unavailable. Please try again.' }
  if (!data) return { ok: false, error: 'Order not found' }
  if(ticketIsHeld(data))return {ok:true,status:data.status as OrderStatus,isPaid:data.is_paid,paymentStatus:'pending-verification',estimatedWaitMinutes:null,waitEstimateLabel:orderHoldReason(data)!,holdReason:orderHoldReason(data)!}
  if (['completed', 'collected', 'cancelled', 'failed'].includes(data.status)) {
    return { ok: true, status: data.status as OrderStatus, estimatedWaitMinutes: null, completedAt: data.completed_at, isPaid:data.is_paid }
  }
  try {
    const snapshot = await loadQueueSnapshot()
    const planned = snapshot.plan.find(row => row.id === orderId)
    return { ok: true, status: data.status as OrderStatus, isPaid:data.is_paid, estimatedWaitMinutes: planned?.estimatedWaitMinutes ?? null,
      waitEstimateLabel: !snapshot.settings.isConfigured ? 'Queue setup unavailable' : snapshot.settings.activeServers === 0 ? 'Queue paused - waiting for staff' : planned?.estimatedWaitMinutes == null
        ? 'Wait estimate unavailable' : `About ${planned?.estimatedWaitMinutes} min before processing`, completedAt: data.completed_at }
  } catch {
    return { ok: true, status: data.status as OrderStatus, isPaid:data.is_paid, estimatedWaitMinutes: null, waitEstimateLabel: 'Wait estimate temporarily unavailable', completedAt: data.completed_at }
  }
}

export async function getOrderTrackingByNumberAction(orderNumber: string) {
  if (!hasServiceRoleConfig()) return { ok: false as const, error: 'Order database is unavailable.' }
  const number = orderNumber.trim().toUpperCase()
  if (!/^(ORD-\d{8}-\d+|LAN-\d{8}-[A-F0-9]{32})$/.test(number)) return { ok: false as const, error: 'Enter the full order number from your ticket.' }
  const result = await supabaseAdmin.from('orders').select('id,order_number,offline_ticket_number,created_at,service_options,queue_entries(queue_number)').eq(number.startsWith('LAN-')?'offline_ticket_number':'order_number',number).maybeSingle()
  if(result.error || !result.data){const local=findBufferedNumber(number);if(local && (result.error || local.offlineMeta)){if(ticketIsHeld(local))return {ok:false as const,error:orderHoldReason(local)!};return {ok:true as const,data:{ok:true,offline:true,status:local.status,orderNumber:local.order_number,queueNumber:local.queue_entries[0].queue_number,createdAt:local.created_at,pickupAt:pickupDeadline(local.service_options),estimatedWaitMinutes:null,waitEstimateLabel:'Saved on the shop server. Live status resumes after reconnection.',isPaid:local.is_paid}}}}
  if (result.error) return { ok: false as const, error: 'Order status could not be loaded. Please retry.' }
  if (!result.data) return { ok: false as const, error: 'Order not found. Check the full number on your ticket.' }
  const tracking = await getOrderTrackingAction(result.data.id)
  if (!tracking.ok) return { ok: false as const, error: tracking.error ?? 'Status unavailable.' }
  if(tracking.paymentStatus==='pending-verification')return {ok:false as const,error:tracking.holdReason ?? 'This request is awaiting staff verification. Return to your submitted request to wait for ticket release.'}
  return { ok: true as const, data: { ...tracking, orderNumber: result.data.offline_ticket_number ?? result.data.order_number, queueNumber: firstRelation(result.data.queue_entries)?.queue_number ?? null, createdAt: result.data.created_at, pickupAt:pickupDeadline(result.data.service_options) } }
}
