'use client'
import { Bluetooth, X } from 'lucide-react'
interface BluetoothBridgeProps {isOpen:boolean;onClose:()=>void;onFileReceived:(file:File)=>void}
export function BluetoothBridge({isOpen,onClose,onFileReceived}:BluetoothBridgeProps){
  if(!isOpen)return null
  return <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Bluetooth file transfer">
    <section className="bg-white rounded-xl p-6 max-w-lg">
      <div className="flex justify-between gap-4 mb-4"><h2 className="font-bold flex gap-2"><Bluetooth size={20}/>Bluetooth file transfer</h2><button aria-label="Close Bluetooth transfer" onClick={onClose}><X size={20}/></button></div>
      <p className="mb-4">Receive the file using Windows Bluetooth, then select the received file below. The browser cannot broadcast a Bluetooth file-transfer service or confirm Windows pairing.</p>
      <label className="block mb-2" htmlFor="received-bluetooth-file">Select received file</label>
      <input id="received-bluetooth-file" type="file" accept=".pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv" onChange={e=>{const file=e.target.files?.[0];if(file){onFileReceived(file);onClose()}}}/>
    </section>
  </div>
}
