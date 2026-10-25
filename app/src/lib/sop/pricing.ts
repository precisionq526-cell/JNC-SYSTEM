export type PageCategory = 'bw' | 'accents' | 'images'
export interface AnalyzedPage { fileIndex: number; page: number; category: PageCategory; textCoverage: number; imageCoverage: number }
export interface PricingPolicy {
  rates: Record<'Short' | 'A4' | 'Long' | 'Legal', Record<PageCategory, number>>
  finishing: Record<string, number>
  studentDiscounts: { textLow: number; textHigh: number; imageLow: number; imageHigh: number }
}
export const SOP_PRICING: PricingPolicy = {
  rates: { Short: { bw: 3, accents: 4, images: 10 }, A4: { bw: 3, accents: 4, images: 12 }, Long: { bw: 4, accents: 5, images: 15 }, Legal: { bw: 4, accents: 5, images: 15 } },
  // No finishing prices are invented. An administrator must configure offered services.
  finishing: {}, studentDiscounts: { textLow: 1, textHigh: 0.5, imageLow: 2, imageHigh: 1 },
}
export interface PrintQuote {
  version: 1; id: string; fingerprint: string; expiresAt: string; student: boolean
  paper: string; copies: number; pages: (AnalyzedPage & { rate: number; discount: number; amount: number })[]
  subtotal: number; discount: number; finishing: { name: string; amount: number }[]; total: number
}
export function quotePages(pages: AnalyzedPage[], options: Record<string, unknown>, student: boolean, policy: PricingPolicy = SOP_PRICING) {
  const paper = options['Paper Size'] === 'Letter' ? 'Short' : String(options['Paper Size'] ?? 'A4')
  if (!(paper in policy.rates)) throw new Error('Choose a supported paper size.')
  const copies = Number(options.Copies ?? 1)
  if (!Number.isInteger(copies) || copies < 1 || copies > 10000 || !pages.length) throw new Error('A quote needs printable pages and a valid copy count.')
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const items = pages.map(page => {
    if (![page.textCoverage, page.imageCoverage].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid page coverage.')
    const rate = policy.rates[paper as keyof PricingPolicy['rates']][page.category]
    const discounts = policy.studentDiscounts
    const deduction = !student ? 0 : page.category === 'images' ? (page.imageCoverage < 0.5 ? discounts.imageLow : discounts.imageHigh) : (page.textCoverage < 0.5 ? discounts.textLow : discounts.textHigh)
    if (![rate, deduction].every(n => Number.isFinite(n) && n >= 0) || deduction > rate) throw new Error('Invalid rate or discount configuration.')
    return { ...page, rate, discount: deduction, amount: round((rate - deduction) * copies) }
  })
  const requested = String(options.Finishing ?? 'None').split(',').map(s => s.trim()).filter(s => s && s !== 'None')
  if (new Set(requested).size !== requested.length) throw new Error('Choose each finishing service once.')
  const finishing = requested.map(name => {
    const amount = policy.finishing[name]
    if (!Number.isFinite(amount) || amount < 0) throw new Error('This finishing service has not been priced by the shop.')
    return { name, amount }
  })
  const total=round(items.reduce((n, p) => n + p.amount, 0) + finishing.reduce((n, f) => n + f.amount, 0))
  if(total>999999)throw new Error('This order exceeds the supported amount. Split it into smaller requests.')
  return { paper, copies, student, pages: items, subtotal: round(items.reduce((n, p) => n + p.rate * copies, 0)),
    discount: round(items.reduce((n, p) => n + p.discount * copies, 0)), finishing,
    total }
}
