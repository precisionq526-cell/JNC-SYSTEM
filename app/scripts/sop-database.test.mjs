import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
after(()=>db.close())
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT NULL::uuid $$;")
let schema=await fs.readFile('supabase/migrations/20260513_initial_schema.sql','utf8')
await db.exec(schema.slice(0,schema.indexOf('-- REALTIME CONFIG')))
await db.exec((await fs.readFile('supabase/migrations/20260529_mg1_hardware_failover.sql','utf8')).replace(/^ALTER PUBLICATION.*$/gm,''))
await db.exec(await fs.readFile('supabase/migrations/20261012_live_data_integrity.sql','utf8'))
const migration=await fs.readFile('supabase/migrations/20261025_sop_operations.sql','utf8')
await db.exec(migration)
const svc=(await db.query("SELECT id FROM services WHERE slug='printing'")).rows[0].id,admin=randomUUID()
await db.query('INSERT INTO auth.users VALUES($1)',[admin]);await db.query("INSERT INTO profiles(id,role) VALUES($1,'admin')",[admin])
await db.query("INSERT INTO service_options(service_id,name,option_type,default_value,is_required) VALUES($1,'Copies','number','1',true),($1,'Paper Size','select','A4',true)",[svc])
await db.exec("UPDATE service_options SET choices='[\"A4\",\"Short\",\"Long\",\"Legal\"]' WHERE name='Paper Size'; UPDATE sop_settings SET policy=jsonb_set(policy,'{enforceHours}','false'); UPDATE queue_settings SET active_servers=2")
async function submit({student=false,schedule=false,method='cash',receipt=false,quoteTotal=9,offline=false}={}) {
  const id=randomUUID(),options={Copies:1,'Paper Size':'A4','Transaction Type':schedule?'schedule':'walk-in',...(schedule?{'Pickup At':new Date(Date.now()+3600000).toISOString()}:{})}
  const quote={version:1,id:randomUUID(),fingerprint:randomUUID(),paper:'A4',copies:1,student,total:quoteTotal,expiresAt:new Date(Date.now()+1800000).toISOString(),pages:[1,2,3].map(page=>({fileIndex:0,page,category:'bw',textCoverage:.2,imageCoverage:0})),finishing:[]}
  const meta={serviceId:svc,source:'online',serviceOptions:options,pricingQuote:quote,studentProof:student?{path:id+'/student/id.png'}:null,customerNotes:'JNC_PAYMENT_V1:'+JSON.stringify({method,status:'pending-verification',...(receipt?{receiptPath:id+'/payment/receipt.png'}:{})})}
  if(offline){meta.offlineSubmittedAt=new Date().toISOString();meta.offlineTicketNumber='LAN-'+new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}).replaceAll('-','')+'-'+id.replaceAll('-','').toUpperCase()}
  const files=[{file_name:'sample.pdf',file_type:'application/pdf',file_size:10,storage_bucket:'order-files',storage_path:id+'/sample.pdf',metadata:{pageCount:3}}]
  return (await db.query('SELECT commit_order_submission($1,$1,$2,$3) AS receipt',[id,JSON.stringify(meta),JSON.stringify(files)])).rows[0].receipt
}
test('migration is repeatable and contract is version 3',async()=>{await db.exec(migration);assert.equal((await db.query('SELECT kiosk_data_contract_version() AS n')).rows[0].n,3)})
test('multi-page billing is canonical and a forged total rolls back',async()=>{
  const row=await submit();assert.equal(row.totalPrice,9)
  assert.equal((await db.query('SELECT page_count FROM order_files WHERE order_id=$1',[row.orderId])).rows[0].page_count,3)
  await assert.rejects(submit({quoteTotal:3}),/prices changed/)
})
test('closed intake rejects orders',async()=>{
  await db.exec("UPDATE sop_settings SET policy=jsonb_set(policy,'{intakeState}','\"closed\"')")
  await assert.rejects(submit(),/intake is closed/)
  await db.exec("UPDATE sop_settings SET policy=jsonb_set(policy,'{intakeState}','\"online\"')")
})
test('student discount needs verification before production',async()=>{
  const row=await submit({student:true,quoteTotal:6})
  await assert.rejects(db.query('SELECT transition_queue_order($1,$2,$3)',[row.orderId,'processing',admin]),/Verify/)
})
test('scheduled counter cash needs prepayment and gets an expiry',async()=>{
  const row=await submit({schedule:true})
  const order=(await db.query('SELECT * FROM orders WHERE id=$1',[row.orderId])).rows[0]
  assert.ok(order.payment_expires_at);assert.equal(order.ticket_released_at,null)
  await assert.rejects(db.query('SELECT transition_queue_order($1,$2,$3)',[row.orderId,'processing',admin]),/Verify/)
})
test('printing, finishing, ready, paid collection are distinct and audited',async()=>{
  await db.exec("UPDATE orders SET status='cancelled' WHERE status IN('pending','queued')")
  const row=await submit()
  for(const status of ['processing','finishing','completed'])await db.query('SELECT transition_queue_order($1,$2,$3)',[row.orderId,status,admin])
  await assert.rejects(db.query('SELECT transition_queue_order($1,$2,$3)',[row.orderId,'collected',admin]),/payment received/)
  await db.query('UPDATE orders SET is_paid=true WHERE id=$1',[row.orderId])
  await db.query('SELECT transition_queue_order($1,$2,$3)',[row.orderId,'collected',admin])
  assert.ok((await db.query('SELECT collected_at FROM orders WHERE id=$1',[row.orderId])).rows[0].collected_at)
})
test('expiry never cancels a submitted wallet receipt',async()=>{
  const row=await submit({method:'gcash',receipt:true})
  await db.query("UPDATE orders SET payment_expires_at=now()-interval '1 minute' WHERE id=$1",[row.orderId])
  await db.query('SELECT expire_unpaid_requests()')
  assert.equal((await db.query('SELECT status FROM orders WHERE id=$1',[row.orderId])).rows[0].status,'pending')
})

test('student and wallet approval release a ticket only when both are approved',async()=>{
  const row=await submit({student:true,method:'maya',receipt:true,quoteTotal:6})
  await db.query('SELECT approve_sop_payment($1,$2,$3)',[row.orderId,JSON.stringify({method:'maya',status:'approved'}),admin])
  assert.equal((await db.query('SELECT ticket_released_at FROM orders WHERE id=$1',[row.orderId])).rows[0].ticket_released_at,null)
  await db.query('SELECT verify_sop_student($1,true,$2,$3)',[row.orderId,'Valid student ID',admin])
  assert.ok((await db.query('SELECT ticket_released_at FROM orders WHERE id=$1',[row.orderId])).rows[0].ticket_released_at)
  await assert.rejects(db.query('SELECT verify_sop_student($1,true,$2,$3)',[row.orderId,'Valid student ID',admin]),/no longer pending/)
})
test('cash collection checks amount, records change and prevents double collection',async()=>{
  const row=await submit();await db.query("UPDATE orders SET status='completed',completed_at=now() WHERE id=$1",[row.orderId])
  await assert.rejects(db.query('SELECT collect_sop_order($1,8,$2,$3)',[row.orderId,'Signed ticket QR',admin]),/full cash payment/)
  assert.equal((await db.query('SELECT is_paid FROM orders WHERE id=$1',[row.orderId])).rows[0].is_paid,false)
  await db.query('SELECT collect_sop_order($1,10,$2,$3)',[row.orderId,'Signed ticket QR',admin])
  assert.equal((await db.query('SELECT status FROM orders WHERE id=$1',[row.orderId])).rows[0].status,'collected')
  assert.equal(Number((await db.query("SELECT metadata->>'change' AS n FROM audit_log WHERE event_type='pickup_verified' AND entity_id=$1",[row.orderId])).rows[0].n),1)
  await assert.rejects(db.query('SELECT collect_sop_order($1,10,$2,$3)',[row.orderId,'Signed ticket QR',admin]),/not available/)
})
test('legacy wallet notes are held without rewriting payment fields',async()=>{
  const row=await submit({method:'gcash',receipt:true})
  await db.query('UPDATE orders SET payment_method=NULL WHERE id=$1',[row.orderId])
  assert.equal((await db.query('SELECT sop_order_held(o) AS held,payment_method FROM orders o WHERE id=$1',[row.orderId])).rows[0].held,true)
  assert.equal((await db.query('SELECT payment_method FROM orders WHERE id=$1',[row.orderId])).rows[0].payment_method,null)
})
test('unpaid counter expiry cancels only requests without receipts',async()=>{
  const row=await submit({schedule:true})
  await db.query("UPDATE orders SET payment_expires_at=now()-interval '1 minute' WHERE id=$1",[row.orderId])
  await db.query('SELECT expire_unpaid_requests()')
  assert.equal((await db.query('SELECT status FROM orders WHERE id=$1',[row.orderId])).rows[0].status,'cancelled')
})
test('dispatch enforces FIFO, distinct finishing, setup audit and admin role',async()=>{
  await db.exec("UPDATE orders SET status='cancelled' WHERE status IN('pending','queued')")
  const first=await submit(),second=await submit()
  await db.query('SELECT set_sop_order_estimate($1,1,5,$2)',[first.orderId,admin])
  await assert.rejects(db.query('SELECT set_sop_order_estimate($1,1,5,$2)',[first.orderId,randomUUID()]),/Administrator/)
  assert.equal((await db.query('SELECT next_sop_order() AS id')).rows[0].id,first.orderId)
  await assert.rejects(db.query("SELECT transition_queue_order($1,'processing',$2)",[second.orderId,admin]),/first eligible/)
  await db.query("SELECT transition_queue_order($1,'processing',$2)",[first.orderId,admin])
  await assert.rejects(db.query("SELECT transition_queue_order($1,'completed',$2)",[first.orderId,admin]),/finishing/)
  await db.query("SELECT transition_queue_order($1,'finishing',$2)",[first.orderId,admin])
  await db.query("SELECT transition_queue_order($1,'completed',$2)",[first.orderId,admin])
})
test('offline ticket aliases remain unique and primary cloud numbers are retained',async()=>{
  const row=await submit({offline:true})
  const saved=(await db.query('SELECT order_number,offline_ticket_number FROM orders WHERE id=$1',[row.orderId])).rows[0]
  assert.match(saved.order_number,/^ORD-/);assert.match(saved.offline_ticket_number,/^LAN-\d{8}-[A-F0-9]{32}$/)
  assert.notEqual(saved.order_number,saved.offline_ticket_number)
})
test('legacy internals and privileged operations are unavailable to public roles',async()=>{
  for(const name of ['commit_order_submission_v2(uuid,uuid,jsonb,jsonb)','transition_queue_order_v2(uuid,text,uuid)','collect_sop_order(uuid,numeric,text,uuid)','approve_sop_payment(uuid,jsonb,uuid)']) {
    assert.equal((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS allowed",['public.'+name])).rows[0].allowed,false)
    assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed",['public.'+name])).rows[0].allowed,false)
  }
})
