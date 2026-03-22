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

### SDR Radios via TCI (WebSocket)

TCI (Transceiver Control Interface) is a WebSocket-based protocol used by modern SDR applications. Unlike serial CAT, TCI **pushes** frequency, mode, and PTT changes in real-time — no polling, no serial port conflicts.

| Application   | Radios              | Default TCI Port |
| ------------- | ------------------- | ---------------- |
| **Thetis**    | Hermes Lite 2, ANAN | 40001            |
| **ExpertSDR** | SunSDR2             | 40001            |

### SDR Radios (Native TCP)

| Application  | Radios                         | Default Port |
| ------------ | ------------------------------ | ------------ |
| **SmartSDR** | FlexRadio 6000/8000 series     | 4992         |
| **rtl_tcp**  | RTL-SDR dongles (receive-only) | 1234         |

### Via Control Software (Legacy)

| Software    | Protocol | Default Port |
| ----------- | -------- | ------------ |
| **flrig**   | XML-RPC  | 12345        |
| **rigctld** | TCP      | 4532         |

### For Testing (No Hardware Required)

| Type                | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| **Simulated Radio** | Fake radio that drifts through several bands — no serial port needed |

Enable by setting `radio.type = "mock"` in `rig-bridge-config.json` or selecting **Simulated Radio** in the setup UI.

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

### SDR Radios via TCI

#### 1. Enable TCI in your SDR application

**Thetis (HL2 / ANAN):** Setup → CAT Control → check **Enable TCI Server** (default port 40001)

**ExpertSDR:** Settings → TCI → Enable (default port 40001)

#### 2. Configure rig-bridge

Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "tci" },
  "tci": {
    "host": "localhost",
    "port": 40001,
    "trx": 0,
    "vfo": 0
  }
}
```

| Field  | Description                      | Default     |
| ------ | -------------------------------- | ----------- |
| `host` | Host running the SDR application | `localhost` |
| `port` | TCI WebSocket port               | `40001`     |
| `trx`  | Transceiver index (0 = primary)  | `0`         |
| `vfo`  | VFO index (0 = VFO-A, 1 = VFO-B) | `0`         |

#### 3. Run rig-bridge

```bash
node rig-bridge.js
```

You should see:

```
[TCI] Connecting to ws://localhost:40001...
[TCI] ✅ Connected to ws://localhost:40001
[TCI] Device: Thetis
[TCI] Server ready
```

The bridge auto-reconnects every 5 s if the connection drops — just restart your SDR app and it will reconnect automatically.

---

## FlexRadio SmartSDR

The SmartSDR plugin connects directly to a FlexRadio 6000 or 8000 series radio via the native SmartSDR TCP API — no rigctld, no SmartSDR CAT, no DAX required. The radio pushes frequency, mode, and slice changes in real-time.

### Setup

Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "smartsdr" },
  "smartsdr": {
    "host": "192.168.1.100",
    "port": 4992,
    "sliceIndex": 0
  }
}
```

| Field        | Description                        | Default         |
| ------------ | ---------------------------------- | --------------- |
| `host`       | IP address of the FlexRadio        | `192.168.1.100` |
| `port`       | SmartSDR TCP API port              | `4992`          |
| `sliceIndex` | Slice receiver index (0 = Slice A) | `0`             |

You should see:

```
[SmartSDR] Connecting to 192.168.1.100:4992...
[SmartSDR] ✅ Connected — Slice A on 14.074 MHz
```

The bridge auto-reconnects every 5 s if the connection drops.

**Supported modes:** USB, LSB, CW, AM, SAM, FM, DATA-USB (DIGU), DATA-LSB (DIGL), RTTY, FreeDV

---

## RTL-SDR (rtl_tcp)

The RTL-SDR plugin connects to an `rtl_tcp` server for cheap RTL-SDR dongles. It is **receive-only** — frequency tuning works, but mode changes and PTT are no-ops.

### Setup

1. Start `rtl_tcp` on the machine with the dongle:

```bash
rtl_tcp -a 127.0.0.1 -p 1234
```

2. Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "rtl-tcp" },
  "rtltcp": {
    "host": "127.0.0.1",
    "port": 1234,
    "sampleRate": 2400000,
    "gain": "auto"
  }
}
```

| Field        | Description                                     | Default     |
| ------------ | ----------------------------------------------- | ----------- |
| `host`       | Host running `rtl_tcp`                          | `127.0.0.1` |
| `port`       | `rtl_tcp` listen port                           | `1234`      |
| `sampleRate` | IQ sample rate in Hz                            | `2400000`   |
| `gain`       | Tuner gain in tenths of dB, or `"auto"` for AGC | `"auto"`    |

You should see:

```
[RTL-TCP] Connecting to 127.0.0.1:1234...
[RTL-TCP] ✅ Connected — tuner: R820T
[RTL-TCP] Setting sample rate: 2.4 MS/s
[RTL-TCP] Gain: auto (AGC)
```

---

## WSJT-X Relay

The WSJT-X Relay is an **integration plugin** (not a radio plugin) that listens for WSJT-X UDP packets on the local machine and forwards decoded messages to an OpenHamClock server in real-time. This lets OpenHamClock display your FT8/FT4 decodes as DX spots without any manual intervention.

### Setup

Edit `rig-bridge-config.json`:

```json
{
  "wsjtxRelay": {
    "enabled": true,
    "url": "https://openhamclock.com",
    "key": "your-relay-key",
    "session": "your-session-id",
    "udpPort": 2237,
    "batchInterval": 2000,
    "verbose": false,
    "multicast": false,
    "multicastGroup": "224.0.0.1",
    "multicastInterface": ""
  }
}
```

| Field                | Description                                             | Default                    |
| -------------------- | ------------------------------------------------------- | -------------------------- |
| `enabled`            | Activate the relay on startup                           | `false`                    |
| `url`                | OpenHamClock server URL                                 | `https://openhamclock.com` |
| `key`                | Relay authentication key (from your OHC account)        | —                          |
| `session`            | Browser session ID for per-user isolation               | —                          |
| `udpPort`            | UDP port WSJT-X is sending to                           | `2237`                     |
| `batchInterval`      | How often decoded messages are sent (ms)                | `2000`                     |
| `verbose`            | Log every decoded message to the console                | `false`                    |
| `multicast`          | Join a UDP multicast group to receive WSJT-X packets    | `false`                    |
| `multicastGroup`     | Multicast group IP address to join                      | `224.0.0.1`                |
| `multicastInterface` | Local NIC IP for multi-homed systems; `""` = OS default | `""`                       |

### In WSJT-X

Make sure WSJT-X is configured to send UDP packets to `localhost` on the same port as `udpPort` (default `2237`):
**File → Settings → Reporting → UDP Server → `127.0.0.1:2237`**

The relay runs alongside your radio plugin — you can use direct USB or TCI at the same time.

### Multicast Mode

By default the relay uses **unicast** — WSJT-X sends packets directly to `127.0.0.1` and only this process receives them.

If you want multiple applications on the same machine or LAN to receive WSJT-X packets simultaneously, enable multicast:

1. In WSJT-X: **File → Settings → Reporting → UDP Server** — set the address to `224.0.0.1`
2. In `rig-bridge-config.json` (or via the setup UI at `http://localhost:5555`):

```json
{
  "wsjtxRelay": {
    "multicast": true,
    "multicastGroup": "224.0.0.1",
    "multicastInterface": ""
  }
}
```

Leave `multicastInterface` blank unless you have multiple network adapters and need to specify which one to use (enter its local IP, e.g. `"192.168.1.100"`).

> `224.0.0.1` is the WSJT-X conventional multicast group. It is link-local — packets are not routed across subnet boundaries.

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

| Problem                       | Solution                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No COM ports found            | Install USB driver (Silicon Labs CP210x for Yaesu, FTDI for some Kenwood)                                                                                   |
| Port opens but no data        | Check baud rate matches radio's CAT Rate setting                                                                                                            |
| Icom not responding           | Verify CI-V address matches your radio model                                                                                                                |
| CORS errors in browser        | The bridge allows all origins by default                                                                                                                    |
| Port already in use           | Close flrig/rigctld if running — you don't need them anymore                                                                                                |
| PTT not responsive            | Enable **Hardware Flow (RTS/CTS)** (especially for FT-991A/FT-710)                                                                                          |
| macOS Comms Failure           | The bridge automatically applies a `stty` fix for CP210x drivers.                                                                                           |
| TCI: Connection refused       | Enable TCI in your SDR app (Thetis → Setup → CAT Control → Enable TCI Server)                                                                               |
| TCI: No frequency updates     | Check `trx` / `vfo` index in config match the active transceiver in your SDR app                                                                            |
| TCI: Remote SDR               | Set `tci.host` to the IP of the machine running the SDR application                                                                                         |
| SmartSDR: Connection refused  | Confirm the radio is powered on and reachable; default API port is 4992                                                                                     |
| SmartSDR: No slice updates    | Check `sliceIndex` matches the active slice in SmartSDR                                                                                                     |
| RTL-SDR: Connection refused   | Start `rtl_tcp` first: `rtl_tcp -a 127.0.0.1 -p 1234`; check no other app holds the dongle                                                                  |
| RTL-SDR: Frequency won't tune | Verify the frequency is within your dongle's supported range (typically 24 MHz–1.7 GHz for R820T)                                                           |
| Multicast: no packets         | Verify `multicastGroup` matches what WSJT-X sends to; check OS firewall allows multicast UDP; set `multicastInterface` to the correct NIC IP if multi-homed |

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
    │   ├── index.js            # USB serial lifecycle (open, reconnect, poll)
    │   ├── protocol-yaesu.js   # Yaesu CAT ASCII protocol
    │   ├── protocol-kenwood.js # Kenwood ASCII protocol
    │   └── protocol-icom.js    # Icom CI-V binary protocol
    ├── tci.js             # TCI/SDR WebSocket plugin (Thetis, ExpertSDR, etc.)
    ├── smartsdr.js        # FlexRadio SmartSDR native TCP API plugin
    ├── rtl-tcp.js         # RTL-SDR via rtl_tcp binary protocol (receive-only)
    ├── rigctld.js         # rigctld TCP plugin
    ├── flrig.js           # flrig XML-RPC plugin
    ├── mock.js            # Simulated radio for testing (no hardware needed)
    └── wsjtx-relay.js     # WSJT-X UDP listener → OpenHamClock relay
```

---

## Writing a Plugin

Each plugin exports an object with the following shape:

```js
module.exports = {
  id: 'my-plugin', // Unique identifier (matches config.radio.type)
  name: 'My Plugin', // Human-readable name
  category: 'rig', // 'rig' | 'integration' | 'rotator' | 'logger' | 'other'
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
- `integration` — background service plugins (e.g. WSJT-X relay); started via `registry.connectIntegrations()`
- `rotator`, `logger`, `other` — use `registerRoutes(app)` to expose their own endpoints

To register a plugin at startup, call `registry.register(descriptor)` in `rig-bridge.js` before `registry.connectActive()`.
