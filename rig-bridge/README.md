# 📻 OpenHamClock Rig Bridge

**One download. One click. Your radio is connected.**

The Rig Bridge connects OpenHamClock directly to your radio via USB — no flrig, no rigctld, no complicated setup. Just plug in your radio, run the bridge, pick your COM port, and go.

## Supported Radios

### Direct USB (Recommended)
| Brand | Protocol | Tested Models |
|-------|----------|---------------|
| **Yaesu** | CAT | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000 |
| **Kenwood** | Kenwood | TS-890, TS-590, TS-2000, TS-480 |
| **Icom** | CI-V | IC-7300, IC-7610, IC-9700, IC-705, IC-7851 |

### Via Control Software (Legacy)
Still works with **flrig** or **rigctld** if you prefer.

---

## Quick Start

### Option A: Download the Executable (Easiest)
1. Download the right file for your OS from the Releases page
2. Double-click to run
3. Open **http://localhost:5555** in your browser
4. Select your radio type and COM port
5. Click **Save & Connect**

### Option B: Run with Node.js
```bash
cd rig-bridge
npm install
node rig-bridge.js
```
Then open **http://localhost:5555** to configure.

---

## Radio Setup Tips

### Yaesu FT-991A
1. Connect USB-B cable from radio to computer
2. On the radio: **Menu → Operation Setting → CAT Rate → 38400**
3. In Rig Bridge: Select **Yaesu**, pick your COM port, baud **38400**, stop bits **2**

### Icom IC-7300
1. Connect USB cable from radio to computer
2. On the radio: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**
3. In Rig Bridge: Select **Icom**, pick COM port, baud **115200**, stop bits **1**, address **0x94**

### Kenwood TS-590
1. Connect USB cable from radio to computer
2. In Rig Bridge: Select **Kenwood**, pick COM port, baud **9600**, stop bits **1**

---

## OpenHamClock Setup

Once the bridge is running and showing your frequency:

1. Open **OpenHamClock** → **Settings** → **Station Settings**
2. Scroll to **Rig Control**
3. Check **Enable Rig Control**
4. Set Host URL: `http://localhost:5555`
5. Click any DX spot, POTA, or SOTA to tune your radio!

---

## Building Executables

To create standalone executables (no Node.js required):

```bash
npm install
npm run build:win        # Windows .exe
npm run build:mac        # macOS (Intel)
npm run build:mac-arm    # macOS (Apple Silicon)
npm run build:linux      # Linux x64
npm run build:linux-arm  # Linux ARM (Raspberry Pi)
npm run build:all        # All platforms
```

Executables are output to the `dist/` folder.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No COM ports found | Install USB driver (Silicon Labs CP210x for Yaesu, FTDI for some Kenwood) |
| Port opens but no data | Check baud rate matches radio's CAT Rate setting |
| Icom not responding | Verify CI-V address matches your radio model |
| CORS errors in browser | The bridge allows all origins by default |
| Port already in use | Close flrig/rigctld if running — you don't need them anymore |

---

## API Reference

Same API as the original rig-daemon — fully backward compatible:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Current freq, mode, PTT, connected status |
| GET | `/stream` | SSE stream of real-time updates |
| POST | `/freq` | Set frequency: `{ "freq": 14074000 }` |
| POST | `/mode` | Set mode: `{ "mode": "USB" }` |
| POST | `/ptt` | Set PTT: `{ "ptt": true }` |
| GET | `/api/ports` | List available serial ports |
| GET | `/api/config` | Get current configuration |
| POST | `/api/config` | Update configuration & reconnect |
