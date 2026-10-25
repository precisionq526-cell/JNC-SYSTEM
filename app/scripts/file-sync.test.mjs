import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { syncOrderFiles, localFilePath } from './lib/file-sync.mjs'
const root = path.resolve('../tmp/sync-fixtures',randomUUID())
await fs.mkdir(root,{recursive:true})
const file = {id:'file-1',file_name:'../../report.pdf',file_size:4,storage_bucket:'order-files',storage_path:'cloud/report.pdf',is_downloaded:true}
const order = {id:'order-1',order_number:'ORD-20261012-001',local_synced:true,order_files:[file]}
function mock({missing=false,dbFailure=false}={}) {
  const updates=[], downloads=[]
  return {updates,downloads,storage:{from:()=>({download:async p=>{downloads.push(p); return missing ? {error:{message:'not found'}} : {data:new Blob(['test'])}},
    info:async()=>missing ? {error:{message:'not found'}} : {data:{size:4}},
    remove:()=>{throw Error('Cloud deletion must never be called')}})},
    from:table=>({update:value=>({eq:()=>({select:()=>({single:async()=>{updates.push({table,value}); return dbFailure ? {error:{message:'db down'}} : {data:{id:1}}}})})})})}
}
test('stale downloaded flag re-downloads a missing local file; cloud retained',async()=>{
  const client=mock()
  const result=await syncOrderFiles(client,root,order)
  assert.equal(result.synced,true,JSON.stringify(result)); assert.equal(result.downloaded,1)
  assert.equal(await fs.readFile(localFilePath(root,order,file),'utf8'),'test')
  assert.ok(client.updates.some(v=>v.table==='orders'&&v.value.local_synced))
})
test('missing cloud source never marks order synced',async()=>{
  const other={...order,order_number:'ORD-20261012-002'}
  const client=mock({missing:true}), result=await syncOrderFiles(client,root,other)
  assert.equal(result.synced,false)
  assert.ok(client.updates.some(v=>v.table==='orders'&&v.value.local_synced===false))
})
test('database update failure is reported even after successful local write',async()=>{
  const client=mock({dbFailure:true})
  const result=await syncOrderFiles(client,root,{...order,order_number:'ORD-20261012-003'})
  assert.equal(result.synced,false); assert.ok(result.errors.length)
})
test('dry run writes neither files nor database',async()=>{
  const client=mock(), other={...order,order_number:'ORD-20261012-004'}
  const result=await syncOrderFiles(client,root,other,{dryRun:true})
  assert.equal(result.synced,false); assert.equal(client.updates.length,0); assert.equal(client.downloads.length,0)
  await assert.rejects(()=>fs.stat(localFilePath(root,other,file)))
})
test('empty metadata and path traversal cannot claim successful sync',async()=>{
  const client=mock()
  assert.equal((await syncOrderFiles(client,root,{...order,order_files:[]})).synced,false)
  assert.throws(()=>localFilePath(root,{...order,order_number:'../escape'},file))
  assert.equal(path.dirname(localFilePath(root,order,file)),path.join(root,'orders',order.order_number))
})
