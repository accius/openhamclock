# OpenHamClock Rig Daemon Installation

This directory contains scripts to install the **Rig Control Daemon** as a background service on Linux, macOS, and Windows.

## Prerequisite
- **Node.js** must be installed on your system.

## Linux (systemd)
Installs as a user-level systemd service (`openhamclock-rig`).

1. Open a terminal.
2. Navigate to `rig-control/scripts/linux`.
3. Run the installer:
   ```bash
   chmod +x install.sh
   sudo ./install.sh
   ```
4. **Manage Service**:
   - Status: `sudo systemctl status openhamclock-rig`
   - Data Log: `journalctl -u openhamclock-rig -f`
   - Stop: `sudo systemctl stop openhamclock-rig`

## macOS (launchd)
Installs as a LaunchAgent (`com.openhamclock.rig`) for the current user.

1. Open Terminal.
2. Navigate to `rig-control/scripts/mac`.
3. Run the installer:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
4. **Manage Service**:
   - The Log file is located at `rig-control/daemon.log`.
   - Stop: `launchctl unload ~/Library/LaunchAgents/com.openhamclock.rig.plist`

## Windows (Task Scheduler)
Installs as a Scheduled Task that runs at logon (hidden window).

1. Open PowerShell as Administrator (optional, but recommended for task registration).
2. Navigate to `rig-control/scripts/windows`.
3. Run the installer:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\install.ps1
   ```
4. **Manage Service**:
   - Open **Task Scheduler** and look for `OpenHamClockRigDaemon`.
   - You can manually Start/End the task from there.

---
**Note:** The daemon listens on port **4532** by default. Ensure this port is allowed in your firewall if accessing from another machine.
