@echo off
rem Startet nur Voicebox: Backend-API (17493) und Weboberflaeche (5173).
rem Das Backend laedt beim Start PyTorch/CUDA -- das dauert einen Moment.
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" start voicebox %*
echo.
pause
