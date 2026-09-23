@echo off
rem ==============================================================================
rem PGH Stop - Zero-hang native batch (Instant kill, No PowerShell pipeline traps)
rem ==============================================================================
setlocal enabledelayedexpansion

set PORT=%1
if "%PORT%"=="" set PORT=3210

set "LOCK_FILE=%USERPROFILE%\.pg_harness\.lock"

rem 1. 彻底清理锁文件
if exist "%LOCK_FILE%" del /f /q "%LOCK_FILE%" >nul 2>nul

rem 2. 单行根据端口通过 netstat 查找 PID 并瞬时强杀，0 秒阻塞
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /R /C:":%PORT% " ^| findstr "LISTENING"') do (
    if not "%%a"=="" if not "%%a"=="0" (
        echo [i] Killing process on port %PORT% (PID: %%a)...
        taskkill /pid %%a /T /F >nul 2>nul
    )
)

echo [OK] Port %PORT% freed and lock removed.
