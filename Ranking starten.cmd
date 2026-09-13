@echo off
rem Startet nur das Ranking-Tool (Port 3000) und oeffnet den Browser.
rem Voicebox und die H3-Kette bleiben unberuehrt.
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" start ranking %*
echo.
pause
