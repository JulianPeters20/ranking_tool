<#
Steuert die lokalen Webanwendungen: Ranking-Tool (Port 3000) und Voicebox
(Backend-API 17493 + Weboberfläche 5173).

  .\server.ps1 start   [all|ranking|voicebox] [-NoBrowser]
  .\server.ps1 stop    [all|ranking|voicebox]
  .\server.ps1 restart [all|ranking|voicebox] [-NoBrowser]
  .\server.ps1 status  [all|ranking|voicebox]

Die Server laufen unsichtbar im Hintergrund weiter, auch wenn dieses Fenster
geschlossen wird. Ihre Ausgaben landen in .run\<dienst>.log.
Doppelklick-Varianten: "Server starten.cmd" / "Server stoppen.cmd".
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status',

    [Parameter(Position = 1)]
    [ValidateSet('all', 'ranking', 'voicebox')]
    [string]$Target = 'all',

    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
# Anpassen, falls Voicebox an einem anderen Ort liegt.
$VoiceboxRoot = 'D:\Projects\voicebox'
$RunDir = Join-Path $RepoRoot '.run'

# Kind-Prozesse bevorzugt mit PowerShell 7 starten (UTF-8-Logdateien).
$Shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

$Services = [ordered]@{
    'ranking'          = @{
        Name        = 'Ranking-Tool'
        Port        = 3000
        Health      = 'http://127.0.0.1:3000/api/settings'
        Url         = 'http://localhost:3000'
        WorkDir     = $RepoRoot
        Command     = 'node server.js'
        Requires    = Join-Path $RepoRoot 'node_modules'
        Processes   = @('node')
        Timeout     = 30
        OpenBrowser = $true
    }
    'voicebox-backend' = @{
        Name        = 'Voicebox-Backend (API)'
        Port        = 17493
        Health      = 'http://127.0.0.1:17493/health'
        Url         = 'http://127.0.0.1:17493/docs'
        WorkDir     = $VoiceboxRoot
        Command     = "& '$VoiceboxRoot\start-backend.ps1'"
        Requires    = Join-Path $VoiceboxRoot 'backend\venv\Scripts\python.exe'
        Processes   = @('python')
        Timeout     = 120   # laedt beim Start PyTorch/CUDA -- dauert einige Sekunden
        OpenBrowser = $false
    }
    'voicebox-web'     = @{
        Name        = 'Voicebox-Oberfläche'
        Port        = 5173
        # "localhost", nicht 127.0.0.1: Vite lauscht je nach System nur auf ::1.
        Health      = 'http://localhost:5173/'
        Url         = 'http://localhost:5173'
        WorkDir     = $VoiceboxRoot
        Command     = "& '$VoiceboxRoot\start-web.ps1'"
        Requires    = Join-Path $VoiceboxRoot 'web\node_modules'
        Processes   = @('node', 'bun')
        Timeout     = 60
        OpenBrowser = $true
    }
}

$Groups = @{
    all      = @('ranking', 'voicebox-backend', 'voicebox-web')
    ranking  = @('ranking')
    voicebox = @('voicebox-backend', 'voicebox-web')
}

function Write-Line([string]$Text, [string]$Color = 'Gray') {
    Write-Host $Text -ForegroundColor $Color
}

# Prozesse, die auf dem Port lauschen, mit Namen (fuer die Sicherheitspruefung).
function Get-Listeners([int]$Port) {
    $ids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -gt 0 })
    foreach ($id in $ids) {
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        [pscustomobject]@{ Id = $id; Name = if ($proc) { $proc.ProcessName } else { '?' } }
    }
}

function Test-Healthy($Svc) {
    try {
        $res = Invoke-WebRequest -Uri $Svc.Health -UseBasicParsing -TimeoutSec 3
        return $res.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Get-PidFile([string]$Key) { Join-Path $RunDir "$Key.pid" }
function Get-LogFile([string]$Key) { Join-Path $RunDir "$Key.log" }

# /T beendet auch alle Kind-Prozesse (pwsh -> node/python/bun -> vite).
function Stop-Tree([int]$ProcessId) {
    & taskkill.exe /PID $ProcessId /T /F *> $null
}

# Die gespeicherte PID nur verwenden, wenn sie noch zu dem von uns gestarteten
# versteckten PowerShell-Prozess gehoert -- nach einem Neustart des Rechners
# koennte dieselbe Nummer einem ganz anderen Programm gehoeren.
function Get-SavedPid([string]$Key) {
    $pidFile = Get-PidFile $Key
    if (-not (Test-Path $pidFile)) { return $null }
    try {
        $saved = [int](Get-Content $pidFile -Raw).Trim()
        $proc = Get-Process -Id $saved -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.ProcessName -notin @('pwsh', 'powershell')) { return $null }
        $age = [Math]::Abs(($proc.StartTime - (Get-Item $pidFile).LastWriteTime).TotalSeconds)
        if ($age -gt 30) { return $null }
        return $saved
    } catch {
        return $null
    }
}

function Start-AppService([string]$Key) {
    $svc = $Services[$Key]
    $label = '  {0,-24}' -f $svc.Name

    $listeners = @(Get-Listeners $svc.Port)
    if ($listeners) {
        $foreign = @($listeners | Where-Object { $_.Name -notin $svc.Processes })
        if ($foreign) {
            Write-Line ("$label Port $($svc.Port) ist von einem anderen Programm belegt ({0}) -- nicht gestartet" -f ($foreign.Name -join ', ')) 'Red'
            return $false
        }
        Write-Line "$label läuft bereits  -> $($svc.Url)" 'Yellow'
        return $true
    }
    if (-not (Test-Path $svc.Requires)) {
        Write-Line "$label nicht eingerichtet (fehlt: $($svc.Requires))" 'Red'
        return $false
    }

    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $log = Get-LogFile $Key
    # Die Ausgabe leitet der versteckte Kind-Prozess selbst in die Logdatei um.
    # Start-Process -RedirectStandardOutput ginge nur mit -NoNewWindow -- dann
    # haengt der Server an diesem Fenster und stirbt beim Schliessen mit.
    # OutputEncoding: Programmausgaben (node, bun, python) als UTF-8 lesen --
    # sonst wird z.B. Vites "➜" mit der alten Konsolen-Codepage zu "Ô×£".
    $inner = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Set-Location -LiteralPath '$($svc.WorkDir)'; $($svc.Command) *> '$log'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    $proc = Start-Process -FilePath $Shell `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" `
        -WindowStyle Hidden -PassThru
    Set-Content -Path (Get-PidFile $Key) -Value $proc.Id

    Write-Host "$label startet ..." -NoNewline
    $deadline = (Get-Date).AddSeconds($svc.Timeout)
    while ((Get-Date) -lt $deadline) {
        if (Test-Healthy $svc) {
            Write-Line " läuft  -> $($svc.Url)" 'Green'
            return $true
        }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 800
    }

    Write-Line ' FEHLER' 'Red'
    if (Test-Path $log) {
        Write-Line "    Letzte Zeilen aus $($log):"
        Get-Content $log -Tail 8 | ForEach-Object { Write-Line "    $_" 'DarkGray' }
    }
    return $false
}

function Stop-AppService([string]$Key) {
    $svc = $Services[$Key]
    $label = '  {0,-24}' -f $svc.Name

    $listeners = @(Get-Listeners $svc.Port)
    $foreign = @($listeners | Where-Object { $_.Name -notin $svc.Processes })
    $targets = @($listeners | Where-Object { $_.Name -in $svc.Processes } | ForEach-Object { $_.Id })
    $saved = Get-SavedPid $Key
    if ($saved) { $targets += $saved }
    Remove-Item (Get-PidFile $Key) -Force -ErrorAction SilentlyContinue

    if ($foreign) {
        Write-Line ("$label Port $($svc.Port) gehört einem anderen Programm ({0}) -- nicht angefasst" -f ($foreign.Name -join ', ')) 'Yellow'
    }
    if (-not $targets) {
        if (-not $foreign) { Write-Line "$label war nicht gestartet" 'DarkGray' }
        return
    }

    foreach ($id in ($targets | Select-Object -Unique)) { Stop-Tree $id }

    $deadline = (Get-Date).AddSeconds(10)
    while ((@(Get-Listeners $svc.Port) | Where-Object { $_.Name -in $svc.Processes }) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
    }
    if (@(Get-Listeners $svc.Port) | Where-Object { $_.Name -in $svc.Processes }) {
        Write-Line "$label konnte nicht beendet werden" 'Red'
    } else {
        Write-Line "$label gestoppt" 'Green'
    }
}

function Show-Status([string[]]$Keys) {
    foreach ($key in $Keys) {
        $svc = $Services[$key]
        $label = '  {0,-24}' -f $svc.Name
        $listeners = @(Get-Listeners $svc.Port)
        if (-not $listeners) {
            Write-Line "$label gestoppt" 'DarkGray'
        } elseif (@($listeners | Where-Object { $_.Name -notin $svc.Processes })) {
            Write-Line "$label Port $($svc.Port) von anderem Programm belegt ($($listeners.Name -join ', '))" 'Yellow'
        } elseif (Test-Healthy $svc) {
            Write-Line "$label läuft      -> $($svc.Url)" 'Green'
        } else {
            Write-Line "$label startet noch bzw. antwortet nicht (Port $($svc.Port))" 'Yellow'
        }
    }
}

function Invoke-Start([string[]]$Keys) {
    Write-Line 'Starte ...'
    $allOk = $true
    $toOpen = @()
    $backendFailed = $false
    foreach ($key in $Keys) {
        # Die Voicebox-Oberflaeche ist ohne Backend nutzlos.
        if ($key -eq 'voicebox-web' -and $backendFailed) {
            Write-Line ('  {0,-24} übersprungen (Backend läuft nicht)' -f $Services[$key].Name) 'Yellow'
            continue
        }
        $ok = Start-AppService $key
        if (-not $ok) {
            $allOk = $false
            if ($key -eq 'voicebox-backend') { $backendFailed = $true }
        } elseif ($Services[$key].OpenBrowser -and -not $NoBrowser) {
            $toOpen += $Services[$key].Url
        }
    }
    foreach ($url in $toOpen) { Start-Process $url }
    return $allOk
}

function Invoke-Stop([string[]]$Keys) {
    Write-Line 'Stoppe ...'
    # Umgekehrte Reihenfolge: erst die Oberflaeche, dann das Backend.
    [array]::Reverse($Keys)
    foreach ($key in $Keys) { Stop-AppService $key }
}

$keys = @($Groups[$Target])
$exitCode = 0
switch ($Action) {
    'status' {
        Write-Line 'Status:'
        Show-Status $keys
    }
    'stop' {
        Invoke-Stop @($keys)
    }
    'start' {
        if (-not (Invoke-Start $keys)) { $exitCode = 1 }
    }
    'restart' {
        Invoke-Stop @($keys)
        if (-not (Invoke-Start $keys)) { $exitCode = 1 }
    }
}
if ($Action -ne 'status') {
    Write-Line "Logs: $RunDir" 'DarkGray'
}
exit $exitCode
