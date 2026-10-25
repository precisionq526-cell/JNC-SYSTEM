// Read-only deployment smoke check. Does not create an order, approve payment or print.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {config} from 'dotenv'
import {createClient} from '@supabase/supabase-js'
config({path:'.env.local',quiet:true})
const base='http://127.0.0.1:3100',pages=[]
for(const route of ['/order','/order/service/printing','/order/review?service=printing','/order/status','/order/queue','/login']) {
  const response=await fetch(base+route,{signal:AbortSignal.timeout(20000)}),html=await response.text()
  assert.equal(response.status,200,route);assert.ok(!html.includes('Internal Server Error'),route)
  for(const [href] of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>[match[1]]).slice(0,2))assert.equal((await fetch(new URL(href.replaceAll('&amp;','&'),base))).status,200)
  pages.push({route,status:response.status})
}
for(const route of ['/admin/collection','/admin/settings','/admin/reports','/admin/recovery']) {
  const response=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(20000)})
  assert.ok([303,307,308].includes(response.status),route+' requires normal sign-in');assert.match(response.headers.get('location'),/login/)
  pages.push({route,status:response.status,protected:true})
}
for(const proof of ['payment-proof','student-proof'])assert.equal((await fetch(base+'/api/admin/orders/11111111-1111-4111-8111-111111111111/'+proof)).status,403)
const cloud=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
const contract=await cloud.rpc('kiosk_data_contract_version');assert.equal(contract.data,3)
const settings=await cloud.from('sop_settings').select('policy,pricing').eq('id',1).single();assert.equal(settings.error,null)
const dispatch=await cloud.rpc('next_sop_order');assert.equal(dispatch.error,null,'Live dispatch can read existing orders')
const report={checkedAt:new Date().toISOString(),pages,contract:contract.data,policyConfigured:!!settings.data,dispatchReadable:!dispatch.error,privateProofAccessDenied:true,migrationSha256:createHash('sha256').update(await fs.readFile('supabase/migrations/20261025_sop_operations.sql')).digest('hex'),liveOrdersCreated:0,paymentsApproved:0,physicalPrints:0}
await fs.writeFile('../output/sop-live-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
