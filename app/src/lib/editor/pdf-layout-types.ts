export interface PdfLayoutSpan {
  id: string; text: string; x: number; y: number; width: number; height: number; baseline: number
  font: string; size: number; bold: boolean; italic: boolean; color: string; maxWidth: number; editable: boolean
}
export interface PdfLayoutPage { width: number; height: number; spans: PdfLayoutSpan[] }
export interface PdfLayout { pages: PdfLayoutPage[] }
export interface PdfLayoutEdit { id: string; text: string; size?: number; bold?: boolean; italic?: boolean; color?: string }
