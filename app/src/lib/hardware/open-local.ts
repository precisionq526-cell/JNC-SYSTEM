import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function openVerifiedLocal(request: Request, folder: boolean) {
  const supabase = await createClient()
  const { data:{user} } = await supabase.auth.getUser()
  if (!user) return Response.json({error:'Unauthorized'},{status:401})
  const profile = await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle()
  if (profile.data?.role !== 'admin') return Response.json({error:'Unauthorized'},{status:403})
  if (process.platform !== 'win32') return Response.json({error:'Local opening requires the Windows kiosk PC.'},{status:400})
  const body = await request.json().catch(()=>null)
  if (!body || (folder ? typeof body.orderNumber !== 'string' : typeof body.fileId !== 'string')) return Response.json({error:'Invalid file request'},{status:400})
  const row = folder ? await supabaseAdmin.from('orders').select('local_path').eq('order_number',body.orderNumber).maybeSingle()
    : await supabaseAdmin.from('order_files').select('local_path').eq('id',body.fileId).maybeSingle()
  if (row.error || !row.data?.local_path) return Response.json({error:'No verified local path. Download from cloud after refreshing.'},{status:404})
  try {
    const root = await fs.realpath(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles')
    const target = await fs.realpath(row.data.local_path)
    const relative = path.relative(root,target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('File is outside kiosk storage.')
    const stat = await fs.stat(target)
    if (folder ? !stat.isDirectory() : !stat.isFile()) throw Error('Local file or folder is missing.')
    await promisify(execFile)('explorer.exe',[target],{windowsHide:true,timeout:10_000})
    return Response.json({success:true})
  } catch {return Response.json({error:'Local file could not be opened. It may be missing from this PC. Refresh and try a cloud download.'},{status:404})}
}
