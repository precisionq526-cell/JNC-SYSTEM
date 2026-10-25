import type { OfficeTextFormat } from './office-document'
import type { WordImage } from './word-graphics'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export type WordNode = { kind: 'paragraph'; align?: string; before: number; after: number; runs: { id?: string; text: string; format: OfficeTextFormat;image?:WordImage }[] } | { kind: 'table'; widths: number[]; rows: { cells: { width?: number; colspan: number; rowspan: number; shade?: string; blocks: WordNode[] }[] }[] }
export interface WordLayout { width: number; padding: number[]; blocks: WordNode[] }
const children = (node: Element, name: string) => Array.from(node.children || node.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === name)
const value = (node: Element | undefined, name: string, attribute = 'val') => node?.getElementsByTagNameNS(W, name)[0]?.getAttributeNS(W, attribute) || ''
export function wordLayout(document: Document, ids: Map<Element, string>,images=new Map<Element,WordImage>()): WordLayout {
  const body = document.getElementsByTagNameNS(W, 'body')[0] ?? document.documentElement
  const section = document.getElementsByTagNameNS(W, 'sectPr')[0]
  function blocks(parent: Element): WordNode[] {
    return Array.from(parent.childNodes).flatMap((node): WordNode[] => {
      if (node.nodeType !== 1) return []
      const element = node as Element
      if (element.localName === 'p') {
        const props = children(element, 'pPr')[0]
        const runs: Extract<WordNode,{kind:'paragraph'}>['runs'] = Array.from(element.getElementsByTagNameNS(W, 'r')).flatMap(run => {
          const p = children(run, 'rPr')[0]
          const format: OfficeTextFormat = { bold: !!p?.getElementsByTagNameNS(W, 'b').length && !['0','false','off'].includes(value(p,'b')), italic:!!p?.getElementsByTagNameNS(W,'i').length && !['0','false','off'].includes(value(p,'i')), underline:!!p?.getElementsByTagNameNS(W,'u').length && value(p,'u') !== 'none', fontSize:Number(value(p,'sz'))/2 || undefined, fontFamily:value(p,'rFonts','ascii') || undefined }
          return Array.from(run.childNodes).flatMap((child):Extract<WordNode,{kind:'paragraph'}>['runs'] => {
            if (child.nodeType !== 1) return []
            const tag = child as Element
            if (tag.localName === 't') return [{id:ids.get(tag),text:tag.textContent || '',format}]
            if (tag.localName === 'tab') return [{text:'\t',format}]
            if (tag.localName === 'br') return [{text:'\n',format}]
            if (tag.localName === 'drawing' && images.has(tag)) return [{text:'',format,image:images.get(tag)}]
            if (tag.localName === 'AlternateContent') return Array.from(tag.getElementsByTagNameNS(W,'drawing')).filter(drawing=>images.has(drawing)).map(drawing=>({text:'',format,image:images.get(drawing)}))
            return []
          })
        })
        if (!runs.length && ids.has(element)) runs.push({id:ids.get(element),text:'',format:{}})
        return [{kind:'paragraph',align:value(props,'jc'),before:Number(value(props,'spacing','before'))/20 || 0,after:Number(value(props,'spacing','after'))/20 || 0,runs}]
      }
      if (element.localName === 'tbl') {
        const grid = children(element,'tblGrid')[0], widths = grid ? children(grid,'gridCol').map(col=>Number(col.getAttributeNS(W,'w'))/20) : []
        const rows: Extract<WordNode,{kind:'table'}>['rows'] = []
        const merged = new Map<number,{width?:number;colspan:number;rowspan:number;shade?:string;blocks:WordNode[]}>()
        for (const row of children(element,'tr')) {
          let column = 0
          const cells: typeof rows[number]['cells'] = []
          for (const cell of children(row,'tc')) {
            const props = children(cell,'tcPr')[0], colspan = Number(value(props,'gridSpan')) || 1
            const merge = props?.getElementsByTagNameNS(W,'vMerge')[0]
            if (merge && merge.getAttributeNS(W,'val') !== 'restart' && merged.has(column)) { merged.get(column)!.rowspan++; column += colspan; continue }
            const next = {width:Number(value(props,'tcW','w'))/20 || undefined,colspan,rowspan:1,shade:value(props,'shd','fill'),blocks:blocks(cell)}
            cells.push(next)
            for (let i=column;i<column+colspan;i++) { if (merge) merged.set(i,next); else merged.delete(i) }
            column += colspan
          }
          rows.push({cells})
        }
        return [{kind:'table',widths,rows}]
      }
      // Content controls may contain paragraphs/tables; drawings are retained in the package and shown in print preview.
      return element.localName === 'sdt' || element.localName === 'sdtContent' ? blocks(element) : []
    })
  }
  return {width:Number(value(section,'pgSz','w'))/20 || 612,padding:['top','right','bottom','left'].map(side=>Number(value(section,'pgMar',side))/20 || 36),blocks:blocks(body)}
}
