import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'
import {filesFingerprint} from '../src/lib/sop/quote-fingerprint.ts'
import {DEFAULT_SHOP_POLICY} from '../src/lib/sop/policy.ts'
import ts from 'typescript'
import {paymentAccounts,validatePayment,paymentReceiptMatches,encodePaymentNotes,readPaymentNotes} from '../src/lib/kiosk/payment.ts'
import {validatePickupAt} from '../src/lib/kiosk/pickup.ts'

const url = code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const compile = file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const serviceId = randomUUID(),adminId=randomUUID()
let state
const reset=()=>{state={uploads:[],commits:[],updates:[],transitions:[],existing:null,paymentNotes:null,isPaid:false,admin:false,customerAuth:null,hasProof:true,readError:false,updateError:false}}
reset()
globalThis.__orderPaymentDb={
  from(table){let update;const filters={};const row=()=>table==='services'?{id:serviceId,slug:'printing',is_active:true}:table==='profiles'?{role:state.admin?'admin':'customer'}:state.existing ?? (state.paymentNotes?{id:filters.id,customer_notes:state.paymentNotes,is_paid:state.isPaid,status:'pending',total_price:25}:null);const query={select(){return query},eq(key,value){filters[key]=value;return query},update(value){update=value;return query},async maybeSingle(){const data=row();return {data:data && Object.entries(filters).every(([key,value])=>data[key]===undefined || data[key]===value)?data:null,error:state.readError?{message:'Read unavailable'}:null}},then(resolve,reject){if(update && !state.updateError){const data=row();if(data && Object.entries(filters).every(([key,value])=>data[key]===undefined || data[key]===value)){state.updates.push(update);Object.assign(data,update);if(state.existing)state.existing=data;state.paymentNotes=data.customer_notes;state.isPaid=data.is_paid}}return Promise.resolve({error:state.updateError?{message:'Update unavailable'}:null}).then(resolve,reject)}};return query},
  storage:{from(){return {
    async upload(path,bytes,options){state.uploads.push({path,bytes,options});return {error:null}},
    async info(){return state.hasProof?{data:{size:8},error:null}:{data:null,error:{message:'Missing'}}},
  }}},
  rpc(name,args){const query={abortSignal(){return query},then(resolve,reject){return (async()=>{
    if(name==='kiosk_data_contract_version')return {data:3,error:null}
    if(name==='approve_sop_payment'){
      if(state.updateError)return {error:{message:'Update unavailable'}}
      const update={is_paid:true,payment_method:args.p_record.method,customer_notes:encodePaymentNotes(args.p_record),...(args.p_record.customerId?{customer_id:args.p_record.customerId}:{})};state.updates.push(update);state.isPaid=true;state.paymentNotes=update.customer_notes;if(state.existing)Object.assign(state.existing,update);return {error:null}
    }
    if(name==='transition_queue_order'){state.transitions.push(args);state.existing.status=args.p_status;return {error:null}}
    state.commits.push(args);state.existing={id:args.p_order_id,submission_key:args.p_submission_key,order_number:'ORD-20261024-001',total_price:args.p_meta.totalPrice,created_at:'2026-10-24T01:00:00Z',estimated_duration_minutes:5,service_id:serviceId,source:'online',customer_id:args.p_meta.customerId,customer_notes:args.p_meta.customerNotes,service_options:args.p_meta.serviceOptions,is_paid:false,payment_method:null,status:'pending',services:{name:'Printing'},queue_entries:{queue_number:1}};return {data:{orderId:args.p_order_id,orderNumber:state.existing.order_number,queueNumber:1,totalPrice:state.existing.total_price,createdAt:state.existing.created_at,estimatedDurationMinutes:5,serviceName:'Printing'},error:null}
  })().then(resolve,reject)}};return query}
}
globalThis.__orderPaymentAdmin=()=>state.admin?{ok:true,userId:adminId}:{ok:false,error:'Unauthorized'}
globalThis.__orderPaymentUser=()=>state.admin?{id:adminId}:state.customerAuth?{id:state.customerAuth}:null
const paymentUrl=url(compile('src/lib/kiosk/payment.ts'))
const workflowUrl=url(compile('src/lib/sop/workflow.ts').replace("'../kiosk/payment'",JSON.stringify(paymentUrl)))
globalThis.__orderPaymentPolicy={...DEFAULT_SHOP_POLICY,enforceHours:false}
const modules={
  '@/lib/sop/workflow':workflowUrl,
  '@/lib/sop/quote-fingerprint':url(compile('src/lib/sop/quote-fingerprint.ts')),
  '@/lib/sop/policy':url(compile('src/lib/sop/policy.ts')),
  '@/lib/sop/settings-server':url('export const loadSopSettings=async()=>({configured:true,offline:false,policy:globalThis.__orderPaymentPolicy});'),
  '@/lib/sop/local-store':url('export const localDatabase=()=>({prepare(){return {get(){return globalThis.__orderPaymentQuote}}}});'),
  '@/lib/sop/pickup-token':url('export const pickupToken=id=>id+".signed-test";'),
  '@/lib/sop/offline-buffer':url('export const readBufferedOrder=()=>null;export const findBufferedNumber=()=>null;export async function bufferSubmission(){throw Error("Offline path tested in SOP suite")}'),
  '@/lib/supabase/admin':url('export const supabaseAdmin=globalThis.__orderPaymentDb;'),
  '@/lib/supabase/env-server':url('export const hasServiceRoleConfig=()=>true;'),
  '@/lib/queue/queue-service':url('export const loadQueueSnapshot=async()=>null;'),
  '@/lib/supabase/server':url('export const createClient=async()=>({auth:{getUser:async()=>({data:{user:globalThis.__orderPaymentUser()}})},from:table=>globalThis.__orderPaymentDb.from(table)});'),
  '@/lib/admin/require-admin':url('export const requireAdmin=async()=>globalThis.__orderPaymentAdmin();'),
  '@/lib/kiosk/pickup':url(compile('src/lib/kiosk/pickup.ts')),
  ...Object.fromEntries([['@/lib/queue/scheduling','src/lib/queue/scheduling.ts'],['@/lib/utils/uuid','src/lib/utils/uuid.ts'],['@/lib/editor/file-types','src/lib/editor/file-types.ts'],['@/lib/supabase/relations','src/lib/supabase/relations.ts'],['@/lib/kiosk/print-options','src/lib/kiosk/print-options.ts'],['@/lib/kiosk/payment','src/lib/kiosk/payment.ts']].map(([alias,file])=>[alias,url(compile(file))]))
}
const load = async file=>{let code=compile(file);for(const [alias,value]of Object.entries(modules))code=code.replaceAll("'"+alias+"'",JSON.stringify(value));return import(url(code))}
const {submitOrderFormAction,getOrderReleaseAction,getOrderTrackingByNumberAction,updateOrderStatusAction}=await load('src/lib/actions/submit-order.ts')
const {verifyOrderPaymentAction}=await load('src/lib/actions/order-payment.ts')
const {submissionFromResult,isPendingPayment}=await load('src/lib/kiosk/order-release.ts')
const originalEnv={name:process.env.PAYMENT_GCASH_NAME,number:process.env.PAYMENT_GCASH_NUMBER}
process.env.PAYMENT_GCASH_NAME='Test account — never displayed in live data'
process.env.PAYMENT_GCASH_NUMBER='09123456789'
test.after(()=>{for(const [key,value]of [['PAYMENT_GCASH_NAME',originalEnv.name],['PAYMENT_GCASH_NUMBER',originalEnv.number]]){if(value===undefined)delete process.env[key];else process.env[key]=value}})
const form=(payment={method:'cash'},receipt=null,key=randomUUID())=>{
  const data=new FormData(),body='%PDF-1.7\nprint document',quoteId=randomUUID(),pricingOptions={Copies:1,'Paper Size':'A4'},hash=createHash('sha256').update(body).digest('hex')
  globalThis.__orderPaymentQuote={expires_at:new Date(Date.now()+1800000).toISOString(),payload:JSON.stringify({quote:{version:1,id:quoteId,total:3,student:false,fingerprint:filesFingerprint([{name:'print.pdf',hash}],pricingOptions,false)},hashes:[{name:'print.pdf',hash,pageCount:1}]})}
  data.append('meta',JSON.stringify({submissionKey:key,quoteId,serviceId,source:'online',serviceSlug:'printing',serviceOptions:{...pricingOptions,'Transaction Type':'walk-in'},totalPrice:3,estimatedDurationMinutes:5,payment}));data.append('files',new File([body],'print.pdf',{type:'application/pdf'}));if(receipt)data.append('paymentReceipt',receipt);return data
}
const png=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10])],'receipt.png',{type:'image/png'})

test('unconfigured wallets are unavailable and payment at pickup stays valid',()=>{
  assert.deepEqual(paymentAccounts({}),[])
  assert.deepEqual(paymentAccounts({PAYMENT_GCASH_NAME:'Incomplete account'}),[])
  assert.equal(validatePayment('cash','',null,[]),null)
  assert.match(validatePayment('gcash','123456',png(),[]),/unavailable/)
})
test('pickup validation uses Manila hours and rejects Sunday, past times and out-of-hours requests',()=>{
  const now=Date.parse('2026-10-24T00:00:00Z')
  assert.equal(validatePickupAt('2026-10-26T08:00:00+08:00',now),null)
  assert.equal(validatePickupAt('2026-10-26T10:00:00Z',now),null)
  assert.match(validatePickupAt('2026-10-26T10:01:00Z',now),/between/)
  assert.match(validatePickupAt('2026-10-25T12:00:00+08:00',now),/Monday/)
  assert.match(validatePickupAt('2026-10-23T12:00:00+08:00',now),/future/)
  assert.match(validatePickupAt('bad',now),/Choose/)
})
test('receipt validation rejects empty, oversized and invalid data; notes cannot supply arbitrary paths',()=>{
  const accounts=paymentAccounts(process.env)
  assert.match(validatePayment('gcash','abc',png(),accounts),/reference/)
  assert.match(validatePayment('gcash','123456',{name:'receipt.html',type:'text/html',size:100},accounts),/receipt/)
  assert.match(validatePayment('gcash','123456',{name:'receipt.png',type:'image/png',size:11*1024*1024},accounts),/10 MB/)
  assert.equal(paymentReceiptMatches(new Uint8Array([1,2,3]),'image/png'),false)
  assert.equal(readPaymentNotes('regular customer notes'),null)
  assert.equal(readPaymentNotes(encodePaymentNotes({method:'gcash',status:'pending-verification',receiptPath:'../../outside.pdf'})),null)
  assert.equal(readPaymentNotes('JNC_PAYMENT_V1:'+JSON.stringify({method:'cash',status:'unpaid',notes:{invalid:'object'}})),null)
})
test('cash orders commit an unpaid payment record without an online receipt',async()=>{
  reset();const result=await submitOrderFormAction(form());assert.equal(result.ok,true)
  const payment=readPaymentNotes(state.commits[0].p_meta.customerNotes)
  assert.deepEqual(payment,{method:'cash',status:'unpaid'})
  assert.equal(state.uploads.length,1);assert.equal(state.commits[0].p_files.length,1)
  assert.equal(state.commits[0].p_meta.is_paid,undefined)
  assert.match(result.orderNumber,/^ORD-/);assert.equal(result.paymentStatus,'unpaid');assert.equal(isPendingPayment(submissionFromResult(result)),false)
})
test('wallet receipt is stored separately, bound to the order, and pending verification; retry returns the same order',async()=>{
  reset();const key=randomUUID();const result=await submitOrderFormAction(form({method:'gcash',reference:'123456789012'},png(),key));assert.equal(result.ok,true)
  assert.equal(state.uploads.length,2);assert.equal(state.commits[0].p_files.length,1)
  assert.equal(state.commits[0].p_files[0].file_name,'print.pdf')
  const payment=readPaymentNotes(state.commits[0].p_meta.customerNotes)
  assert.equal(payment.status,'pending-verification');assert.equal(payment.reference,'123456789012')
  assert.ok(payment.receiptPath.startsWith(key+'/payment/'));assert.equal(state.updates.length,0)
  assert.equal(result.paymentStatus,'pending-verification');assert.equal(result.orderNumber,undefined);assert.equal(result.queueNumber,undefined)
  const retry=await submitOrderFormAction(form({method:'cash'},null,key))
  assert.equal(retry.orderId,result.orderId);assert.equal(state.uploads.length,2);assert.equal(state.commits.length,1)
  assert.equal(retry.orderNumber,undefined);assert.equal(retry.paymentStatus,'pending-verification')
})
test('spoofed receipt content and disabled wallet fail before upload or database commit',async()=>{
  reset();const bad=await submitOrderFormAction(form({method:'gcash',reference:'123456789'},new File(['not an image'],'fake.png',{type:'image/png'})))
  assert.equal(bad.ok,false);assert.match(bad.error,/content/);assert.equal(state.uploads.length,0)
  const disabled=await submitOrderFormAction(form({method:'maya',reference:'123456789'},png()))
  assert.equal(disabled.ok,false);assert.equal(state.commits.length,0)
})
test('only an administrator can confirm a recorded payment; missing wallet receipt prevents confirmation',async()=>{
  reset();const id=randomUUID();state.paymentNotes=encodePaymentNotes({method:'gcash',reference:'123456789',receiptPath:id+'/payment/'+'a'.repeat(64)+'.png',status:'pending-verification'})
  assert.equal((await verifyOrderPaymentAction(id)).ok,false);assert.equal(state.updates.length,0)
  state.admin=true;state.hasProof=false;assert.equal((await verifyOrderPaymentAction(id)).ok,false);assert.equal(state.updates.length,0)
  state.hasProof=true;assert.equal((await verifyOrderPaymentAction(id)).ok,true)
  assert.equal(state.updates[0].is_paid,true);assert.equal(state.updates[0].payment_method,'gcash')
  const approved=readPaymentNotes(state.updates[0].customer_notes);assert.equal(approved.status,'approved');assert.equal(approved.verifiedBy,adminId);assert.ok(Number.isFinite(Date.parse(approved.verifiedAt)))
})

test('admin approval releases the same request exactly once; polling and retries expose no number beforehand',async()=>{
  reset();const key=randomUUID(),submitted=await submitOrderFormAction(form({method:'gcash',reference:'123456789012'},png(),key))
  const pending=submissionFromResult(submitted,{orderNumber:'STALE-NUMBER',queueNumber:55})
  assert.equal(isPendingPayment(pending),true);assert.equal('orderNumber' in pending,false);assert.equal('queueNumber' in pending,false)
  assert.equal(JSON.stringify(await getOrderReleaseAction(key)).includes('ORD-'),false)
  assert.equal((await getOrderTrackingByNumberAction('ORD-20261024-001')).ok,false)
  state.admin=true
  for(const status of ['queued','processing','completed']){const result=await updateOrderStatusAction(key,status);assert.equal(result.ok,false);assert.match(result.error,/payment/)}
  assert.equal(state.transitions.length,0)
  assert.equal((await verifyOrderPaymentAction(key)).ok,true)
  const approved=await getOrderReleaseAction(key),ticket=submissionFromResult(approved,pending)
  assert.equal(ticket.orderNumber,'ORD-20261024-001');assert.equal(ticket.queueNumber,1);assert.equal(ticket.orderId,key);assert.equal(approved.paymentStatus,'approved');assert.equal(approved.isPaid,true)
  assert.equal((await verifyOrderPaymentAction(key)).ok,true);assert.equal(state.updates.length,1)
  assert.deepEqual(await getOrderReleaseAction(key),approved)
  assert.equal((await updateOrderStatusAction(key,'queued')).ok,true);assert.equal(state.transitions.length,1)
  assert.equal(state.commits.length,1)
})

test('Maya also waits for approval and a signed-in customer cannot read a reserved number through own-order policies',async()=>{
  reset();state.customerAuth=randomUUID();const key=randomUUID(),previousName=process.env.PAYMENT_MAYA_NAME,previousNumber=process.env.PAYMENT_MAYA_NUMBER
  process.env.PAYMENT_MAYA_NAME='Test account';process.env.PAYMENT_MAYA_NUMBER='09123456789'
  try {
    const result=await submitOrderFormAction(form({method:'maya',reference:'MAYA123456789'},png(),key))
    assert.equal(result.orderNumber,undefined);assert.equal(result.paymentMethod,'maya');assert.equal(state.commits[0].p_meta.customerId,null)
    assert.equal(readPaymentNotes(state.existing.customer_notes).customerId,state.customerAuth)
    state.admin=true;assert.equal((await verifyOrderPaymentAction(key)).ok,true)
    assert.equal(state.existing.customer_id,state.customerAuth);assert.equal((await getOrderReleaseAction(key)).paymentStatus,'approved')
  } finally {if(previousName===undefined)delete process.env.PAYMENT_MAYA_NAME;else process.env.PAYMENT_MAYA_NAME=previousName;if(previousNumber===undefined)delete process.env.PAYMENT_MAYA_NUMBER;else process.env.PAYMENT_MAYA_NUMBER=previousNumber}
})

test('database failures and closed requests cannot produce an approved ticket',async()=>{
  reset();const key=randomUUID();await submitOrderFormAction(form({method:'gcash',reference:'123456789012'},png(),key));state.admin=true
  state.updateError=true;assert.equal((await verifyOrderPaymentAction(key)).ok,false);assert.equal((await getOrderReleaseAction(key)).orderNumber,undefined)
  state.updateError=false;state.existing.status='cancelled';assert.equal((await verifyOrderPaymentAction(key)).ok,false);assert.equal((await getOrderReleaseAction(key)).orderNumber,undefined)
  state.readError=true;const unavailable=await getOrderReleaseAction(key);assert.equal(unavailable.ok,false);assert.equal(unavailable.orderNumber,undefined)
  assert.throws(()=>submissionFromResult({...unavailable,orderId:key}),/request|check/i)
})
