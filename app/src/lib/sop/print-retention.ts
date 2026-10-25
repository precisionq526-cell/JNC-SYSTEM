import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Remove only old generated spool snapshots for confirmed closed orders.
 * Originals, proof uploads, receipts, active jobs and uncertain print runs stay intact. */
export async function prunePrintSnapshots(runtime:string, closedOrderIds:Set<string>, now=Date.now()) {
  const folder=path.resolve(runtime,'print-receipts','snapshots')
  const root=await fs.realpath(folder).catch(()=>null)
  if(!root)return 0
  let removed=0
  for(const entry of await fs.readdir(root,{withFileTypes:true})) {
    if(!entry.isFile() || !/^[a-f0-9-]{36}\.pdf$/i.test(entry.name))continue
    const target=await fs.realpath(path.join(root,entry.name)).catch(()=>null)
    if(!target || path.dirname(target)!==root)continue
    const stat=await fs.stat(target)
    if(now-stat.mtimeMs<30*86400000)continue
    const receipt=await fs.readFile(path.join(runtime,'print-receipts',entry.name.replace(/\.pdf$/,'.json')),'utf8').then(JSON.parse).catch(()=>null)
    if(receipt?.status!=='submitted' || !closedOrderIds.has(receipt.receipt?.orderId))continue
    await fs.unlink(target);removed++
  }
  return removed
}
