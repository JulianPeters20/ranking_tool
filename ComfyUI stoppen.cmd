@echo off
rem Beendet nur ComfyUI (Port 8188) und gibt Arbeitsspeicher und VRAM frei.
rem
rem Hinweis: h3-studio laeuft danach zwar weiter, kann aber nichts mehr
rem erzeugen -- "/api/health" meldet dann 503. Um beides zu beenden:
rem "H3-Studio stoppen.cmd".
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" stop comfyui %*
echo.
pause
