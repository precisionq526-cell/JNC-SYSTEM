import os from 'node:os'
import dotenv from 'dotenv'
import { scanWindowsPrinters } from '../src/lib/hardware/windows-printers.ts'

dotenv.config({path:'.env.local',quiet:true})
const args=process.argv.slice(2), appArg=args.indexOf('--app-url')
const appUrl=appArg>=0?args[appArg+1]:process.env.KIOSK_APP_URL||process.env.NEXT_PUBLIC_APP_URL
const token=process.env.KIOSK_DEVICE_TOKEN
if(!appUrl||!token)throw Error('Configure KIOSK_APP_URL and KIOSK_DEVICE_TOKEN before starting the hardware bridge.')
const interval=Math.max(5000,Number(process.env.HARDWARE_BRIDGE_INTERVAL_MS)||15000)
const location=process.env.KIOSK_LOCATION||null
async function heartbeat(payload){
  const response=await fetch(appUrl.replace(/\/$/,'')+'/api/hardware/heartbeat',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw Error('Heartbeat failed ('+response.status+'). Check the app URL, token and database connection.')
}
async function tick(){
  const scan=await scanWindowsPrinters()
  await heartbeat({deviceName:os.hostname(),deviceType:'computer',status:'online',location,
    capabilities:{platform:os.platform(),cpuCount:os.cpus().length,memoryMb:Math.round(os.totalmem()/1048576)}})
  for(const printer of scan.printers){
    // Unknown, paused and attention states are unavailable; they cannot masquerade as online.
    const status=printer.status==='idle'?'online':['printing','warming_up'].includes(printer.status)?'busy'
      :printer.status==='offline'?'offline':'error'
    await heartbeat({deviceName:printer.name,deviceType:'printer',status,location,
      capabilities:{driver:printer.driverName,port:printer.portName,windowsStatus:printer.status,pagesPerMinute:printer.pagesPerMinute,supportedSizes:printer.paperNames,supportsColor:printer.supportsColor,supportsDuplex:printer.supportsDuplex},
      errorMessage:['online','busy'].includes(status)?null:printer.issues.join('; ')||'Printer status: '+printer.status})
  }
  console.log('Hardware heartbeat confirmed: '+scan.printers.length+' physical printer(s).')
}
do{
  await tick().catch(error=>console.error(error.message))
  if(!args.includes('--once'))await new Promise(resolve=>setTimeout(resolve,interval))
}while(!args.includes('--once'))
