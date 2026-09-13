@echo off
rem Beendet die H3-Kette: erst h3-studio (3100), dann ComfyUI (8188).
rem Gibt rund 20 GB Arbeitsspeicher und das VRAM wieder frei.
rem
rem Ein laufender Erzeugungsauftrag geht dabei verloren.
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" stop h3 %*
echo.
pause
