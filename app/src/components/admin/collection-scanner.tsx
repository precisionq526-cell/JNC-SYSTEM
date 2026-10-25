'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {findCollectionOrderAction,collectOrderAction} from '@/lib/actions/sop-operations'
import {formatCurrency} from '@/lib/utils/format'
type Found=Extract<Awaited<ReturnType<typeof findCollectionOrderAction>>,{ok:true}>
export function CollectionScanner() {
  const [input,setInput]=useState(''),[found,setFound]=useState<Found|null>(null),[busy,setBusy]=useState(false),[cash,setCash]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[camera,setCamera]=useState(false),[error,setError]=useState('')
  const video=useRef<HTMLVideoElement>(null),media=useRef<MediaStream|null>(null)
  const lookup=async(value=input)=>{setBusy(true);setError('');setFound(null);setConfirmed(false);try{const result=await findCollectionOrderAction(value);if(result.ok){setFound(result);setInput(value);setCash('')}else setError(result.error)}catch{setError('Ticket lookup failed. Check the connection.')}finally{setBusy(false)}}
  useEffect(()=>{const number=new URLSearchParams(window.location.search).get('order');if(number)setInput(number)},[])
  useEffect(()=>{
    if(!camera)return
    let cancelled=false,timer:ReturnType<typeof setTimeout>
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true})
    void (async()=>{
      try {
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false})
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return}media.current=stream
        if(video.current){video.current.srcObject=stream;await video.current.play()}
        const {default:decode}=await import('jsqr')
        const tick=()=>{if(cancelled)return;const v=video.current;if(v?.videoWidth && context){const scale=Math.min(1,800/v.videoWidth);canvas.width=Math.floor(v.videoWidth*scale);canvas.height=Math.floor(v.videoHeight*scale);context.drawImage(v,0,0,canvas.width,canvas.height);const data=context.getImageData(0,0,canvas.width,canvas.height);const result=decode(data.data,data.width,data.height);if(result){setCamera(false);void lookup(result.data);return}}timer=setTimeout(tick,250)};tick()
      }catch{if(!cancelled){setError('Camera unavailable. Use a USB scanner, upload a QR image, or enter the full order number.');setCamera(false)}}
    })()
    return()=>{cancelled=true;clearTimeout(timer);media.current?.getTracks().forEach(t=>t.stop());media.current=null}
  // Lookup reads the scanned token, not a captured input value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[camera])
  const upload=async(file:File)=>{
    if(file.size>10*1024*1024){setError('Use a QR image up to 10 MB.');return}
    try{const bitmap=await createImageBitmap(file),scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(bitmap.width*scale));canvas.height=Math.max(1,Math.floor(bitmap.height*scale));const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const data=ctx.getImageData(0,0,canvas.width,canvas.height);const {default:decode}=await import('jsqr');const result=decode(data.data,data.width,data.height);if(!result)throw Error('No QR found. Upload a clear image of the complete ticket QR.');await lookup(result.data)}catch(e){setError(e instanceof Error?e.message:'Could not read the QR image.')}
  }
  const collect=async()=>{if(!found || !confirmed)return;setBusy(true);try{const result=await collectOrderAction({ticket:input,...(!found.data.is_paid?{cashReceived:Number(cash)}:{}),...(!found.qrVerified?{manualReason:reason}:{})});if(!result.ok)setError(result.error);else{toast.success('Payment and collection recorded.');await lookup(input)}}catch{setError('Could not confirm collection. Refresh before retrying.')}finally{setBusy(false)}}
  return <div className="admin-page sop-page"><div className="ref-page-heading"><h1>Ticket verification & collection</h1><Link className="button button-outline" href="/admin/orders">All orders</Link></div><section className="sop-card"><h2>Scan customer ticket</h2><form onSubmit={e=>{e.preventDefault();void lookup()}} className="sop-form-row"><input aria-label="Ticket QR or order number" value={input} onChange={e=>{setInput(e.target.value);setFound(null)}} placeholder="Scan QR with a USB scanner, or enter ORD-date-number" maxLength={1000}/><button disabled={busy || !input.trim()} className="button button-primary">Find ticket</button></form><div className="actions-row"><button type="button" className="button button-outline" onClick={()=>setCamera(v=>!v)}>{camera?'Stop camera':'Scan with camera'}</button><label className="button button-outline">Read QR image<input type="file" accept="image/*" hidden onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);e.target.value=''}}/></label></div>{camera&&<video ref={video} playsInline muted className="sop-camera"/>}{error&&<p role="alert" className="sop-error">{error}</p>}</section>
    {found&&<section className="sop-card"><h2>{found.data.order_number}</h2><p>{found.data.customer_name ?? 'Customer'} · {found.data.status} · {found.qrVerified?'Signed QR verified':'Manual identity check required'}</p><p>Total: <strong>{formatCurrency(Number(found.data.total_price))}</strong> · {found.data.is_paid?'Payment approved':'Cash payment outstanding'}</p>
      {found.data.status==='completed'&&!found.data.disposal_recorded_at?<><label className="field">{found.data.is_paid?'Payment received':'Cash actually received (PHP)'}{!found.data.is_paid&&<input type="number" min={Number(found.data.total_price)} step="0.01" value={cash} onChange={e=>setCash(e.target.value)} required/>}</label>{!found.data.is_paid&&cash&&<p>Change: {formatCurrency(Math.max(0,Number(cash)-Number(found.data.total_price)))}</p>}{!found.qrVerified&&<label className="field">How did you verify the customer and ticket?<input value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={250}/></label>}<label className="sop-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I verified the customer’s ticket, received any outstanding payment, and handed over the prints.</label><button type="button" className="button button-primary" disabled={busy||!confirmed||!found.data.is_paid&&(!cash||Number(cash)<Number(found.data.total_price))||!found.qrVerified&&reason.trim().length<10} onClick={()=>void collect()}>Record collection & archive</button></>:<p>{found.data.status==='collected'?'Already collected. A second collection is blocked.':found.data.disposal_recorded_at?'This uncollected print was recorded as disposed.':'This order is not ready for collection.'}</p>}
    </section>}
  </div>
}
