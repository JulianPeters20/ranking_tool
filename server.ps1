<#
Steuert die lokalen Anwendungen:
  Ranking-Tool  Port 3000
  Voicebox      Backend-API 17493 + Weboberfläche 5173
  ComfyUI       Port 8188   (Generierungs-Engine für MiniMax H3)
  h3-studio     Port 3100   (Videoerzeugung, braucht ComfyUI)

  .\server.ps1 start   [all|ranking|voicebox|comfyui|h3-studio|h3|alles] [-NoBrowser]
  .\server.ps1 stop    [...]
  .\server.ps1 restart [...]
  .\server.ps1 status  [...]

"all" umfasst bewusst NUR Ranking-Tool und Voicebox. ComfyUI belegt beim
Laden rund 20 GB Arbeitsspeicher und fast das gesamte VRAM -- das soll nicht
nebenbei passieren, wenn jemand nur das Ranking-Tool starten will. Die
H3-Kette startet man gezielt mit "h3", oder mit "alles" zusammen mit dem Rest.

Die Server laufen unsichtbar im Hintergrund weiter, auch wenn dieses Fenster
geschlossen wird. Ihre Ausgaben landen in .run\<dienst>.log.
Doppelklick-Varianten: siehe die .cmd-Dateien im selben Ordner.
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status',

    [Parameter(Position = 1)]
    [ValidateSet('all', 'alles', 'ranking', 'voicebox', 'comfyui', 'h3-studio', 'h3')]
    [string]$Target = 'all',

    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
# Anpassen, falls die Programme an einem anderen Ort liegen.
$VoiceboxRoot = 'D:\Projects\voicebox'
$ComfyRoot = 'D:\Projects\ComfyUI'
$H3StudioRoot = 'D:\Projects\h3-studio'
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
        DependsOn   = 'voicebox-backend'   # ohne Backend ist die Oberfläche nutzlos
    }
    'comfyui'          = @{
        Name        = 'ComfyUI'
        Port        = 8188
        Health      = 'http://127.0.0.1:8188/system_stats'
        Url         = 'http://127.0.0.1:8188'
        WorkDir     = $ComfyRoot
        # --fast-disk gehoert dazu: hält die Modellgewichte aus dem anonymen
        # Speicher heraus. Ohne das Flag ist der Arbeitsspeicher schneller voll.
        Command     = "& '$ComfyRoot\.venv\Scripts\python.exe' main.py --fast-disk"
        Requires    = Join-Path $ComfyRoot '.venv\Scripts\python.exe'
        Processes   = @('python')
        Timeout     = 180  # lädt Torch/CUDA und prüft die Modellordner
        OpenBrowser = $false
    }
    'h3-studio'        = @{
        Name        = 'h3-studio'
        Port        = 3100
        # Bewusst /api/characters statt /api/health: health liefert absichtlich
        # 503, solange ComfyUI fehlt oder Modelle unvollständig sind. Hier soll
        # nur geprüft werden, ob der Dienst überhaupt antwortet -- ob er
        # generieren KANN, sagt "curl /api/health".
        Health      = 'http://127.0.0.1:3100/api/characters'
        Url         = 'http://127.0.0.1:3100/api/health'
        WorkDir     = $H3StudioRoot
        Command     = 'node server.js'
        Requires    = Join-Path $H3StudioRoot 'node_modules'
        Processes   = @('node')
        Timeout     = 30
        OpenBrowser = $false
        DependsOn   = 'comfyui'            # ohne Engine kann es nichts erzeugen
    }
}

$Groups = @{
    # "all" bleibt absichtlich bei Ranking-Tool und Voicebox -- siehe Kopf.
    all         = @('ranking', 'voicebox-backend', 'voicebox-web')
    alles       = @('ranking', 'voicebox-backend', 'voicebox-web', 'comfyui', 'h3-studio')
    ranking     = @('ranking')
    voicebox    = @('voicebox-backend', 'voicebox-web')
    comfyui     = @('comfyui')
    'h3-studio' = @('comfyui', 'h3-studio')   # h3-studio ohne Engine wäre sinnlos
    h3          = @('comfyui', 'h3-studio')
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
    # Welche Dienste sind fehlgeschlagen? Ein Dienst, dessen Voraussetzung
    # nicht läuft, wird übersprungen statt sinnlos gestartet -- welcher von
    # welchem abhängt, steht als DependsOn bei den Diensten selbst.
    $failed = @{}
    foreach ($key in $Keys) {
        $needs = $Services[$key].DependsOn
        if ($needs -and $failed.ContainsKey($needs)) {
            Write-Line ('  {0,-24} übersprungen ({1} läuft nicht)' -f $Services[$key].Name, $Services[$needs].Name) 'Yellow'
            $failed[$key] = $true
            continue
        }
        $ok = Start-AppService $key
        if (-not $ok) {
            $allOk = $false
            $failed[$key] = $true
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
