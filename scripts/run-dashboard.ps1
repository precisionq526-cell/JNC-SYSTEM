$ErrorActionPreference = 'Stop'

$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$appDirectory = Join-Path $workspaceDirectory 'app'
$appUrl = 'http://127.0.0.1:3100/login?redirect=/admin'
$healthUrl = 'http://127.0.0.1:3100/login?redirect=/admin'

if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'package.json'))) {
    Write-Error "Dashboard app not found at $appDirectory"
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'node_modules\next\dist\bin\next'))) {
    Write-Error 'App dependencies are not installed. Open a terminal in the app folder and run npm install.'
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory '.env.local'))) {
    Write-Error 'The app .env.local file is missing. Restore the Supabase settings before starting the dashboard.'
    exit 1
}

$dashboardAlreadyRunning = $false
try {
    $existingPage = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing
    $dashboardAlreadyRunning = $existingPage.StatusCode -eq 200 -and $existingPage.Content.Contains('Admin sign in')
} catch {
    # No dashboard is responding on the app's local port yet.
}

if (-not $dashboardAlreadyRunning) {
    $portInUse = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portInUse) {
        Write-Error 'Port 3100 is in use by another app. Close it, then run this launcher again.'
        exit 1
    }

    $serverCommand = 'cd /d "' + $appDirectory + '" && npm run dev -- --hostname 127.0.0.1 --port 3100'
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/k', $serverCommand) -WorkingDirectory $appDirectory -WindowStyle Normal | Out-Null

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (-not $ready -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 750
        try {
            $page = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing
            $ready = $page.StatusCode -eq 200 -and $page.Content.Contains('Admin sign in')
        } catch {
            # Next.js is still compiling or the server is starting.
        }
    }

    if (-not $ready) {
        Write-Error 'The dashboard did not become ready. Check the JandC Dashboard Server window for startup errors.'
        exit 1
    }
}

Start-Process $appUrl
Write-Host 'Dashboard is ready at http://127.0.0.1:3100/login?redirect=/admin'
Write-Host 'Use the JandC Dashboard Server window to view logs or stop the local server.'
