export interface TextDocument { text: string; encoding:'utf-8'|'utf-16le'|'utf-16be'; bom:boolean; newline:'\n'|'\r\n' }
export function readTextDocument(bytes:Uint8Array):TextDocument {
  const encoding=bytes[0]===255 && bytes[1]===254 ? 'utf-16le' : bytes[0]===254 && bytes[1]===255 ? 'utf-16be' : 'utf-8'
  const bom=encoding!=='utf-8' || bytes[0]===239 && bytes[1]===187 && bytes[2]===191
  let text:string
  try { text=new TextDecoder(encoding,{fatal:true}).decode(bytes) }
  catch { throw new Error('This text file uses an unsupported encoding. Save a UTF-8 or UTF-16 copy before editing; the original file is kept.') }
  return {text,encoding,bom,newline:text.includes('\r\n')?'\r\n':'\n'}
}
export function saveTextDocument(source:TextDocument,text:string):Uint8Array {
  const normalized=text.replace(/\r\n|\r|\n/g,source.newline)
  if(source.encoding==='utf-8')return new TextEncoder().encode((source.bom?'\ufeff':'')+normalized)
  const output=new Uint8Array(normalized.length*2+(source.bom?2:0)),little=source.encoding==='utf-16le'
  let offset=0
  if(source.bom){output[0]=little?255:254;output[1]=little?254:255;offset=2}
  for(let i=0;i<normalized.length;i++){const code=normalized.charCodeAt(i);output[offset+i*2]=little?code&255:code>>>8;output[offset+i*2+1]=little?code>>>8:code&255}
  return output
}
