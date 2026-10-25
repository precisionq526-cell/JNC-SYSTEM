import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const source = path.join(root, 'node_modules', 'pdfjs-dist')
const destination = path.join(root, 'public', 'scripts', 'pdfjs')
await mkdir(destination, { recursive: true })
await cp(path.join(source, 'build', 'pdf.worker.min.mjs'), path.join(destination, 'pdf.worker.min.mjs'))
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(path.join(source, folder), path.join(destination, folder), { recursive: true })
}
