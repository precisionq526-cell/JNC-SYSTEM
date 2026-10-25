'use server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/utils/uuid'
import { loadSopSettings } from '@/lib/sop/settings-server'
import { intakeAvailability } from '@/lib/sop/policy'
import { readPickupToken } from '@/lib/sop/pickup-token'
import { cacheValue } from '@/lib/sop/local-store'

export async function getShopAvailabilityAction() {
  try { const settings=await loadSopSettings();return {ok:true as const,...intakeAvailability(settings.policy),policy:settings.policy,configured:settings.configured,offline:settings.offline} }
  catch {return {ok:false as const,accepting:false,reason:'Shop availability could not be verified.'}}
}
export async function getSopSettingsAction() {
  const auth=await requireAdmin();if(!auth.ok)return auth
  try{return {ok:true as const,data:await loadSopSettings()}}catch{return {ok:false as const,error:'Operational settings could not be loaded.'}}
}
const amount=z.number().finite().min(0).max(999999)
const policySchema=z.object({intakeState:z.enum(['online','offline','closed']),enforceHours:z.boolean(),openingMinute:z.number().int().min(0).max(1438),closingMinute:z.number().int().min(1).max(1439),workingDays:z.array(z.number().int().min(0).max(6)).min(1).max(7),completionBufferMinutes:z.number().min(0).max(60),dispatchMode:z.enum(['walkins-first','deadline-aware']),unpaidTimeoutMinutes:z.number().int().min(5).max(120),uncollectedHours:z.number().int().min(1).max(720)})
const rates=z.object({bw:amount,accents:amount,images:amount})
const pricingSchema=z.object({rates:z.object({Short:rates,A4:rates,Long:rates,Legal:rates}),finishing:z.record(z.string().trim().min(1).max(50),amount),studentDiscounts:z.object({textLow:amount,textHigh:amount,imageLow:amount,imageHigh:amount})})
export async function saveSopSettingsAction(input:unknown) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  const parsed=z.object({policy:policySchema,pricing:pricingSchema}).safeParse(input)
  if(!parsed.success)return {ok:false as const,error:'Check hours, policy values, and non-negative prices.'}
  const {policy,pricing}=parsed.data
  if(policy.openingMinute>=policy.closingMinute || new Set(policy.workingDays).size!==policy.workingDays.length)return {ok:false as const,error:'Use distinct working days and a closing time after opening.'}
  for(const row of Object.values(pricing.rates))if(Math.max(pricing.studentDiscounts.textLow,pricing.studentDiscounts.textHigh)>Math.min(row.bw,row.accents) || Math.max(pricing.studentDiscounts.imageLow,pricing.studentDiscounts.imageHigh)>row.images)return {ok:false as const,error:'Student discounts cannot exceed the applicable page rate.'}
  const result=await supabaseAdmin.from('sop_settings').update({policy,pricing,updated_at:new Date().toISOString(),updated_by:auth.userId}).eq('id',1).select('id').single()
  if(result.error)return {ok:false as const,error:'Settings were not saved. Apply the SOP migration and check the connection.'}
  cacheValue('sop-settings',{policy,pricing,configured:true,offline:false})
  await supabaseAdmin.from('audit_log').insert({event_type:'shop_policy_saved',entity_type:'sop_settings',actor_id:auth.userId,actor_role:'admin',metadata:{policy,pricing}})
  return {ok:true as const}
}
export async function verifyStudentAction(orderId:string,approved:boolean,reason='') {
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(!isUuid(orderId) || typeof approved!=='boolean' || reason.length>500)return {ok:false as const,error:'Invalid student review.'}
  const result=await supabaseAdmin.rpc('verify_sop_student',{p_order_id:orderId,p_approved:approved,p_reason:reason,p_actor_id:auth.userId})
  return result.error?{ok:false as const,error:result.error.message}:{ok:true as const}
}
export async function setOrderEstimateAction(orderId:string,setup:number,total:number){
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(!isUuid(orderId)||![setup,total].every(Number.isFinite)||setup<0||setup>120||total<=setup||total>10080)return {ok:false as const,error:'Enter setup minutes and a larger total service duration (up to seven days).'}
  const result=await supabaseAdmin.rpc('set_sop_order_estimate',{p_order_id:orderId,p_setup:setup,p_total:total,p_actor_id:auth.userId})
  return result.error?{ok:false as const,error:result.error.message}:{ok:true as const}
}
export async function findCollectionOrderAction(input:string) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(typeof input!=='string' || input.length>1000)return {ok:false as const,error:'Scan a valid ticket or enter the full order number.'}
  const id=readPickupToken(input)
  const query=supabaseAdmin.from('orders').select('id,order_number,customer_name,status,is_paid,payment_method,total_price,collected_at,disposal_recorded_at,completed_at')
  if(!id && !/^(ORD-\d{8}-\d+|LAN-\d{8}-[A-F0-9]{32})$/i.test(input.trim()))return {ok:false as const,error:'The QR is invalid, or the order number is incomplete.'}
  const result=await (id?query.eq('id',id):query.eq(input.trim().toUpperCase().startsWith('LAN-')?'offline_ticket_number':'order_number',input.trim().toUpperCase())).maybeSingle()
  return result.error || !result.data?{ok:false as const,error:'This ticket could not be found.'}:{ok:true as const,data:result.data,qrVerified:!!id}
}
export async function collectOrderAction(input:{ticket:string;cashReceived?:number;manualReason?:string}) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  const found=await findCollectionOrderAction(input.ticket);if(!found.ok)return found
  if(!found.qrVerified && (!input.manualReason || input.manualReason.trim().length<10))return {ok:false as const,error:'For manual lookup, record how the customer and ticket were verified (at least 10 characters).'}
  if(input.cashReceived!==undefined && (!Number.isFinite(input.cashReceived) || input.cashReceived<0 || input.cashReceived>999999))return {ok:false as const,error:'Enter the cash amount actually received.'}
  const result=await supabaseAdmin.rpc('collect_sop_order',{p_order_id:found.data.id,p_cash_received:input.cashReceived ?? null,p_verification:found.qrVerified?'Signed ticket QR':'Manual: '+input.manualReason!.trim().slice(0,250),p_actor_id:auth.userId})
  return result.error?{ok:false as const,error:result.error.message}:{ok:true as const}
}
export async function recordUncollectedDisposalAction(orderId:string,confirmed:boolean) {
  const auth=await requireAdmin();if(!auth.ok)return auth
  if(!isUuid(orderId) || confirmed!==true)return {ok:false as const,error:'Confirm that staff physically handled the uncollected print.'}
  const settings=await loadSopSettings()
  const result=await supabaseAdmin.from('orders').update({disposal_recorded_at:new Date().toISOString()}).eq('id',orderId).eq('status','completed').is('disposal_recorded_at',null).lte('completed_at',new Date(Date.now()-settings.policy.uncollectedHours*3600000).toISOString()).select('id').maybeSingle()
  if(result.error || !result.data)return {ok:false as const,error:'This print is not eligible for the uncollected-order procedure.'}
  await supabaseAdmin.from('audit_log').insert({event_type:'uncollected_print_disposed',entity_type:'order',entity_id:orderId,actor_id:auth.userId,actor_role:'admin',metadata:{retentionHours:settings.policy.uncollectedHours}})
  return {ok:true as const}
}
