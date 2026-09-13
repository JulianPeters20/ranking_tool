@echo off
rem Beendet Voicebox: erst die Oberflaeche (5173), dann das Backend (17493).
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" stop voicebox %*
echo.
pause
