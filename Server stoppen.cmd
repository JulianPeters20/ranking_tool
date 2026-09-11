@echo off
rem Beendet Ranking-Tool und Voicebox (alle drei Hintergrund-Server).
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" stop %*
echo.
pause
