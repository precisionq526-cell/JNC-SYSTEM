import { convertPdfToDocument } from './pdf-to-document'

const conversions = new WeakMap<File, Promise<File>>()

export function openEditablePdf(file: File): Promise<File> {
  const existing = conversions.get(file)
  if (existing) return existing
  const pending = convertPdfToDocument(file)
  conversions.set(file, pending)
  void pending.catch(() => conversions.delete(file))
  return pending
}
