import {requireAdmin} from '@/lib/admin/require-admin'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {isUuid} from '@/lib/utils/uuid'
export async function GET(_request:Request,{params}:{params:Promise<{orderId:string}>}) {
  const auth=await requireAdmin();if(!auth.ok)return Response.json({error:auth.error},{status:403})
  const {orderId}=await params;if(!isUuid(orderId))return Response.json({error:'Invalid order.'},{status:400})
  const row=await supabaseAdmin.from('orders').select('student_proof').eq('id',orderId).maybeSingle()
  const proof=row.data?.student_proof as {path?:string;type?:string}|null
  if(!proof?.path?.startsWith(orderId+'/student/'))return Response.json({error:'Student proof not found.'},{status:404})
  const file=await supabaseAdmin.storage.from('order-files').download(proof.path)
  if(file.error || !file.data)return Response.json({error:'Student proof unavailable.'},{status:404})
  return new Response(file.data,{headers:{'Content-Type':proof.type ?? 'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}})
}
