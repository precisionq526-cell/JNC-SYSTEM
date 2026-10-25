'use client'
import {useEffect,useState} from 'react'
import {getShopAvailabilityAction} from '@/lib/actions/sop-operations'
import {shopHoursLabel} from '@/lib/sop/policy'

export function ShopHours() {
  const [label,setLabel]=useState('Checking shop hours…')
  useEffect(()=>{let active=true;const refresh=()=>void getShopAvailabilityAction().then(result=>{if(active)setLabel(result.ok&&result.configured?shopHoursLabel(result.policy):'Contact the shop for current hours')}).catch(()=>{if(active)setLabel('Contact the shop for current hours')});refresh();const timer=setInterval(refresh,30000);return()=>{active=false;clearInterval(timer)}},[])
  return <span>{label}</span>
}
