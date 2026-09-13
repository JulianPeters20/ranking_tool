@echo off
rem Beendet nur das Ranking-Tool (Port 3000).
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" stop ranking %*
echo.
pause
