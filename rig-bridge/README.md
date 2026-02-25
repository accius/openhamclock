# 📻 OpenHamClock Rig Bridge

**One download. One click. Your radio is connected.**

The Rig Bridge connects OpenHamClock directly to your radio via USB — no flrig, no rigctld, no complicated setup. Just plug in your radio, run the bridge, pick your COM port, and go.

Built on a **plugin architecture** — each radio integration is a standalone module, making it easy to add new integrations without touching existing code.

## Supported Radios

### Direct USB (Recommended)

| Brand       | Protocol | Tested Models                                       |
| ----------- | -------- | --------------------------------------------------- |
| **Yaesu**   | CAT      | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000 |
| **Kenwood** | Kenwood  | TS-890, TS-590, TS-2000, TS-480                     |
| **Icom**    | CI-V     | IC-7300, IC-7610, IC-9700, IC-705, IC-7851          |

Also works with **Elecraft** radios (K3, K4, KX3, KX2) using the Kenwood plugin.

### Via Control Software (Legacy)

| Software    | Protocol | Default Port |
| ----------- | -------- | ------------ |
| **flrig**   | XML-RPC  | 12345        |
| **rigctld** | TCP      | 4532         |

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

**Options:**

```bash
node rig-bridge.js --port 8080   # Use a different port
node rig-bridge.js --debug       # Enable raw hex/ASCII CAT traffic logging
```

---

## Radio Setup Tips

### Yaesu FT-991A

1. Connect USB-B cable from radio to computer
2. On the radio: **Menu → Operation Setting → CAT Rate → 38400**
3. In Rig Bridge: Select **Yaesu**, pick your COM port, baud **38400**, stop bits **2**, and enable **Hardware Flow (RTS/CTS)**

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

| Problem                | Solution                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| No COM ports found     | Install USB driver (Silicon Labs CP210x for Yaesu, FTDI for some Kenwood) |
| Port opens but no data | Check baud rate matches radio's CAT Rate setting                          |
| Icom not responding    | Verify CI-V address matches your radio model                              |
| CORS errors in browser | The bridge allows all origins by default                                  |
| Port already in use    | Close flrig/rigctld if running — you don't need them anymore              |
| PTT not responsive     | Enable **Hardware Flow (RTS/CTS)** (especially for FT-991A/FT-710)        |
| macOS Comms Failure    | The bridge automatically applies a `stty` fix for CP210x drivers.         |

---

## API Reference

Fully backward compatible with the original rig-daemon API:

| Method | Endpoint      | Description                               |
| ------ | ------------- | ----------------------------------------- |
| GET    | `/status`     | Current freq, mode, PTT, connected status |
| GET    | `/stream`     | SSE stream of real-time updates           |
| POST   | `/freq`       | Set frequency: `{ "freq": 14074000 }`     |
| POST   | `/mode`       | Set mode: `{ "mode": "USB" }`             |
| POST   | `/ptt`        | Set PTT: `{ "ptt": true }`                |
| GET    | `/api/ports`  | List available serial ports               |
| GET    | `/api/config` | Get current configuration                 |
| POST   | `/api/config` | Update configuration & reconnect          |
| POST   | `/api/test`   | Test a serial port connection             |

---

## Project Structure

```
rig-bridge/
├── rig-bridge.js          # Entry point — thin orchestrator
│
├── core/
│   ├── config.js          # Config load/save, defaults, CLI args
│   ├── state.js           # Shared rig state + SSE broadcast
│   ├── server.js          # Express HTTP server + all API routes
│   ├── plugin-registry.js # Plugin lifecycle manager + dispatcher
│   └── serial-utils.js    # Shared serial port helpers
│
└── plugins/
    ├── usb/
    │   ├── index.js           # USB serial lifecycle (open, reconnect, poll)
    │   ├── protocol-yaesu.js  # Yaesu CAT ASCII protocol
    │   ├── protocol-kenwood.js# Kenwood ASCII protocol
    │   └── protocol-icom.js   # Icom CI-V binary protocol
    ├── rigctld.js         # rigctld TCP plugin
    └── flrig.js           # flrig XML-RPC plugin
```

---

## Writing a Plugin

Each plugin exports an object with the following shape:

```js
module.exports = {
  id: 'my-plugin', // Unique identifier (matches config.radio.type)
  name: 'My Plugin', // Human-readable name
  category: 'rig', // 'rig' | 'rotator' | 'logger' | 'other'
  configKey: 'radio', // Which config section this plugin reads

  create(config, { updateState, state }) {
    return {
      connect() {
        /* open connection */
      },
      disconnect() {
        /* close connection */
      },

      // Rig category — implement these for radio control:
      setFreq(hz) {
        /* tune to frequency in Hz */
      },
      setMode(mode) {
        /* set mode string e.g. 'USB' */
      },
      setPTT(on) {
        /* key/unkey transmitter */
      },

      // Optional — register extra HTTP routes:
      // registerRoutes(app) { app.get('/my-plugin/...', handler) }
    };
  },
};
```

**Categories:**

- `rig` — radio control; the bridge dispatches `/freq`, `/mode`, `/ptt` to the active rig plugin
- `rotator`, `logger`, `other` — use `registerRoutes(app)` to expose their own endpoints

To register a plugin at startup, call `registry.register(descriptor)` in `rig-bridge.js` before `registry.connectActive()`.
