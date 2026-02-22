<# 
Install-N3FJPBridge.ps1
Version: 1.0.1 (action/working-dir fix)

What it does:
- Ensures C:\N3FJP_Proxy exists
- Detects Python via 'py' launcher (preferred), else tries 'python'
- Auto-detects N3FJP host by scanning local /24 for TCP 1100 (unless -N3FJPHost provided)
- Writes config.json (UTF-8 no BOM) into InstallDir
- Creates Scheduled Task (AtLogOn, runs as current user) using a wrapper .cmd

Run from an elevated PowerShell:
  PowerShell (Admin) -> cd C:\N3FJP_Proxy -> .\Install-N3FJPBridge.ps1

If scripts are blocked:
  PowerShell (Admin): Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

param(
  [string]$N3FJPHost = "",                 # optional override
  [int]$N3FJPPort = 1100,
  [string]$MyCall = "",                    # optional override
  [string]$InstallDir = "C:\N3FJP_Proxy",
  [string]$ScriptName = "n3fjp_bridge.py",
  [string]$TaskName = "N3FJP UDP Bridge",
  [int]$ScanTimeoutMs = 250                # per-IP connect timeout
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) {
  $ts = (Get-Date).ToString("s")
  Write-Host "$ts $msg"
}

function Ensure-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run PowerShell as Administrator."
  }
}

function Get-PythonExe {
  # Prefer 'py' launcher
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $exe = & $py.Source -c "import sys, os; print(sys.executable)"
    $exe = $exe.Trim()

    $pythonw = Join-Path (Split-Path $exe) "pythonw.exe"
    if (Test-Path $pythonw) {
      return $pythonw
    }

    if (Test-Path $exe) {
      return $exe
    }
  }

  # Fallback to python / pythonw on PATH
  $pythonw = Get-Command pythonw -ErrorAction SilentlyContinue
  if ($pythonw) { return $pythonw.Source }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return $python.Source }

  throw "Python not found. Install Python (with py launcher) and try again."
}

function Get-PrimaryIPv4 {
  $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
           Sort-Object -Property RouteMetric, InterfaceMetric |
           Select-Object -First 1
  if (-not $route) { return $null }

  $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
        Where-Object { $_.IPAddress -notmatch "^169\.254\." -and $_.IPAddress -ne "127.0.0.1" } |
        Select-Object -First 1

  return $ip.IPAddress
}

function Test-TcpPortFast([string]$TargetHost, [int]$Port, [int]$TimeoutMs) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($TargetHost, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($iar) | Out-Null
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Discover-N3FJPHost([int]$Port, [int]$TimeoutMs) {
  $localIp = Get-PrimaryIPv4
  if (-not $localIp) { throw "Could not determine primary IPv4 address." }

  $parts = $localIp.Split(".")
  if ($parts.Count -ne 4) { throw "Unexpected IPv4 format: $localIp" }

  $prefix = "$($parts[0]).$($parts[1]).$($parts[2])."
  Write-Info "Primary IPv4 detected: $localIp"
  Write-Info "Scanning subnet: ${prefix}1-254 for TCP $Port (timeout ${TimeoutMs}ms)..."

  $hits = @()
  for ($i=1; $i -le 254; $i++) {
    $ipAddr = "$prefix$i"
    if ($ipAddr -eq $localIp) { continue }

    if (Test-TcpPortFast -TargetHost $ipAddr -Port $Port -TimeoutMs $TimeoutMs) {
      Write-Info "FOUND: ${ipAddr}:${Port}"
      $hits += $ipAddr
    }
  }

  return $hits
}

function Ensure-InstallDir([string]$Dir) {
  if (-not (Test-Path $Dir)) {
    New-Item -ItemType Directory -Path $Dir | Out-Null
  }
}

function Write-Config(
  [string]$Path,
  [string]$N3FJPHostValue,
  [int]$Port,
  [string]$MyCallValue,
  [string]$LogPathValue
) {
  $cfg = [ordered]@{
    N3FJP_HOST      = $N3FJPHostValue
    N3FJP_PORT      = $Port
    MYCALL_FALLBACK = $MyCallValue
    UDP_DEST_IP     = "127.0.0.1"
    UDP_DEST_PORT   = 12060
	ENABLE_OHC_HTTP = $false
    OHC_BASE_URL = "http://localhost:3000"
    OHC_API_KEY = ""
    LOG_PATH        = $LogPathValue
    Updated         = (Get-Date).ToString("s")
  }

  $json = $cfg | ConvertTo-Json -Depth 3

  # Write UTF-8 WITHOUT BOM (Windows PowerShell 5.1 + PowerShell 7+)
  [System.IO.File]::WriteAllText(
    $Path,
    $json,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Create-Or-UpdateTask(
  [string]$TaskNameValue,
  [string]$PythonExe,
  [string]$ScriptPath,
  [string]$WorkingDir
) {
  # Ensure we use pythonw.exe if available (no console)
  $pythonDir = Split-Path $PythonExe -Parent
  $pythonW   = Join-Path $pythonDir "pythonw.exe"
  if (Test-Path $pythonW) { $PythonExe = $pythonW }

  # Create a hidden runner .vbs (this is what actually prevents any window)
  $vbsPath = Join-Path $WorkingDir "Run-N3FJPBridge.vbs"

  $vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$WorkingDir"
cmd = """" & "$PythonExe" & """ """ & "$ScriptPath" & """"
sh.Run cmd, 0, False
"@

  # VBS should be ASCII/ANSI-safe
  Set-Content -Path $vbsPath -Value $vbs -Encoding Ascii
  Write-Info "Hidden runner: $vbsPath"
  Write-Info "Python used: $PythonExe"

  # ---- De-dupe: remove any prior tasks with this name ----
  Write-Info "Removing task (by name if exists): $TaskNameValue"
  Unregister-ScheduledTask -TaskName $TaskNameValue -Confirm:$false -ErrorAction SilentlyContinue

  # Build scheduled task action (NO cmd.exe)
  $wscript = Join-Path $env:windir "System32\wscript.exe"
  $action  = New-ScheduledTaskAction `
    -Execute $wscript `
    -Argument ("//B //NoLogo `"{0}`"" -f $vbsPath) `
    -WorkingDirectory $WorkingDir

  # Trigger at logon for THIS user
  $fullUser = "$env:USERDOMAIN\$env:USERNAME"
  $trigger  = New-ScheduledTaskTrigger -AtLogOn -User $fullUser

  # Settings: allow on battery, don't stop on battery, ignore duplicates
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  try { $settings.MultipleInstances = "IgnoreNew" } catch {}
  try { $settings.AllowHardTerminate = $false } catch {}

  # Principal: run as the interactive user
  $principal = New-ScheduledTaskPrincipal -UserId $fullUser -LogonType Interactive -RunLevel Highest

  $taskObj = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal

  Write-Info "Creating/updating scheduled task: $TaskNameValue"
  Register-ScheduledTask -TaskName $TaskNameValue -InputObject $taskObj -Force | Out-Null

  # Patch ExecutionTimeLimit to PT0S (no limit) using COM (avoids XML quirks)
  try {
    $svc = New-Object -ComObject "Schedule.Service"
    $svc.Connect()
    $folder = $svc.GetFolder("\")
    $task   = $folder.GetTask("\$TaskNameValue")
    $def    = $task.Definition
    $def.Settings.ExecutionTimeLimit = "PT0S"
    # 6 = TASK_CREATE_OR_UPDATE, 3 = TASK_LOGON_INTERACTIVE_TOKEN
    $folder.RegisterTaskDefinition("\$TaskNameValue", $def, 6, $fullUser, $null, 3) | Out-Null
    Write-Info "Patched ExecutionTimeLimit to PT0S (no time limit)."
  } catch {
    Write-Info "WARNING: Could not patch ExecutionTimeLimit via COM: $($_.Exception.Message)"
  }

  Write-Info "Task created."
}

# ------------------- MAIN -------------------
Ensure-Admin
Ensure-InstallDir $InstallDir

$pythonExe = Get-PythonExe
Write-Info "Python detected: $pythonExe"

$scriptPath = Join-Path $InstallDir $ScriptName
if (-not (Test-Path $scriptPath)) {
  throw "Bridge script not found: $scriptPath`nPlace '$ScriptName' in $InstallDir first."
}

$configPath = Join-Path $InstallDir "config.json"
$logPath    = Join-Path $InstallDir "bridge.log"

# Determine N3FJP host
if ($N3FJPHost -and $N3FJPHost.Trim() -ne "") {
  $chosen = $N3FJPHost.Trim()
  Write-Info "Using N3FJP host override: $chosen"
} else {
  $hits = @(Discover-N3FJPHost -Port $N3FJPPort -TimeoutMs $ScanTimeoutMs)
  Write-Info ("Scan results: count={0} hits={1}" -f $hits.Count, ($hits -join ","))

  if ($hits.Count -eq 0) {
    Write-Info "No hosts found with TCP $N3FJPPort open."
    $chosen = Read-Host "Enter the N3FJP Logger IP (e.g. 192.168.1.43)"
  } elseif ($hits.Count -eq 1) {
    $chosen = [string]$hits[0]
    Write-Info "Auto-detected N3FJP host: $chosen"
  } else {
    Write-Info "Multiple possible N3FJP hosts found:"
    for ($i=0; $i -lt $hits.Count; $i++) {
      Write-Host "  [$i] $($hits[$i])"
    }
    $idx = Read-Host "Select index"
    if ($idx -notmatch '^\d+$' -or [int]$idx -ge $hits.Count) {
      throw "Invalid selection."
    }
    $chosen = $hits[[int]$idx]
    Write-Info "Selected N3FJP host: $chosen"
  }
}

Write-Config -Path $configPath -N3FJPHostValue $chosen -Port $N3FJPPort -MyCallValue $MyCall -LogPathValue $logPath
Write-Info "Wrote config: $configPath"

Create-Or-UpdateTask -TaskNameValue $TaskName -PythonExe $pythonExe -ScriptPath $scriptPath -WorkingDir $InstallDir

Write-Info "Done."
Write-Info "Next: ensure N3FJP TCP API is enabled on ${chosen}:${N3FJPPort}, then log off/on (or reboot) to test."
