'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, FileText, ReceiptText, Smartphone, UserRound, X, Pencil, Download, Check, Expand } from 'lucide-react'
import { DocumentPreview } from '@/components/preview/document-preview'
import { FlowHeading } from './flow-heading'
import { PrintOptionField } from './print-option-field'
import { ExpandedPreview } from './expanded-preview'
import { submitOrderFormAction, type SubmitOrderMeta } from '@/lib/actions/submit-order'
import { calculateKioskTotal, getDefaultOptions, type KioskOrderDraft, type KioskOptionValue, type OrderSubmission } from '@/lib/kiosk/order-draft'
import { isPendingPayment, submissionFromResult } from '@/lib/kiosk/order-release'
import { OrderQueueClient } from './order-queue-client'
import { clearStagedFiles, loadStagedFiles, saveStagedFiles, type StagedFileChannel } from '@/lib/kiosk/staged-files'
import { getServiceConfigurationAction } from '@/lib/actions/service-catalog'
import { normalizeService, normalizeOption, restoreConfiguredOptions, validatePrintOptions } from '@/lib/kiosk/print-options'
import { createEditedUpload, getFileEditorKind } from '@/lib/editor/file-types'
import { hasSupabaseConfig } from '@/lib/supabase/config'
import { isUuid } from '@/lib/utils/uuid'
import { useSessionJson } from '@/lib/kiosk/use-session-json'
import { formatCurrency } from '@/lib/utils/format'
import type { OrderSource } from '@/lib/types/database'
import { getOrderPaymentAccountsAction } from '@/lib/actions/order-payment'
import { validatePayment, type PaymentAccount, type PaymentMethod } from '@/lib/kiosk/payment'
import { OrderPaymentPanel } from './order-payment-panel'
import { validatePickupAt } from '@/lib/kiosk/pickup'
import { getPrintQuoteAction } from '@/lib/actions/print-quote'
import type { PrintQuote } from '@/lib/sop/pricing'
import { PrintQuoteSummary } from './print-quote-summary'
import {getShopAvailabilityAction} from '@/lib/actions/sop-operations'
import {policyClock,shopHoursLabel} from '@/lib/sop/policy'

export interface OrderReviewClientProps {
  draftStorageKey: string; ticketStorageKey: string; stagedChannel: StagedFileChannel
  orderSource: OrderSource; serviceBaseHref: string; homeHref: string; queueHref: string
  showCustomerFields?: boolean
}

type ReviewStep = 'preview' | 'transaction' | 'schedule' | 'confirmation'
const UploadFileEditor = dynamic(() => import('@/components/editor/upload-file-editor'), { ssr: false })

export function OrderReviewClient({
  draftStorageKey, ticketStorageKey, stagedChannel, orderSource,
  serviceBaseHref, homeHref, queueHref, showCustomerFields = false,
}: OrderReviewClientProps) {
  const router = useRouter()
  const storedDraft = useSessionJson<KioskOrderDraft>(draftStorageKey)
  const [draftOverride, setDraftOverride] = useState<KioskOrderDraft | null>(null)
  const draft = draftOverride ?? storedDraft
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [retryOptions, setRetryOptions] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [pageCounts, setPageCounts] = useState<Record<number, number>>({})
  const submissionKeyRef = useRef<string | null>(null)
  const [step, setStep] = useState<ReviewStep>('preview')
  const [transactionType, setTransactionType] = useState<'walk-in' | 'schedule'>('walk-in')
  const [optionChanges, setOptionChanges] = useState<Record<string, KioskOptionValue>>({})
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [pickupDate, setPickupDate] = useState('')
  const [pickupTime, setPickupTime] = useState('08:00')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmedTicket, setConfirmedTicket] = useState<OrderSubmission | null>(null)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [activeFile, setActiveFile] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [student,setStudent] = useState(false)
  const [availability,setAvailability]=useState<Awaited<ReturnType<typeof getShopAvailabilityAction>>|null>(null)
  const [quoteClock,setQuoteClock]=useState(()=>Date.now())
  const [studentProof,setStudentProof] = useState<File|null>(null)
  const [quote,setQuote] = useState<PrintQuote|null>(null)
  const [quoteKey,setQuoteKey] = useState('')
  const [quoteError,setQuoteError] = useState<string|null>(null)
  const [quoteBusy,setQuoteBusy] = useState(false)
  const [quoteRetry,setQuoteRetry] = useState(0)
  const [finishingOptions,setFinishingOptions] = useState<string[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [receiptSaving,setReceiptSaving] = useState(false)
  const checkoutRestored = useRef(false)
  const serviceSlug = storedDraft?.service.slug
  useEffect(()=>{let active=true;const refresh=()=>{setQuoteClock(Date.now());void getShopAvailabilityAction().then(result=>{if(active)setAvailability(result)}).catch(()=>{if(active)setAvailability({ok:false,accepting:false,reason:'Shop availability could not be verified.'})})};refresh();const timer=setInterval(refresh,30000);return()=>{active=false;clearInterval(timer)}},[])

  useEffect(() => {
    const checkout = storedDraft?.checkout
    if (!checkout || checkoutRestored.current) return
    checkoutRestored.current = true
    setTransactionType(checkout.transactionType ?? 'walk-in'); setPickupDate(checkout.pickupDate ?? ''); setPickupTime(checkout.pickupTime ?? '08:00')
    setCustomerName(checkout.customerName ?? ''); setCustomerEmail(checkout.customerEmail ?? ''); setCustomerPhone(checkout.customerPhone ?? '')
    setPaymentMethod(checkout.paymentMethod ?? 'cash'); setPaymentReference(checkout.paymentReference ?? '')
    setStudent(checkout.student ?? false)
  }, [storedDraft])
  useEffect(() => {
    let cancelled = false
    void getOrderPaymentAccountsAction().then(accounts => {if(!cancelled)setPaymentAccounts(accounts)}).catch(()=>{if(!cancelled)toast.error('Online payment details are unavailable. Payment at pickup is available.')})
    void loadStagedFiles(stagedChannel+'-payment').then(files=>{if(!cancelled)setPaymentReceipt(files[0] ?? null)}).catch(()=>{if(!cancelled)toast.error('Could not restore the saved receipt. Attach it again if paying online.')})
    void loadStagedFiles(stagedChannel+'-student').then(files=>{if(!cancelled)setStudentProof(files[0] ?? null)}).catch(()=>{})
    return ()=>{cancelled=true}
  }, [stagedChannel])

  useEffect(() => {
    if (!serviceSlug) return
    let cancelled = false
    setOptionsLoading(true); setOptionsError(null)
    void getServiceConfigurationAction(serviceSlug).then(result => {
      if (cancelled) return
      if (!result.ok) { setOptionsError(result.error); return }
      const service = normalizeService(result.data.service)
      const definitions = result.data.options.map(normalizeOption)
      if (service.slug === 'printing' && definitions.length === 0) { setOptionsError('Print options have not been configured in the database.'); return }
      const current = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null') as KioskOrderDraft | null
      if (!current) return
      const options = { ...getDefaultOptions(definitions), ...restoreConfiguredOptions(definitions, current.options) }
      const next = { ...current, service, options, optionDefinitions: definitions, totalPrice: calculateKioskTotal(service, definitions, options) }
      sessionStorage.setItem(draftStorageKey, JSON.stringify(next))
      setDraftOverride(next)
    }).catch(() => { if (!cancelled) setOptionsError('Could not refresh the print options. Please retry.') })
      .finally(() => { if (!cancelled) setOptionsLoading(false) })
    return () => { cancelled = true }
  }, [serviceSlug, draftStorageKey, retryOptions])

  useEffect(() => {
    let cancelled = false
    void loadStagedFiles(stagedChannel).then(files => {
      if (cancelled) return
      setStagedFiles(files)
    }).catch(() => toast.error('Could not load your file previews.'))
    return () => { cancelled = true }
  }, [stagedChannel])

  useEffect(() => {
    const imageCounts = Object.fromEntries(stagedFiles.flatMap((file, index) => getFileEditorKind(file.name) === 'image' ? [[index, 1]] : []))
    setPageCounts(current => ({ ...current, ...imageCounts }))
  }, [stagedFiles])

  const quoteOptions = JSON.stringify({...draft?.options,...optionChanges})
  const quoteInputKey = JSON.stringify([quoteOptions,student,stagedFiles.map(f=>[f.name,f.size,f.lastModified])])
  useEffect(()=>{
    if(draft?.service.slug!=='printing' || optionsLoading || !stagedFiles.length || editingIndex!==null)return
    let cancelled=false
    setQuoteBusy(true);setQuoteError(null)
    const timer=window.setTimeout(()=>{
      const form=new FormData();form.append('options',quoteOptions);form.append('student',student?'yes':'no')
      for(const upload of stagedFiles)form.append('files',upload)
      void getPrintQuoteAction(form).then(result=>{
        if(cancelled)return
        if(!result.ok){setQuote(null);setQuoteError(result.error);return}
        setQuote(result.quote);setQuoteKey(quoteInputKey);setFinishingOptions(result.finishingOptions)
      }).catch(()=>{if(!cancelled){setQuote(null);setQuoteError('The page quote could not be loaded. Retry before paying.')}}).finally(()=>{if(!cancelled)setQuoteBusy(false)})
    },500)
    return ()=>{cancelled=true;window.clearTimeout(timer)}
  // The key includes files and every pricing option, so a stale response cannot enable checkout.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[quoteInputKey,optionsLoading,editingIndex,quoteRetry,draft?.service.slug])

  if (confirmedTicket) return <OrderQueueClient ticketStorageKey={ticketStorageKey} homeHref={homeHref} initialSubmission={confirmedTicket}/>
  if (!draft) return (
    <div className="empty-state">
      <ReceiptText size={44} /><h1>No order to review</h1>
      <p>Upload your files to start a print order.</p>
      <Link href={homeHref} className="button button-primary">Start an order <ArrowRight size={17} /></Link>
    </div>
  )

  const selectedOptions = { ...draft.options, ...optionChanges }
  const paperSize = String(selectedOptions['Paper Size'] ?? 'A4')
  const photoSize = selectedOptions['Photo Size'] === undefined ? undefined : String(selectedOptions['Photo Size'])
  const currentQuote = quoteKey===quoteInputKey && quote && Date.parse(quote.expiresAt)>quoteClock ? quote : null
  const intakeClosed=availability!==null && (!availability.ok || !availability.accepting || !availability.configured)
  const total = draft.service.slug==='printing' ? currentQuote?.total ?? quote?.total ?? 0 : calculateKioskTotal(draft.service, draft.optionDefinitions ?? [], selectedOptions)
  const isScheduled = transactionType === 'schedule'
  const file = stagedFiles[activeFile]
  const fileSummary = draft.files[activeFile]
  const printing = draft.service.slug === 'printing'
  const optionDefinitions = draft.optionDefinitions ?? []
  const localToday = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
  const selectedPickup = pickupDate ? new Date(`${pickupDate}T${pickupTime}:00+08:00`) : null
  const updateCheckout = (changes: NonNullable<KioskOrderDraft['checkout']>) => {
    try {
      const current = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null') as KioskOrderDraft | null
      if (!current) throw new Error('Draft unavailable')
      const next = {...current,checkout:{...current.checkout,...changes}}
      sessionStorage.setItem(draftStorageKey,JSON.stringify(next)); setDraftOverride(next)
    } catch {toast.error('Could not save your contact or payment choice. Keep this page open and try again.')}
    setPaymentConfirmed(false)
  }
  const chooseReceipt = async (file:File|null) => {
    if (file && stagedFiles.reduce((sum,item)=>sum+item.size,0)+file.size > 200*1024*1024) throw new Error('The files and receipt exceed 200 MB combined.')
    setReceiptSaving(true)
    try {await saveStagedFiles(stagedChannel+'-payment',file ? [file] : []);setPaymentReceipt(file);setPaymentConfirmed(false)} finally {setReceiptSaving(false)}
  }
  const chooseStudentProof = async (file:File|null) => {
    if(file && (file.size>10*1024*1024 || !['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))){toast.error('Choose a PDF or image of your student ID, up to 10 MB.');return}
    setReceiptSaving(true)
    try {await saveStagedFiles(stagedChannel+'-student',file?[file]:[]);setStudentProof(file);setPaymentConfirmed(false)}catch{toast.error('Could not save the student proof. Try again.')}finally{setReceiptSaving(false)}
  }

  const updateOption = (name: string, value: KioskOptionValue) => {
    setPaymentConfirmed(false)
    const options = { ...draft.options, ...optionChanges, [name]: value }
    const next = { ...draft, options, totalPrice: calculateKioskTotal(draft.service, draft.optionDefinitions ?? [], options) }
    try { sessionStorage.setItem(draftStorageKey, JSON.stringify(next)); setDraftOverride(next); setOptionChanges(current => ({ ...current, [name]: value })) }
    catch { toast.error('Your browser could not save this print choice. Please retry.') }
  }
  const optionError = validatePrintOptions(selectedOptions, Object.values(pageCounts))
  const saveOptions = () => {
    const next = { ...draft, options: selectedOptions, totalPrice: total }
    sessionStorage.setItem(draftStorageKey, JSON.stringify(next))
    setDraftOverride(next)
  }
  const moveTo = (next: ReviewStep) => {
    if(next!=='preview' && printing && (!currentQuote || quoteBusy)){toast.error(quoteError ?? 'Wait for the verified page quote before continuing.');return}
    if (receiptSaving) {toast.error('Wait for your receipt to finish saving.');return}
    if (optionsLoading || optionsError || editingIndex !== null) return
    if (next !== 'preview' && optionError) { toast.error(optionError); return }
    try { saveOptions(); setStep(next) } catch { toast.error('Your browser could not save the print choices. Please retry.') }
  }

  const handleSaveEdit = async (blob: Blob) => {
    if (editingIndex === null || !stagedFiles[editingIndex]) throw new Error('This file is unavailable. Upload it again.')
    const edited = createEditedUpload(stagedFiles[editingIndex], blob)
    const nextFiles = stagedFiles.map((file, index) => index === editingIndex ? edited : file)
    if (nextFiles.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('The edited files exceed the combined 200 MB order limit.')
    const nextDraft = { ...draft, options: selectedOptions, totalPrice: total, files: draft.files.map((item, index) => index === editingIndex
      ? { name: edited.name, size: edited.size, type: edited.type, edited: true } : item) }
    await saveStagedFiles(stagedChannel, nextFiles)
    try { sessionStorage.setItem(draftStorageKey, JSON.stringify(nextDraft)) }
    catch { await saveStagedFiles(stagedChannel, stagedFiles); throw new Error('Your browser could not save the edited draft. The previous file is kept. Please retry.') }
    setPageCounts(current => { const next = { ...current }; delete next[editingIndex]; return next })
    setDraftOverride(nextDraft); setStagedFiles(nextFiles); setEditingIndex(null)
    toast.success('Edits saved. This version will be sent with your order.')
  }

  const downloadFile = () => {
    if (!file) return
    const url = URL.createObjectURL(file), link = document.createElement('a')
    link.href = url; link.download = file.name; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  const handleScheduleNext = () => {
    const error = validatePickupAt(selectedPickup && !Number.isNaN(selectedPickup.getTime()) ? selectedPickup.toISOString() : null,undefined,availability?.ok?availability.policy:undefined)
    if (error) {toast.error(error);return}
    moveTo('confirmation')
  }

  const handleConfirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if(intakeClosed){toast.error(availability?.reason ?? 'Order intake is unavailable.');return}
    if(printing && (!currentQuote || quoteBusy)){toast.error('Refresh the page quote before submitting.');return}
    if(student && !studentProof){toast.error('Attach your student ID for staff verification, or remove the student discount.');return}
    if (optionError) { toast.error(optionError); return }
    if (receiptSaving) {toast.error('Wait for your payment receipt to finish saving.');return}
    if (editingIndex !== null || optionsLoading || optionsError) return
    if (showCustomerFields && !customerName.trim()) { toast.error('Please enter your full name.'); return }
    if (showCustomerFields && isScheduled && !customerEmail.trim()) { toast.error('Please enter your email.'); return }
    const paymentError = validatePayment(paymentMethod,paymentReference,paymentMethod==='cash' ? null : paymentReceipt,paymentAccounts)
    if (paymentError) {toast.error(paymentError);return}
    if (!paymentConfirmed) {toast.error('Confirm that your files, pickup details, and payment method are correct.');return}
    const pickupError = isScheduled ? validatePickupAt(selectedPickup && !Number.isNaN(selectedPickup.getTime()) ? selectedPickup.toISOString() : null,undefined,availability?.ok?availability.policy:undefined) : null
    if (pickupError) {toast.error(pickupError);return}
    setIsSubmitting(true)
    const ticketDetails = {
      customerName: customerName.trim() || undefined,
      transactionType,
      pickupAt: isScheduled ? selectedPickup?.toISOString() : undefined,
    }
    let savedSubmission: OrderSubmission | null = null
    try {
      if (!hasSupabaseConfig() || !isUuid(draft.service.id)) { toast.error('Database configuration is unavailable. Your files remain saved for retry.'); return }
      let ticket: OrderSubmission
      {
        const submissionKey = submissionKeyRef.current ?? draft.submissionKey ?? crypto.randomUUID()
        submissionKeyRef.current = submissionKey
        sessionStorage.setItem(draftStorageKey, JSON.stringify({ ...draft, submissionKey, options: selectedOptions, totalPrice: total }))
        const staged = await loadStagedFiles(stagedChannel)
        if (staged.length !== draft.files.length) { toast.error('Some files are missing from this browser. Return to your files and upload them again.'); return }
        const formData = new FormData()
        const meta: SubmitOrderMeta = {
          quoteId:currentQuote?.id,
          submissionKey, source: orderSource, serviceId: draft.service.id, serviceSlug: draft.service.slug,
          serviceOptions: { ...selectedOptions, 'Transaction Type': transactionType, ...(isScheduled ? { 'Pickup Date': pickupDate, 'Pickup Time': pickupTime, 'Pickup At': selectedPickup?.toISOString() } : {}) },
          totalPrice: total, estimatedDurationMinutes: draft.service.estimatedDurationMinutes,
          customerName: customerName.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          payment: {method:paymentMethod,...(paymentMethod!=='cash' ? {reference:paymentReference.trim()} : {})},
        }
        formData.append('meta', JSON.stringify(meta))
        for (const upload of staged) formData.append('files', upload)
        if (paymentMethod!=='cash' && paymentReceipt) formData.append('paymentReceipt',paymentReceipt)
        if(student && studentProof)formData.append('studentProof',studentProof)
        const result = await submitOrderFormAction(formData)
        if (!result.ok || !result.orderId) { toast.error(result.error ?? 'Could not submit your order.'); return }
        ticket = submissionFromResult(result,ticketDetails)
      }
      savedSubmission = ticket
      setConfirmedTicket(ticket)
      sessionStorage.setItem(ticketStorageKey, JSON.stringify(ticket))
      sessionStorage.removeItem(draftStorageKey)
      await clearStagedFiles(stagedChannel).catch(() => toast.error('Order saved; your browser could not clear the old staged files.'))
      await clearStagedFiles(stagedChannel+'-payment').catch(()=>toast.error('Order saved; the browser could not clear the staged receipt.'))
      await clearStagedFiles(stagedChannel+'-student').catch(()=>{})
      toast.success(isPendingPayment(ticket)?'Request submitted. Waiting for admin payment confirmation.':'Order saved to the database and queue.')
      router.push(queueHref)
    } catch (error) {
      console.error(error)
      toast.error(savedSubmission ? isPendingPayment(savedSubmission)?'Your request is saved. Keep this page open to wait for payment confirmation. Do not send payment again.':'Order ' + savedSubmission.orderNumber + ' was saved, but this browser could not save its receipt. Keep the order number shown on screen.'
        : 'Submission could not be confirmed. Keep your draft and retry to retrieve the same order.')
    } finally { setIsSubmitting(false) }
  }

  const handleCancel = async () => {
    if (receiptSaving || isSubmitting) return
    sessionStorage.removeItem(draftStorageKey)
    await clearStagedFiles(stagedChannel)
    await clearStagedFiles(stagedChannel+'-payment')
    await clearStagedFiles(stagedChannel+'-student')
    router.push(homeHref)
  }

  return (
    <div className={`flow-content ${step === 'preview' ? 'flow-content-wide' : ''}`} data-step={step}>
      {intakeClosed&&<p className="sop-closed-banner" role="status">{availability?.ok && !availability.configured?'Order setup is not ready.':availability?.reason} You can keep your draft and return when intake reopens.</p>}
      {availability?.ok&&availability.offline&&<p className="sop-closed-banner">The shop server is using its local buffer. Requests are preserved here and synchronized to the shop’s existing database when the connection returns. Staff verification and processing resume after reconnection.</p>}
      {printing&&quote&&!currentQuote&&!quoteBusy&&<p className="sop-closed-banner">Your quote needs refreshing before payment. <button className="underline" type="button" onClick={()=>{setQuoteClock(Date.now());setQuoteRetry(n=>n+1)}}>Refresh quote</button></p>}
      <FlowHeading
        title={step === 'preview' ? 'Print preview & specifications' : 'Place your order'}
        subtitle="Complete each step to submit your print job."
        current={step === 'preview' ? 'Preview & specs' : step === 'transaction' ? 'Transaction' : step === 'schedule' ? 'Schedule' : 'Confirmation'}
        next={step === 'preview' ? 'Transaction' : step === 'transaction' && isScheduled ? 'Schedule' : step === 'confirmation' ? paymentMethod==='cash'?'Ticket no.':'Payment review' : 'Confirmation'}
      />

      {step === 'preview' && <>
        <div className="preview-layout">
          <section className="surface preview-panel">
            <h2 className="panel-heading"><FileText size={18} /> Virtual print preview</h2>
            <p className="panel-description">Check your actual pages before printing. Black & white selections are shown in grayscale.</p>
            <div className="preview-file-actions">
              {file && <button type="button" className="button button-outline" onClick={() => setExpanded(true)}><Expand size={16} /> Expand preview</button>}
              {file && getFileEditorKind(file.name) && <button type="button" className="button button-primary" aria-label={'Edit ' + file.name} disabled={!!draft.submissionKey} onClick={() => setEditingIndex(activeFile)}><Pencil size={16} /> Edit file</button>}
              {file && <button type="button" className="button button-outline" onClick={downloadFile}><Download size={16} /> Download file</button>}
              {fileSummary?.edited && <span className="edit-saved"><Check size={15} /> Edits saved</span>}
            </div>
            <div className="document-sheet">
              {file ? <DocumentPreview file={file} width={560} height={700} paperSize={paperSize} photoSize={photoSize} printMargin={Number(selectedOptions['Print margin (mm)'] ?? 0)} grayscale={selectedOptions['Print Color'] === 'B&W'} onPageCount={count => setPageCounts(current => current[activeFile] === count ? current : { ...current, [activeFile]: count })} />
                : <div className="empty-state" style={{ minHeight: 240 }}><FileText size={34} /><p>{fileSummary ? 'Preview unavailable. Your file is still included.' : 'No uploaded files for this service.'}</p></div>}
            </div>
            <p className="document-file-name">{fileSummary?.name ?? draft.service.name}</p>
            {fileSummary?.edited && <p className="helper-note">The saved edited file replaces the original in this order.</p>}
            {draft.files.length > 1 && <div className="file-tabs" aria-label="Choose a document to preview">
              {draft.files.map((item, index) => <button key={`${item.name}-${index}`} type="button" aria-pressed={index === activeFile} onClick={() => setActiveFile(index)} title={item.name}>{item.name}</button>)}
            </div>}
          </section>
          <aside className="preview-spec-column"><section className="surface preview-panel">
            <h2 className="panel-heading">{printing ? 'Print specifications' : 'Service specifications'}</h2>
            <p className="panel-description">Confirm your options before continuing.</p>
            {optionsLoading && <p role="status" className="helper-note">Loading print choices from the database…</p>}
            {optionsError && <div role="alert"><p>{optionsError}</p><button type="button" className="button button-outline" onClick={() => setRetryOptions(value => value + 1)}>Retry</button></div>}
            <div className="spec-fields">
              {optionDefinitions.length > 0 ? optionDefinitions.map(option => <PrintOptionField key={option.id} option={option} value={selectedOptions[option.name]} onChange={value => updateOption(option.name, value)} prefix="review" />) : Object.entries(selectedOptions).map(([name, value]) => <div className="detail-row" key={name}><span>{name}</span><strong>{String(value)}</strong></div>)}
            </div>
            {optionError && <p role="alert" className="print-option-error">{optionError}</p>}
            {printing && <div className="sop-extra-options">
              <label className="field">Print margin (mm)<input type="number" min="0" max="40" step="1" value={Number(selectedOptions['Print margin (mm)'] ?? 0)} onChange={e=>updateOption('Print margin (mm)',Number(e.target.value))}/><small>Adds space around the complete page without reflowing the source document.</small></label>
              {!!finishingOptions.length && <label className="field">Finishing<select value={String(selectedOptions.Finishing ?? 'None')} onChange={e=>updateOption('Finishing',e.target.value)}><option>None</option>{finishingOptions.map(name=><option key={name}>{name}</option>)}</select></label>}
              <label className="sop-check"><input type="checkbox" checked={student} onChange={e=>{setStudent(e.target.checked);updateCheckout({student:e.target.checked})}}/>Request a student discount · ID verification required</label>
              {student && <div className="field"><label htmlFor="student-proof">Student ID proof · visible only to authorized staff</label><input id="student-proof" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={receiptSaving} onChange={e=>{void chooseStudentProof(e.target.files?.[0] ?? null);e.target.value=''}}/>{studentProof && <p>{studentProof.name} <button type="button" className="underline" onClick={()=>void chooseStudentProof(null)}>Remove</button></p>}<small>Submit only the ID needed to confirm eligibility. It is stored privately in the shop’s database, or buffered on this shop server and uploaded after reconnection. Your discount stays on hold until staff approve it.</small></div>}
              {quoteBusy && <p role="status">Analyzing selected pages and calculating your price…</p>}
              {quoteError && <p role="alert">{quoteError} <button type="button" className="underline" onClick={()=>setQuoteRetry(n=>n+1)}>Retry quote</button></p>}
              {currentQuote && <PrintQuoteSummary quote={currentQuote} names={stagedFiles.map(f=>f.name)}/>}
            </div>}
            {printing && <p className="helper-note">Changing the paper size updates the preview. Each page is centered and fitted to your selected sheet without stretching. Final margins depend on the printer.</p>}
          </section>
          <div className="surface preview-actions-summary"><Link href={`${serviceBaseHref}/${draft.service.slug}`} className="button button-outline"><ArrowLeft size={16}/>Back</Link><div className="preview-total"><span>Print total</span><strong>{printing && !currentQuote?'Calculating…':formatCurrency(total)}</strong></div><button type="button" className="button confirm-order" disabled={optionsLoading || !!optionsError || !!optionError || draft.files.length !== stagedFiles.length || printing && (!currentQuote || quoteBusy)} onClick={() => moveTo('transaction')}>Confirm print options <ArrowRight size={22}/></button></div>
          </aside>
        </div>
      </>}

      {step === 'transaction' && <>
        <section className="surface form-panel">
          <h2 className="panel-heading"><Banknote size={19} /> Choose transaction type</h2>
          <p className="panel-description">Select how you’ll collect and pay for your order.</p>
          <div className="choice-grid">
            <button type="button" className="transaction-choice" aria-pressed={!isScheduled} onClick={() => {setTransactionType('walk-in');updateCheckout({transactionType:'walk-in'})}}>
              <Banknote size={21} /><span><strong>Walk-in order</strong><small>Pay in cash when you pick up your order.</small></span><i className="selected-indicator" aria-hidden="true" />
            </button>
            <button type="button" className="transaction-choice" aria-pressed={isScheduled} onClick={() => {setTransactionType('schedule');updateCheckout({transactionType:'schedule'})}}>
              <Smartphone size={20} /><span><strong>Scheduled order</strong><small>Choose a pickup time. Online or counter prepayment must be approved before your ticket is released.</small></span><i className="selected-indicator" aria-hidden="true" />
            </button>
          </div>
        </section>
        <button type="button" className="button button-primary full-button" onClick={() => moveTo(isScheduled ? 'schedule' : 'confirmation')}>Continue to review <ArrowRight size={19} /></button>
        <button type="button" className="button button-outline" style={{ marginTop: 14 }} onClick={() => moveTo('preview')}><ArrowLeft size={16} /> Back</button>
      </>}

      {step === 'schedule' && <>
        <section className="surface form-panel">
          <h2 className="panel-heading"><CalendarDays size={19} /> Schedule pickup</h2>
          <p className="panel-description">Pickup hours: {availability?.ok?shopHoursLabel(availability.policy):'Contact the shop for current hours'}</p>
          <div className="spec-fields">
            <div className="field"><label htmlFor="pickup-date">Pickup date</label><input id="pickup-date" type="date" min={localToday} value={pickupDate} onChange={e => {setPickupDate(e.target.value);updateCheckout({pickupDate:e.target.value})}} required /></div>
            <div className="field"><label htmlFor="pickup-time">Pickup time</label><input id="pickup-time" type="time" min={availability?.ok?policyClock(availability.policy.openingMinute):undefined} max={availability?.ok?policyClock(availability.policy.closingMinute):undefined} step={900} value={pickupTime} onChange={e => {setPickupTime(e.target.value);updateCheckout({pickupTime:e.target.value})}} required /></div>
          </div>
          {selectedPickup && !Number.isNaN(selectedPickup.getTime()) && <p className="selected-time">Your selected time: {selectedPickup.toLocaleString('en-PH', { timeZone:'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
          <p className="helper-note">Your selected pickup time will be saved with your order. Please arrive during shop hours; the shop closes at 6:00 PM.</p>
        </section>
        <div className="actions-row"><button type="button" className="button button-outline" onClick={() => moveTo('transaction')}><ArrowLeft size={16} /> Back</button><button type="button" className="button button-primary" onClick={handleScheduleNext}>Next <ArrowRight size={17} /></button></div>
      </>}

      {step === 'confirmation' && <form className="confirmation-form" onSubmit={handleConfirm}>
        <section className="surface form-panel">
          <h2 className="panel-heading"><UserRound size={18} /> Contact information</h2>
          <p className="panel-description">{isScheduled ? 'Enter your details for your scheduled pickup.' : 'Tell us who will be collecting this order.'}</p>
          <div className="field"><label htmlFor="customer-name">Full name {showCustomerFields && '(required)'}</label><input id="customer-name" autoComplete="name" placeholder="e.g. Juan Dela Cruz" value={customerName} onChange={e => {setCustomerName(e.target.value);updateCheckout({customerName:e.target.value})}} required={showCustomerFields} maxLength={120} disabled={isSubmitting}/></div>
          <div className="fields-grid" style={{ marginTop: 18 }}>
            <div className="field"><label htmlFor="customer-email">Email {isScheduled ? '(required)' : '(optional)'}</label><input id="customer-email" type="email" autoComplete="email" placeholder="e.g. juan@example.com" value={customerEmail} onChange={e => {setCustomerEmail(e.target.value);updateCheckout({customerEmail:e.target.value})}} required={showCustomerFields && isScheduled} maxLength={254} disabled={isSubmitting}/></div>
            <div className="field"><label htmlFor="customer-phone">Phone (optional)</label><input id="customer-phone" type="tel" autoComplete="tel" placeholder="e.g. 0912 345 6789" value={customerPhone} onChange={e => {setCustomerPhone(e.target.value);updateCheckout({customerPhone:e.target.value})}} maxLength={30} disabled={isSubmitting}/></div>
          </div>
        </section>
        {printing&&!currentQuote?<p className="sop-closed-banner">Return to preview and refresh the price before sending a payment.</p>:<OrderPaymentPanel prepay={isScheduled} prepayMinutes={availability?.ok?availability.policy.unpaidTimeoutMinutes:15} accounts={paymentAccounts} method={paymentMethod} reference={paymentReference} receipt={paymentReceipt} total={total} disabled={isSubmitting || quoteBusy || intakeClosed} onMethod={method=>{setPaymentMethod(method);updateCheckout({paymentMethod:method})}} onReference={reference=>{setPaymentReference(reference);updateCheckout({paymentReference:reference})}} onReceipt={chooseReceipt}/>}
        <dl className="surface order-summary">
          <div><dt>Paper size</dt><dd>{String(selectedOptions['Paper Size'] ?? '—')}</dd></div>
          <div><dt>Color</dt><dd>{String(selectedOptions['Print Color'] ?? selectedOptions['Color Mode'] ?? '—')}</dd></div>
          <div><dt>Copies</dt><dd>{String(selectedOptions['Copies'] ?? 'Not specified')}</dd></div>
          <div><dt>Pages to print</dt><dd>{String(selectedOptions['Pages to print'] ?? '—')}</dd></div>
          <div><dt>Back to back</dt><dd>{String(selectedOptions['Back to back'] ?? '—')}</dd></div>
          <div className="summary-files"><dt>Files</dt><dd>{draft.files.map(item => item.name + (item.edited ? ' (edited)' : '')).join(', ')}</dd></div>
          <div><dt>Estimated total</dt><dd>{formatCurrency(total)}</dd></div>
        </dl>
        {isScheduled && <p className="selected-time">Pickup: {selectedPickup?.toLocaleString('en-PH', { timeZone:'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
        <label className="payment-confirm-check"><input type="checkbox" checked={paymentConfirmed} onChange={e=>setPaymentConfirmed(e.target.checked)} required disabled={isSubmitting}/><span>I’ve checked my files, print options, pickup details, and payment method. {paymentMethod==='cash' ? 'I will pay at the shop.' : 'I understand the uploaded payment is awaiting staff verification.'}</span></label>
        <div className="actions-row confirmation-actions">
          <button type="button" className="button button-outline" disabled={isSubmitting || receiptSaving} onClick={() => moveTo(isScheduled ? 'schedule' : 'transaction')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="button button-cancel" disabled={isSubmitting || receiptSaving} onClick={() => void handleCancel()}><X size={16} /> Cancel</button>
          <button type="submit" className="button button-primary" disabled={isSubmitting || receiptSaving || intakeClosed || printing&&(!currentQuote||quoteBusy)}>{receiptSaving ? 'Saving receipt…' : isSubmitting ? 'Submitting…' : 'Get ticket'} <ArrowRight size={17} /></button>
        </div>
      </form>}
      {expanded && file && <ExpandedPreview file={file} paperSize={paperSize} photoSize={photoSize} printMargin={Number(selectedOptions['Print margin (mm)'] ?? 0)} grayscale={selectedOptions['Print Color'] === 'B&W'} onClose={() => setExpanded(false)} />}
      {editingIndex !== null && stagedFiles[editingIndex] && <UploadFileEditor file={stagedFiles[editingIndex]} onSave={handleSaveEdit} onCancel={() => setEditingIndex(null)} />}
    </div>
  )
}
