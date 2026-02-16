# OpenHamClock Rig Listener

**Download. Run. Click spots to tune your radio.**

No flrig. No rigctld. No Node.js. Just a single executable that connects your radio to OpenHamClock via USB.

## Download

Grab the right file for your computer from the [Releases](../../releases) page:

| Platform | Download |
|----------|----------|
| **Windows** (64-bit) | `rig-listener-win-x64.exe` |
| **Mac** (Apple Silicon — M1/M2/M3) | `rig-listener-mac-arm64` |
| **Mac** (Intel) | `rig-listener-mac-x64` |
| **Linux** (64-bit) | `rig-listener-linux-x64` |

## Setup (One Time)

### 1. Plug in your radio via USB

### 2. Run the listener

**Windows:** Double-click `rig-listener-win-x64.exe`

**Mac:** Open Terminal, then:
```bash
chmod +x rig-listener-mac-arm64
./rig-listener-mac-arm64
```
> Mac may show a security warning. Go to System Settings → Privacy & Security → click "Allow Anyway".

**Linux:**
```bash
chmod +x rig-listener-linux-x64
./rig-listener-linux-x64
```

### 3. Follow the wizard

The wizard lists your serial ports, asks your radio brand, and saves the config:

```
  📟 Available serial ports:

     1) COM3  —  Silicon Labs (FT-991A)

  Select port (1): 1

  📻 Radio brand:

     1) Yaesu     (FT-991A, FT-891, FT-710, FT-DX10, FT-817/818)
     2) Kenwood   (TS-590, TS-890, TS-480, TS-2000)
     3) Elecraft  (K3, K4, KX3, KX2)
     4) Icom      (IC-7300, IC-7610, IC-705, IC-9700)

  Select brand (1-4): 1

  💾 Config saved! You won't see this wizard again.
```

### 4. Connect OpenHamClock

In **Settings → Rig Control**:
- ☑ Enable Rig Control
- Host: `http://localhost`
- Port: `5555`

**Done!** Click any spot on the map or DX cluster to tune your radio.

## After Setup

Just run the listener again — it remembers your settings:

```
  ╔══════════════════════════════════════════════════╗
  ║  OpenHamClock Rig Listener v1.0.0               ║
  ╚══════════════════════════════════════════════════╝

  📻 Radio: YAESU FT-991A
  🔌 Port:  COM3 @ 38400 baud
  🌐 HTTP:  http://localhost:5555

  [Serial] ✅ Connected to COM3
```

To re-run the wizard: `rig-listener --wizard`

## Supported Radios

| Brand | Models | Protocol |
|-------|--------|----------|
| **Yaesu** | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-450D, FT-817/818 | CAT |
| **Kenwood** | TS-590, TS-890, TS-480, TS-2000 | Kenwood |
| **Elecraft** | K3, K4, KX3, KX2 | Kenwood-compatible |
| **Icom** | IC-7300, IC-7610, IC-705, IC-9700, IC-7100 | CI-V |

## Radio Configuration

Before running, make sure CAT control is enabled on your radio:

**Yaesu FT-991A:** Menu → CAT Rate → `38400`, CAT RTS → Enable

**Icom IC-7300:** Menu → CI-V → Baud Rate → `19200`, CI-V Address → note the hex value

**Kenwood / Elecraft:** Set COM port baud to `38400`

The baud rate in the wizard **must match** your radio's setting exactly.

## How It Works

```
┌─────────┐    USB     ┌───────────────┐   HTTP/SSE    ┌──────────────┐
│  Radio   │◄─────────►│ Rig Listener  │◄─────────────►│ OpenHamClock │
│ (FT-991A)│  Serial   │ (port 5555)   │  localhost     │  (browser)   │
└─────────┘   CAT cmd  └───────────────┘               └──────────────┘
```

The listener polls your radio every 500ms for frequency/mode/PTT and pushes changes to OpenHamClock in real time. When you click a spot in OHC, it sends the frequency command back to the radio.

## Troubleshooting

**No serial ports detected**
- Is the USB cable plugged in?
- Windows: Check Device Manager → Ports. You may need the [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- Linux: `sudo usermod -a -G dialout $USER` then log out/in

**"Port in use"**
- Close flrig, rigctld, WSJT-X, fldigi, or any other program using the same serial port. Only one program can use a serial port at a time.

**Connected but no frequency updates**
- Baud rate mismatch — must match your radio's CAT rate setting exactly
- Wrong brand selected — re-run with `--wizard`
- Icom: CI-V address must match (re-run wizard to change)

**Mac security warning**
- System Settings → Privacy & Security → scroll down → click "Allow Anyway"

## Command Line Options

```
rig-listener                      Normal start (wizard if first run)
rig-listener --wizard             Re-run setup wizard
rig-listener --port COM5          Override serial port
rig-listener --baud 9600          Override baud rate
rig-listener --brand icom         Override radio brand
rig-listener --http-port 5556     Different HTTP port
rig-listener --mock               Simulation mode (no radio)
rig-listener --help               Show all options
```

## Building From Source

If you prefer to run from source code (requires Node.js 18+):

```bash
cd rig-listener
npm install
node rig-listener.js
```

To build your own executable:
```bash
npm run build
```

The executable appears in the `dist/` folder.
