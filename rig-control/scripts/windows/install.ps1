<#
.SYNOPSIS
Installs OpenHamClock Rig Daemon as a background task on Windows.

.DESCRIPTION
This script installs dependencies and creates a Scheduled Task to run the daemon
at user logon with a hidden window.
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RigDir = Resolve-Path "$ScriptDir\..\.."
$NodeExe = Get-Command node -ErrorAction SilentlyContinue

Write-Host "Installing OpenHamClock Rig Daemon for Windows..."
Write-Host "Rig Directory: $RigDir"

# Check for Node.js
if ($null -eq $NodeExe) {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js."
    exit 1
}

# Install dependencies
Write-Host "Installing NPM dependencies..."
Set-Location $RigDir
npm install

# Create VBS launcher to hide console window
$VbsPath = Join-Path $RigDir "launch_daemon.vbs"
$DaemonScript = Join-Path $RigDir "rig-daemon.js"
$VbsContent = "Set WshShell = CreateObject(""WScript.Shell"")" + [Environment]::NewLine + `
              "WshShell.Run ""node """"$DaemonScript"""""", 0, False"

Set-Content -Path $VbsPath -Value $VbsContent
Write-Host "Created launcher script: $VbsPath"

# Create Scheduled Task
$TaskName = "OpenHamClockRigDaemon"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$VbsPath"""
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0

Write-Host "Registering Scheduled Task: $TaskName"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Trigger $Trigger -Action $Action -Principal $Principal -Settings $Settings

Write-Host "--------------------------------------------------"
Write-Host "Success! The rig daemon handles have been installed."
Write-Host "It will start automatically when you log in."
Write-Host "To start it now, run: Start-ScheduledTask -TaskName $TaskName"
Write-Host "--------------------------------------------------"
