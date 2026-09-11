@echo off
rem Startet Ranking-Tool und Voicebox im Hintergrund und oeffnet den Browser.
rem Nur das Ranking-Tool: server.ps1 start ranking
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" start %*
echo.
pause
