import fs from 'node:fs'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer
const require=createRequire(import.meta.url)
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const compile=file=>ts.transpileModule(fs.readFileSync(new URL('../src/lib/editor/'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
let code=compile('office-document')
for(const file of ['word-layout','word-graphics','worksheet-layout'])code=code.replace("'./"+file+"'",JSON.stringify(url(compile(file))))
code=code.replace("'./file-types'",JSON.stringify(new URL('../src/lib/editor/file-types.ts',import.meta.url).href)).replace("'jszip'",JSON.stringify(pathToFileURL(require.resolve('jszip')).href))
export const {openOfficeDocument}=await import(url(code))
