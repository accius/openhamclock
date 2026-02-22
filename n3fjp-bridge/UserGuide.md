# N3FJP UDP Bridge – User Guide

This guide explains how to install and run the N3FJP UDP Bridge using the provided Python script and PowerShell installer.

## Files Included

- `n3fjp_bridge.py` – Python bridge (TCP → UDP)
- `Install-N3FJPBridge.ps1` – PowerShell installer
- `Run-N3FJPBridge.vbs` – Optional hidden runner (created/used by the installer)
- `config.json` – Generated configuration (created by installer)
- `bridge.log` – Runtime log output

## Prerequisites

- Windows 10 / 11
- Python 3.9+ installed (with the `py` launcher)
- N3FJP Logger with TCP API enabled (port 1100)
- UDP consumer (Time Mapper Logger Feed, etc.) on port 12060

## Installation Steps

1. Install Python if needed: https://www.python.org/downloads/
2. If prompted about long paths, choose **y** to enable it and continue installation.
3. Create folder:
   ```
   C:\N3FJP_Proxy
   ```
4. Copy these files into `C:\N3FJP_Proxy`:
   - `n3fjp_bridge.py`
   - `Install-N3FJPBridge.ps1`
5. In N3FJP Logger:
   - Go to **Settings → Application Program Interface (API)**
   - Enable **TCP API Enabled (Server)** on **Port 1100**
6. Open **PowerShell as Administrator**
7. In PowerShell:
   ```powershell
   cd C:\N3FJP_Proxy
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\Install-N3FJPBridge.ps1
   ```
8. Wait for the installer to finish (it may take a minute or two).
9. Reboot, or run the scheduled task once to test.

## What the Installer Does

The installer will:

- Detect Python using the `py` launcher
- Detect your primary IPv4 address
- Scan your subnet for an active N3FJP TCP API (port 1100)
- Write `config.json`
- Create a Windows Scheduled Task named **N3FJP UDP Bridge**
  - Runs at login
  - Runs hidden
  - Runs with highest privileges
  - No execution time limit

## Time Mapper Setup (Optional)

If using Time Mapper UHD:

1. Open Time Mapper settings (top-right square → Settings)
2. Go to **Logger Feed**
3. Set:
   - UDP Receive IP: `127.0.0.1`
   - Port: `12060`
4. Enable the layer:
   - Layers → Ham Radio → Logger Feed
5. Open the Info Bar logger feed (example: type `IL` depending on your setup)

## Quick Verification

Open:

```
C:\N3FJP_Proxy\bridge.log
```

You should see something like:

```
Connected.
Sent SETUPDATESTATE TRUE
RX SETUPDATESTATERESPONSE VALUE=TRUE
```

Log a test QSO in N3FJP. You should see:

```
SENT UDP -> 127.0.0.1:12060
```

## Configuration File

If your N3FJP host cannot be auto-detected or the IP changes, edit:

```
C:\N3FJP_Proxy\config.json
```

Example:

```json
{
  "N3FJP_HOST": "192.168.1.43",
  "N3FJP_PORT": 1100,
  "MYCALL_FALLBACK": "",
  "UDP_DEST_IP": "127.0.0.1",
  "UDP_DEST_PORT": 12060,
  "LOG_PATH": "C:\\N3FJP_Proxy\\bridge.log",
  "Updated": "2026-01-12T09:06:19"
}
```

## Troubleshooting

- If the bridge does not connect, confirm N3FJP TCP API is enabled and reachable on port 1100.
- If Time Mapper does not show spots, confirm its UDP Logger Feed is enabled and set to `127.0.0.1:12060`.
- If needed, allow outbound TCP 1100 through Windows Firewall.

## Support

If something doesn’t go right, include your `bridge.log` when asking for help.
