# 📻 OpenHamClock Rig Control Solutions — Comparison Guide

OpenHamClock offers **three different solutions** for connecting your radio to the web application. Each serves different use cases and technical requirements.

---

## Quick Decision Guide

**Choose based on your setup:**

| Your Situation | Recommended Solution |
|----------------|---------------------|
| 🎯 **I want the simplest setup** | **Rig Listener** — One download, one click |
| 🔌 **I already use flrig or rigctld** | **Rig Control Daemon** — Works with existing setup |
| 🌐 **I need a web UI to configure my radio** | **Rig Bridge** — Browser-based configuration |
| 🏠 **Radio is on a different computer** | **Rig Bridge** or **Rig Control Daemon** — Network accessible |
| 🐧 **Running on Raspberry Pi** | **Rig Control Daemon** — Lightweight, proven |

---

## Solution Comparison

### 1️⃣ Rig Listener (Newest — Recommended for Most Users)

**What it is:** A standalone executable that connects directly to your radio via USB. No dependencies, no configuration files, no web server.

**Best for:**
- First-time users who want zero hassle
- Users who don't need flrig/rigctld for other apps
- Portable/field operation (single executable)

**Pros:**
- ✅ **Easiest setup** — Interactive wizard on first run
- ✅ **Single executable** — No Node.js installation required
- ✅ **Direct USB connection** — No intermediate software needed
- ✅ **Remembers settings** — Config saved automatically
- ✅ **Small footprint** — ~30MB executable

**Cons:**
- ❌ No web UI for configuration (CLI wizard only)
- ❌ **USB port exclusivity** — Cannot share radio with other apps simultaneously (WSJT-X, fldigi, etc.)
- ❌ Must run on same computer as radio USB connection

> [!WARNING]
> **USB Port Limitation**: When using direct USB connection, only ONE application can access the serial port at a time. If you need to use WSJT-X, fldigi, or other CAT control software alongside OpenHamClock, use **Rig Control Daemon** with flrig/rigctld instead — they can share the radio among multiple applications.

**Supported Radios:**
- Yaesu (FT-991A, FT-891, FT-710, FT-DX10, FT-817/818)
- Kenwood (TS-590, TS-890, TS-480, TS-2000)
- Elecraft (K3, K4, KX3, KX2)
- Icom (IC-7300, IC-7610, IC-705, IC-9700)

**Setup:**
```bash
# Download executable, then:
./rig-listener-mac-arm64    # Mac
rig-listener-win-x64.exe    # Windows
./rig-listener-linux-x64    # Linux

# Follow wizard prompts
# Done! Runs on http://localhost:5555
```

**When to use:**
- You want to get started in under 2 minutes
- You don't use flrig/rigctld for other applications
- You value simplicity over advanced features

---

### 2️⃣ Rig Bridge (Feature-Rich)

**What it is:** A web-based rig control server with a browser configuration UI. Connects directly to your radio via USB **or** can proxy to flrig/rigctld.

**Best for:**
- Users who want a web UI to configure their radio
- Network setups (radio on one computer, OpenHamClock on another)
- Users who need to switch between radios frequently

**Pros:**
- ✅ **Web-based configuration** — Configure via browser at http://localhost:5555
- ✅ **Direct USB or proxy mode** — Works with or without flrig/rigctld
- ✅ **Network accessible** — Can run on a different computer
- ✅ **Visual port selection** — See all available COM ports in browser
- ✅ **Live status display** — Real-time frequency/mode display in web UI

**Cons:**
- ❌ Requires Node.js (or download pre-built executable)
- ❌ More complex than Rig Listener
- ❌ Slightly larger resource footprint
- ❌ **USB port exclusivity** (when using direct USB mode) — Cannot share radio with other apps

**Supported Radios:**
- Same as Rig Listener (Yaesu, Kenwood, Icom, Elecraft)
- **Plus:** Can proxy to flrig/rigctld for any radio they support

**Setup:**
```bash
cd rig-bridge
npm install
node rig-bridge.js

# Open http://localhost:5555 in browser
# Select radio type and COM port
# Click "Save & Connect"
```

**When to use:**
- You prefer GUI configuration over CLI
- You want to access rig control from multiple devices on your network
- You need to frequently switch between different radios
- You want a visual confirmation of connection status

---

### 3️⃣ Rig Control Daemon (Original — Most Flexible)

**What it is:** A lightweight Node.js service that acts as a bridge between OpenHamClock and **existing** rig control software (flrig or rigctld).

**Best for:**
- Users who already run flrig or rigctld for other applications
- Advanced users who want maximum control via config files
- Raspberry Pi / headless server deployments
- Integration with existing HAMlib-based workflows

**Pros:**
- ✅ **Works with existing setup** — No need to change your current rig control
- ✅ **Lightweight** — Minimal resource usage
- ✅ **Flexible configuration** — JSON config file with all options
- ✅ **Battle-tested** — Original solution, most mature codebase
- ✅ **Remote access** — Binds to 0.0.0.0 by default for network access

**Cons:**
- ❌ **Requires flrig or rigctld** — Cannot connect directly to radio
- ❌ Requires Node.js installation
- ❌ Manual configuration (edit JSON file)
- ❌ No built-in web UI

**Supported Backends:**
- **rigctld** (HAMlib) — Supports 300+ radio models
- **flrig** — Popular GUI rig control software
- **mock** — Simulation mode for testing

**Setup:**
```bash
cd rig-control
npm install

# Edit rig-config.json:
{
  "radio": {
    "type": "flrig",      // or "rigctld"
    "host": "127.0.0.1",
    "port": 12345         // flrig default, rigctld uses 4532
  }
}

node rig-daemon.js
```

**When to use:**
- You already use flrig or rigctld for WSJT-X, fldigi, etc.
- You want to share radio control across multiple applications
- You're running on a Raspberry Pi or headless server
- You need maximum flexibility and don't mind config files

---

## Technical Comparison

| Feature | Rig Listener | Rig Bridge | Rig Control Daemon |
|---------|--------------|------------|-------------------|
| **Direct USB** | ✅ Yes | ✅ Yes | ❌ No (needs flrig/rigctld) |
| **Web UI** | ❌ No | ✅ Yes | ❌ No |
| **Standalone Executable** | ✅ Yes | ✅ Yes (optional) | ❌ No |
| **Requires Node.js** | ❌ No | ❌ No (if using exe) | ✅ Yes |
| **Config Method** | CLI Wizard | Web UI | JSON File |
| **Network Access** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Resource Usage** | Low | Medium | Very Low |
| **Setup Time** | 2 minutes | 5 minutes | 10 minutes |
| **Proxy to flrig/rigctld** | ❌ No | ✅ Yes | ✅ Yes (only) |

---

## API Compatibility

**All three solutions expose the same HTTP API**, so OpenHamClock works identically with any of them:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Current freq, mode, PTT, connection status |
| `/stream` | GET | Server-Sent Events (SSE) real-time updates |
| `/freq` | POST | Set frequency: `{ "freq": 14074000 }` |
| `/mode` | POST | Set mode: `{ "mode": "USB" }` |
| `/ptt` | POST | Set PTT: `{ "ptt": true }` |

**Additional endpoints (Rig Bridge only):**
- `/api/ports` — List available serial ports
- `/api/config` — Get/set configuration via web UI

---

## Migration Guide

### From Rig Control Daemon → Rig Listener
1. Stop `rig-daemon.js`
2. Stop `flrig` or `rigctld`
3. Download and run Rig Listener
4. Follow the wizard
5. No changes needed in OpenHamClock settings (same port 5555)

### From Rig Listener → Rig Bridge
1. Stop Rig Listener
2. Download/run Rig Bridge
3. Open http://localhost:5555 and configure
4. No changes needed in OpenHamClock settings

### From Rig Bridge → Rig Control Daemon
1. Install and start `flrig` or `rigctld`
2. Stop Rig Bridge
3. Configure `rig-control/rig-config.json`
4. Run `node rig-daemon.js`
5. No changes needed in OpenHamClock settings

---

## Troubleshooting

### All Solutions
- **Port 5555 in use:** Another rig control service is running. Stop it first.
- **OpenHamClock can't connect:** Check firewall, ensure service is running
- **No frequency updates:** Verify radio is connected and powered on

### Rig Listener / Rig Bridge (Direct USB)
- **No COM ports found:** Install USB driver (Silicon Labs CP210x for Yaesu)
- **Port opens but no data:** Baud rate mismatch — check radio's CAT settings
- **Linux permission denied:** `sudo usermod -a -G dialout $USER` then log out/in

### Rig Control Daemon
- **Connection refused:** Ensure flrig/rigctld is running first
- **Wrong port:** Check `rig-config.json` matches flrig/rigctld port

---

## Recommendations by Use Case

### 🏕️ Field Operation / Portable
**Use Rig Listener** — Single executable, no dependencies, works offline

### 🏠 Home Station (Single Radio)
**Use Rig Listener** — Simplest setup, direct USB connection

### 🏠 Home Station (Multiple Apps)
**Use Rig Control Daemon** — Share flrig/rigctld with WSJT-X, fldigi, etc.

> **Why?** Direct USB solutions (Rig Listener/Rig Bridge) lock the serial port exclusively. If you run WSJT-X, fldigi, or other CAT control software, they cannot access the radio simultaneously. The Rig Control Daemon works with flrig/rigctld, which act as a "hub" that multiple applications can connect to at once.

### 🌐 Network Setup (Radio on Different Computer)
**Use Rig Bridge** — Web UI makes remote configuration easy

### 🐧 Raspberry Pi / Headless Server
**Use Rig Control Daemon** — Lightweight, proven, easy to automate

### 🔧 Frequent Radio Changes
**Use Rig Bridge** — Web UI makes switching radios quick

### 🆕 First-Time User
**Use Rig Listener** — Get running in under 2 minutes

---

## Summary

| Solution | Best For | Complexity | Setup Time |
|----------|----------|------------|------------|
| **Rig Listener** | Most users, simplicity | ⭐ Easy | 2 min |
| **Rig Bridge** | Web UI lovers, network setups | ⭐⭐ Moderate | 5 min |
| **Rig Control Daemon** | Advanced users, existing flrig/rigctld | ⭐⭐⭐ Advanced | 10 min |

**Still unsure?** Start with **Rig Listener**. You can always switch later — all three use the same API, so OpenHamClock doesn't need reconfiguration.

---

## Getting Help

- **Documentation:** Each solution has its own README in its folder
- **Issues:** [GitHub Issues](https://github.com/K0CJH/openhamclock/issues)
- **Community:** Check the OpenHamClock community forums

---

**73 de K0CJH** 📻
