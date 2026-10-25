'use client'
import {useRef,useState} from 'react'
import {ChevronLeft,ChevronRight,LockKeyhole} from 'lucide-react'
import type {OfficeTextField} from '@/lib/editor/office-document'
import {cellId,cellPosition,columnName,displayCell,inRange,styleForCell,worksheetPaste,writableCell,type WorksheetLayout} from '@/lib/editor/worksheet-layout'
import styles from './editor-shell.module.css'

export function SpreadsheetEditor({sheets,fields,values,disabled,onChange}:{sheets:WorksheetLayout[];fields:OfficeTextField[];values:Record<string,string>;disabled:boolean;onChange:(changes:Record<string,string>)=>void}) {
  const [sheetIndex,setSheetIndex]=useState(0),[selected,setSelected]=useState('A1'),[editing,setEditing]=useState(false),[rowStart,setRowStart]=useState(1),[columnStart,setColumnStart]=useState(1),[jump,setJump]=useState('A1'),[error,setError]=useState<string|null>(null)
  const grid=useRef<HTMLDivElement>(null),beforeEdit=useRef('')
  const sheet=sheets[sheetIndex],byId=new Map(fields.map(field=>[field.id,field]))
  if(!sheet)return <p className={styles.notice}>This workbook has no worksheets.</p>
  const raw=(address:string)=>values[cellId(sheet.path,address)] ?? byId.get(cellId(sheet.path,address))?.value ?? sheet.values[address] ?? ''
  const current=cellPosition(selected) || {row:1,column:1},readOnly=disabled || !writableCell(sheet,selected)
  const change=(address:string,value:string)=>{if(!disabled && writableCell(sheet,address))onChange({[cellId(sheet.path,address)]:value})}
  const navigate=(row:number,column:number,focus=true)=>{
    row=Math.min(1048576,Math.max(1,row));column=Math.min(16384,Math.max(1,column))
    while(sheet.hiddenRows.includes(row) && row<1048576)row++
    while(sheet.hiddenColumns.includes(column) && column<16384)column++
    const merge=sheet.merges.find(range=>inRange(range,row,column));if(merge){row=merge.startRow;column=merge.startColumn}
    const address=columnName(column)+row;setSelected(address);setJump(address);setEditing(false)
    if(row<rowStart || row>=rowStart+60)setRowStart(Math.floor((row-1)/60)*60+1)
    if(column<columnStart || column>=columnStart+12)setColumnStart(Math.floor((column-1)/12)*12+1)
    if(focus)requestAnimationFrame(()=>grid.current?.querySelector<HTMLElement>(`[data-cell="${address}"]`)?.focus())
  }
  const move=(dr:number,dc:number)=>{
    const merge=sheet.merges.find(range=>inRange(range,current.row,current.column))
    navigate(dr>0 && merge?merge.endRow+1:current.row+dr,dc>0 && merge?merge.endColumn+1:current.column+dc)
  }
  const startEditing=()=>{if(readOnly)return;beforeEdit.current=raw(selected);setEditing(true)}
  const rows=Array.from({length:Math.min(60,1048577-rowStart)},(_,i)=>rowStart+i).filter(row=>!sheet.hiddenRows.includes(row))
  const columns=Array.from({length:Math.min(12,16385-columnStart)},(_,i)=>columnStart+i).filter(column=>!sheet.hiddenColumns.includes(column))
  return <section className={styles.worksheet} aria-label="Excel worksheet editor">
    <div className={styles.sheetTitle}><strong>{sheet.name}</strong><span>{sheet.protected?<><LockKeyhole size={14}/>Protected worksheet</>:'Worksheet cells and formulas'}</span></div>
    <div className={styles.formulaBar}><form onSubmit={e=>{e.preventDefault();const position=cellPosition(jump.toUpperCase().replaceAll('$',''));if(position){navigate(position.row,position.column);setError(null)}else setError('Enter a cell address such as A1 or AA120.')}}><label className="sr-only" htmlFor="sheet-address">Go to cell</label><input id="sheet-address" value={jump} onChange={e=>setJump(e.target.value)} aria-label="Go to cell"/><button type="submit" disabled={disabled}>Go</button></form><span aria-hidden="true">fx</span><input aria-label="Cell value or formula" value={raw(selected)} disabled={readOnly} onChange={e=>change(selected,e.target.value)} placeholder={readOnly?'Protected cell':'Type a value or =formula'} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();move(1,0)}}}/></div>
    {error && <p role="alert" className={styles.sheetError}>{error}</p>}
    <div ref={grid} className={styles.worksheetGrid} onPaste={e=>{
      if(disabled)return
      const text=e.clipboardData.getData('text/plain')
      if(e.target instanceof HTMLInputElement && !/[\t\n]/.test(text))return
      e.preventDefault()
      try{onChange(worksheetPaste(sheet,selected,text));setError(null)}catch(error){setError(error instanceof Error?error.message:'These cells could not be pasted.')}
    }}>
      <table role="grid" aria-label={sheet.name+' cells'} aria-rowcount={Math.max(sheet.rows,rowStart+59)} aria-colcount={Math.max(sheet.columns,columnStart+11)}><colgroup><col style={{width:48}}/>{columns.map(column=><col key={column} style={{width:sheet.widths[column] ?? 100}}/>)}</colgroup><thead><tr><th aria-label="Select cell"/>{columns.map(column=><th key={column} scope="col" aria-selected={column===current.column}>{columnName(column)}</th>)}</tr></thead><tbody>
        {rows.map(row=><tr key={row} style={{height:Math.max(22,sheet.heights[row] ?? 25)}}><th scope="row" aria-selected={row===current.row}>{row}</th>{columns.map(column=>{
          const merge=sheet.merges.find(range=>inRange(range,row,column))
          const visibleRow=merge?Math.max(merge.startRow,rows[0]):row,visibleColumn=merge?Math.max(merge.startColumn,columns[0]):column
          if(merge && (row!==visibleRow || column!==visibleColumn))return null
          const address=merge?columnName(merge.startColumn)+merge.startRow:columnName(column)+row,value=raw(address),format=styleForCell(sheet,address),locked=!writableCell(sheet,address),active=address===selected
          const original=sheet.values[address] ?? '',cached=value===original?sheet.cached[address]:''
          return <td key={column} role="gridcell" data-cell={address} aria-label={sheet.name+' '+address} aria-selected={active} aria-readonly={locked} tabIndex={active?0:-1} colSpan={merge?columns.filter(c=>c>=merge.startColumn && c<=merge.endColumn).length:1} rowSpan={merge?rows.filter(r=>r>=merge.startRow && r<=merge.endRow).length:1} className={active?styles.activeCell:undefined}
            style={{fontFamily:format.fontFamily,fontSize:format.fontSize?`${format.fontSize}pt`:undefined,fontWeight:format.bold?700:undefined,fontStyle:format.italic?'italic':undefined,color:format.color,background:format.background,textAlign:format.align ?? (value!=='' && Number.isFinite(Number(value))?'right':'left'),whiteSpace:format.wrap?'pre-wrap':'nowrap'}}
            onClick={()=>navigate(merge?.startRow ?? row,merge?.startColumn ?? column,false)} onDoubleClick={()=>{navigate(merge?.startRow ?? row,merge?.startColumn ?? column,false);if(!locked){beforeEdit.current=value;setEditing(true)}}}
            onKeyDown={e=>{
              if(e.target instanceof HTMLInputElement)return
              const arrows:Record<string,[number,number]>={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowRight:[0,1],ArrowLeft:[0,-1]}
              if(arrows[e.key]){e.preventDefault();move(...arrows[e.key])}
              else if(e.key==='Tab'){e.preventDefault();move(0,e.shiftKey?-1:1)}
              else if(e.key==='Enter' || e.key==='F2'){e.preventDefault();startEditing()}
              else if((e.key==='Delete' || e.key==='Backspace') && !readOnly){e.preventDefault();change(selected,'')}
              else if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey && !readOnly){e.preventDefault();beforeEdit.current=value;change(selected,e.key);setEditing(true)}
            }}>
            {active && editing && !locked?<input data-sheet-input="true" autoFocus aria-label={'Edit '+sheet.name+' '+address} value={value} disabled={disabled} onClick={e=>e.stopPropagation()} onChange={e=>change(address,e.target.value)} onBlur={()=>setEditing(false)} onKeyDown={e=>{if(e.key==='Enter' || e.key==='Tab'){e.preventDefault();setEditing(false);move(e.key==='Enter'?(e.shiftKey?-1:1):0,e.key==='Tab'?(e.shiftKey?-1:1):0)}else if(e.key==='Escape'){e.preventDefault();change(address,beforeEdit.current);setEditing(false)}}}/>:<span title={value}>{displayCell(value,format,sheet.date1904,cached) || '\u00a0'}</span>}
          </td>
        })}</tr>)}
      </tbody></table>
    </div>
    <div className={styles.sheetBottom}><nav className={styles.sheetTabs} aria-label="Worksheets">{sheets.map((item,index)=><button key={item.path} type="button" aria-pressed={sheetIndex===index} disabled={disabled} onClick={()=>{setSheetIndex(index);setSelected('A1');setJump('A1');setRowStart(1);setColumnStart(1);setEditing(false);setError(null)}}>{item.name}</button>)}</nav><div className={styles.sheetPaging}><button type="button" aria-label="Previous worksheet rows" disabled={rowStart===1} onClick={()=>setRowStart(n=>Math.max(1,n-60))}><ChevronLeft size={16}/></button><span>Rows {rowStart}–{Math.min(rowStart+59,1048576)}</span><button type="button" aria-label="Next worksheet rows" disabled={rowStart+60>1048576} onClick={()=>setRowStart(n=>Math.min(1048517,n+60))}><ChevronRight size={16}/></button></div></div>
    <p className={styles.sheetHint}>Double-click or press F2 to edit. Tab and arrow keys move between cells. Paste a range from Excel. Use Update preview to recalculate formulas and check the exact print layout.</p>
  </section>
}
