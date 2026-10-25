import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Printer, Search } from 'lucide-react'
import {ResumeRequest} from '@/components/order-flow/resume-request'

const steps = [
  { title: 'Upload', text: 'Add the documents or photos you want printed.' },
  { title: 'Configure', text: 'Choose paper, color, and copies. Check your print preview.' },
  { title: 'Collect', text: 'Use your ticket to track your order and collect your prints.' },
]

export default function OnlineOrderHomePage() {
  return <div className="home-content">
    <ResumeRequest/>
    <section className="home-hero surface">
      <div className="home-copy">
        <p className="eyebrow"><Printer size={15} /> Simple printing, clear status</p>
        <h1>Send your files. Pick them up when they’re ready.</h1>
        <p className="home-description">Upload your files in just a few taps and we’ll handle the rest. Preview your print order, follow its progress, and collect it at the shop when it’s ready.</p>
        <div className="home-actions">
          <Link href="/order/service/printing" className="button button-navy">Start print order <ArrowRight size={24} /></Link>
          <Link href="/order/status" className="button button-outline"><Search size={19} /> Track status</Link>
        </div>
      </div>
      <div className="home-visual"><Image src="/order-assets/services-poster.png" alt="JandC Internet Cafe services: printing, computer rentals, ID pictures, scanning, emails, and printer repair" width={950} height={621} priority sizes="(max-width: 760px) 90vw, 500px" /></div>
    </section>
    <section className="home-steps" aria-label="How to place your print order">{steps.map((step,index)=><article key={step.title} className="home-step surface"><span className="customer-step-number">{index+1}</span><div><h2>{step.title}</h2><p>{step.text}</p></div></article>)}</section>
  </div>
}
