// Check the exact Git index before publishing; never print credential values.
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim()
const names=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
const failures=[]
const patterns=[
  ['credential token',/(?:sb_secret_[A-Za-z0-9_-]{15,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|sk-(?:proj-)?[A-Za-z0-9_-]{25,})/g],
  ['embedded JWT',/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['credential-bearing URL',/(?:https?|postgres(?:ql)?):\/\/[^\s/:]+:[^\s/@]+@/g],
]
for(const name of names){
  const base=path.posix.basename(name),example=base==='.env.example'
  if((base.startsWith('.env')&&!example)||/(^|\/)(node_modules|\.next|\.runtime|\.temp|\.cache|\.branches|output|tmp|uploads|print-receipts|payment-proofs|student-proofs)(\/|$)/i.test(name)||/\.(?:sqlite(?:-\w+)?|db(?:-\w+)?|pem|key|pfx|p12|log|tsbuildinfo)$/i.test(base))failures.push({file:name,issue:'private or generated artifact'})
  if(/\.(?:pdf|docx?|xlsx?|pptx?|csv)$/i.test(base)&&!name.startsWith('app/tests/fixtures/'))failures.push({file:name,issue:'document upload outside an explicit synthetic fixture folder'})
  const data=execFileSync('git',['show',':'+name],{cwd:root,maxBuffer:110*1024*1024})
  if(data.length>=100*1024*1024)failures.push({file:name,issue:'file exceeds GitHub 100 MiB limit'})
  if(data.length>3*1024*1024||data.includes(0))continue
  const text=data.toString('utf8')
  for(const [issue,pattern]of patterns){pattern.lastIndex=0;for(const match of text.matchAll(pattern))failures.push({file:name,line:text.slice(0,match.index).split('\n').length,issue})}
}
if(!names.length)throw Error('No tracked files were found. Stage the intended source before checking.')
if(failures.length){console.error(JSON.stringify({ok:false,findings:failures},null,2));process.exitCode=1}
else console.log(JSON.stringify({ok:true,trackedFiles:names.length,checked:'Git index: secret patterns, private artifacts, document uploads and file sizes'},null,2))

