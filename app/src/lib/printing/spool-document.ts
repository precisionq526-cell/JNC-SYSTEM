import { PDFDocument } from 'pdf-lib'

// Build complete copies in the PDF so printer-driver collation cannot mix customer copies.
// Add a blank between odd-length duplex copies so each copy starts on a new sheet.
export async function prepareSpoolDocument(source: Uint8Array, pages: number[], copies: number, duplex: boolean) {
  const original = await PDFDocument.load(source)
  if (!pages.length || pages.some(page => !Number.isInteger(page) || page < 1 || page > original.getPageCount()) || !Number.isInteger(copies) || copies < 1) throw new Error('Invalid pages or copies.')
  const blanks = duplex && pages.length % 2 === 1 ? copies - 1 : 0
  if (pages.length * copies + blanks > 20000) throw new Error('This print run exceeds 20,000 pages. Split it into smaller runs.')
  if (copies === 1 && pages.length === original.getPageCount() && pages.every((page, index) => page === index + 1)) return Buffer.from(source)
  // Keep filled form appearances when selecting pages or making collated copies.
  // The original customer's bytes stay intact; only the temporary spool document is flattened.
  try {
    const form = original.getForm()
    if (form.getFields().length) form.flatten({ updateFieldAppearances: false })
  } catch { throw new Error('This PDF form cannot be prepared with its saved appearance. Export a flattened PDF before printing selected pages or multiple copies.') }
  const pdf = await PDFDocument.create()
  for (let copy = 0; copy < copies; copy++) {
    const selected = await pdf.copyPages(original, pages.map(page => page - 1))
    for (const page of selected) pdf.addPage(page)
    if (duplex && pages.length % 2 === 1 && copy < copies - 1) {
      const last = selected[selected.length - 1]
      pdf.addPage([last.getWidth(), last.getHeight()])
    }
  }
  return Buffer.from(await pdf.save())
}
