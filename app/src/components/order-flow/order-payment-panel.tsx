'use client'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Banknote, Copy, CreditCard, UploadCloud, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { PaymentAccount, PaymentMethod } from '@/lib/kiosk/payment'
import { paymentReceiptError } from '@/lib/kiosk/payment'
import { formatCurrency, formatFileSize } from '@/lib/utils/format'

export function OrderPaymentPanel({accounts,method,reference,receipt,total,disabled,onMethod,onReference,onReceipt,prepay=false,prepayMinutes=15}:{
  prepayMinutes?:number
  prepay?:boolean
  accounts:PaymentAccount[];method:PaymentMethod;reference:string;receipt:File|null;total:number;disabled:boolean
  onMethod:(value:PaymentMethod)=>void;onReference:(value:string)=>void;onReceipt:(file:File|null)=>Promise<void>
}) {
  const [url,setUrl] = useState('')
  const [staging,setStaging] = useState(false)
  const account = accounts.find(account=>account.method === method)
  useEffect(()=>{if(!receipt){setUrl('');return}const url=URL.createObjectURL(receipt);setUrl(url);return()=>URL.revokeObjectURL(url)},[receipt])
  const choose = async (file:File|null) => {
    if (file) {const error=paymentReceiptError(file);if(error){toast.error(error);return}}
    setStaging(true)
    try {await onReceipt(file)} catch {toast.error('Could not save the receipt in this browser. Please try again.')} finally {setStaging(false)}
  }
  return <section className="surface payment-panel" aria-labelledby="payment-title">
    <h2 id="payment-title" className="panel-heading"><CreditCard size={23}/>Payment confirmation</h2>
    <div className="payment-methods" role="group" aria-label="Payment method">
      <button type="button" aria-pressed={method==='cash'} disabled={disabled} onClick={()=>onMethod('cash')}><Banknote size={18} className="inline-block mr-2"/>{prepay?'Prepay at counter':'Pay at pickup'}</button>
      {(['gcash','maya'] as const).map(option=><button key={option} type="button" aria-pressed={method===option} disabled={disabled || !accounts.some(account=>account.method===option)} onClick={()=>onMethod(option)}>{option==='gcash'?'GCash':'Maya'}{!accounts.some(account=>account.method===option) && <small className="block text-[10px] mt-1">Unavailable</small>}</button>)}
    </div>
    {method==='cash' ? <p className="payment-help">{prepay?<>Scheduled orders require prepayment. Pay <strong>{formatCurrency(total)}</strong> at the counter within {prepayMinutes} minutes. Your ticket and production slot are released after staff confirm receipt of the cash.</>:<>Pay <strong>{formatCurrency(total)}</strong> at the shop when you collect your order. Your ticket confirms the order; payment is collected separately.</>}</p> : account ? <div className="payment-layout">
      <aside className="payment-account"><h3>Send your payment</h3><p>Use the verified {method==='gcash'?'GCash':'Maya'} account below.</p><strong>{account.number}</strong><p>{account.name}</p><button type="button" className="button" onClick={()=>{void navigator.clipboard.writeText(account.number).then(()=>toast.success('Account number copied.')).catch(()=>toast.error('Select and copy the account number above.'))}}><Copy size={16}/>Copy number</button><p>Amount: <b>{formatCurrency(total)}</b></p><p>Already sent payment? Attach its receipt. Reuse the same draft if submission needs a retry.</p></aside>
      <div className="receipt-fields"><div className="field"><label htmlFor="payment-reference">Payment reference number <span>(required)</span></label><input id="payment-reference" value={reference} onChange={e=>onReference(e.target.value)} placeholder="Enter the reference on your receipt" maxLength={80} minLength={6} required disabled={disabled}/></div>
        <div className="receipt-upload"><label htmlFor="payment-receipt"><UploadCloud size={18} className="inline-block mr-2"/>Upload payment receipt (required)</label><input id="payment-receipt" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={disabled || staging} onChange={e=>{const file=e.target.files?.[0];if(file)void choose(file);e.target.value=''}}/>
          {receipt && <><p><strong>{receipt.name}</strong> · {formatFileSize(receipt.size)}</p>{url && receipt.type.startsWith('image/') && <Image src={url} alt="Your payment receipt" width={420} height={220} unoptimized className="receipt-preview"/>}{url && <a href={url} target="_blank" rel="noopener noreferrer" className="underline">View receipt</a>}<button type="button" className="button button-outline" disabled={disabled || staging} onClick={()=>void choose(null)}><X size={15}/>Remove receipt</button></>}
          <small>{staging?'Saving receipt…':'PDF, JPG, PNG, or WEBP · Up to 10 MB. Receipts are kept separately from files to print.'}</small>
        </div>
        <p className="payment-help">After you click Get ticket, you will wait for admin confirmation. The admin checks your receipt and verifies that the payment was received. Your order number is released only after approval.</p>
      </div>
    </div> : <p className="payment-help" role="alert">This wallet is unavailable. Choose payment at pickup.</p>}
  </section>
}
