param (
    [int]$Port = 0
)

$ErrorActionPreference = "Continue"

Write-Host "========================================="
Write-Host "  Agent Harness - Stop (Win32 Force Kill)"
Write-Host "========================================="

$lockFile = Join-Path $HOME ".pg_harness\.lock"
$targetPort = $Port

if (Test-Path $lockFile) {
    try {
        $raw = Get-Content $lockFile -Raw -ErrorAction SilentlyContinue
        $lockData = ConvertFrom-Json $raw -ErrorAction SilentlyContinue
        if ($lockData -ne $null) {
            if ($lockData.pid) {
                & cmd.exe /c "taskkill /pid $($lockData.pid) /T /F >nul 2>nul"
            }
            if ($targetPort -eq 0 -and $lockData.port) {
                $targetPort = $lockData.port
            }
        }
    } catch {
    }
    Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
}

if ($targetPort -eq 0) {
    $targetPort = 3210
}

# 优先调用跨平台确定性 kill-port 工具
$killScript = Join-Path $PSScriptRoot "kill-port.ts"
if (Test-Path $killScript) {
    & node --experimental-strip-types $killScript $targetPort
}

$pidsToKill = @()
try {
    $lines = & cmd.exe /c "netstat -ano -p tcp | findstr /R /C:`":$targetPort `"" 2>$null
    if ($lines) {
        foreach ($line in ($lines -split "`r?`n")) {
            $parts = $line.Trim() -split '\s+'
            if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
                $p = $parts[4]
                if ($p -and $p -ne "0" -and $pidsToKill -notcontains $p) {
                    $pidsToKill += $p
                }
            }
        }
    }
} catch {
}

foreach ($p in $pidsToKill) {
    Write-Host "[i] Terminating port $targetPort process (PID: $p)..."
    & cmd.exe /c "taskkill /pid $p /T /F >nul 2>nul"
}

Write-Host "[OK] Agent Harness stopped. Port $targetPort and lock released."
