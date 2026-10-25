param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][int]$JobId,
  [Parameter(Mandatory=$true)][string]$ExpectedRequestId,
  [Parameter(Mandatory=$true)][int]$MaximumPrintedSides
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if ($ExpectedRequestId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Invalid print request identifier.' }
$job=Get-PrintJob -PrinterName $PrinterName -ID $JobId
if ($job.DocumentName -notlike "*$ExpectedRequestId*") { throw 'The queued job does not match this print receipt. No job was removed.' }
if ($job.PagesPrinted -gt $MaximumPrintedSides) { throw 'The driver reports more printed sides. Recheck the actual output before re-routing.' }
Remove-PrintJob -PrinterName $PrinterName -ID $JobId
$remaining=Get-PrintJob -PrinterName $PrinterName -ID $JobId -ErrorAction SilentlyContinue
if ($remaining) { throw 'The original queue job is still present. No replacement was submitted.' }
ConvertTo-Json -Compress -InputObject @{removed=$true;jobId=$JobId;printedSides=$job.PagesPrinted}
