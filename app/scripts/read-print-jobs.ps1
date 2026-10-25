param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$jobs = @(Get-PrintJob -PrinterName $PrinterName | ForEach-Object {
  [pscustomobject]@{ id=$_.ID; document=$_.DocumentName; status=[string]$_.JobStatus; pages=$_.TotalPages; printedPages=$_.PagesPrinted; submittedAt=$_.SubmittedTime.ToString('o') }
})
ConvertTo-Json -InputObject $jobs -Depth 3 -Compress
