'use client'
import type {PrintQuote} from '@/lib/sop/pricing'
import {formatCurrency} from '@/lib/utils/format'
export function PrintQuoteSummary({quote,names}:{quote:PrintQuote;names:string[]}) {
  return <section className="sop-quote" aria-label="Itemized print price"><h3>Itemized print price</h3>
    <p>{quote.pages.length} selected pages × {quote.copies} {quote.copies===1?'copy':'copies'} · {quote.paper}</p>
    <details><summary>View page classifications and rates</summary><div className="sop-table-scroll"><table><thead><tr><th>File / page</th><th>Classification</th><th>Rate</th><th>Student discount</th><th>Line total</th></tr></thead><tbody>{quote.pages.map(p=><tr key={p.fileIndex+':'+p.page}><td>{names[p.fileIndex]} · p. {p.page}</td><td>{{bw:'Black & white',accents:'Colored accents',images:'Full color / images'}[p.category]}</td><td>{formatCurrency(p.rate)}</td><td>{formatCurrency(p.discount)} / page</td><td>{formatCurrency(p.amount)}</td></tr>)}</tbody></table></div></details>
    <dl><div><dt>Pages before discount</dt><dd>{formatCurrency(quote.subtotal)}</dd></div>{quote.student&&<div><dt>Student discount · verification required</dt><dd>−{formatCurrency(quote.discount)}</dd></div>}{quote.finishing.map(f=><div key={f.name}><dt>{f.name}</dt><dd>{formatCurrency(f.amount)}</dd></div>)}<div><dt>Total</dt><dd><strong>{formatCurrency(quote.total)}</strong></dd></div></dl>
    <small>Classification and coverage are estimated from the print layout. Check each page before paying. Student discounts require staff approval of a valid student ID.</small></section>
}
