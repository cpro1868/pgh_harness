param (
    [int]$Port = 3210,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

Write-Host "========================================="
Write-Host "  PGH Background Start (Win32)"
Write-Host "========================================="

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

$lockFile = Join-Path $HOME ".pg_harness\.lock"
if (Test-Path $lockFile) {
    $existingLock = Get-Content $lockFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($existingLock -and $existingLock.pid) {
        $existingProcess = Get-Process -Id $existingLock.pid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Warning "[!] PGH already running (PID: $($existingLock.pid), Port: $($existingLock.port))."
            Write-Host "Open browser: http://127.0.0.1:$($existingLock.port)/run-chat.html"
            exit 0
        } else {
            Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
        }
    }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EntryFile = Join-Path $ProjectRoot "apps\server\src\index.ts"
if (-not (Test-Path $EntryFile)) {
    Write-Error "Server entry not found: $EntryFile"
    exit 1
}

$LogDir = Join-Path $HOME ".pg_harness\logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogOutFile = Join-Path $LogDir "pgh-server-out.log"
$LogErrFile = Join-Path $LogDir "pgh-server-err.log"

Write-Host "[+] Starting Harness in background: http://127.0.0.1:$Port/run-chat.html"
Write-Host "[i] Project root: $ProjectRoot"
Write-Host "[i] Log out: $LogOutFile"
Write-Host "[i] Log err: $LogErrFile"

# 使用 cmd /c 重定向 + Start-Process -WindowStyle Hidden 完全脱离父管道，
# 不注册任何异步事件读取（避免 PowerShell 进程因子进程句柄/任务依赖而无法退出）。
$cmdArgs = "/c start `"PGH-Server`" /min /b node --experimental-strip-types `"$EntryFile`" --port $Port 1>>`"$LogOutFile`" 2>>`"$LogErrFile`""
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 800

# 通过端口探测拿到真实的 node 进程 PID（cmd /c start 后其自身很快退出，此 PID 用于展示与记录）
$nodePid = $null
try {
    $lines = & cmd.exe /c "netstat -ano -p tcp | findstr /R /C:`":$Port `"" 2>$null
    if ($lines) {
        foreach ($line in ($lines -split "`r?`n")) {
            $parts = $line.Trim() -split '\s+'
            if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
                $nodePid = $parts[4]
                break
            }
        }
    }
} catch { }

$displayPid = if ($nodePid) { $nodePid } else { $proc.Id }
Write-Host "[OK] PGH started in background (PID: $displayPid)."
Write-Host "[OK] URL: http://127.0.0.1:$Port/run-chat.html"

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port/run-chat.html"
}
