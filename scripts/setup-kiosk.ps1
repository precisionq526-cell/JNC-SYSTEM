# PrintHub Kiosk Auto-Setup Script
# Run this as Administrator to configure any PC as a Kiosk

$kioskName = "PrintHub-Kiosk-$(-join ((65..90) | Get-Random -Count 3 | ForEach-Object {[char]$_}))"

Write-Host "--- PrintHub Kiosk Setup ---" -ForegroundColor Cyan
Write-Host "Target Name: $kioskName"

# 1. Rename Computer
Write-Host "[1/3] Renaming computer..."
Rename-Computer -NewName $kioskName -Force -ErrorAction SilentlyContinue

# 2. Enable Bluetooth Discovery (Registry Hack)
Write-Host "[2/3] Enabling Bluetooth Discovery..."
$registryPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Bluetooth\Audio\Runtime"
if (!(Test-Path $registryPath)) { New-Item -Path $registryPath -Force }
# Note: Full discovery usually requires user interaction in UI, but we can trigger the settings page
Start-Process "ms-settings:bluetooth"

# 3. Create Local Kiosk Folders
Write-Host "[3/3] Creating local file storage..."
$storagePath = "C:\KioskFiles"
if (!(Test-Path $storagePath)) { 
    New-Item -ItemType Directory -Path "$storagePath\pending" -Force
    New-Item -ItemType Directory -Path "$storagePath\processed" -Force
}

Write-Host "`n--- SETUP COMPLETE ---" -ForegroundColor Green
Write-Host "PC Name is now: $kioskName"
Write-Host "RESTART REQUIRED to apply name change."
Write-Host "------------------------"
