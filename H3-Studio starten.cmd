@echo off
rem Startet die vollstaendige H3-Kette: erst ComfyUI (8188), dann h3-studio
rem (3100). h3-studio ohne ComfyUI koennte nichts erzeugen, deshalb beides.
rem
rem ACHTUNG: belegt rund 20 GB Arbeitsspeicher und fast das gesamte VRAM.
rem Ein 5-Sekunden-Clip braucht auf diesem PC gut fuenf Minuten.
rem
rem Danach pruefen:  curl http://127.0.0.1:3100/api/health
rem Erwartet wird "ok": true -- erst dann kann erzeugt werden.
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" start h3 %*
echo.
pause
