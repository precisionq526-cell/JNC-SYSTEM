import JSZip from 'jszip'
import { OFFICE_MIME } from './file-types'
import { wordLayout, type WordLayout } from './word-layout'
import { inspectWordGraphics, type WordImageRepair } from './word-graphics'
import {cellId,cellPosition,dateCellValue,readWorksheet,styleForCell,worksheetFormats,writableCell,type WorksheetLayout} from './worksheet-layout'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const XML = 'http://www.w3.org/XML/1998/namespace'

export interface OfficeTextField {
  id: string
  group: string
  label: string
  value: string
  format?: OfficeTextFormat
}

export interface OfficeTextFormat { bold?: boolean; italic?: boolean; underline?: boolean; fontSize?: number; fontFamily?: string }

export interface OfficeDocument {
  kind: keyof typeof OFFICE_MIME
  fields: OfficeTextField[]
  layout?: WordLayout
  wordParts?: {name:string;kind:'header'|'footer';layout:WordLayout}[]
  imageRepairs?: WordImageRepair[]
  worksheets?: WorksheetLayout[]
  save: (values: Record<string, string>, formats?: Record<string, OfficeTextFormat>, imageRepairs?:string[]) => Promise<Blob>
}

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('This document contains invalid XML.')
  return document
}

function setText(node: Element, value: string) {
  node.textContent = value
  node.setAttributeNS(XML, 'xml:space', 'preserve')
}

function setWordText(node: Element, value: string) {
  const lines = value.split(/\r?\n/)
  setText(node, lines[0])
  const anchor = node.nextSibling
  for (const line of lines.slice(1)) {
    node.parentNode!.insertBefore(node.ownerDocument!.createElementNS(WORD, 'w:br'), anchor)
    const next = node.ownerDocument!.createElementNS(WORD, 'w:t')
    setText(next, line)
    node.parentNode!.insertBefore(next, anchor)
  }
}

function readWordFormat(run?: Element): OfficeTextFormat {
  const properties = run?.getElementsByTagNameNS(WORD, 'rPr')[0]
  const property = (name: string) => properties?.getElementsByTagNameNS(WORD, name)[0]
  const enabled = (name: string) => !!property(name) && !['0', 'false', 'off', 'none'].includes(property(name)?.getAttributeNS(WORD, 'val') ?? '')
  return {
    bold: enabled('b'), italic: enabled('i'), underline: enabled('u'),
    ...(property('sz') ? { fontSize: Number(property('sz')?.getAttributeNS(WORD, 'val')) / 2 } : {}),
    ...(property('rFonts')?.getAttributeNS(WORD, 'ascii') ? { fontFamily: property('rFonts')!.getAttributeNS(WORD, 'ascii')! } : {}),
  }
}

function setWordFormat(run: Element, changes: OfficeTextFormat) {
  const document = run.ownerDocument
  let props = run.getElementsByTagNameNS(WORD, 'rPr')[0]
  if (!props) { props = document.createElementNS(WORD, 'w:rPr'); run.insertBefore(props, run.firstChild) }
  const setProperty = (name: string, attributes: Record<string, string>) => {
    let prop = props.getElementsByTagNameNS(WORD, name)[0]
    if (!prop) { prop = document.createElementNS(WORD, 'w:' + name); props.appendChild(prop) }
    for (const [key, value] of Object.entries(attributes)) prop.setAttributeNS(WORD, 'w:' + key, value)
  }
  if (changes.bold !== undefined) setProperty('b', { val: changes.bold ? '1' : '0' })
  if (changes.italic !== undefined) setProperty('i', { val: changes.italic ? '1' : '0' })
  if (changes.underline !== undefined) setProperty('u', { val: changes.underline ? 'single' : 'none' })
  if (changes.fontSize !== undefined) {
    if (!Number.isFinite(changes.fontSize) || changes.fontSize < 1 || changes.fontSize > 200) throw new Error('Font size must be between 1 and 200.')
    setProperty('sz', { val: String(Math.round(changes.fontSize * 2)) })
  }
  if (changes.fontFamily !== undefined) setProperty('rFonts', { ascii: changes.fontFamily, hAnsi: changes.fontFamily })
}

/** Keep rich cell runs and their font properties while replacing just the changed characters. */
function setRichCellText(container: Element, next: string) {
  const nodes = Array.from(container.getElementsByTagNameNS(SHEET, 't'))
  const previous = nodes.map(node => node.textContent || '').join('')
  let prefix = 0, suffix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
  const insert = next.slice(prefix, next.length - suffix), end = previous.length - suffix
  let offset = 0, inserted = false
  for (const node of nodes) {
    const value = node.textContent || '', start = offset; offset += value.length
    const before = value.slice(0, Math.max(0, Math.min(value.length, prefix - start)))
    const after = value.slice(Math.max(0, Math.min(value.length, end - start)))
    const ownsInsertion = !inserted && prefix <= offset
    setText(node, before + (ownsInsertion ? insert : '') + after)
    if (ownsInsertion) inserted = true
  }
  if (!nodes.length) { const text = container.ownerDocument.createElementNS(SHEET, 't'); setText(text, next); container.appendChild(text) }
}

function writeCell(cell:Element,next:string,richSource?:Element) {
  const document=cell.ownerDocument,type=cell.getAttribute('t'),textCell=['s','inlineStr','str'].includes(type || '')
  for(const child of Array.from(cell.childNodes).filter((node):node is Element=>node.nodeType===1))if(['v','f','is'].includes(child.localName))cell.removeChild(child)
  cell.removeAttribute('t')
  if(next.startsWith('=')){
    if(!next.slice(1).trim())throw new Error('A formula cannot be empty.')
    const node=document.createElementNS(SHEET,'f');node.textContent=next.slice(1);cell.appendChild(node)
  } else if(!textCell && next!=='' && Number.isFinite(Number(next)) && next.trim()===next && !/^0\d/.test(next)){
    const node=document.createElementNS(SHEET,'v');node.textContent=next;cell.appendChild(node)
  } else if(!textCell && (next==='TRUE' || next==='FALSE')){
    cell.setAttribute('t','b');const node=document.createElementNS(SHEET,'v');node.textContent=next==='TRUE'?'1':'0';cell.appendChild(node)
  } else {
    cell.setAttribute('t','inlineStr');const inline=document.createElementNS(SHEET,'is')
    if(richSource){for(const child of Array.from(richSource.childNodes))inline.appendChild(document.importNode(child,true));setRichCellText(inline,next)}
    else {const node=document.createElementNS(SHEET,'t');setText(node,next);inline.appendChild(node)}
    cell.appendChild(inline)
  }
}

export async function openOfficeDocument(data: ArrayBuffer, extension: string): Promise<OfficeDocument> {
  return buildOfficeDocument(data, extension)
}

async function buildOfficeDocument(data: ArrayBuffer, extension: string, saving = false): Promise<OfficeDocument> {
  if (!(extension in OFFICE_MIME)) throw new Error('Unsupported document format.')
  const kind = extension as keyof typeof OFFICE_MIME
  const zip = await JSZip.loadAsync(data)
  const fields: OfficeTextField[] = []
  const documents = new Map<string, Document>()
  const setters = new Map<string, (value: string) => void>()
  const formatSetters = new Map<string, (format: OfficeTextFormat) => void>()
  const wordIds = new Map<Element, string>()
  const worksheets:WorksheetLayout[]=[]
  let hasFormulaChange = false

  const addField = (path: string, group: string, label: string, value: string, setter: (value: string) => void, format?: OfficeTextFormat, formatSetter?: (format: OfficeTextFormat) => void, identity?:string) => {
    const id = identity ?? path + ':' + fields.length
    fields.push({ id, group, label, value, ...(format ? { format } : {}) })
    setters.set(id, setter)
    if (formatSetter) formatSetters.set(id, formatSetter)
    return id
  }
  const readXml = async (path: string) => {
    const file = zip.file(path)
    if (!file) throw new Error('A required document part is missing.')
    const xml = await file.async('string')
    if (xml.length > 10_000_000) throw new Error('This document is too large for the text editor.')
    const document = parseXml(xml)
    documents.set(path, document)
    return document
  }

  if (kind === 'xlsx') {
    const sharedNodes = zip.file('xl/sharedStrings.xml')
      ? Array.from(parseXml(await zip.file('xl/sharedStrings.xml')!.async('string')).getElementsByTagNameNS(SHEET, 'si'))
      : []
    const sharedStrings = sharedNodes.map(node => node.textContent || '')
    const workbook = await readXml('xl/workbook.xml')
    const formats=worksheetFormats(zip.file('xl/styles.xml') ? parseXml(await zip.file('xl/styles.xml')!.async('string')) : undefined)
    const date1904=['1','true'].includes(workbook.getElementsByTagNameNS(SHEET,'workbookPr')[0]?.getAttribute('date1904') || '')
    const relationships = parseXml(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
    const sheetNames = new Map<string, string>()
    for (const sheet of Array.from(workbook.getElementsByTagNameNS(SHEET, 'sheet'))) {
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(node => node.getAttribute('Id') === id)
      const target = relationship?.getAttribute('Target') || ''
      const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
      sheetNames.set(path, sheet.getAttribute('name') || 'Worksheet')
    }
    const paths = [...sheetNames.keys()].filter(path=>!!zip.file(path))
    for (const path of paths) {
      const document = await readXml(path)
      const sheet=readWorksheet(document,path,sheetNames.get(path) || path,formats,date1904);worksheets.push(sheet)
      for (const cell of Array.from(document.getElementsByTagNameNS(SHEET, 'c'))) {
        const address=cell.getAttribute('r') || ''
        const formula = cell.getElementsByTagNameNS(SHEET, 'f')[0]
        // Shared/array formulas need their full range updated together.
        const valueNode = cell.getElementsByTagNameNS(SHEET, 'v')[0]
        const type = cell.getAttribute('t')
        const richSource = type === 's' ? sharedNodes[Number(valueNode?.textContent)] : type === 'inlineStr' ? cell.getElementsByTagNameNS(SHEET,'is')[0] : undefined
        const value = formula ? '=' + formula.textContent
          : type === 's' ? sharedStrings[Number(valueNode?.textContent)] ?? ''
          : type === 'inlineStr' ? cell.getElementsByTagNameNS(SHEET, 'is')[0]?.textContent || ''
          : type === 'b' ? valueNode?.textContent === '1' ? 'TRUE' : 'FALSE'
          : valueNode?.textContent || ''
        sheet.values[address]=value
        if(!writableCell(sheet,address))continue
        addField(path, sheetNames.get(path) || path, address, value, (next) => {
          writeCell(cell,dateCellValue(next,styleForCell(sheet,address),sheet.date1904),richSource)
          hasFormulaChange = true
        },undefined,undefined,cellId(path,address))
      }
    }
  } else {
    const paths = Object.keys(zip.files).filter(path => kind === 'docx'
      ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)
      : /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!paths.length) throw new Error('No editable document content was found.')
    for (const path of paths) {
      const document = await readXml(path)
      const namespace = kind === 'docx' ? WORD : DRAWING
      const group = kind === 'docx' ? path === 'word/document.xml' ? 'Document' : path.replace('word/', '').replace('.xml', '')
        : 'Slide ' + path.match(/slide(\d+)\.xml$/)![1]
      const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, 'p'))
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const nodes = Array.from(paragraph.getElementsByTagNameNS(namespace, 't'))
        if (kind === 'docx' && path === 'word/document.xml' && !nodes.length && !['drawing','pict','br','fldChar'].some(name=>paragraph.getElementsByTagNameNS(WORD,name).length)) {
          let run = Array.from(paragraph.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === WORD && (node as Element).localName === 'r')
          let node: Element | undefined
          const ensureRun = () => {
            if (!run) { run = document.createElementNS(WORD, 'w:r'); paragraph.appendChild(run) }
            return run
          }
          const id = addField(path, group, 'Paragraph '+(paragraphIndex+1), '', next => {
            if (!node) { node = document.createElementNS(WORD, 'w:t'); ensureRun().appendChild(node) }
            setWordText(node, next)
          }, readWordFormat(run), changes => setWordFormat(ensureRun(), changes))
          wordIds.set(paragraph,id)
        }
        nodes.forEach((node, index) => {
          const run = node.parentElement ?? node.parentNode as Element
          const format = kind === 'docx' ? readWordFormat(run) : undefined
          const fieldId = addField(path, group, (kind === 'docx' ? 'Paragraph ' : 'Text block ') + (paragraphIndex + 1) + (nodes.length > 1 ? ' · Segment ' + (index + 1) : ''),
            node.textContent || '', value => kind === 'docx' ? setWordText(node, value) : setText(node, value), format, kind === 'docx' ? changes => setWordFormat(run, changes) : undefined)
          if (kind === 'docx') wordIds.set(node, fieldId)
        })
      })
    }
  }
  if (fields.length > (kind==='xlsx'?50000:5000)) throw new Error('This document has too many text fields to edit here.')
  const graphics = kind === 'docx' ? await inspectWordGraphics(zip,documents) : null

  return {
    kind, fields, ...(kind==='xlsx'?{worksheets}:{}), ...(graphics ? {layout:wordLayout(documents.get('word/document.xml')!,wordIds,graphics.images),wordParts:[...documents].filter(([part])=>/^word\/(header|footer)\d+\.xml$/.test(part)).map(([part,document])=>({name:part.replace('word/','').replace('.xml',''),kind:part.includes('header')?'header' as const:'footer' as const,layout:wordLayout(document,wordIds,graphics.images)})),imageRepairs:graphics.repairs.map(repair=>repair.info)} : {}),
    async save(values, formats = {}, imageRepairs = []) {
      // Build a fresh package for each save so a failed export cannot alter a later retry.
      if (!saving) return (await buildOfficeDocument(data, extension, true)).save(values, formats,imageRepairs)
      const changedParts = new Set<string>()
      for(const id of new Set(imageRepairs)){
        const repair=graphics?.repairs.find(repair=>repair.info.id===id)
        if(!repair)throw new Error('This logo repair is not available in the original document.')
        repair.apply()
        changedParts.add(id.slice(0,id.indexOf(':logo-cover:')))
      }
      const existingIds=new Set(fields.map(field=>field.id));let added=0
      for(const [id,value]of Object.entries(values)){
        if(existingIds.has(id) || value==='')continue
        const sheet=worksheets.find(sheet=>id.startsWith(sheet.path+':cell:'))
        if(!sheet)continue
        const address=id.slice((sheet.path+':cell:').length),position=cellPosition(address)
        if(!position || !writableCell(sheet,address))throw new Error('This worksheet cell is protected, merged, or part of a shared formula.')
        if(++added>5000)throw new Error('Save up to 5,000 new cells at a time.')
        const document=documents.get(sheet.path)!,data=document.getElementsByTagNameNS(SHEET,'sheetData')[0]
        let row=Array.from(data.getElementsByTagNameNS(SHEET,'row')).find(row=>Number(row.getAttribute('r'))===position.row)
        if(!row){row=document.createElementNS(SHEET,'row');row.setAttribute('r',String(position.row));const next=Array.from(data.getElementsByTagNameNS(SHEET,'row')).find(row=>Number(row.getAttribute('r'))>position.row);data.insertBefore(row,next ?? null)}
        const cell=document.createElementNS(SHEET,'c');cell.setAttribute('r',address)
        const style=row.getAttribute('s') || sheet.columnStyles[position.column];if(style)cell.setAttribute('s',style)
        const next=Array.from(row.getElementsByTagNameNS(SHEET,'c')).find(cell=>(cellPosition(cell.getAttribute('r') || '')?.column ?? 0)>position.column)
        row.insertBefore(cell,next ?? null);writeCell(cell,dateCellValue(value,styleForCell(sheet,address),sheet.date1904));changedParts.add(sheet.path);hasFormulaChange=true
        sheet.rows=Math.max(sheet.rows,position.row);sheet.columns=Math.max(sheet.columns,position.column)
        const dimension=document.getElementsByTagNameNS(SHEET,'dimension')[0];if(dimension){const lastColumn=(()=>{let n=sheet.columns,name='';while(n){name=String.fromCharCode(65+(n-1)%26)+name;n=Math.floor((n-1)/26)}return name})();dimension.setAttribute('ref','A1:'+lastColumn+sheet.rows)}
      }
      for (const field of fields) {
        if (values[field.id] !== undefined && values[field.id] !== field.value) {
          setters.get(field.id)!(values[field.id])
          changedParts.add(kind==='xlsx'?field.id.split(':cell:')[0]:field.id.slice(0, field.id.lastIndexOf(':')))
        }
        if (formats[field.id] && formatSetters.has(field.id)) {
          const changes = Object.fromEntries(Object.entries(formats[field.id]).filter(([key,value])=>value !== undefined && value !== field.format?.[key as keyof OfficeTextFormat]))
          if (Object.keys(changes).length) {
            formatSetters.get(field.id)!(changes)
            changedParts.add(kind==='xlsx'?field.id.split(':cell:')[0]:field.id.slice(0, field.id.lastIndexOf(':')))
          }
        }
      }
      if (hasFormulaChange) {
        const workbook = documents.get('xl/workbook.xml')!
        let calculation = workbook.getElementsByTagNameNS(SHEET, 'calcPr')[0]
        if (!calculation) { calculation = workbook.createElementNS(SHEET, 'calcPr'); workbook.documentElement.appendChild(calculation) }
        calculation.setAttribute('fullCalcOnLoad', '1')
        calculation.setAttribute('forceFullCalc', '1')
        changedParts.add('xl/workbook.xml')
        zip.remove('xl/calcChain.xml')
        // Keep the package valid when discarding a now-stale calculation chain.
        for (const path of ['xl/_rels/workbook.xml.rels', '[Content_Types].xml']) {
          const document = parseXml(await zip.file(path)!.async('string'))
          for (const node of Array.from(document.documentElement.childNodes)) {
            if (node.nodeType === 1) {
              const element = node as Element
              if ((element.getAttribute('Type') || '').endsWith('/calcChain') || element.getAttribute('PartName') === '/xl/calcChain.xml') document.documentElement.removeChild(node)
            }
          }
          zip.file(path, new XMLSerializer().serializeToString(document))
        }
      }
      for (const path of changedParts) zip.file(path, new XMLSerializer().serializeToString(documents.get(path)!))
      if (!changedParts.size) return new Blob([data], { type: OFFICE_MIME[kind] })
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      return new Blob([new Uint8Array(bytes).buffer], { type: OFFICE_MIME[kind] })
    },
  }
}

