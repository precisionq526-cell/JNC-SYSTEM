import type { KioskOptionValue, KioskServiceSummary, KioskOptionSummary } from './order-draft'
import type { Service, ServiceOption } from '@/lib/types/database'

export function normalizeService(service: Service): KioskServiceSummary {
  return { id: service.id, name: service.name, slug: service.slug, description: service.description ?? '', icon: service.icon,
    basePrice: Number(service.base_price), estimatedDurationMinutes: service.estimated_duration_minutes }
}

export function normalizeOption(option: ServiceOption): KioskOptionSummary {
  return { id: option.id, name: option.name, optionType: option.option_type, choices: Array.isArray(option.choices) ? option.choices.map(String) : [],
    defaultValue: option.default_value, priceModifier: Number(option.price_modifier), isRequired: option.is_required, displayOrder: option.display_order }
}

export const PAPER_LABELS: Record<string, string> = {
  A4: 'A4 · 210 × 297 mm', Short: 'Short bond · 8.5 × 11 in', Long: 'Long bond · 8.5 × 13 in', Legal: 'Legal · 8.5 × 14 in',
}

export function printOptionHint(name: string): string | undefined {
  if (name === 'Pages to print') return 'All, or pages such as 1-3, 5. The same selection applies to each uploaded document.'
  if (name === 'Back to back') return 'Yes prints on both sides. No prints on one side.'
  if (name === 'Copies') return 'Number of copies of each uploaded file.'
}

export function parsePrintPages(value: unknown, pageCount?: number): number[] | null {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter All or the pages you want to print, such as 1-3, 5.')
  if (/^all$/i.test(value.trim())) return null
  if (value.length > 2000) throw new Error('The page selection is too long.')
  const pages = new Set<number>()
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('Use page numbers or ranges separated by commas, such as 1-3, 5.')
    const first = Number(match[1]), last = match[2] ? Number(match[2]) : first
    if (first < 1 || last < first || last > 10000) throw new Error('Page ranges must start at 1 or higher and go from a smaller number to a larger number (maximum 10000).')
    if (pageCount !== undefined && last > pageCount) throw new Error('The page selection exceeds this document’s ' + pageCount + ' pages.')
    for (let page = first; page <= last; page++) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

export function validatePrintOptions(options: Record<string, unknown>, pageCounts: number[] = []): string | null {
  const margin=Number(options['Print margin (mm)'] ?? 0)
  if(!Number.isFinite(margin) || margin<0 || margin>40)return 'Print margin must be between 0 and 40 mm.'
  const copies = options.Copies
  if (copies !== undefined && (!Number.isInteger(Number(copies)) || Number(copies) < 1 || Number(copies) > 10000)) return 'Copies must be a whole number between 1 and 10000.'
  if (options['Pages to print'] !== undefined) {
    try {
      parsePrintPages(options['Pages to print'])
      for (const count of pageCounts) parsePrintPages(options['Pages to print'], count)
    } catch (error) { return error instanceof Error ? error.message : 'Invalid page selection.' }
  }
  return null
}

export function restoreConfiguredOptions(definitions: KioskOptionSummary[], saved: Record<string, KioskOptionValue>) {
  return {...Object.fromEntries(['Finishing','Print margin (mm)'].filter(key=>saved[key]!==undefined).map(key=>[key,saved[key]])),...Object.fromEntries(definitions.filter(option => saved[option.name] !== undefined &&
    (option.optionType !== 'select' && option.optionType !== 'toggle' || (option.optionType === 'toggle' ? ['Yes', 'No'] : option.choices).includes(String(saved[option.name]))))
    .map(option => [option.name, saved[option.name]]))}
}
