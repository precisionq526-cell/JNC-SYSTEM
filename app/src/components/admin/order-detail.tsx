'use client'
import Link from 'next/link'
import {SopOrderChecks} from './sop-order-checks'
import {PrintRecovery} from './print-recovery'
import {ticketIsHeld,orderHoldReason} from '@/lib/sop/workflow'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { getAdminOrderDetailAction } from '@/lib/actions/admin-order-detail'
import { scanAdminPrintersAction } from '@/lib/actions/admin-data'
import { getWindowsPrintJobsAction } from '@/lib/actions/print-jobs'
import { customerLabel, money, timestamp } from '@/lib/admin/display'
import { buildPrintPlan, type PrintSide } from '@/lib/printing/print-plan'
import type { PrintReceipt } from '@/lib/printing/send-to-printer'
import { DocumentPreview } from '@/components/preview/document-preview'
import DataStatus from './data-status'
import { useAdminData } from './use-admin-data'
import { verifyOrderPaymentAction } from '@/lib/actions/order-payment'

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const load = useCallback(() => getAdminOrderDetailAction(orderId), [orderId])
  const state = useAdminData(load)
  const printers = useAdminData(scanAdminPrintersAction, 30000)
  const [selectedId, setSelectedId] = useState('')
  const [printerName, setPrinterName] = useState('')
  const [preview, setPreview] = useState<File | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [pages, setPages] = useState(0)
  const [reviewed, setReviewed] = useState(false)
  const [manualCopy, setManualCopy] = useState(1)
  const [reloaded, setReloaded] = useState(false)
  const [reverseBacks, setReverseBacks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const [paymentBusy,setPaymentBusy] = useState(false)
  const [paymentError,setPaymentError] = useState<string|null>(null)
  const [paymentReviewed,setPaymentReviewed] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [receipt, setReceipt] = useState<PrintReceipt | null>(null)
  const [reprints, setReprints] = useState<Partial<Record<PrintSide, string>>>({})
  const [unconfirmedRequest, setUnconfirmedRequest] = useState<{ side: PrintSide; requestId: string } | null>(null)
  const printInFlight = useRef(false)
  const data = state.data
  const paymentHeld = !!data && ticketIsHeld(data.order)
  const file = data?.files.find(file => file.id === selectedId) ?? data?.files[0]
  const selectedPrinter = printers.data?.printers.find(printer => printer.name === printerName) ?? printers.data?.printers[0]
  const actualPrinter = selectedPrinter?.name ?? ''
  const options = JSON.stringify(data?.order.service_options ?? {})
  const manualDuplex = data && ['yes', 'true'].includes(String(data.order.service_options['Back to back']).toLowerCase()) && selectedPrinter?.supportsDuplex !== true
  const copies = Number(data?.order.service_options.Copies ?? 1)
  const jobsAction = useCallback(() => actualPrinter ? getWindowsPrintJobsAction(actualPrinter) : Promise.resolve({ ok: true as const, data: [] }), [actualPrinter])
  const jobs = useAdminData(jobsAction, 10000)
  const fileUrl = file ? '/api/admin/orders/' + orderId + '/files/' + file.id : ''

  useEffect(() => {
    setReviewed(false); setReloaded(false); setReceipt(null); setReprints({}); setUnconfirmedRequest(null); setUncertain(false)
  }, [file?.id, actualPrinter, manualCopy, options])
  useEffect(() => {
    if (!fileUrl || !file) return
    const controller = new AbortController()
    setPreview(null); setPages(0); setReviewed(false); setPreviewError(null); setPreviewLoading(true)
    void (async () => {
      try {
        const response = await fetch(fileUrl + '?preview=pdf', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? 'The file preview is unavailable.') }
        const blob = await response.blob()
        if (!controller.signal.aborted) setPreview(new File([blob], file.file_name.replace(/\.[^.]+$/, '') + '-print.pdf', { type: 'application/pdf' }))
      } catch (error) { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Could not load the file.') }
      finally { if (!controller.signal.aborted) setPreviewLoading(false) }
    })()
    return () => controller.abort()
  // Order options are included so paper changes refresh image/text PDF layout.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, file?.file_name, file?.file_size, file?.availability, options, previewAttempt])

  const savedReceipt = (side: PrintSide): PrintReceipt | null => {
    const previous = data?.printHistory.find(row => row.metadata.fileId === file?.id && row.metadata.printerName === actualPrinter
      && row.metadata.side === side && (side === 'all' || row.metadata.manualCopy === manualCopy))
    const metadata = previous?.metadata
    if (!metadata || !Array.isArray(metadata.pages) || typeof metadata.paper !== 'string' || typeof metadata.copies !== 'number') return null
    return { ...metadata, requestId: String(metadata.requestId ?? previous.id) } as unknown as PrintReceipt
  }
  const sideReceipt = (side: PrintSide) => receipt?.side === side ? receipt : reprints[side] ? null : savedReceipt(side)
  const displayedReceipt = receipt ?? (manualDuplex ? sideReceipt('back') ?? sideReceipt('front') : sideReceipt('all'))
  const intent = (side: PrintSide) => JSON.stringify([orderId, file?.id, actualPrinter, side, manualCopy, reverseBacks, options, reprints[side] ?? null])
  const storageKey = (side: PrintSide) => 'admin-print-request:' + intent(side)
  const submit = async (side: PrintSide) => {
    if (!data || !file || !selectedPrinter || !reviewed || !pages || paymentHeld || printInFlight.current || sideReceipt(side)) return
    setPrintError(null)
    try { buildPrintPlan(data.order.service_options, pages, selectedPrinter.supportsDuplex, side, manualCopy, reverseBacks) }
    catch (error) { setPrintError(error instanceof Error ? error.message : 'Invalid print settings.'); return }
    printInFlight.current = true; setBusy(true)
    try {
      const key = storageKey(side)
      let requestId = sessionStorage.getItem(key)
      if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(key, requestId) }
      const response = await fetch('/api/admin/print', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, orderId, fileId: file.id, printerName: actualPrinter, side, manualCopy, reverseBacks, reprintOf: reprints[side] }) })
      const result = await response.json()
      if (!response.ok) {
        setUncertain(result.code === 'PRINT_UNCONFIRMED')
        if (result.code === 'PRINT_UNCONFIRMED') setUnconfirmedRequest({ side, requestId: result.requestId ?? requestId })
        if (result.code === 'INVALID_PRINT') sessionStorage.removeItem(key)
        throw new Error(result.error ?? 'Print submission could not be confirmed.')
      }
      setReceipt(result.receipt); setUncertain(false); setUnconfirmedRequest(null); setReloaded(false)
      await Promise.all([state.refresh(), jobs.refresh()])
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'The response was interrupted. Retry uses the same request and will not duplicate a confirmed submission.')
    } finally { setBusy(false); printInFlight.current = false }
  }
  const allowNewRequest = () => {
    const next: Partial<Record<PrintSide, string>> = {}
    for (const side of ['all', 'front', 'back'] as const) {
      const previous = sideReceipt(side) ?? savedReceipt(side)
      if (previous) next[side] = previous.requestId
    }
    if (unconfirmedRequest) next[unconfirmedRequest.side] = unconfirmedRequest.requestId
    setReprints(next)
    setUnconfirmedRequest(null)
    setReceipt(null); setPrintError(null); setUncertain(false); setReviewed(false); setReloaded(false)
  }
  const frontSubmitted = !!sideReceipt('front')
  const blocked = busy || paymentBusy || paymentHeld || !reviewed || !preview || !pages || !selectedPrinter || !!previewError || uncertain
  if (!data) return <div className="admin-page"><Link href="/admin/orders">Back to orders</Link><DataStatus {...state} /></div>
  return <div className="admin-page order-detail-page">
    <Link href="/admin/orders" className="order-back-link"><ArrowLeft size={16} />All orders</Link>
    <div className="order-detail-heading"><div><h1>{data.order.order_number}</h1><p>{data.service?.name ?? 'Service unavailable'} · {customerLabel(data.order)}</p></div>
      <div><strong>{money(data.order.total_price)}</strong><p>{data.order.status} · {data.order.is_paid ? 'Paid' : 'Unpaid'} · Queue {data.queue?.queue_number ?? 'not recorded'}</p></div></div>
    <DataStatus {...state} />
    <section className="order-detail-summary">
      <dl>{Object.entries(data.order.service_options ?? {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([name, value]) =>
        <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>)}</dl>
      <p>Received {timestamp(data.order.created_at)}{data.order.customer_email && ' · ' + data.order.customer_email}</p>
      {(data.payment?.notes || !data.payment && data.order.customer_notes) && <p>Customer notes: {data.payment?.notes ?? data.order.customer_notes}</p>}
      <Link href="/admin/queue" className="underline">Manage order status in queue</Link>
    </section>
    {data.payment && <section id="payment-review" className="order-detail-summary" aria-label="Recorded payment">
      <h2 className="font-semibold text-lg mb-3">Payment confirmation</h2>
      {paymentHeld && <div className="admin-payment-hold"><strong>{orderHoldReason(data.order)}</strong><p>The customer’s ticket is held until all required payment and student checks are approved. Confirm the actual cash or wallet payment before recording it as received.</p></div>}
      <p>Method: {data.payment.method==='cash'?'Cash at pickup':data.payment.method==='gcash'?'GCash':'Maya'} · {data.order.is_paid?'Verified and paid':data.payment.method==='cash'?'Awaiting collection':'Awaiting staff verification'}</p>
      {data.payment.reference && <p>Reference: <strong>{data.payment.reference}</strong></p>}
      {data.payment.receiptPath && <p className="my-3"><a href={'/api/admin/orders/'+orderId+'/payment-proof'} target="_blank" rel="noopener noreferrer" className="underline">View uploaded receipt: {data.payment.receiptName}</a></p>}
      {data.order.is_paid && data.payment.verifiedAt && <p>Approved {timestamp(data.payment.verifiedAt)}. The customer can now view the released order number.</p>}
      {!data.order.is_paid && !['cancelled','failed'].includes(data.order.status) && <><label className="flex items-start gap-2 text-sm my-4"><input type="checkbox" checked={paymentReviewed} onChange={e=>setPaymentReviewed(e.target.checked)} disabled={paymentBusy || busy}/><span>{data.payment.method==='cash'?'I have collected the cash payment.':`I checked the receipt and reference, and confirmed that ${money(data.order.total_price)} was received in the shop wallet.`}</span></label><button type="button" className="order-primary-button" disabled={!paymentReviewed || paymentBusy || busy} onClick={async()=>{setPaymentBusy(true);setPaymentError(null);try{const result=await verifyOrderPaymentAction(orderId);if(!result.ok)setPaymentError(result.error);else{setPaymentReviewed(false);await state.refresh()}}catch{setPaymentError('Payment could not be confirmed. Please retry.')}finally{setPaymentBusy(false)}}}>{paymentBusy?'Approving…':data.payment.method==='cash'?'Confirm cash received':'Approve payment & release ticket'}</button></>}
      {paymentError && <p role="alert" className="text-red-700">{paymentError}</p>}
    </section>}
    <SopOrderChecks order={data.order} names={data.files.map(f=>f.file_name)} refresh={state.refresh}/>
    <PrintRecovery orderId={orderId} history={data.printHistory} refresh={state.refresh}/>
    <div className="order-review-grid">
      <section className="order-file-preview">
        <h2>Order files & print preview</h2>
        {!data.files.length && <p>This order has no attached files.</p>}
        <div className="order-file-list">{data.files.map(item => <button key={item.id} type="button" disabled={busy} aria-pressed={file?.id === item.id} onClick={() => setSelectedId(item.id)}>
          <strong>{item.file_name}</strong><span>{(item.file_size / 1024).toFixed(1)} KB · {({ local: 'On this PC', cloud: 'Available in cloud', missing: 'Original file missing', unknown: 'Availability could not be checked' })[item.availability]}</span>
        </button>)}</div>
        {file && <div className="order-downloads"><a href={fileUrl} download><Download size={15} />Download saved file</a><a href={fileUrl + '?preview=pdf'} download><Download size={15} />Download print PDF</a></div>}
        {previewLoading && <p role="status">Preparing the actual document pages…</p>}
        {previewError && <div className="order-error" role="alert"><p>{previewError}</p><button type="button" className="order-secondary-button" onClick={() => setPreviewAttempt(attempt => attempt + 1)}>Retry preview</button></div>}
        {preview && <DocumentPreview file={preview} width={760} height={850} paperSize={String(data.order.service_options['Paper Size'] ?? 'A4')} grayscale={/b&w|black|monochrome/i.test(String(data.order.service_options['Print Color'] ?? data.order.service_options['Color Mode'] ?? 'B&W'))} onPageCount={setPages} />}
      </section>
      <section className="order-print-controls">
        <h2><Printer size={18} />Send to printer</h2>
        {paymentHeld && <p className="admin-payment-hold">Printing is on hold. {orderHoldReason(data.order)}.</p>}
        <p>Review every page and the saved specifications. Pages are fitted to the selected paper.</p>
        <dl className="text-sm mb-4 space-y-2">{Object.entries({ 'Paper Size': 'A4', 'Print Color': 'B&W', 'Back to back': 'No', 'Pages to print': 'All', Copies: 1 }).map(([name, fallback]) => {
          const value = data.order.service_options[name] ?? (name === 'Print Color' ? data.order.service_options['Color Mode'] : undefined)
          return <div key={name} className="flex flex-wrap gap-x-2"><dt>{name}:</dt><dd className="font-semibold">{String(value ?? fallback)}{value === undefined && <span className="font-normal text-gray-500"> · printing default; customer choice not recorded</span>}</dd></div>
        })}</dl>
        <DataStatus {...printers} />
        <label className="order-control">Printer<select value={actualPrinter} disabled={busy} onChange={event => setPrinterName(event.target.value)}><option value="">Choose a printer</option>
          {printers.data?.printers.map(printer => <option key={printer.name} value={printer.name}>{printer.name} · {printer.status}</option>)}</select></label>
        {!printers.data?.printers.length && !printers.loading && <p>No physical printer was found on this PC.</p>}
        {selectedPrinter && <p>{selectedPrinter.supportsColor === true ? 'Color supported' : selectedPrinter.supportsColor === false ? 'Black & white printer' : 'Color support unknown'} · {selectedPrinter.supportsDuplex === true ? 'Automatic two-sided printing' : 'Manual two-sided printing'}</p>}
        <label className="order-check"><input type="checkbox" checked={reviewed} disabled={!pages || busy} onChange={event => setReviewed(event.target.checked)} />I checked this file’s pages, paper size, color, sides and copies.</label>
        {!displayedReceipt && !reviewed && !previewLoading && !previewError && pages > 0 && <p>Check the box above to enable printing.</p>}
        {manualDuplex ? <div className="manual-duplex">
          <h3>Manual back-to-back printing</h3><p>Print one copy at a time. Wait for the fronts to finish, then reload them using your printer’s feed direction. For an odd page count, set aside the last front sheet before printing backs.</p>
          <label className="order-control">Copy number<input type="number" min="1" max={Math.max(1, copies)} value={manualCopy} disabled={busy} onChange={event => setManualCopy(Number(event.target.value))} /></label>
          <p>{copies} ordered {copies === 1 ? 'copy' : 'copies'}</p>
          <button className="order-primary-button" disabled={blocked || !!sideReceipt('front') || !!sideReceipt('back')} onClick={() => void submit('front')}>1. Print front sides</button>
          <label className="order-check"><input type="checkbox" checked={reloaded} disabled={busy || !frontSubmitted} onChange={event => setReloaded(event.target.checked)} />The front sides finished and I reloaded the sheets.</label>
          <label className="order-check"><input type="checkbox" checked={reverseBacks} disabled={busy} onChange={event => setReverseBacks(event.target.checked)} />Print back pages in reverse order (change to suit the feed direction).</label>
          <button className="order-primary-button" disabled={blocked || !reloaded || !frontSubmitted || !!sideReceipt('back')} onClick={() => void submit('back')}>2. Print back sides</button>
        </div> : <button className="order-primary-button" disabled={blocked || !!sideReceipt('all')} onClick={() => void submit('all')}>Print selected file · {copies} {copies === 1 ? 'copy' : 'copies'}</button>}
        {busy && <p role="status">Submitting this file to Windows printing…</p>}
        {printError && <p className="order-error" role="alert">{printError}</p>}
        {displayedReceipt && <div className="order-print-receipt" role="status"><strong>Already submitted to {displayedReceipt.printerName}</strong><p>Pages {displayedReceipt.pages.join(', ')} · {displayedReceipt.paper} · {displayedReceipt.copies} {displayedReceipt.copies === 1 ? 'copy' : 'copies'}{displayedReceipt.side !== 'all' && ' · ' + displayedReceipt.side + ' sides'}</p><p>{timestamp(displayedReceipt.submittedAt)}. Refreshing this page will not send another print.</p>{displayedReceipt.warning && <p>{displayedReceipt.warning}</p>}</div>}
        {(displayedReceipt || uncertain) && <button className="order-secondary-button" disabled={busy} onClick={allowNewRequest}>{uncertain ? 'I checked the queue and sheets · prepare a new request' : 'Prepare another print of this file'}</button>}
        <h3>Windows printer queue</h3><DataStatus {...jobs} />
        {jobs.data?.map(job => <div className="windows-print-job" key={job.id}><strong>Job {job.id} · {job.document}</strong><p>{job.status} · {job.printedPages}/{job.pages} pages · {timestamp(job.submittedAt)}</p></div>)}
        {actualPrinter && jobs.data?.length === 0 && <p>No jobs are currently waiting in this printer’s Windows queue. Completed jobs may disappear from this list.</p>}
      </section>
    </div>
    <section className="order-print-history"><h2>Print submission history</h2>{data.historyError && <p role="alert">{data.historyError}</p>}
      {!data.printHistory.length && <p>No print submissions are recorded for this order.</p>}
      {data.printHistory.map(row => <p key={row.id}>{timestamp(row.created_at)} · {String(row.metadata.printerName ?? 'Printer unavailable')} · {String(row.metadata.side ?? 'all')} sides · {Array.isArray(row.metadata.pages) ? row.metadata.pages.join(', ') : 'Pages unavailable'} · {String(row.metadata.copies ?? '')} copies</p>)}
    </section>
  </div>
}
