import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT NULL::uuid $$;")
let schema = await fs.readFile('supabase/migrations/20260513_initial_schema.sql','utf8')
schema = schema.slice(0, schema.indexOf('-- REALTIME CONFIG'))
await db.exec(schema)
const hardwareSchema=(await fs.readFile('supabase/migrations/20260529_mg1_hardware_failover.sql','utf8')).replace(/^ALTER PUBLICATION.*$/gm,'')
await db.exec(hardwareSchema)
const migration = await fs.readFile('supabase/migrations/20261012_live_data_integrity.sql','utf8')
await db.exec(migration)
const svc = (await db.query("SELECT id FROM services WHERE slug='printing'")).rows[0].id
const admin = randomUUID()
await db.query("INSERT INTO auth.users(id) VALUES($1)",[admin])
await db.query("INSERT INTO profiles(id,role) VALUES($1,'admin')",[admin])
await db.query("INSERT INTO service_options(service_id,name,option_type,default_value,is_required) VALUES($1,'Copies','number','1',true)",[svc])
const submit = async (key = randomUUID(), files, options = { Copies: 2, 'Transaction Type': 'walk-in' }) => {
  const meta = { serviceId:svc, source:'online', serviceOptions:options, totalPrice:0 }
  const uploaded = files ?? [{file_name:'proof.pdf',file_type:'application/pdf',file_size:10,storage_bucket:'order-files',storage_path:key+'/proof.pdf',asset_classification:'document'}]
  return (await db.query('SELECT commit_order_submission($1,$1,$2,$3) AS receipt',[key,JSON.stringify(meta),JSON.stringify(uploaded)])).rows[0].receipt
}
test('migration is repeatable and inserts no fabricated orders', async () => {
  await db.exec(migration)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,0)
  assert.equal((await db.query('SELECT active_servers FROM queue_settings')).rows[0].active_servers,0)
})
test('order, file and queue commit together with database prices; retry returns same receipt', async () => {
  const key = randomUUID()
  const a = await submit(key), b = await submit(key)
  assert.deepEqual(a,b)
  assert.equal(Number(a.totalPrice),10)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders WHERE submission_key=$1',[key])).rows[0].n,1)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM queue_entries WHERE order_id=$1',[a.orderId])).rows[0].n,1)
})
test('invalid file rolls back order, queue and counter changes', async () => {
  const before = (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n
  await assert.rejects(() => submit(randomUUID(),[{file_name:'bad.pdf',file_size:0,storage_path:'outside/file',storage_bucket:'order-files'}]))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,before)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders o LEFT JOIN queue_entries q ON q.order_id=o.id WHERE q.id IS NULL')).rows[0].n,0)
})
test('unconfigured and invalid options are rejected', async () => {
  await assert.rejects(() => submit(randomUUID(),undefined,{ Copies:0, 'Transaction Type':'walk-in' }))
  await assert.rejects(() => submit(randomUUID(),undefined,{ Copies:1, Fake:'demo', 'Transaction Type':'walk-in' }))
})

test('all printing instructions and the edited file checksum are committed with the queue entry', async () => {
  await db.query("INSERT INTO service_options(service_id,name,option_type,choices,default_value,is_required) VALUES($1,'Paper Size','select','[\"A4\",\"Short\",\"Long\"]','A4',true),($1,'Print Color','select','[\"B&W\",\"Colored\"]','B&W',true),($1,'Back to back','toggle',NULL,'No',true),($1,'Pages to print','text',NULL,'All',true)",[svc])
  try {
    const key = randomUUID()
    const options = { 'Paper Size': 'Long', 'Print Color': 'Colored', 'Back to back': 'Yes', 'Pages to print': '1-2, 5', Copies: 3, 'Transaction Type': 'walk-in' }
    const file = { file_name: 'edited.docx', file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 1234, storage_bucket: 'order-files', storage_path: key + '/edited.docx', asset_classification: 'document', metadata: { sha256: 'edited-content-checksum' } }
    const receipt = await submit(key, [file], options)
    const saved = (await db.query('SELECT service_options FROM orders WHERE id=$1', [receipt.orderId])).rows[0]
    assert.deepEqual(saved.service_options, options)
    assert.equal((await db.query('SELECT metadata FROM order_files WHERE order_id=$1', [receipt.orderId])).rows[0].metadata.sha256, file.metadata.sha256)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM queue_entries WHERE order_id=$1', [receipt.orderId])).rows[0].n, 1)
  } finally { await db.query("DELETE FROM service_options WHERE service_id=$1 AND name<>'Copies'",[svc]) }
})
test('ticket numbers remain unique beyond 999 and use Manila dates', async () => {
  await db.exec("UPDATE daily_ticket_counters SET last_order=999,last_queue=999 WHERE ticket_date=(now() AT TIME ZONE 'Asia/Manila')::date")
  const a = await submit(), b = await submit()
  assert.match(a.orderNumber,/-1000$/)
  assert.equal(a.queueNumber,1000)
  assert.notEqual(a.orderNumber,b.orderNumber)
  assert.notEqual(a.queueNumber,b.queueNumber)
})
test('status transition enforces admin access and shared staff capacity; updates queue atomically', async () => {
  const a = await submit(), b = await submit()
  await assert.rejects(() => db.query("SELECT transition_queue_order($1,'processing',$2)",[a.orderId,randomUUID()]))
  await assert.rejects(() => db.query("SELECT transition_queue_order($1,'processing',$2)",[a.orderId,admin]))
  await db.exec('UPDATE queue_settings SET active_servers=1')
  await db.query("SELECT transition_queue_order($1,'processing',$2)",[a.orderId,admin])
  await assert.rejects(() => db.query("SELECT transition_queue_order($1,'processing',$2)",[b.orderId,admin]))
  await db.query("SELECT transition_queue_order($1,'completed',$2)",[a.orderId,admin])
  const q = (await db.query('SELECT status,finished_at FROM queue_entries WHERE order_id=$1',[a.orderId])).rows[0]
  assert.equal(q.status,'served'); assert.ok(q.finished_at)
  await db.query("SELECT transition_queue_order($1,'processing',$2)",[b.orderId,admin])
})
test('mobile transfer commits a whole batch and rejects expired sessions',async()=>{
  const active=randomUUID(),expired=randomUUID()
  await db.query("INSERT INTO transfer_sessions(id,short_code,expires_at) VALUES($1,'ABCDEF',now()+interval '15 minutes'),($2,'GHIJKL',now()-interval '1 minute')",[active,expired])
  const files=[{file_name:'proof.pdf',file_type:'application/pdf',file_size:10,storage_path:active+'/proof.pdf'}]
  const result=await db.query('SELECT commit_transfer_files($1,$2) AS files',[active,JSON.stringify(files)])
  assert.equal(result.rows[0].files.length,1)
  await assert.rejects(()=>db.query('SELECT commit_transfer_files($1,$2)',[expired,JSON.stringify(files)]))
  await assert.rejects(()=>db.query('SELECT commit_transfer_files($1,$2)',[active,JSON.stringify([...files,{...files[0],storage_path:'outside'}])]))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM transfer_files')).rows[0].n,1)
})
test('service configuration updates price and options together with admin authorization',async()=>{
  const service={id:svc,base_price:7,estimated_duration_minutes:4,is_active:true}
  const options=[{name:'Copies',option_type:'number',choices:[],default_value:'1',price_modifier:0,is_required:true,display_order:0}]
  await assert.rejects(()=>db.query('SELECT save_service_configuration($1,$2,$3)',[JSON.stringify(service),JSON.stringify(options),randomUUID()]))
  await db.query('SELECT save_service_configuration($1,$2,$3)',[JSON.stringify(service),JSON.stringify(options),admin])
  const receipt=await submit()
  assert.equal(Number(receipt.totalPrice),14)
})
test('anonymous role cannot call transaction functions or modify queues and profile roles',async()=>{
  await db.exec('SET ROLE anon')
  try{
    await assert.rejects(()=>db.query('SELECT commit_order_submission($1,$1,$2,$3)',[randomUUID(),'{}','[]']))
    await assert.rejects(()=>db.exec("UPDATE queue_entries SET status='served'"))
    await assert.rejects(()=>db.exec("UPDATE profiles SET role='admin'"))
  }finally{await db.exec('RESET ROLE')}
})
test('failover records and assignment change together; stale printers are excluded',async()=>{
  const receipt=await submit(), failed=randomUUID(), fresh=randomUUID(), stale=randomUUID()
  await db.query("INSERT INTO hardware_devices(id,device_name,device_type,status,last_heartbeat) VALUES($1,'failed','printer','offline',now()),($2,'fresh','printer','online',now()),($3,'stale','printer','online',now()-interval '10 minutes')",[failed,fresh,stale])
  const job=(await db.query("INSERT INTO print_job_assignments(order_id,device_id,status) VALUES($1,$2,'assigned') RETURNING id",[receipt.orderId,failed])).rows[0].id
  assert.equal((await db.query('SELECT reroute_hardware_assignment($1,$2,$3) AS outcome',[job,failed,'Offline'])).rows[0].outcome,'rerouted')
  assert.equal((await db.query('SELECT device_id FROM print_job_assignments WHERE id=$1',[job])).rows[0].device_id,fresh)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM failover_events WHERE assignment_id=$1',[job])).rows[0].n,1)
  assert.equal((await db.query('SELECT reroute_hardware_assignment($1,$2,$3) AS outcome',[job,failed,'Repeated'])).rows[0].outcome,'skipped')
})
test.after(async () => { await db.close() })
