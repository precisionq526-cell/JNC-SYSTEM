import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync('src/lib/editor/text-document.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {readTextDocument,saveTextDocument}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('text edits retain UTF-8 BOM, CRLF lines and Unicode characters',()=>{
 const source=readTextDocument(new TextEncoder().encode('\ufeffName,Quantity\r\nCafé,2\r\n'))
 assert.equal(source.bom,true);assert.equal(source.newline,'\r\n')
 assert.equal(new TextDecoder('utf-8',{ignoreBOM:true}).decode(saveTextDocument(source,'Name,Quantity\nNiño,3\n')),'\ufeffName,Quantity\r\nNiño,3\r\n')
})
test('UTF-16 LE and BE text keeps its original encoding and byte order',()=>{
 for(const encoding of ['utf-16le','utf-16be']){
  const template={text:'',encoding,bom:true,newline:'\r\n'},bytes=saveTextDocument(template,'Original\r\n')
  const source=readTextDocument(bytes);assert.equal(source.encoding,encoding)
  const result=saveTextDocument(source,'Edited 你好\n');assert.equal(readTextDocument(result).text,'Edited 你好\r\n');assert.deepEqual([...result.slice(0,2)],encoding==='utf-16le'?[255,254]:[254,255])
 }
})
test('unsupported text encodings fail instead of replacing characters silently',()=>{assert.throws(()=>readTextDocument(new Uint8Array([67,97,102,233])),/unsupported encoding/)})
