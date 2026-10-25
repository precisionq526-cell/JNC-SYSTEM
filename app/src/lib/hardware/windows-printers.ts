import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

export type ScannedPrinterStatus = 'idle' | 'printing' | 'warming_up' | 'offline' | 'paused' | 'attention' | 'error' | 'unknown'

export interface ScannedPrinter {
  name: string
  driverName: string
  portName: string
  status: ScannedPrinterStatus
  issues: string[]
  isDefault: boolean
  isVirtual: boolean
  paperNames: string[]
  pagesPerMinute?: number | null
  supportsDuplex?: boolean | null
  supportsColor?: boolean | null
  paperSizes?: { name: string; kind: number; width: number; height: number }[]
}

export interface PrinterScanSnapshot {
  printers: ScannedPrinter[]
  virtualPrinters: ScannedPrinter[]
  scannedAt: string
  computerName: string
}

const execFileAsync = promisify(execFile)

// Fixed, read-only commands: printer names are never interpolated into a shell command.
const WINDOWS_SCAN = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$printerDetails = @(Get-CimInstance -ClassName Win32_Printer)
Add-Type -AssemblyName System.Drawing
$rows = @(Get-Printer | ForEach-Object {
  $installedPrinter = $_
  $details = $printerDetails | Where-Object { $_.Name -eq $installedPrinter.Name } | Select-Object -First 1
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $installedPrinter.Name
  [pscustomobject]@{
    Name = $installedPrinter.Name
    WindowsStatus = [string]$installedPrinter.PrinterStatus
    DriverName = $installedPrinter.DriverName
    PortName = $installedPrinter.PortName
    Default = ($details.Default -eq $true)
    WorkOffline = ($details.WorkOffline -eq $true)
    PrinterStatus = $details.PrinterStatus
    ExtendedPrinterStatus = $details.ExtendedPrinterStatus
    DetectedErrorState = $details.DetectedErrorState
    PaperNames = @($details.PrinterPaperNames)
    PagesPerMinute = $details.AveragePagesPerMinute
    SupportsDuplex = $settings.CanDuplex
    SupportsColor = $settings.SupportsColor
    PaperSizes = @($settings.PaperSizes | ForEach-Object { [pscustomobject]@{Name=$_.PaperName;Kind=$_.RawKind;Width=$_.Width;Height=$_.Height} })
  }
})
ConvertTo-Json -InputObject $rows -Depth 4 -Compress
`

// Microsoft Win32_Printer DetectedErrorState values.
const ERROR_STATES: Record<number, string> = {
  1: 'Other printer error', 3: 'Low paper', 4: 'No paper', 5: 'Low toner',
  6: 'No toner', 7: 'Door open', 8: 'Paper jam', 9: 'Offline',
  10: 'Service required', 11: 'Output bin full',
}
const FLAG_ISSUES: Record<string, string> = {
  error: 'Printer error', paperjam: 'Paper jam', paperout: 'No paper',
  paperproblem: 'Paper problem', offline: 'Offline', tonerlow: 'Low toner',
  notoner: 'No toner', dooropen: 'Door open', outputbinfull: 'Output bin full',
  userintervention: 'User intervention required', outofmemory: 'Printer memory full',
  notavailable: 'Not available', serverunknown: 'Print server unavailable',
  pendingdeletion: 'Printer removal pending',
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function parseWindowsPrinterOutput(output: string): ScannedPrinter[] {
  const parsed: unknown = JSON.parse(output.replace(/^\uFEFF/, '').trim() || '[]')
  const rows = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
  const seen = new Set<string>()

  return rows.map((row): ScannedPrinter => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid Windows printer response')
    const printer = row as Record<string, unknown>
    const name = text(printer.Name)
    if (!name || seen.has(name)) throw new Error('Invalid Windows printer name')
    seen.add(name)
    const driverName = text(printer.DriverName)
    const portName = text(printer.PortName)
    const flags = text(printer.WindowsStatus).toLowerCase().replace(/[ _-]/g, '').split(',').map(flag => flag.trim())
    const has = (...values: string[]) => values.some(value => flags.includes(value))
    const errorState = typeof printer.DetectedErrorState === 'number' ? printer.DetectedErrorState : null
    const extendedStatus = typeof printer.ExtendedPrinterStatus === 'number' ? printer.ExtendedPrinterStatus : null
    const legacyStatus = typeof printer.PrinterStatus === 'number' ? printer.PrinterStatus : null
    const issues = [...new Set([
      ...(errorState !== null && ERROR_STATES[errorState] ? [ERROR_STATES[errorState]] : []),
      ...flags.flatMap(flag => FLAG_ISSUES[flag] ? [FLAG_ISSUES[flag]] : []),
    ])]

    let status: ScannedPrinterStatus = 'unknown'
    if (printer.WorkOffline === true || has('offline', 'notavailable', 'serverunknown') || errorState === 9 || extendedStatus === 7 || extendedStatus === 11 || legacyStatus === 7) {
      status = 'offline'
      if (!issues.length) issues.push('Offline')
    } else if (issues.some(issue => issue !== 'Low paper' && issue !== 'Low toner') || extendedStatus === 9) {
      status = 'error'
      if (!issues.length) issues.push('Printer error')
    } else if (has('paused') || extendedStatus === 8 || extendedStatus === 6 || legacyStatus === 6) {
      status = 'paused'
      issues.push('Printing paused')
    } else if (issues.length) {
      status = 'attention'
    } else if (has('printing', 'busy', 'processing', 'ioactive') || [4, 10, 13].includes(extendedStatus ?? 0) || legacyStatus === 4) {
      status = 'printing'
    } else if (has('warmingup', 'initializing', 'initialization') || [5, 14].includes(extendedStatus ?? 0) || legacyStatus === 5) {
      status = 'warming_up'
    } else if (has('normal', 'idle') || extendedStatus === 3 || legacyStatus === 3) {
      status = 'idle'
    }

    // Identify known software output drivers without guessing from a printer's user-defined name.
    const isVirtual = /onenote|microsoft print to pdf|microsoft xps|fax|pdf|document writer/i.test(driverName)
      || /^(nul:|portprompt:|file:|shrfax:|xpsport:)/i.test(portName)

    return {
      name, driverName, portName, status, issues,
      isDefault: printer.Default === true,
      isVirtual,
      paperNames: Array.isArray(printer.PaperNames) ? printer.PaperNames.map(text).filter(Boolean) : [],
      pagesPerMinute: typeof printer.PagesPerMinute === 'number' && printer.PagesPerMinute > 0 ? printer.PagesPerMinute : null,
      supportsDuplex: typeof printer.SupportsDuplex === 'boolean' ? printer.SupportsDuplex : null,
      supportsColor: typeof printer.SupportsColor === 'boolean' ? printer.SupportsColor : null,
      paperSizes: Array.isArray(printer.PaperSizes) ? printer.PaperSizes.flatMap((paper) => {
        if (!paper || typeof paper !== 'object') return []
        const p = paper as Record<string, unknown>
        return typeof p.Kind === 'number' && typeof p.Width === 'number' && typeof p.Height === 'number'
          ? [{ name: text(p.Name), kind: p.Kind, width: p.Width, height: p.Height }] : []
      }) : [],
    }
  }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}

let activeScan: Promise<PrinterScanSnapshot> | null = null

export async function scanWindowsPrinters(): Promise<PrinterScanSnapshot> {
  if (process.platform !== 'win32') throw new Error('Printer scanning requires the app to run on the Windows computer connected to your printers.')
  if (activeScan) return activeScan

  activeScan = (async () => {
    let stdout: string
    try {
      const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCAN], {
        windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
      })
      stdout = result.stdout
    } catch {
      throw new Error('Could not scan printers. Check that the Windows Print Spooler is running, then try again.')
    }
    const installed = parseWindowsPrinterOutput(stdout)
    return {
      printers: installed.filter(printer => !printer.isVirtual),
      virtualPrinters: installed.filter(printer => printer.isVirtual),
      scannedAt: new Date().toISOString(),
      computerName: hostname(),
    }
  })()

  try { return await activeScan } finally { activeScan = null }
}

