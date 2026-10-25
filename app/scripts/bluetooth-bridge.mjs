import fs from 'fs'
import path from 'path'

// --- CONFIG ---
const WATCH_DIR = path.join(process.env.USERPROFILE || '', 'Documents', 'Bluetooth')
const TARGET_DIR = 'C:\\KioskFiles\\pending'

console.log(`📡 Bluetooth Bridge Started`)
console.log(`👀 Watching: ${WATCH_DIR}`)

if (!fs.existsSync(WATCH_DIR)) {
  console.log(`⚠️  Bluetooth folder not found. Creating placeholder...`)
  fs.mkdirSync(WATCH_DIR, { recursive: true })
}

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true })
}

// Watch for new files
fs.watch(WATCH_DIR, (eventType, filename) => {
  if (filename && eventType === 'rename') {
    const filePath = path.join(WATCH_DIR, filename)
    
    // Check if file exists (it might have been deleted/moved)
    if (fs.existsSync(filePath)) {
      console.log(`✨ New Bluetooth file detected: ${filename}`)
      
      // Give it a second to finish receiving
      setTimeout(() => {
        const destPath = path.join(TARGET_DIR, filename)
        
        try {
          fs.copyFileSync(filePath, destPath)
          console.log(`✅ File moved to Kiosk Storage: ${destPath}`)
          
        } catch (err) {
          console.error(`❌ Error processing file:`, err)
        }
      }, 2000)
    }
  }
})

console.log(`\n💡 INSTRUCTIONS:`)
console.log(`1. Pair your phone with this PC.`)
console.log(`2. Send any file via Bluetooth.`)
console.log(`3. The file will appear in ${TARGET_DIR} automatically.`)
