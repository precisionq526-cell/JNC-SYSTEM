'use server'
import { randomUUID, randomInt } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import { isUuid } from '@/lib/utils/uuid'
import { getFileEditorKind } from '@/lib/editor/file-types'
import { SESSION_LIFETIME_MINUTES, TRANSFER_BUCKET, type TransferFile, type TransferSession } from '@/lib/transfer/types'

const unavailable='Mobile transfer database setup is unavailable. Use direct file upload or apply the database migration.'
type SessionRow={id:string;short_code:string;expires_at:string;kiosk_station_id:string|null;status:TransferSession['status'];created_at:string}
const sessionSummary=(row:SessionRow):TransferSession=>({id:row.id,shortCode:row.short_code,expiresAt:row.expires_at,kioskStationId:row.kiosk_station_id,status:row.status,createdAt:row.created_at})
type FileRow={id:string;session_id:string;file_name:string;file_size:number;file_type:string;storage_path:string;uploaded_at:string}
const fileSummary=(row:FileRow):TransferFile=>({id:row.id,sessionId:row.session_id,fileName:row.file_name,fileSize:row.file_size,fileType:row.file_type,storagePath:row.storage_path,uploadedAt:row.uploaded_at})

export async function createTransferSession(kioskStationId?:string):Promise<{ok:boolean;session?:TransferSession;error?:string}> {
  if(!hasServiceRoleConfig()) return {ok:false,error:unavailable}
  if(kioskStationId && !isUuid(kioskStationId)) return {ok:false,error:'Invalid kiosk station configuration.'}
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for(let attempt=0;attempt<3;attempt++){
    const code=Array.from({length:6},()=>chars[randomInt(chars.length)]).join('')
    const result=await supabaseAdmin.from('transfer_sessions').insert({short_code:code,
      expires_at:new Date(Date.now()+SESSION_LIFETIME_MINUTES*60000).toISOString(),kiosk_station_id:kioskStationId??null,status:'active'}).select('*').single()
    if(!result.error&&result.data) return {ok:true,session:sessionSummary(result.data)}
    if(result.error?.code!=='23505') return {ok:false,error:unavailable}
  }
  return {ok:false,error:'Could not reserve a transfer code. Please retry.'}
}
export async function getTransferSessionById(id:string):Promise<{ok:boolean;session?:TransferSession;error?:string}> {
  if(!hasServiceRoleConfig()||!isUuid(id)) return {ok:false,error:'Invalid or unavailable transfer session.'}
  const result=await supabaseAdmin.from('transfer_sessions').select('*').eq('id',id).maybeSingle()
  if(result.error) return {ok:false,error:unavailable}
  if(!result.data||result.data.status!=='active'||Date.parse(result.data.expires_at)<=Date.now()) return {ok:false,error:'Transfer session is closed or expired. Request a new code.'}
  return {ok:true,session:sessionSummary(result.data)}
}
export async function getTransferSessionByCode(code:string):Promise<{ok:boolean;session?:TransferSession;error?:string}> {
  if(!hasServiceRoleConfig()||!/^[A-Z2-9]{6}$/.test(code.trim().toUpperCase())) return {ok:false,error:'Enter a valid transfer code.'}
  const result=await supabaseAdmin.from('transfer_sessions').select('id').eq('short_code',code.trim().toUpperCase()).maybeSingle()
  if(result.error) return {ok:false,error:unavailable}
  if(!result.data) return {ok:false,error:'Transfer session not found.'}
  return getTransferSessionById(result.data.id)
}
export async function uploadTransferFiles(form:FormData):Promise<{ok:boolean;files?:TransferFile[];error?:string}> {
  const id=form.get('sessionId')
  if(typeof id!=='string') return {ok:false,error:'Missing transfer session.'}
  const session=await getTransferSessionById(id)
  if(!session.ok) return {ok:false,error:session.error}
  const values=form.getAll('files')
  if(!values.length||values.length>20||values.some(v=>!(v instanceof File)||!getFileEditorKind(v.name)||v.size<1||v.size>209715200)
    ||values.reduce((sum,v)=>sum+(v instanceof File?v.size:0),0)>209715200) return {ok:false,error:'Select up to 20 supported files with a combined size of at most 200 MB.'}
  const records:Record<string,unknown>[]=[]
  const uploaded:string[]=[]
  try {
    for(const value of values){
      const file=value as File
      const storagePath=id+'/'+randomUUID()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)
      const result=await supabaseAdmin.storage.from(TRANSFER_BUCKET).upload(storagePath,await file.arrayBuffer(),{contentType:file.type||'application/octet-stream'})
      if(result.error) throw Error('A file could not be uploaded. Please retry.')
      uploaded.push(storagePath)
      records.push({session_id:id,file_name:file.name.slice(0,255),file_size:file.size,file_type:file.type||'application/octet-stream',storage_path:storagePath})
    }
    const result=await supabaseAdmin.rpc('commit_transfer_files',{p_session_id:id,p_files:records})
    if(result.error) throw Error(result.error.code==='PGRST202'?unavailable:result.error.message)
    return {ok:true,files:(result.data as FileRow[]).map(fileSummary)}
  } catch(error) {
    // A timeout may follow a committed transaction. Keep uploads until their metadata can be checked.
    const check=await supabaseAdmin.from('transfer_files').select('storage_path').in('storage_path',uploaded)
    if(!check.error&&!check.data?.length&&uploaded.length) await supabaseAdmin.storage.from(TRANSFER_BUCKET).remove(uploaded)
    return {ok:false,error:error instanceof Error?error.message:'Upload could not be confirmed.'}
  }
}
export async function getTransferFiles(sessionId:string):Promise<{ok:boolean;files?:TransferFile[];error?:string}> {
  const session=await getTransferSessionById(sessionId)
  if(!session.ok) return {ok:false,error:session.error}
  const result=await supabaseAdmin.from('transfer_files').select('*').eq('session_id',sessionId).order('uploaded_at')
  return result.error?{ok:false,error:unavailable}:{ok:true,files:(result.data??[]).map(fileSummary)}
}
export async function closeTransferSession(sessionId:string):Promise<{ok:boolean;error?:string}> {
  if(!hasServiceRoleConfig()||!isUuid(sessionId)) return {ok:false,error:'Invalid transfer session.'}
  const result=await supabaseAdmin.from('transfer_sessions').update({status:'completed'}).eq('id',sessionId).select('id').maybeSingle()
  return result.error||!result.data?{ok:false,error:'Session closure could not be confirmed.'}:{ok:true}
}
