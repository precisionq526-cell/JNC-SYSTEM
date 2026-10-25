import type JSZip from 'jszip'

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main', WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', A='http://schemas.openxmlformats.org/drawingml/2006/main', R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export interface WordImage { id:string;src:string;name:string;width:number;height:number;crop:{left:number;right:number;top:number;bottom:number};anchored:boolean }
export interface WordImageRepair { id:string;label:string;imageId:string }
const first=(node:Element,ns:string,name:string)=>node.getElementsByTagNameNS(ns,name)[0]
function container(node:Element,name:string):Element|undefined { let current:Element|null=node;while(current){if(current.localName===name)return current;current=current.parentElement ?? current.parentNode as Element|null} }
function targetPath(part:string,target:string) {const bits=(target.startsWith('/')?target.slice(1):part.slice(0,part.lastIndexOf('/')+1)+target).split('/'),safe:string[]=[];for(const bit of bits){if(bit==='..')safe.pop();else if(bit!=='.')safe.push(bit)}return safe.join('/')}
function anchorPosition(anchor:Element,axis:'H'|'V',margin:number,paragraph:number):number|null {
  const position=first(anchor,WP,'position'+axis),offset=position && first(position,WP,'posOffset')
  if(!offset)return null
  const relative=position.getAttribute('relativeFrom'),n=Number(offset.textContent)/12700
  return relative==='page'?n:['margin','column'].includes(relative || '')?margin+n:relative==='paragraph'?paragraph+n:null
}

export async function inspectWordGraphics(zip:JSZip,documents:Map<string,Document>) {
  const images=new Map<Element,WordImage>(),repairs:{info:WordImageRepair;apply:()=>void}[]=[]
  const bodyDocument=documents.get('word/document.xml'),section=bodyDocument?.getElementsByTagNameNS(W,'sectPr')[0],margins=section?.getElementsByTagNameNS(W,'pgMar')[0]
  const left=Number(margins?.getAttributeNS(W,'left') || 1080)/20,top=Number(margins?.getAttributeNS(W,'top') || 1080)/20
  for(const [part,document]of documents){
    const relPath=part.slice(0,part.lastIndexOf('/')+1)+'_rels/'+part.slice(part.lastIndexOf('/')+1)+'.rels'
    const relFile=zip.file(relPath)
    const rels=relFile?new DOMParser().parseFromString(await relFile.async('string'),'application/xml'):null
    const firstBodyParagraph=document.getElementsByTagNameNS(W,'body')[0]?.getElementsByTagNameNS(W,'p')[0]
    const logos:{image:WordImage;anchor:Element;x:number;y:number}[]=[]
    for(const [index,drawing]of Array.from(document.getElementsByTagNameNS(W,'drawing')).entries()){
      if(container(drawing,'Fallback'))continue
      const blip=first(drawing,A,'blip'),id=blip?.getAttributeNS(R,'embed')
      const relationship=id && Array.from(rels?.getElementsByTagName('Relationship') ?? []).find(node=>node.getAttribute('Id')===id)
      if(!relationship || relationship.getAttribute('TargetMode')==='External')continue
      const source=zip.file(targetPath(part,relationship.getAttribute('Target') || ''))
      if(!source)continue
      const ext=source.name.split('.').pop()?.toLowerCase(),mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml'} as Record<string,string>)[ext || '']
      if(!mime)continue
      const bytes=await source.async('uint8array');if(bytes.length>20*1024*1024)continue
      const extent=first(drawing,WP,'extent'),crop=first(drawing,A,'srcRect'),anchor=first(drawing,WP,'anchor'),properties=first(drawing,WP,'docPr')
      const image:WordImage={id:part+':image:'+index,src:'data:'+mime+';base64,'+await source.async('base64'),name:properties?.getAttribute('name') || 'Document image',width:Number(extent?.getAttribute('cx') || 1270000)/12700,height:Number(extent?.getAttribute('cy') || 1270000)/12700,crop:{left:Number(crop?.getAttribute('l') || 0)/100000,right:Number(crop?.getAttribute('r') || 0)/100000,top:Number(crop?.getAttribute('t') || 0)/100000,bottom:Number(crop?.getAttribute('b') || 0)/100000},anchored:!!anchor}
      images.set(drawing,image)
      // Restrict the suggested repair to named header/logo pictures in the first body paragraph.
      // Intentional masks elsewhere are never removed automatically.
      const description=properties?.getAttribute('descr') || ''
      if(anchor && container(drawing,'p')===firstBodyParagraph && /logo|header|faith|college/i.test(description+' '+image.name)){
        const x=anchorPosition(anchor,'H',left,left),y=anchorPosition(anchor,'V',top,top)
        if(x!==null && y!==null && y<144)logos.push({image,anchor,x,y})
      }
    }
    const seen=new Set<Element>()
    for(const logo of logos)for(const drawing of Array.from(firstBodyParagraph?.getElementsByTagNameNS(W,'drawing') ?? [])){
      if(images.has(drawing) || first(drawing,A,'blip') || Array.from(drawing.getElementsByTagNameNS(W,'t')).some(node=>node.textContent?.trim()))continue
      const anchor=first(drawing,WP,'anchor'),fill=first(drawing,A,'solidFill'),color=fill?.firstElementChild ?? Array.from(fill?.childNodes ?? []).find(node=>node.nodeType===1) as Element|undefined
      if(!anchor || !color || !['FFFFFF','ffffff','lt1','bg1'].includes(color.getAttribute('val') || ''))continue
      const x=anchorPosition(anchor,'H',left,left),y=anchorPosition(anchor,'V',top,top),extent=first(anchor,WP,'extent')
      if(x===null || y===null || !extent)continue
      const width=Number(extent.getAttribute('cx'))/12700,height=Number(extent.getAttribute('cy'))/12700
      const overlapW=Math.max(0,Math.min(x+width,logo.x+logo.image.width)-Math.max(x,logo.x)),overlapH=Math.max(0,Math.min(y+height,logo.y+logo.image.height)-Math.max(y,logo.y))
      if(overlapW>logo.image.width*.5 && overlapH>logo.image.height*.15 && !seen.has(logo.anchor)){
        const highest=Math.max(0,...Array.from(document.getElementsByTagNameNS(WP,'anchor')).map(node=>Number(node.getAttribute('relativeHeight') || 0)))
        seen.add(logo.anchor);repairs.push({info:{id:part+':logo-cover:'+repairs.length,label:'Restore full logo — '+logo.image.name,imageId:logo.image.id},apply:()=>{
          // Word also uses drawing order for imported shapes that share a stacking level.
          // Keep the white mask (it may hide a running header) and raise only the picture.
          const picture=container(logo.anchor,'drawing')!,run=container(picture,'r')!,paragraph=container(run,'p')!
          const children=Array.from(run.childNodes).filter((node):node is Element=>node.nodeType===1)
          if(children.every(node=>node===picture || node.namespaceURI===W && node.localName==='rPr'))paragraph.appendChild(run)
          else {
            const pictureRun=document.createElementNS(W,'w:r'),properties=children.find(node=>node.namespaceURI===W && node.localName==='rPr')
            if(properties)pictureRun.appendChild(properties.cloneNode(true))
            pictureRun.appendChild(picture);paragraph.appendChild(pictureRun)
          }
          logo.anchor.setAttribute('relativeHeight',String(Math.min(4294967295,Math.max(251658240,highest+1))))
        }})
      }
    }
  }
  return {images,repairs}
}
