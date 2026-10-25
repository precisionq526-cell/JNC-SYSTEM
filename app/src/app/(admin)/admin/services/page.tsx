'use client'
import { useState } from 'react'
import { getAdminServiceConfigurationAction, saveAdminServiceConfigurationAction } from '@/lib/actions/admin-data'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'
import { money } from '@/lib/admin/display'
import type { Service, ServiceOption } from '@/lib/types/database'
type Edit = Service & {service_options:ServiceOption[]}

export default function ServicesPage(){
  const state=useAdminData(getAdminServiceConfigurationAction)
  const [edit,setEdit]=useState<Edit|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const save=async()=>{
    if(!edit)return
    setSaving(true);setError(null)
    try{
      const result=await saveAdminServiceConfigurationAction({...edit,base_price:Number(edit.base_price),estimated_duration_minutes:Number(edit.estimated_duration_minutes),
        options:edit.service_options.map((o,i)=>({...o,choices:o.choices??[],price_modifier:Number(o.price_modifier),display_order:i}))})
      if(!result.ok)setError(result.error)
      else{setEdit(null);await state.refresh()}
    }catch{setError('Configuration could not be saved. Please retry.')}
    finally{setSaving(false)}
  }
  const optionChange=(index:number,change:Partial<ServiceOption>)=>setEdit(e=>e?{...e,service_options:e.service_options.map((o,i)=>i===index?{...o,...change}:o)}:e)
  return <div className="admin-page"><h1 className="text-xl font-semibold mb-4">Services</h1><DataStatus {...state}/>
    <p className="mb-4 text-sm">Prices and options come from the database. Configure the choices customers can actually order. Base price is multiplied by Copies when configured; selected option modifiers are added once.</p>
    <div className="grid md:grid-cols-2 gap-4">{state.data?.map(s=><section className="bg-white border rounded-xl p-5" key={s.id}>
      <h2 className="font-bold">{s.name}</h2><p className="text-sm">{s.is_active?'Active':'Inactive'} · {money(s.base_price)} · {s.estimated_duration_minutes} min</p>
      <p className="my-3 text-sm">{s.service_options.length ? s.service_options.map(o=>o.name).join(', ') : 'No options configured. Customers see the base service price only.'}</p>
      <button className="border rounded px-3 py-2" onClick={()=>{setError(null);setEdit(structuredClone(s))}}>Edit configuration</button>
    </section>)}</div>
    {edit&&<div className="fixed inset-0 bg-black/40 z-50 overflow-auto p-6" role="dialog" aria-modal="true" aria-label="Edit service configuration">
      <section className="bg-white rounded-xl p-6 max-w-3xl mx-auto">
        <h2 className="font-bold text-xl mb-4">{edit.name}</h2>
        {error&&<p role="alert" className="text-red-700 mb-3">{error}</p>}
        <div className="flex flex-wrap gap-4 mb-6">
          <label>Base price (PHP)<input className="block border p-2" type="number" min="0" step=".01" value={edit.base_price} onChange={e=>setEdit({...edit,base_price:Number(e.target.value)})}/></label>
          <label>Processing minutes<input className="block border p-2" type="number" min="1" value={edit.estimated_duration_minutes} onChange={e=>setEdit({...edit,estimated_duration_minutes:Number(e.target.value)})}/></label>
          <label><input type="checkbox" checked={edit.is_active} onChange={e=>setEdit({...edit,is_active:e.target.checked})}/> Service active</label>
        </div>
        <h3 className="font-semibold">Customer options</h3>
        {edit.service_options.map((o,i)=><fieldset key={i} className="border rounded p-4 mt-3 grid sm:grid-cols-2 gap-3">
          <label>Name<input className="block border p-2 w-full" value={o.name} onChange={e=>optionChange(i,{name:e.target.value})}/></label>
          <label>Type<select className="block border p-2" value={o.option_type} onChange={e=>optionChange(i,{option_type:e.target.value as ServiceOption['option_type']})}>{['select','number','toggle','text'].map(t=><option key={t}>{t}</option>)}</select></label>
          {o.option_type==='select'&&<label>Choices (comma separated)<input className="block border p-2 w-full" value={(o.choices??[]).join(',')} onChange={e=>optionChange(i,{choices:e.target.value.split(',')})}/></label>}
          <label>Default value<input className="block border p-2" value={o.default_value??''} onChange={e=>optionChange(i,{default_value:e.target.value||null})}/></label>
          <label>Added price (PHP)<input className="block border p-2" type="number" min="0" step=".01" value={o.price_modifier} onChange={e=>optionChange(i,{price_modifier:Number(e.target.value)})}/></label>
          <label><input type="checkbox" checked={o.is_required} onChange={e=>optionChange(i,{is_required:e.target.checked})}/> Required</label>
          <button className="text-red-700 underline text-left" onClick={()=>setEdit({...edit,service_options:edit.service_options.filter((_,n)=>n!==i)})}>Remove option</button>
        </fieldset>)}
        <button className="mt-4 border rounded p-2" onClick={()=>setEdit({...edit,service_options:[...edit.service_options,{id:'',service_id:edit.id,name:'',option_type:'text',choices:[],default_value:null,price_modifier:0,is_required:false,display_order:edit.service_options.length,created_at:''}]})}>Add option</button>
        <div className="mt-6 flex gap-4"><button disabled={saving} className="bg-[#a5242a] text-white rounded px-4 py-2" onClick={()=>void save()}>{saving?'Saving…':'Save configuration'}</button>
          <button disabled={saving} className="border rounded px-4 py-2" onClick={()=>setEdit(null)}>Cancel</button></div>
      </section>
    </div>}
  </div>
}
