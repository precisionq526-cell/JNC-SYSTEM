param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$officeApp = $null
$officeDocument = $null
$ownsOfficeApp = $false
$originalSecurity = $null
$originalAlerts = $null
$missing = [Type]::Missing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PreviewWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
function Register-PreviewProcess([IntPtr]$WindowHandle) {
  [uint32]$previewProcessId = 0
  [void][PreviewWindow]::GetWindowThreadProcessId($WindowHandle, [ref]$previewProcessId)
  if ($previewProcessId -eq 0) { throw 'Could not identify the Office preview process.' }
  $script:ownsOfficeApp = $previewProcessId -notin $existingProcessIds
  # The server may terminate only an application created for this conversion.
  # PowerPoint can share the user's existing process, which must stay open.
  if ($script:ownsOfficeApp) { Write-Output ('OFFICE_PID:' + $previewProcessId) }
}
try {
  $extension = [IO.Path]::GetExtension($InputPath).ToLowerInvariant()
  $processName = @{ '.docx' = 'WINWORD'; '.xlsx' = 'EXCEL'; '.pptx' = 'POWERPNT' }[$extension]
  if (-not $processName) { throw 'Unsupported Office file.' }
  $existingProcessIds = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  # Word and Excel create separate automation instances even when already open.
  # Each conversion opens a temporary, read-only copy of the saved upload.
  if ($extension -eq '.docx') {
    $officeApp = New-Object -ComObject Word.Application
    $officeApp.Visible = $false
    $officeApp.DisplayAlerts = 0
    $officeApp.AutomationSecurity = 3
    $officeApp.Options.UpdateLinksAtOpen = $false
    $officeDocument = $officeApp.Documents.Open($InputPath, $false, $true, $false)
    Register-PreviewProcess ([IntPtr]$officeDocument.ActiveWindow.Hwnd)
    $officeDocument.ExportAsFixedFormat($OutputPath, 17, $false, 0, 0)
  } elseif ($extension -eq '.xlsx') {
    $officeApp = New-Object -ComObject Excel.Application
    $officeApp.Visible = $false
    $officeApp.DisplayAlerts = $false
    $officeApp.AutomationSecurity = 3
    $officeApp.AskToUpdateLinks = $false
    Register-PreviewProcess ([IntPtr]$officeApp.Hwnd)
    $officeDocument = $officeApp.Workbooks.Open($InputPath, 0, $true, $missing, '', '', $true, $missing, $missing, $false, $false, $missing, $false)
    $officeDocument.ExportAsFixedFormat(0, $OutputPath, 0, $true, $false)
  } elseif ($extension -eq '.pptx') {
    $officeApp = New-Object -ComObject PowerPoint.Application
    Register-PreviewProcess ([IntPtr]$officeApp.HWND)
    # PowerPoint is a single-instance COM server. Keep the existing application
    # visible and restore its settings; close only our hidden temporary document.
    $originalSecurity = $officeApp.AutomationSecurity
    $originalAlerts = $officeApp.DisplayAlerts
    $officeApp.AutomationSecurity = 3
    $officeApp.DisplayAlerts = 1
    $officeDocument = $officeApp.Presentations.Open($InputPath, -1, 0, 0)
    $officeApp.AutomationSecurity = $originalSecurity
    $officeDocument.SaveAs($OutputPath, 32)
  } else { throw 'Unsupported Office file.' }
  if (-not [IO.File]::Exists($OutputPath)) { throw 'Office did not create the PDF preview.' }
  Write-Output '{"ok":true}'
} catch {
  [Console]::Error.WriteLine('Office could not export this document: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $officeDocument) {
    try {
      if ($extension -eq '.docx') { $officeDocument.Close(0) }
      elseif ($extension -eq '.xlsx') { $officeDocument.Close($false) }
      else { $officeDocument.Close() }
    } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeDocument)
  }
  if ($null -ne $officeApp) {
    if ($null -ne $originalSecurity) { try { $officeApp.AutomationSecurity = $originalSecurity } catch {} }
    if ($null -ne $originalAlerts) { try { $officeApp.DisplayAlerts = $originalAlerts } catch {} }
    if ($ownsOfficeApp) { try { $officeApp.Quit() } catch {} }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeApp)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
