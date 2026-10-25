'use client'
import Link from 'next/link'
import {useState} from 'react'
import toast from 'react-hot-toast'
import type {Order} from '@/lib/types/database'
import {verifyStudentAction,recordUncollectedDisposalAction,setOrderEstimateAction} from '@/lib/actions/sop-operations'
import {updateOrderStatusAction} from '@/lib/actions/submit-order'
import {PrintQuoteSummary} from '@/components/order-flow/print-quote-summary'
export function SopOrderChecks({order,names,refresh}:{order:Order;names:string[];refresh:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false),[reason,setReason]=useState('')
  const [setup,setSetup]=useState(String(order.setup_duration_minutes ?? 0)),[duration,setDuration]=useState(String(order.estimated_duration_minutes ?? ''))
  const act=async(action:()=>Promise<{ok:boolean;error?:string}>)=>{setBusy(true);try{const result=await action();if(!result.ok)toast.error(result.error ?? 'Update failed.');else{toast.success('Recorded.');setReviewed(false);await refresh()}}catch{toast.error('Could not confirm the update. Refresh before retrying.')}finally{setBusy(false)}}
  return <section className="order-detail-summary sop-order-checks"><h2>Production & collection checks</h2>
    {['pending','queued'].includes(order.status)&&<details><summary>Review processing-time estimate</summary><p>ATC-P uses setup time separately from print time. Update this estimate from the actual job; it changes queue estimates without changing the bill.</p><div className="sop-settings-grid"><label className="field">Setup minutes<input type="number" min="0" max="120" value={setup} onChange={e=>setSetup(e.target.value)}/></label><label className="field">Total service minutes (setup + printing + finishing)<input type="number" min="0.1" step="0.1" max="10080" value={duration} onChange={e=>setDuration(e.target.value)}/></label></div><button className="button button-outline" disabled={busy||duration===''} onClick={()=>void act(()=>setOrderEstimateAction(order.id,Number(setup),Number(duration)))}>Save processing estimate</button></details>}
    {order.pricing_quote && <PrintQuoteSummary quote={order.pricing_quote} names={names}/>}
    {order.student_status && order.student_status!=='none' && <div className="sop-notice"><h3>Student verification · {order.student_status}</h3>
      <a className="underline" href={'/api/admin/orders/'+order.id+'/student-proof'} target="_blank" rel="noopener noreferrer">View private student ID proof</a>
      {order.student_status==='pending' && <><label className="sop-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I checked that this is a valid student ID for this customer.</label><button className="button button-primary" disabled={busy || !reviewed} onClick={()=>void act(()=>verifyStudentAction(order.id,true))}>Approve student discount</button><label className="field">Reason if declining<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button className="button button-outline" disabled={busy || reason.trim().length<5} onClick={()=>void act(()=>verifyStudentAction(order.id,false,reason))}>Decline verification & hold request</button><p>Declining holds this request. Resolve any payment with the customer; no automatic extra charge or refund is made.</p></>}
    </div>}
    {order.status==='processing' && <button className="button button-primary" disabled={busy} onClick={()=>void act(()=>updateOrderStatusAction(order.id,'finishing'))}>Printing done · move to finishing</button>}
    {order.status==='finishing' && <button className="button button-primary" disabled={busy} onClick={()=>void act(()=>updateOrderStatusAction(order.id,'completed'))}>Finishing & quality checks done · ready for pickup</button>}
    {order.status==='completed' && !order.disposal_recorded_at && <><Link className="button button-primary" href={'/admin/collection?order='+encodeURIComponent(order.order_number)}>Verify ticket & record collection</Link><details><summary>Uncollected print procedure</summary><p>Use only after the configured retention period and after staff physically handle the uncollected print. The transaction history is retained.</p><label className="sop-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I completed the shop’s physical uncollected-print procedure.</label><button className="button button-outline" disabled={!reviewed || busy} onClick={()=>void act(()=>recordUncollectedDisposalAction(order.id,true))}>Record physical disposal</button></details></>}
    {order.collected_at && <p>Collected {new Date(order.collected_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}. Payment and pickup verification are recorded in the audit history.</p>}
    {order.disposal_recorded_at && <p>Physical disposal recorded {new Date(order.disposal_recorded_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}. This print can no longer be collected.</p>}
  </section>
}
