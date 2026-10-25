import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export function withinRoot(root, candidate) {
  const relative = path.relative(path.resolve(root),path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
export function localFilePath(root, order, file) {
  if (!/^[A-Za-z0-9_-]+$/.test(order.order_number) || !/^[A-Za-z0-9_-]+$/.test(file.id)) throw new Error('Unsafe order or file identifier')
  const safeName = file.file_name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120) || 'file'
  const target = path.join(root,'orders',order.order_number,file.id+'_'+safeName)
  if (!withinRoot(root,target)) throw new Error('File path is outside kiosk storage')
  return target
}
export async function verifiedLocalFile(root, candidate, file) {
  if (!candidate || !withinRoot(root,candidate)) return false
  try {
    const real = await fs.realpath(candidate)
    if (!withinRoot(await fs.realpath(root),real)) return false
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size !== Number(file.file_size)) return false
    if (file.metadata?.sha256) {
      const digest = createHash('sha256').update(await fs.readFile(real)).digest('hex')
      if (digest !== file.metadata.sha256) return false
    }
    return true
  } catch { return false }
}
export async function syncOrderFiles(client, root, order, {dryRun=false}={}) {
  const result = { orderId:order.id, files:0, available:0, downloaded:0, missing:0, errors:[], synced:false }
  const files = order.order_files ?? []
  if (!files.length) { result.errors.push('No attached files; no file-sync claim was made.'); return result }
  for (const file of files) {
    result.files++
    try {
      const target = localFilePath(root,order,file)
      const existing = await verifiedLocalFile(root,file.local_path,file) ? file.local_path
        : await verifiedLocalFile(root,target,file) ? target : null
      let confirmedPath = existing
      if (!confirmedPath) {
        if (dryRun) {
          const info = await client.storage.from(file.storage_bucket).info(file.storage_path)
          if (info.error || !info.data) {
            if (String(info.error?.statusCode)==='404' || /not found/i.test(info.error?.message ?? '')) result.missing++
            result.errors.push('Cloud source unavailable for file ' + file.id)
          }
          else result.errors.push('Local download required for file ' + file.id)
          continue
        }
        const download = await client.storage.from(file.storage_bucket).download(file.storage_path)
        if (download.error || !download.data) {
          if (String(download.error?.statusCode)==='404' || /not found/i.test(download.error?.message ?? '')) result.missing++
          throw new Error('Cloud source unavailable for file ' + file.id)
        }
        const buffer = Buffer.from(await download.data.arrayBuffer())
        if (buffer.length !== Number(file.file_size)) throw new Error('Downloaded size mismatch for file ' + file.id)
        if (file.metadata?.sha256 && createHash('sha256').update(buffer).digest('hex') !== file.metadata.sha256) throw new Error('Downloaded checksum mismatch for file ' + file.id)
        // Verify real parent paths too, so a junction cannot redirect the write outside the root.
        await fs.mkdir(path.dirname(target),{recursive:true})
        const parent = await fs.realpath(path.dirname(target)), realRoot = await fs.realpath(root)
        if (!withinRoot(realRoot,parent)) throw new Error('Local directory points outside kiosk storage')
        const temp = target + '.part-' + randomUUID()
        try { await fs.writeFile(temp,buffer,{flag:'wx'}); await fs.rename(temp,target) }
        finally { await fs.rm(temp,{force:true}) }
        if (!await verifiedLocalFile(root,target,file)) throw new Error('Local file verification failed')
        confirmedPath = target
        result.downloaded++
      }
      result.available++
      if (!dryRun && (!file.is_downloaded || file.local_path !== confirmedPath)) {
        const saved = await client.from('order_files').update({is_downloaded:true,local_path:confirmedPath,
          downloaded_at: existing ? file.downloaded_at ?? new Date().toISOString() : new Date().toISOString()}).eq('id',file.id).select('id').single()
        if (saved.error || !saved.data) throw new Error('File sync status could not be saved for ' + file.id)
      }
    } catch (error) {
      result.errors.push(error.message)
      if (!dryRun && file.is_downloaded) {
        const reset = await client.from('order_files').update({is_downloaded:false}).eq('id',file.id).select('id').single()
        if (reset.error) result.errors.push('Could not reset the unavailable file flag')
      }
    }
  }
  result.synced = result.available === files.length && !result.errors.length
  const orderPath=result.synced ? path.join(root,'orders',order.order_number) : null
  if (!dryRun && (order.local_synced !== result.synced || order.local_path !== orderPath)) {
    const saved = await client.from('orders').update({local_synced:result.synced,local_path:orderPath}).eq('id',order.id).select('id').single()
    if (saved.error || !saved.data) { result.synced=false; result.errors.push('Order sync status could not be saved') }
  }
  // Cloud files are retained. Download success never causes source deletion.
  return result
}
