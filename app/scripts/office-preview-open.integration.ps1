$ErrorActionPreference = 'Stop'
$word = $null
$excel = $null
$powerpoint = $null
$wordDocument = $null
$workbook = $null
$presentation = $null
$ownedPowerPoint = $false
$originalSecurity = $null
$originalAlerts = $null
$marker = 'Unsaved document kept during print preview'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OfficeTestWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
function Get-OfficeProcessId([IntPtr]$WindowHandle) {
  [uint32]$officeProcessId = 0
  [void][OfficeTestWindow]::GetWindowThreadProcessId($WindowHandle, [ref]$officeProcessId)
  if (-not $officeProcessId) { throw 'Cannot identify test Office process.' }
  return $officeProcessId
}
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $wordDocument = $word.Documents.Add()
  $wordDocument.Content.Text = $marker
  $wordProcessId = Get-OfficeProcessId ([IntPtr]$wordDocument.ActiveWindow.Hwnd)
  $wordDocuments = $word.Documents.Count

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $workbook = $excel.Workbooks.Add()
  $workbook.Worksheets.Item(1).Cells.Item(1, 1).Value2 = $marker
  $excelProcessId = Get-OfficeProcessId ([IntPtr]$excel.Hwnd)
  $excelWorkbooks = $excel.Workbooks.Count

  $existingPowerPointIds = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $powerpoint = New-Object -ComObject PowerPoint.Application
  $powerPointProcessId = Get-OfficeProcessId ([IntPtr]$powerpoint.HWND)
  $ownedPowerPoint = $powerPointProcessId -notin $existingPowerPointIds
  $originalSecurity = $powerpoint.AutomationSecurity
  $originalAlerts = $powerpoint.DisplayAlerts
  $presentation = $powerpoint.Presentations.Add(0)
  $slide = $presentation.Slides.Add(1, 1)
  $slide.Shapes.Title.TextFrame.TextRange.Text = $marker
  $powerPointPresentations = $powerpoint.Presentations.Count

  Write-Output 'Testing preview API with unsaved Word, Excel and PowerPoint documents open...'
  & node (Join-Path $PSScriptRoot 'office-preview.integration.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Office preview API test failed.' }

  foreach ($officeProcessId in @($wordProcessId, $excelProcessId, $powerPointProcessId)) {
    if (-not (Get-Process -Id $officeProcessId -ErrorAction SilentlyContinue)) { throw 'An existing Office process was closed.' }
  }
  if ($wordDocument.Content.Text.Trim() -ne $marker -or $wordDocument.Saved) { throw 'Unsaved Word document changed.' }
  if ($workbook.Worksheets.Item(1).Cells.Item(1, 1).Value2 -ne $marker -or $workbook.Saved) { throw 'Unsaved workbook changed.' }
  if ($presentation.Slides.Item(1).Shapes.Title.TextFrame.TextRange.Text -ne $marker -or $presentation.Saved -ne 0) { throw 'Unsaved presentation changed.' }
  if ($word.Documents.Count -ne $wordDocuments -or $excel.Workbooks.Count -ne $excelWorkbooks -or $powerpoint.Presentations.Count -ne $powerPointPresentations) { throw 'Temporary preview document was left open.' }
  if ($powerpoint.AutomationSecurity -ne $originalSecurity -or $powerpoint.DisplayAlerts -ne $originalAlerts) { throw 'PowerPoint settings were not restored.' }
  Write-Output 'PASS: All three previews succeeded; existing processes, unsaved documents and PowerPoint settings were preserved.'
} finally {
  if ($null -ne $wordDocument) { try { $wordDocument.Close(0) } catch {} }
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
  if ($null -ne $presentation) { try { $presentation.Saved = -1; $presentation.Close() } catch {} }
  if ($null -ne $word) { try { $word.Quit() } catch {} }
  if ($null -ne $excel) { try { $excel.Quit() } catch {} }
  if ($null -ne $powerpoint -and $ownedPowerPoint) { try { $powerpoint.Quit() } catch {} }
  foreach ($comObject in @($slide, $wordDocument, $workbook, $presentation, $word, $excel, $powerpoint)) {
    if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
