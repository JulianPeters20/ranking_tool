@echo off
rem Startet nur ComfyUI (Port 8188) mit --fast-disk.
rem
rem ACHTUNG: ComfyUI belegt beim Laden der H3-Modelle rund 20 GB
rem Arbeitsspeicher und fast das gesamte VRAM. Waehrend ein Clip erzeugt wird,
rem ist der Rechner kaum noch fuer anderes zu gebrauchen.
rem
rem Der Start dauert etwa 40 Sekunden (Torch/CUDA laden).
chcp 65001 >nul
where pwsh >nul 2>nul && set "PS=pwsh" || set "PS=powershell"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" start comfyui %*
echo.
pause
