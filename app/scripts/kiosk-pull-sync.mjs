import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import { syncOrderFiles } from './lib/file-sync.mjs'
import { syncPrintHistory } from './lib/print-history-sync.mjs'

dotenv.config({path:'.env.local',quiet:true})
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase environment is missing')
const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const root = path.resolve(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles')
const dryRun = process.argv.includes('--dry-run')
const once = dryRun || process.argv.includes('--once')
const interval = Math.max(5000,Number(process.env.KIOSK_SYNC_INTERVAL_MS) || 15000)
const runtime = path.resolve(process.env.KIOSK_RUNTIME_PATH || path.join(root,'.runtime'))
const lock = path.join(runtime,'kiosk-sync.lock')
const parentIndex = process.argv.indexOf('--parent-pid')
const parentPid = parentIndex < 0 ? null : Number(process.argv[parentIndex+1])
const alive = pid => { try { process.kill(pid,0); return true } catch { return false } }
if (!once) {
  await fs.mkdir(runtime,{recursive:true})
  try { await fs.writeFile(lock,JSON.stringify({pid:process.pid}),{flag:'wx'}) }
  catch {
    const existing=JSON.parse(await fs.readFile(lock,'utf8').catch(()=>'{}'))
    if (existing.pid && alive(existing.pid)) process.exit(0)
    await fs.rm(lock,{force:true})
    try { await fs.writeFile(lock,JSON.stringify({pid:process.pid}),{flag:'wx'}) } catch { process.exit(0) }
  }
}
async function recordStatus(summary) {
  if(once)return
  await fs.writeFile(path.join(runtime,'sync-status.tmp'),JSON.stringify({...summary,pid:process.pid,checkedAt:new Date().toISOString()}))
  await fs.rename(path.join(runtime,'sync-status.tmp'),path.join(runtime,'sync-status.json'))
}
async function tick() {
  const response = await client.from('orders').select('id,order_number,local_synced,order_files(*)')
    .in('status',['pending','queued','processing','completed']).order('created_at').limit(1000)
  if (response.error) throw new Error('Cannot read orders: ' + response.error.message)
  if (response.data.length === 1000) throw new Error('Sync exceeds 1,000 orders; configure a narrower worker scope')
  const summary = {dryRun,orders:0,synced:0,downloaded:0,missing:0,errors:[]}
  for (const order of response.data) {
    const result = await syncOrderFiles(client,root,order,{dryRun})
    summary.orders++; summary.synced += Number(result.synced); summary.downloaded += result.downloaded; summary.missing += result.missing
    if (result.errors.length) summary.errors.push({orderId:order.id,errors:result.errors})
  }
  if (!dryRun) {
    const history = await syncPrintHistory(client,path.join(runtime,'print-receipts'))
    summary.printHistorySynced = history.synced; summary.printHistoryPending = history.pending
  }
  console.log(JSON.stringify(summary))
  await recordStatus(summary)
}

try {
  do {
    if(parentPid && !alive(parentPid))break
    await tick().catch(async error => { console.error(error.message); await recordStatus({orders:0,synced:0,missing:0,error:'Could not connect to the database or local file storage.'}) })
    if (!once) await new Promise(resolve => setTimeout(resolve,interval))
  } while (!once)
} finally { if(!once)await fs.rm(lock,{force:true}) }
