import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {config} from 'dotenv'
config({path:'.env.local',quiet:true})
const base='http://127.0.0.1:3100', results=[]
let customerStylesLoaded=false
for(const route of ['/order','/order/service/printing','/order/review?service=printing','/order/status','/order/queue','/order-assets/photos-background.webp','/order-assets/paper-background.webp','/order-assets/payment-background.webp','/order-assets/services-poster.png']){
  const response=await fetch(base+route,{signal:AbortSignal.timeout(60000)}), bytes=await response.arrayBuffer()
  assert.equal(response.status,200,route+' is available');results.push({route,status:response.status,bytes:bytes.byteLength})
  if(route==='/order'){
    const html=new TextDecoder().decode(bytes)
    assert.ok(html.includes('Send your files. Pick'));assert.ok(html.includes('customer-shell'))
    for(const [tag] of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)){
      const href=tag.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&')
      if(href){const css=await(await fetch(new URL(href,base))).text();if(css.includes('.customer-shell') && css.includes('photos-background.webp'))customerStylesLoaded=true}
    }
    assert.ok(customerStylesLoaded,'The reference design stylesheet is linked and served')
  }
}
const blocked=await fetch(base+'/api/admin/orders/11111111-1111-4111-8111-111111111111/payment-proof');assert.equal(blocked.status,403)
const hashes=JSON.parse(await fs.readFile('../output/order-ui-audit/editor-before.json','utf8'))
const changed=[]
for(const [file,hash]of Object.entries(hashes))if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==hash)changed.push(file)
assert.deepEqual(changed,[],'Every editor source and stylesheet remains unchanged')
let catalog
try{
  const response=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/services?select=name,slug&is_active=eq.true',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},signal:AbortSignal.timeout(15000)})
  const data=await response.json();catalog={status:response.status,services:Array.isArray(data)?data.map(item=>item.slug):[],ok:response.ok}
}catch(error){catalog={ok:false,error:error.cause?.code || error.message}}
const report={checkedAt:new Date().toISOString(),results,customerStylesLoaded,editorFilesByteIdentical:Object.keys(hashes).length,unauthorizedReceiptDenied:true,catalog,browserInteraction:'Unavailable: local browser use disabled in Work settings',liveOrdersCreated:0}
await fs.writeFile('../output/order-ui-audit/http-checks.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
