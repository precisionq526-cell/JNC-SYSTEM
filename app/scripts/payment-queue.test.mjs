import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {encodePaymentNotes} from '../src/lib/kiosk/payment.ts'
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const base={created_at:new Date(Date.now()-300000).toISOString(),estimated_duration_minutes:5,service_options:{Copies:1},status:'pending',started_at:null,is_rush:false,services:{name:'Printing'},queue_entries:[],order_files:[]}
const cash={...base,id:'cash',is_paid:false,customer_notes:encodePaymentNotes({method:'cash',status:'unpaid'})}
const wallet={...base,id:'wallet',is_paid:false,payment_method:null,customer_notes:encodePaymentNotes({method:'gcash',status:'pending-verification'})}
globalThis.__paymentQueueDb={from(table){let fields='';const query={select(value){fields=value;return query},eq(){return query},in(){return query},gte(){return query},or(){return query},order(){return query},limit(){return query},async single(){return {data:{active_servers:1,atc_lookahead:2,page_penalty:0,max_wait_minutes:60},error:null}},then(resolve,reject){const data=table==='services'?[{estimated_duration_minutes:5}]:fields.startsWith('id, order_number')?[]:[cash,wallet];return Promise.resolve({data,error:null,count:data.length}).then(resolve,reject)}};return query}}
const mg1=url(compile('src/lib/queue/mg1-model.ts')),ggc=url(compile('src/lib/queue/ggc-model.ts').replace("'./mg1-model'",JSON.stringify(mg1)))
let code=compile('src/lib/queue/queue-service.ts').replace("import 'server-only';",'')
const paymentUrl=url(compile('src/lib/kiosk/payment.ts'));const workflowUrl=url(compile('src/lib/sop/workflow.ts').replace("'../kiosk/payment'",JSON.stringify(paymentUrl)))
const imports={'@/lib/sop/workflow':workflowUrl,'@/lib/sop/settings-server':url("export const loadSopSettings=async()=>({policy:{dispatchMode:'deadline-aware',completionBufferMinutes:0}});"),'@/lib/supabase/admin':url('export const supabaseAdmin=globalThis.__paymentQueueDb;'),'./ggc-model':ggc,'./scheduling':url(compile('src/lib/queue/scheduling.ts')),'@/lib/supabase/relations':url(compile('src/lib/supabase/relations.ts')),'@/lib/kiosk/payment':url(compile('src/lib/kiosk/payment.ts'))}
for(const [name,replacement]of Object.entries(imports))code=code.replaceAll("'"+name+"'",JSON.stringify(replacement))
const {loadQueueSnapshot}=await import(url(code))

test('wallet requests waiting for approval consume no queue position or workload; approval admits the same request',async()=>{
  const before=await loadQueueSnapshot()
  assert.deepEqual(before.orders.map(row=>row.id),['cash']);assert.equal(before.plan.some(row=>row.id==='wallet'),false)
  assert.equal(before.metrics.arrivalRatePerMinute,1/60)
  wallet.is_paid=true
  const after=await loadQueueSnapshot()
  assert.deepEqual(after.orders.map(row=>row.id),['cash','wallet']);assert.equal(after.plan.some(row=>row.id==='wallet'),true)
  assert.equal(after.metrics.arrivalRatePerMinute,2/60)
})
