param (
    [int]$Port = 3210,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

Write-Host "========================================="
Write-Host "  Agent Harness - Local Dev Start (Win32)"
Write-Host "========================================="

# 1. Check Node.js version (requires >= 22)
try {
    $nodeVersionRaw = & node -v
    $nodeMajor = [int]($nodeVersionRaw -replace 'v(\d+)\..*', '$1')
    if ($nodeMajor -lt 22) {
        Write-Error "Node version requires >= 22. Current: $nodeVersionRaw"
        exit 1
    }
    Write-Host "[OK] Node.js version: $nodeVersionRaw"
} catch {
    Write-Error "Node.js 22+ not found."
    exit 1
}

# 2. Check single-instance lock
$lockFile = Join-Path $HOME ".pg_harness\.lock"
if (Test-Path $lockFile) {
    $existingLock = Get-Content $lockFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($existingLock -and $existingLock.pid) {
        $existingProcess = Get-Process -Id $existingLock.pid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Warning "[!] PGH is already running (PID: $($existingLock.pid), Port: $($existingLock.port))."
            Write-Host "Open browser: http://localhost:$($existingLock.port)"
            exit 0
        } else {
            Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
        }
    }
}

# 3. Resolve project root from script location (independent of CWD)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EntryFile = Join-Path $ProjectRoot "apps/server/src/index.ts"
if (-not (Test-Path $EntryFile)) {
    Write-Error "Server entry not found: $EntryFile (project root: $ProjectRoot)"
    exit 1
}
Set-Location $ProjectRoot
Write-Host "[+] Starting Harness on http://127.0.0.1:$Port ... (foreground, Ctrl+C to stop)"
Write-Host "[i] Project root: $ProjectRoot"

# Open browser after server is likely up (delayed job, non-blocking)
if (-not $NoBrowser) {
    $pageUrl = "http://127.0.0.1:$Port/run-chat.html"
    Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Seconds 2
        Start-Process $url
    } -ArgumentList $pageUrl | Out-Null
}

& node --experimental-strip-types $EntryFile --port $Port
