@echo off
rem ==============================================================================
rem PGH Background Start - Zero-hang native batch (No PowerShell escaping traps)
rem ==============================================================================
setlocal enabledelayedexpansion

set PORT=%1
if "%PORT%"=="" set PORT=3210

set "PROJECT_ROOT=%~dp0.."
set "ENTRY_FILE=%PROJECT_ROOT%\apps\server\src\index.ts"
set "LOG_DIR=%USERPROFILE%\.pg_harness\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [+] Starting Harness in background on port %PORT%...
cd /d "%PROJECT_ROOT%"

rem 使用 start /B 原生分离子进程，执行即走，0 毫秒阻塞
start "PGH_SERVER" /B node --experimental-strip-types "%ENTRY_FILE%" --port %PORT% > "%LOG_DIR%\pgh-stdout.log" 2> "%LOG_DIR%\pgh-stderr.log"

echo [OK] PGH server spawned on port %PORT%.
echo [OK] URL: http://127.0.0.1:%PORT%/run-chat.html
