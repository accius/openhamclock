# N3FJP UDP Bridge (Windows)

This bridge connects **N3FJP Logger (TCP API)** to UDP consumers such as **Time Mapper** and **OpenHamClock** integrations.

It listens to the N3FJP TCP API (default **1100**) and forwards QSO updates via UDP (default **12060**).

This bridge is optional and runs independently of OpenHamClock.

---

## Requirements

- Windows 10/11
- Python 3.9+ (installed with the `py` launcher)
- N3FJP Logger with **TCP API enabled** (default port 1100)
- A UDP consumer (Time Mapper Logger Feed, etc.) listening on UDP port 12060

---

## Quick Install

1. Create folder:

   ```
   C:\N3FJP_Proxy
   ```

2. Copy these files into that folder:
   - `n3fjp_bridge.py`
   - `Install-N3FJPBridge.ps1`

3. In N3FJP, enable:
   **Settings → Application Program Interface (API) → TCP API Enabled (Server) Port 1100**

4. Open **PowerShell as Administrator** and run:

   ```powershell
   cd C:\N3FJP_Proxy
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\Install-N3FJPBridge.ps1
   ```

5. Reboot (or run the scheduled task once to test).

---

## Default Ports

- N3FJP TCP API: **1100**
- UDP destination: **127.0.0.1:12060**

---

## Verify

Open:

```
C:\N3FJP_Proxy\bridge.log
```

Look for:

```
Connected.
Sent SETUPDATESTATE TRUE
RX SETUPDATESTATERESPONSE VALUE=TRUE
```

Then log a test QSO and look for:

```
SENT UDP -> 127.0.0.1:12060
```

---

## Configuration

The installer creates:

```
C:\N3FJP_Proxy\config.json
```

If auto-detect fails or your N3FJP IP changes, edit `N3FJP_HOST`.

---

## Full Guide

See `UserGuide.md`.
