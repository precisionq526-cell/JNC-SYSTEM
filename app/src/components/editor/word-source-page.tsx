'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { OfficeTextField, OfficeTextFormat } from '@/lib/editor/office-document'
import type { WordLayout, WordNode } from '@/lib/editor/word-layout'
import styles from './editor-shell.module.css'

function EditableRun({ field, format, disabled, onChange, onFocus }: {field:OfficeTextField;format:OfficeTextFormat;disabled:boolean;onChange:(text:string)=>void;onFocus:()=>void}) {
  const [original] = useState(field.value)
  return <span contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-label={field.group+' '+field.label} aria-multiline="true" data-office-field={field.id}
    className={styles.wordRun} style={{fontFamily:format.fontFamily,fontSize:format.fontSize ? `${format.fontSize}pt` : undefined,fontWeight:format.bold ? 700 : undefined,fontStyle:format.italic ? 'italic' : undefined,textDecoration:format.underline ? 'underline' : undefined}}
    onFocus={onFocus} onInput={e=>onChange(e.currentTarget.innerText.replace(/\r\n/g,'\n'))}
    onPaste={e=>{e.preventDefault();window.document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))}}>{original}</span>
}
export function WordSourcePage({layout,fields,formats,parts=[],disabled,onChange,onFocus}:{layout:WordLayout;fields:OfficeTextField[];formats:Record<string,OfficeTextFormat>;parts?:{name:string;kind:'header'|'footer';layout:WordLayout}[];disabled:boolean;onChange:(id:string,text:string)=>void;onFocus:(id:string)=>void}) {
  const byId = new Map(fields.map(field=>[field.id,field]))
  const render = (nodes:WordNode[],prefix:string):React.ReactNode => nodes.map((node,index)=>{
    const key=prefix+'-'+index
    if (node.kind==='table') return <table key={key} className={styles.wordTable}><colgroup>{node.widths.map((width,i)=><col key={i} style={{width:`${width}pt`}}/>)}</colgroup><tbody>{node.rows.map((row,r)=><tr key={r}>{row.cells.map((cell,c)=><td key={c} colSpan={cell.colspan} rowSpan={cell.rowspan} style={{width:cell.width ? `${cell.width}pt` : undefined,background:cell.shade && /^[a-f0-9]{6}$/i.test(cell.shade) ? '#'+cell.shade : undefined}}>{render(cell.blocks,`${key}-${r}-${c}`)}</td>)}</tr>)}</tbody></table>
    const align = node.align==='both' ? 'justify' : ['center','right','left','justify'].includes(node.align || '') ? node.align as 'center'|'right'|'left'|'justify' : undefined
    return <p key={key} className={styles.wordParagraph} style={{textAlign:align,marginTop:`${node.before}pt`,marginBottom:`${node.after}pt`}}>{node.runs.length ? node.runs.map((run,i)=>{
      if(run.image){const image=run.image,crop=image.crop,w=Math.max(.01,1-crop.left-crop.right),h=Math.max(.01,1-crop.top-crop.bottom);return <span key={image.id} className={styles.wordImage} style={{width:`${image.width}pt`,aspectRatio:`${image.width}/${image.height}`,display:image.anchored?'block':'inline-block',marginInline:image.anchored?'auto':undefined}}><Image src={image.src} alt={image.name} width={Math.ceil(image.width/w)} height={Math.ceil(image.height/h)} unoptimized style={{position:'absolute',width:`${100/w}%`,height:`${100/h}%`,maxWidth:'none',left:`${-crop.left/w*100}%`,top:`${-crop.top/h*100}%`}}/></span>}
      const field=run.id ? byId.get(run.id) : null
      return field ? <EditableRun key={run.id} field={field} format={{...field.format,...formats[field.id]}} disabled={disabled} onChange={text=>onChange(field.id,text)} onFocus={()=>onFocus(field.id)}/> : <span key={i}>{run.text}</span>
    }) : <br/>}</p>
  })
  return <div className={styles.wordSourceScroller}><article className={styles.wordSourcePage} aria-label="Word text and tables" style={{width:`${layout.width}pt`,padding:layout.padding.map(n=>`${n}pt`).join(' ')}}>{parts.filter(part=>part.kind==='header').map(part=><section key={part.name} className={styles.wordPart} aria-label={part.name}><small>{part.name}</small>{render(part.layout.blocks,part.name)}</section>)}{render(layout.blocks,'document')}{parts.filter(part=>part.kind==='footer').map(part=><section key={part.name} className={styles.wordPart} aria-label={part.name}><small>{part.name}</small>{render(part.layout.blocks,part.name)}</section>)}</article></div>
}
