const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export interface CellRange {startRow:number;startColumn:number;endRow:number;endColumn:number}
export interface CellStyle {fontFamily?:string;fontSize?:number;bold?:boolean;italic?:boolean;color?:string;background?:string;align?:'left'|'right'|'center';wrap?:boolean;numberFormat?:string;locked?:boolean}
export interface WorksheetLayout {path:string;name:string;rows:number;columns:number;widths:Record<number,number>;heights:Record<number,number>;hiddenRows:number[];hiddenColumns:number[];merges:CellRange[];blocked:CellRange[];protected:boolean;styles:Record<string,CellStyle>;styleIds:Record<string,string>;columnStyles:Record<number,string>;rowStyles:Record<number,string>;formats:CellStyle[];cached:Record<string,string>;values:Record<string,string>;date1904:boolean}
export const cellId=(path:string,address:string)=>path+':cell:'+address
export function columnName(value:number):string {let name='';for(let n=value;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name}
export function cellPosition(address:string) {const match=/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);if(!match)return null;let column=0;for(const c of match[1])column=column*26+c.charCodeAt(0)-64;const row=Number(match[2]);return column<=16384 && row<=1048576?{row,column}:null}
export function cellRange(value:string):CellRange|null {const [start,end]=value.replaceAll('$','').split(':'),a=cellPosition(start),b=cellPosition(end || start);return a && b?{startRow:a.row,startColumn:a.column,endRow:b.row,endColumn:b.column}:null}
export const inRange=(range:CellRange,row:number,column:number)=>row>=range.startRow && row<=range.endRow && column>=range.startColumn && column<=range.endColumn
const children=(node:Element,name:string)=>Array.from(node.childNodes).filter((child):child is Element=>child.nodeType===1 && (child as Element).localName===name)
const first=(node:Element|undefined,name:string)=>node?.getElementsByTagNameNS(S,name)[0]
const builtin:Record<number,string>={0:'General',1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',14:'mm/dd/yyyy',15:'d-mmm-yy',16:'d-mmm',17:'mmm-yy',18:'h:mm AM/PM',19:'h:mm:ss AM/PM',20:'h:mm',21:'h:mm:ss',22:'m/d/yy h:mm',37:'#,##0',38:'#,##0',39:'#,##0.00',40:'#,##0.00',49:'@'}
export function worksheetFormats(document?:Document):CellStyle[] {
  if(!document)return [{}]
  const fonts=Array.from(document.getElementsByTagNameNS(S,'fonts')[0]?.childNodes ?? []).filter((node):node is Element=>node.nodeType===1)
  const fills=Array.from(document.getElementsByTagNameNS(S,'fills')[0]?.childNodes ?? []).filter((node):node is Element=>node.nodeType===1)
  const custom=new Map(Array.from(document.getElementsByTagNameNS(S,'numFmt')).map(node=>[Number(node.getAttribute('numFmtId')),node.getAttribute('formatCode') || 'General']))
  const color=(node:Element|undefined)=>{const rgb=node?.getAttribute('rgb');return rgb && /^[0-9a-f]{6,8}$/i.test(rgb)?'#'+rgb.slice(-6):undefined}
  const xfs=document.getElementsByTagNameNS(S,'cellXfs')[0]
  return xfs?children(xfs,'xf').map(xf=>{
    const font=fonts[Number(xf.getAttribute('fontId') || 0)],fill=fills[Number(xf.getAttribute('fillId') || 0)],alignment=first(xf,'alignment'),protection=first(xf,'protection'),horizontal=alignment?.getAttribute('horizontal')
    return {fontFamily:first(font,'name')?.getAttribute('val') || undefined,fontSize:Number(first(font,'sz')?.getAttribute('val')) || undefined,bold:!!first(font,'b') && first(font,'b')?.getAttribute('val')!=='0',italic:!!first(font,'i') && first(font,'i')?.getAttribute('val')!=='0',color:color(first(font,'color')),background:first(fill,'patternFill')?.getAttribute('patternType')==='solid'?color(first(fill,'fgColor')):undefined,align:['left','right','center'].includes(horizontal || '')?horizontal as CellStyle['align']:undefined,wrap:alignment?.getAttribute('wrapText')==='1',locked:protection?.getAttribute('locked')!=='0',numberFormat:custom.get(Number(xf.getAttribute('numFmtId'))) ?? builtin[Number(xf.getAttribute('numFmtId'))] ?? 'General'}
  }):[{}]
}
export function readWorksheet(document:Document,path:string,name:string,formats:CellStyle[],date1904:boolean):WorksheetLayout {
  const sheet:WorksheetLayout={path,name,rows:1,columns:1,widths:{},heights:{},hiddenRows:[],hiddenColumns:[],merges:[],blocked:[],protected:document.getElementsByTagNameNS(S,'sheetProtection').length>0,styles:{},styleIds:{},columnStyles:{},rowStyles:{},formats,cached:{},values:{},date1904}
  for(const col of Array.from(document.getElementsByTagNameNS(S,'col'))){const min=Number(col.getAttribute('min')),max=Math.min(16384,Number(col.getAttribute('max')));for(let n=min;n<=max;n++){sheet.widths[n]=Math.max(24,Number(col.getAttribute('width') || 12)*7+5);if(col.getAttribute('hidden')==='1')sheet.hiddenColumns.push(n);if(col.hasAttribute('style'))sheet.columnStyles[n]=col.getAttribute('style')!}}
  for(const row of Array.from(document.getElementsByTagNameNS(S,'row'))){const n=Number(row.getAttribute('r'));if(row.hasAttribute('ht'))sheet.heights[n]=Number(row.getAttribute('ht'))*4/3;if(row.getAttribute('hidden')==='1')sheet.hiddenRows.push(n);if(row.hasAttribute('s'))sheet.rowStyles[n]=row.getAttribute('s')!}
  for(const node of Array.from(document.getElementsByTagNameNS(S,'mergeCell'))){const range=cellRange(node.getAttribute('ref') || '');if(range){sheet.merges.push(range);sheet.rows=Math.max(sheet.rows,range.endRow);sheet.columns=Math.max(sheet.columns,range.endColumn)}}
  for(const cell of Array.from(document.getElementsByTagNameNS(S,'c'))){const address=cell.getAttribute('r') || '',position=cellPosition(address);if(!position)continue;sheet.rows=Math.max(sheet.rows,position.row);sheet.columns=Math.max(sheet.columns,position.column);const styleId=cell.getAttribute('s') || sheet.rowStyles[position.row] || sheet.columnStyles[position.column] || '0';sheet.styleIds[address]=styleId;sheet.styles[address]=formats[Number(styleId)] ?? {};sheet.cached[address]=first(cell,'v')?.textContent || '';const formula=first(cell,'f');if(formula?.hasAttribute('t')){const range=cellRange(formula.getAttribute('ref') || address);if(range)sheet.blocked.push(range)}}
  return sheet
}
export function styleForCell(sheet:WorksheetLayout,address:string):CellStyle {const position=cellPosition(address) ?? {row:1,column:1};return sheet.styles[address] ?? sheet.formats[Number(sheet.rowStyles[position.row] || sheet.columnStyles[position.column] || 0)] ?? {}}
export function writableCell(sheet:WorksheetLayout,address:string):boolean {const p=cellPosition(address);return !!p && !(sheet.protected && styleForCell(sheet,address).locked!==false) && !sheet.blocked.some(range=>inRange(range,p.row,p.column)) && !sheet.merges.some(range=>inRange(range,p.row,p.column) && (p.row!==range.startRow || p.column!==range.startColumn))}
export const dateFormat=(format:string|undefined)=>!!format && /[yd]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g,'')) && !/\[h\]/i.test(format)
export function dateCellValue(value:string,style:CellStyle,date1904:boolean):string {
  if(!dateFormat(style.numberFormat) || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(value))return value
  const timestamp=Date.parse(value.includes('T')?value+'Z':value+'T00:00:00Z')
  if(!Number.isFinite(timestamp))throw new Error('Enter a valid worksheet date.')
  return String((timestamp-Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30))/86400000)
}
export function displayCell(value:string,style:CellStyle,date1904:boolean,cached=''):string {
  const raw=value.startsWith('=')?cached:value,n=Number(raw),format=style.numberFormat || 'General'
  if(raw==='' || !Number.isFinite(n) || format==='General' || format==='@')return raw || value
  if(dateFormat(format)){const date=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+n*86400000);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'2-digit',day:'2-digit',year:'numeric'}).format(date):raw}
  const decimals=Math.min(10,/\.([0#]+)/.exec(format)?.[1].length ?? 0),percentage=format.includes('%'),currency=format.includes('₱')?'₱':format.includes('$')?'$':''
  return currency+new Intl.NumberFormat('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:format.includes(',')}).format(n*(percentage?100:1))+(percentage?'%':'')
}

export function worksheetPaste(sheet:WorksheetLayout,start:string,text:string):Record<string,string> {
  const position=cellPosition(start);if(!position)throw new Error('Choose a valid starting cell.')
  const rows:string[][]=[[]];let cell='',quoted=false
  const source=text.replace(/\r\n/g,'\n').replace(/\n$/,'')
  for(let i=0;i<source.length;i++){const c=source[i];if(c==='"' && (quoted || cell==='')){if(quoted && source[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(!quoted && (c==='\t' || c==='\n')){rows.at(-1)!.push(cell);cell='';if(c==='\n')rows.push([])}else cell+=c}
  rows.at(-1)!.push(cell)
  if(rows.reduce((n,row)=>n+row.length,0)>5000)throw new Error('Paste up to 5,000 cells at a time.')
  const updates:Record<string,string>={}
  rows.forEach((row,r)=>row.forEach((value,c)=>{const address=columnName(position.column+c)+(position.row+r);if(!writableCell(sheet,address))throw new Error('The paste includes a protected cell, merged-cell continuation, or shared formula.');updates[cellId(sheet.path,address)]=value}))
  return updates
}
