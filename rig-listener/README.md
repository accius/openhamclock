# OpenHamClock Rig Listener

**Download. Run. Click spots to tune your radio.**

No flrig. No rigctld. No Node.js. Just a single executable that connects your radio to OpenHamClock — via USB serial or TCI WebSocket.

## Download

Grab the right file for your computer from the [Releases](../../releases) page:

| Platform                           | Download                   |
| ---------------------------------- | -------------------------- |
| **Windows** (64-bit)               | `rig-listener-win-x64.exe` |
| **Mac** (Apple Silicon — M1/M2/M3) | `rig-listener-mac-arm64`   |
| **Mac** (Intel)                    | `rig-listener-mac-x64`     |
| **Linux** (64-bit)                 | `rig-listener-linux-x64`   |

## Setup — Serial Radios (Yaesu, Kenwood, Elecraft, Icom)

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

The wizard asks your radio type first, then walks through serial port setup:

```text
  📻 Radio type:

     1) Yaesu     (FT-991A, FT-891, FT-710, FT-DX10, FT-817/818)
     2) Kenwood   (TS-590, TS-890, TS-480, TS-2000)
     3) Elecraft  (K3, K4, KX3, KX2)
     4) Icom      (IC-7300, IC-7610, IC-705, IC-9700)
     5) SDR (TCI) (Thetis/HL2, ANAN, SunSDR, ExpertSDR)

  Select radio type (1-5): 1

  📟 Available serial ports:

     1) COM3  —  Silicon Labs (FT-991A)

  Select port (1): 1

  💾 Config saved! You won't see this wizard again.
```

### 4. Connect OpenHamClock

In **Settings → Rig Control**:

- ☑ Enable Rig Control
- Host: `http://localhost`
- Port: `5555`

**Done!** Click any spot on the map or DX cluster to tune your radio.

## Setup — SDR Radios via TCI (Thetis, SunSDR, ExpertSDR)

TCI (Transceiver Control Interface) is a WebSocket-based protocol used by modern SDR applications. The Rig Listener connects to your SDR app's TCI server and translates it into the same HTTP/SSE interface that OpenHamClock already speaks.

### Supported SDR applications

| Application   | Radios                | TCI Default Port |
| ------------- | --------------------- | ---------------- |
| **Thetis**    | Hermes Lite 2, ANAN   | 40001            |
| **ExpertSDR** | SunSDR2, SunSDR2 Pro  | 40001            |
| **SmartSDR**  | Flex (via TCI bridge) | varies           |

### 1. Enable TCI in your SDR application

**Thetis:** Setup → CAT Control → check "Enable TCI Server" (default port 40001)

**ExpertSDR:** Settings → TCI → Enable (default port 40001)

### 2. Quick start (no wizard needed)

```bash
./rig-listener --tci
```

That's it. Connects to `localhost:40001` automatically. No serial ports, no config file.

To specify a different host or port:

```bash
./rig-listener --tci-host 192.168.1.50 --tci-port 40001
```

### 3. Or use the wizard

Run `./rig-listener` (or `--wizard`) and select option **5) SDR (TCI)**. The wizard asks for the TCI host, port, and transceiver/VFO index.

```text
  📻 Radio type:

     5) SDR (TCI) (Thetis/HL2, ANAN, SunSDR, ExpertSDR)

  Select radio type (1-5): 5

  🌐 TCI Connection
     Thetis default:    localhost:40001
     ExpertSDR default: localhost:40001

  TCI host [localhost]:
  TCI port [40001]:

  💾 Config saved!
```

### 4. Connect OpenHamClock

Same as serial radios — **Settings → Rig Control**, enable, `http://localhost`, port `5555`.

### TCI output

```text
  ╔══════════════════════════════════════════════════╗
  ║  OpenHamClock Rig Listener v1.1.0               ║
  ╚══════════════════════════════════════════════════╝

  📻 Radio: TCI/SDR HL2
  🌐 TCI:   ws://localhost:40001
  🌐 HTTP:  http://localhost:5555

  [TCI] ✅ Connected to ws://localhost:40001
  [TCI] Device: Thetis
  [TCI] Server ready
```

### How TCI differs from serial

- **No polling** — TCI pushes frequency/mode/PTT changes in real-time over WebSocket, so updates appear instantly (serial protocols poll every 500ms).
- **No serial port conflicts** — TCI runs over the network, so multiple applications can connect to the same radio simultaneously. No more "port in use" errors.
- **Network capable** — Your SDR app can run on a different machine. Use `--tci-host` to point at a remote host.

## After Setup

Just run the listener again — it remembers your settings:

```text
  ╔══════════════════════════════════════════════════╗
  ║  OpenHamClock Rig Listener v1.1.0               ║
  ╚══════════════════════════════════════════════════╝

  📻 Radio: YAESU FT-991A
  🔌 Port:  COM3 @ 38400 baud
  🌐 HTTP:  http://localhost:5555

  [Serial] ✅ Connected to COM3
```

To re-run the wizard: `rig-listener --wizard`

## Supported Radios

| Type         | Models                                                          | Protocol         |
| ------------ | --------------------------------------------------------------- | ---------------- |
| **Yaesu**    | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-450D, FT-817/818 | CAT (serial)     |
| **Kenwood**  | TS-590, TS-890, TS-480, TS-2000                                 | Kenwood (serial) |
| **Elecraft** | K3, K4, KX3, KX2                                                | Kenwood (serial) |
| **Icom**     | IC-7300, IC-7610, IC-705, IC-9700, IC-7100                      | CI-V (serial)    |
| **TCI/SDR**  | Hermes Lite 2, ANAN, SunSDR, ExpertSDR, Flex (via bridge)       | TCI (WebSocket)  |

## Radio Configuration

Before running, make sure control is enabled on your radio or SDR application:

**Yaesu FT-991A:** Menu → CAT Rate → `38400`, CAT RTS → Enable

**Icom IC-7300:** Menu → CI-V → Baud Rate → `19200`, CI-V Address → note the hex value

**Kenwood / Elecraft:** Set COM port baud to `38400`

**Thetis (HL2/ANAN):** Setup → CAT Control → check "Enable TCI Server" (port 40001)

**ExpertSDR:** Settings → TCI → Enable

The baud rate in the wizard **must match** your radio's setting exactly (serial radios only).

## How It Works

**Serial radios** — polls via USB every 500ms:

```text
┌─────────┐    USB     ┌───────────────┐   HTTP/SSE    ┌──────────────┐
│ Radio   │◄──────────►│ Rig Listener  │◄─────────────►│ OpenHamClock │
│(FT-991A)│   Serial   │ (port 5555)   │  localhost    │  (browser)   │
└─────────┘   CAT cmd  └───────────────┘               └──────────────┘
```

**TCI/SDR radios** — real-time push via WebSocket:

```text
┌─────────┐  WebSocket  ┌───────────────┐   HTTP/SSE    ┌──────────────┐
│ Thetis  │◄───────────►│ Rig Listener  │◄─────────────►│ OpenHamClock │
│  (HL2)  │  TCI push   │ (port 5555)   │  localhost    │  (browser)   │
└─────────┘  port 40001 └───────────────┘               └──────────────┘
```

Both transports feed the same HTTP/SSE bridge — OpenHamClock doesn't know or care what's underneath. Click a spot, radio tunes.

## Troubleshooting

### Serial radios

**`No serial ports detected`**

- Is the USB cable plugged in?
- Windows: Check Device Manager → Ports. You may need the [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- Linux: `sudo usermod -a -G dialout $USER` then log out/in

**`Port in use`**

- Close flrig, rigctld, WSJT-X, fldigi, or any other program using the same serial port. Only one program can use a serial port at a time.

**`Connected but no frequency updates`**

- Baud rate mismatch — must match your radio's CAT rate setting exactly
- Wrong brand selected — re-run with `--wizard`
- Icom: CI-V address must match (re-run wizard to change)

**`Mac security warning`**

- System Settings → Privacy & Security → scroll down → click "Allow Anyway"

### TCI/SDR radios

**`Connection refused`**

- Is Thetis / ExpertSDR running?
- Is TCI enabled? (Thetis → Setup → CAT Control → Enable TCI Server)
- Check the port number (default 40001)

**`Connected but no updates`**

- Make sure TCI is the active control method (some SDR apps allow only one CAT interface at a time)
- Check TRX index if you have a multi-transceiver setup — default is 0

**`Connecting to a remote machine`**

- Use `--tci-host 192.168.1.x` (the IP of the machine running Thetis)
- Make sure the TCI port (40001) is open in the remote machine's firewall

**`Reconnecting after Thetis restart`**

- The listener auto-reconnects every 5 seconds when the TCI connection drops. Just restart Thetis and it will reconnect automatically.

## Command Line Options

```text
rig-listener                      Normal start (wizard if first run)
rig-listener --wizard             Re-run setup wizard
rig-listener --port COM5          Override serial port
rig-listener --baud 9600          Override baud rate
rig-listener --brand icom         Override radio brand
rig-listener --tci                TCI mode (localhost:40001)
rig-listener --tci-host 10.0.0.5  TCI on remote host
rig-listener --tci-port 40002     TCI on non-default port
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
