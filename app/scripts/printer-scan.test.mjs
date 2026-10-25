import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWindowsPrinterOutput } from '../src/lib/hardware/windows-printers.ts'

test('empty discovery produces no placeholder printers', () => {
  for (const value of ['', '[]', 'null']) assert.deepEqual(parseWindowsPrinterOutput(value), [])
})
test('single printer and Unicode names survive Windows JSON output', () => {
  const [printer] = parseWindowsPrinterOutput('\uFEFF' + JSON.stringify({ Name: 'EPSON — Café', WindowsStatus: 'Normal', Default: true, PaperNames: ['A4', null] }))
  assert.equal(printer.name, 'EPSON — Café')
  assert.equal(printer.status, 'idle')
  assert.equal(printer.isDefault, true)
  assert.deepEqual(printer.paperNames, ['A4'])
})
test('missing telemetry is unknown instead of silently online', () => {
  assert.equal(parseWindowsPrinterOutput('{"Name":"Installed printer"}')[0].status, 'unknown')
})
test('offline and paper-jam telemetry take precedence over idle or printing', () => {
  const printers = parseWindowsPrinterOutput(JSON.stringify([
    { Name: 'Offline', WorkOffline: true, PrinterStatus: 3, WindowsStatus: 'Normal' },
    { Name: 'Jammed', PrinterStatus: 4, DetectedErrorState: 8, WindowsStatus: 'Printing, PaperJam' },
  ]))
  const offline = printers.find(printer => printer.name === 'Offline')
  const jammed = printers.find(printer => printer.name === 'Jammed')
  assert.equal(offline.status, 'offline')
  assert.equal(jammed.status, 'error')
  assert.deepEqual(jammed.issues, ['Paper jam'])
})
test('low supplies and stopped queues are not marked available', () => {
  const [low, stopped] = parseWindowsPrinterOutput(JSON.stringify([
    { Name: 'Low supplies', DetectedErrorState: 5, WindowsStatus: 'Normal' },
    { Name: 'Stopped', ExtendedPrinterStatus: 6, PrinterStatus: 3 },
  ]))
  assert.equal(low.status, 'attention')
  assert.equal(stopped.status, 'paused')
})
test('software drivers are separated without filtering physical printer names', () => {
  const printers = parseWindowsPrinterOutput(JSON.stringify([
    { Name: 'Epson PDF office', DriverName: 'Microsoft IPP Class Driver', PortName: 'WSD-real' },
    { Name: 'PDF output', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:' },
    { Name: 'Notes', DriverName: 'Send to Microsoft OneNote 16 Driver', PortName: 'nul:' },
  ]))
  assert.deepEqual(printers.filter(printer => !printer.isVirtual).map(printer => printer.name), ['Epson PDF office'])
})
test('invalid discovery output fails instead of creating phantom devices', () => {
  for (const output of ['not json', '["Printer"]', '[{}]', '{"printers":[]}', '[{"Name":"A"},{"Name":"A"}]']) {
    assert.throws(() => parseWindowsPrinterOutput(output))
  }
})

