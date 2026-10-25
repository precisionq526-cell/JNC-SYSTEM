import {createHash} from 'node:crypto'
export function filesFingerprint(files:{name:string;hash:string}[],options:Record<string,unknown>,student:boolean){
  return createHash('sha256').update(JSON.stringify({files:files.map(({name,hash})=>({name,hash})),options:Object.fromEntries(Object.entries(options).sort(([a],[b])=>a.localeCompare(b))),student})).digest('hex')
}
