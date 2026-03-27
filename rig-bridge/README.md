# 📻 OpenHamClock Rig Bridge

**Let OpenHamClock talk to your radio — click a spot, your radio tunes.**

Rig Bridge is a small program that runs on your computer and acts as a translator between OpenHamClock and your radio. Once it is running, you can click any DX spot, POTA activation, or SOTA summit in OpenHamClock and your radio will automatically tune to the right frequency and mode.

It also connects FT8/FT4 decoding software (WSJT-X, JTDX, MSHV, JS8Call) to OpenHamClock, so all your decoded stations appear live on the map.

---

## Contents

1. [Supported Radios](#supported-radios)
2. [Getting Started](#getting-started)
3. [Updating Rig Bridge](#updating-rig-bridge)
4. [Connecting Your Radio](#connecting-your-radio)
5. [Connecting to OpenHamClock](#connecting-to-openhamclock)
6. [Digital Mode Software (FT8, JS8, etc.)](#digital-mode-software)
7. [APRS via Local TNC _(Beta)_](#aprs-via-local-tnc-beta)
8. [Antenna Rotator](#antenna-rotator-alpha)
9. [HTTPS Setup (needed for openhamclock.com)](#https-setup)
10. [Troubleshooting](#troubleshooting)
11. [Glossary](#glossary)
12. [Advanced Topics](#advanced-topics)

---

## Supported Radios

### Direct USB connection (recommended for most hams)

You connect the radio to your computer with a USB cable — no extra software needed.

| Brand        | Tested Models                                       |
| ------------ | --------------------------------------------------- |
| **Yaesu**    | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000 |
| **Kenwood**  | TS-890, TS-590, TS-2000, TS-480                     |
| **Icom**     | IC-7300, IC-7610, IC-9700, IC-705, IC-7851          |
| **Elecraft** | K3, K4, KX3, KX2 (use the Kenwood plugin)           |

### SDR software radios (Hermes Lite 2, ANAN, SunSDR)

These connect over your local network rather than USB.

| Software      | Compatible Radios          |
| ------------- | -------------------------- |
| **Thetis**    | Hermes Lite 2, ANAN series |
| **ExpertSDR** | SunSDR2                    |

### FlexRadio SmartSDR (6000 / 8000 series)

Connects directly over your home network — no extra software needed on the FlexRadio side.

### RTL-SDR dongle (receive only)

Cheap USB TV tuner dongles used as software-defined receivers. Frequency tuning works; transmit/PTT does not apply.

### Already using flrig or rigctld?

If you already have **flrig** or **rigctld** (Hamlib) running and controlling your radio, Rig Bridge can connect to those instead of talking to the radio directly. This lets you keep your existing setup.

### No radio? Test with the simulator

Select **Simulated Radio** in the setup screen. A fake radio will drift through the bands so you can try everything without any hardware connected.

---

## Getting Started

### Step 1 — Download and run Rig Bridge

#### Prerequisites

The installer script requires **Node.js** and **Git**. Install them once before continuing:

- **Node.js:** Download and install the LTS version from [nodejs.org](https://nodejs.org/).
- **Git:** Download from [git-scm.com](https://git-scm.com/). On Windows use Git for Windows; on macOS you may be prompted to install Xcode command line tools; on Linux install via your package manager (e.g. `sudo apt install git`).

#### Option A — Installer from the OpenHamClock Settings tab (recommended)

1. In OpenHamClock, open **Settings → Rig Bridge**.
2. Tick **Enable Rig Bridge**.
3. Click the download button for your operating system — **Windows**, **Mac**, or **Linux**.
4. Install Rig Bridge
   - **Windows**

     Open your Downloads folder and double-click `install-rig-bridge.bat`.
     A Command Prompt window will open, download Rig Bridge, and then prompt you to press Enter to open the Setup UI in your browser. Leave this window open.

   - **macOS**

     Open **Terminal** (Applications → Utilities → Terminal) and run:

     ```bash
     chmod +x ~/Downloads/install-rig-bridge.sh
     ~/Downloads/install-rig-bridge.sh
     ```

     The script downloads Rig Bridge and then prompts you to press Enter to open the Setup UI in your browser. Leave the Terminal window open.

   - **Linux**

     Open a terminal and run:

     ```bash
     chmod +x ~/Downloads/install-rig-bridge.sh
     ~/Downloads/install-rig-bridge.sh
     ```

     The script downloads Rig Bridge and then prompts you to press Enter to open the Setup UI in your browser. Leave the terminal open.

5. The installation script will automatically open the Setup UI (e.g., **http://localhost:5555**, or **https://localhost:5555** if you enabled TLS) in your web browser. _(If it doesn't, you can click **Open Setup UI** in OpenHamClock's Settings tab)._
6. Copy the **API Token** shown at the top of that page.
7. Back in OpenHamClock **Settings → Rig Bridge**, paste the token into the **API Token** field.
8. Confirm **Host** is `http://localhost` and **Port** is `5555`.
9. Tick **Click-to-tune** if you want spot clicks to tune your radio, then click **Save**.

Now configure your radio in the Rig Bridge Setup UI — see [Connecting Your Radio](#connecting-your-radio).

To update Rig Bridge in the future, see [Updating Rig Bridge](#updating-rig-bridge).

#### Option B — Run from source with Node.js

"Running from source" means you manually download the raw source code of OpenHamClock (for instance, using `git clone` or downloading the ZIP from GitHub) and execute the program directly from your command line, rather than using an automated installer.

If you have downloaded the code repository and have **Node.js** installed, open a terminal in the project directory and run:

```bash
cd rig-bridge
npm install
node rig-bridge.js
```

### Step 2 — Open the setup page

Once Rig Bridge is running, open your web browser and go to:

**<http://localhost:5555>**

> **What is localhost:5555?** `localhost` means "this computer" — Rig Bridge is running on your own machine, not on the internet. `5555` is just the "door number" (port) it listens on. Nothing is sent to the internet.

You will see the Rig Bridge setup screen. The first time it opens, your **API Token** (a security password) will be shown automatically — Rig Bridge logs you in for you.

> **What is the API Token?** It is a password that protects Rig Bridge from being controlled by other websites you might visit. Keep it private. You will need to paste it into OpenHamClock once.

### Step 3 — Configure your radio

See [Connecting Your Radio](#connecting-your-radio) below for step-by-step instructions for your specific radio.

### Step 4 — Connect to OpenHamClock

See [Connecting to OpenHamClock](#connecting-to-openhamclock) below.

---

## Updating Rig Bridge

To update to the latest version, re-run the installer script you downloaded during setup
with the `--update` flag. Your radio configuration is preserved automatically.

### Windows

Open Command Prompt, navigate to your Downloads folder, and run:

```cmd
install-rig-bridge.bat --update
```

> You cannot pass arguments by double-clicking a `.bat` file — open Command Prompt first (`Win + R` → type `cmd` → Enter), then run the command above.

### macOS / Linux

```bash
~/Downloads/install-rig-bridge.sh --update
```

> If you no longer have the original script, download it again from
> **Settings → Rig Bridge** in OpenHamClock — the `--update` flag works on a freshly
> downloaded copy too, as long as Rig Bridge is already installed.

### What the update does

1. Stops the running Rig Bridge instance (if any)
2. Downloads the latest files from the repository
3. Preserves your `rig-bridge-config.json` (radio settings, tokens, plugins)
4. Re-installs dependencies
5. Restarts Rig Bridge

### What gets reset

Nothing in your configuration is changed. Any manual edits you made directly to
`rig-bridge.js` or other source files **will be overwritten** — the update replaces
all source files.

---

## Connecting Your Radio

### Yaesu radios (FT-991A, FT-891, FT-710, FT-DX10, etc.)

**On the radio:**

| Radio   | Menu path                           | Setting   |
| ------- | ----------------------------------- | --------- |
| FT-991A | Menu → Operation Setting → CAT Rate | **38400** |
| FT-891  | Menu → CAT Rate                     | **38400** |
| FT-710  | Menu → CAT RATE                     | **38400** |
| FT-DX10 | Menu → CAT RATE                     | **38400** |

**In Rig Bridge setup (<http://localhost:5555>):**

1. Radio Type → **Yaesu**
2. Serial Port → select your radio's COM port (see tip below)
3. Baud Rate → **38400**
4. Stop Bits → **2**
5. Hardware Flow (RTS/CTS) → **enabled** (important for FT-991A and FT-710)
6. Click **Save & Connect**

> **Which COM port is my radio?** On Windows, open Device Manager → Ports (COM & LPT). Look for "Silicon Labs CP210x" or similar — that is your radio. On macOS, look for `/dev/cu.usbserial-...` in the list.

---

### Icom radios (IC-7300, IC-7610, IC-9700, IC-705)

**On the radio:**

- IC-7300: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**
- IC-7610: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**
- IC-9700: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**
- IC-705: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**

**In Rig Bridge setup:**

1. Radio Type → **Icom**
2. Serial Port → select your radio's COM port
3. Baud Rate → **115200**
4. Stop Bits → **1**
5. CI-V Address → use the value for your model:

   | Radio   | CI-V Address |
   | ------- | ------------ |
   | IC-7300 | 0x94         |
   | IC-7610 | 0x98         |
   | IC-9700 | 0xA2         |
   | IC-705  | 0xA4         |
   | IC-7851 | 0x8E         |

6. Click **Save & Connect**

---

### Kenwood and Elecraft radios (TS-890, TS-590, K3, K4, KX3)

**In Rig Bridge setup:**

1. Radio Type → **Kenwood**
2. Serial Port → select your radio's COM port
3. Baud Rate → **9600** (check your radio's CAT speed setting if unsure)
4. Stop Bits → **1**
5. Click **Save & Connect**

---

### SDR radios via Thetis or ExpertSDR (Hermes Lite 2, ANAN, SunSDR)

These connect over your local network using the TCI protocol — no USB cable needed.

#### Step 1 — Enable TCI in your SDR software

- **Thetis:** Setup → CAT Control → tick **Enable TCI Server** (default port: 40001)
- **ExpertSDR:** Settings → TCI → Enable (default port: 40001)

#### Step 2 — In Rig Bridge setup

1. Radio Type → **TCI / SDR**
2. Host → `localhost` (or the IP address of the machine running the SDR software if it is on a different computer)
3. Port → **40001**
4. Click **Save & Connect**

You should see in the Rig Bridge log:

```text
[TCI] ✅ Connected to ws://localhost:40001
[TCI] Device: Thetis
```

Rig Bridge will automatically reconnect if the SDR software is restarted.

---

### FlexRadio SmartSDR (6000 / 8000 series)

**In Rig Bridge setup:**

1. Radio Type → **SmartSDR**
2. Host → the IP address of your FlexRadio on your network (e.g. `192.168.1.100`)
3. Port → **4992**
4. Slice Index → **0** (Slice A; change to 1 for Slice B, etc.)
5. Click **Save & Connect**

You should see:

```text
[SmartSDR] ✅ Connected — Slice A on 14.074 MHz
```

---

### Connecting via flrig or rigctld (existing setups)

If you already have flrig or rigctld (Hamlib) controlling your radio, Rig Bridge can connect to them. This way you do not need to change anything in your existing workflow.

#### flrig

1. Radio Type → **flrig**
2. Host → `127.0.0.1` (or the IP where flrig runs)
3. Port → **12345**

#### rigctld

1. Radio Type → **rigctld**
2. Host → `127.0.0.1`
3. Port → **4532**

---

## Connecting to OpenHamClock

### Scenario A — Everything on the same computer (most common)

OpenHamClock and Rig Bridge both run on your shack computer.

1. Make sure Rig Bridge is running and your radio is connected (green dot in the status bar)
2. Open OpenHamClock in your browser
3. Go to **Settings → Rig Bridge**
4. Tick **Enable Rig Bridge**
5. Host: `http://localhost` — Port: `5555`
6. Copy the **API Token** from the Rig Bridge setup page and paste it into the token field
7. Tick **Click-to-tune** if you want spot clicks to tune your radio
8. Click **Save**

That is it. Click any DX spot, POTA or SOTA activation on the map and your radio tunes automatically.

---

### Scenario B — Radio on one computer, OpenHamClock on another

For example: Rig Bridge runs on a Raspberry Pi or shack PC connected to the radio. OpenHamClock runs on a laptop elsewhere in the house.

**On the shack computer (where the radio is):**

1. Start Rig Bridge with network access enabled:
   - If running from source: `node rig-bridge.js --bind 0.0.0.0`
   - Or set `"bindAddress": "0.0.0.0"` in the config file
2. Find the shack computer's IP address (e.g. `192.168.1.50`)
3. Configure your radio at `http://192.168.1.50:5555`

**On the other computer (where OpenHamClock runs):**

1. Settings → Rig Bridge → Host: `http://192.168.1.50` — Port: `5555`
2. Paste the API Token from the shack computer's setup page
3. Save

> **Security note:** When you open Rig Bridge to the network (`0.0.0.0`), it is accessible to any device on your home network. The API Token protects it from unauthorised commands. Do not do this on a public or shared network.

---

### Scenario C — Using the cloud version at openhamclock.com _(Cloud Relay: Alpha)_

This lets you control your radio at home from anywhere in the world through the openhamclock.com website.

#### Step 1 — Install Rig Bridge on your home computer

Download and run Rig Bridge on the computer that is connected to your radio (see [Getting Started](#getting-started)).

#### Step 2 — Configure your radio

Open <http://localhost:5555> and set up your radio. Make sure the green "connected" dot appears.

#### Step 3 — Enable HTTPS on Rig Bridge

The openhamclock.com website uses a secure connection (HTTPS), and browsers will not allow it to talk to a non-secure Rig Bridge. You need to enable HTTPS first — see the [HTTPS Setup](#https-setup) section for the full walkthrough.

#### Step 4 — Connect from OpenHamClock

1. Go to <https://openhamclock.com> → **Settings → Rig Bridge**
2. Host: `https://localhost` — Port: `5555`
3. Paste your API Token
4. Click **Connect Cloud Relay**

How it works behind the scenes:

```text
Your shack                              openhamclock.com
────────────                            ────────────────
Radio (USB) ←→ Rig Bridge ──HTTPS──→  Your browser
  └─ WSJT-X                              └─ Click-to-tune
  └─ Direwolf/APRS TNC                   └─ PTT
  └─ Antenna rotator                     └─ FT8 decodes on map
```

---

## Digital Mode Software

Rig Bridge can receive decoded FT8, FT4, JT65, and other digital mode signals from your decoding software and display them live in OpenHamClock — all stations appear on the map in real time.

### Supported software

| Software    | Mode                          | Default Port | Maturity |
| ----------- | ----------------------------- | ------------ | -------- |
| **WSJT-X**  | FT8, FT4, JT65, JT9, and more | 2237         | Beta     |
| **JTDX**    | FT8, JT65 (enhanced decoding) | 2238         | Alpha    |
| **MSHV**    | MSK144, Q65, and others       | 2239         | Alpha    |
| **JS8Call** | JS8 keyboard messaging        | 2242         | Alpha    |

All of these are **bidirectional** — OpenHamClock can also send replies, stop transmit, set free text, and highlight callsigns in the decode window.

### Setting up WSJT-X (same steps apply to JTDX and MSHV)

**Step 1 — In WSJT-X:**

1. Open **File → Settings → Reporting**
2. Set **UDP Server** to `127.0.0.1`
3. Set **UDP Server port** to `2237`
4. Make sure **Accept UDP requests** is ticked

**Step 2 — In Rig Bridge:**

1. Open <http://localhost:5555> → **Plugins** tab
2. Find **WSJT-X Relay** and tick **Enable**
3. Click **Save**

Decoded stations will now appear on the OpenHamClock map. When you first open the map, the last 100 decoded stations are shown immediately — you do not have to wait for the next FT8 cycle.

> **⚠️ Important — start Rig Bridge before WSJT-X**
>
> Both programs listen on the same UDP port. Whichever starts first gets the port. Always start Rig Bridge first, then start WSJT-X (or JTDX / MSHV). If you see `UDP port already in use` in the Rig Bridge log, stop WSJT-X, restart Rig Bridge, then start WSJT-X again.

### Multicast — sharing decodes with multiple programs

By default, WSJT-X sends its decoded packets only to one listener. If you want both Rig Bridge and another program (e.g. GridTracker) to receive decodes at the same time, use multicast:

1. In WSJT-X: **File → Settings → Reporting → UDP Server** — set the address to `224.0.0.1`
2. In Rig Bridge → Plugins → WSJT-X Relay → tick **Enable Multicast**, group address `224.0.0.1`
3. Click **Save**

### HamQTH callsign lookup (optional)

When **HamQTH callsign lookup** is enabled in the WSJT-X Relay settings, Rig Bridge resolves unknown callsigns to country-level coordinates via the public [HamQTH DXCC API](https://www.hamqth.com/dxcc.php). This places map pins for stations whose FT8 message did not include a grid square.

**What to know before enabling it:**

- Lookups use the unauthenticated `dxcc.php` endpoint, which is intended for lookup tools. Rig Bridge caps requests at 2 per second globally and waits at least 60 seconds before retrying any individual callsign, so the traffic volume is modest even on a busy 20m FT8 band.
- Results are cached for 24 hours in `hamqth-cache.json` (stored alongside `rig-bridge-config.json`) and survive restarts, so each callsign is typically looked up only once per day.
- Lookups require outbound internet access (port 443) from the machine running Rig Bridge.
- If HamQTH is unreachable, decodes simply show no lat/lon for unresolved callsigns — no errors are shown and operation is otherwise unaffected.

---

## APRS via Local TNC _(Beta)_

If you run a local APRS TNC (for example, [Direwolf](https://github.com/wb2osz/direwolf) connected to a VHF radio), Rig Bridge can receive APRS packets from it and show nearby stations on the OpenHamClock map — without needing an internet connection.

This works alongside the regular internet-based APRS-IS feed. When the internet goes down, local RF keeps the map populated.

### Setup with Direwolf

1. Start Direwolf with KISS TCP enabled (it listens on port 8001 by default)
2. In Rig Bridge → Plugins tab → find **APRS TNC** → tick **Enable**
3. Protocol → **KISS TCP**
4. Host → `127.0.0.1`, Port → `8001`
5. Enter your callsign (required if you want to transmit beacons)
6. Click **Save**

APRS packets from nearby stations on RF will now appear alongside internet-sourced APRS stations on the map.

### MeshCom UDP Plugin

Receives MeshCom LoRa mesh network packets and forwards them to OHC. See [MeshCom UDP Plugin](#meshcom-udp-plugin) for full setup instructions.

| Setting   | Default   | Description                     |
| --------- | --------- | ------------------------------- |
| UDP Port  | `1799`    | Port MeshCom nodes broadcast to |
| Bind Host | `0.0.0.0` | Network interface to listen on  |

### APRS TNC Plugin

If you have a traditional hardware TNC connected via serial port:

| Setting         | Default     | Description                                             |
| --------------- | ----------- | ------------------------------------------------------- |
| Protocol        | `kiss-tcp`  | `kiss-tcp` for Direwolf, `kiss-serial` for hardware TNC |
| Host            | `127.0.0.1` | Direwolf KISS TCP host                                  |
| Port            | `8001`      | Direwolf KISS TCP port                                  |
| Callsign        | (required)  | Your callsign for TX                                    |
| SSID            | `0`         | APRS SSID                                               |
| Beacon Interval | `600`       | Seconds between position beacons (0 = disabled)         |

**With Direwolf:**

1. Start Direwolf with KISS enabled (default port 8001)
2. Enable the APRS TNC plugin in rig-bridge
3. Set your callsign
4. APRS packets from nearby stations appear in OHC's APRS panel

The APRS TNC runs alongside APRS-IS (internet) for dual-path coverage. When internet goes down, local RF keeps working.

### MeshCom UDP Plugin

Receives JSON packets broadcast by [MeshCom](https://github.com/icssw-org/MeshCom-Firmware) LoRa mesh network nodes over UDP and forwards them to OpenHamClock. MeshCom nodes appear on the OHC world map and in the dedicated MeshCom panel with live positions, battery levels, weather/telemetry, and text messages.

#### How it works

MeshCom firmware can broadcast its status packets as UDP JSON to the local network (`--extudp on`). Rig Bridge binds a UDP socket on port 1799, receives those packets, deduplicates them (the mesh rebroadcasts each packet via multiple paths), and forwards them to OpenHamClock via the Cloud Relay plugin — no direct HTTP connection from the plugin itself is needed.

```
MeshCom node (LoRa)
      │ UDP JSON broadcast (port 1799)
      ▼
Rig Bridge — meshcom-udp plugin
      │ dedup → normalise → bus.emit('meshcom')
      ▼
cloud-relay plugin ──HTTPS──→ OpenHamClock server
                                    │ POST /api/rig-bridge/relay/state
                                    ▼
                              meshcom route
                                    │ POST /api/meshcom/local/{pos|msg|telem}
                                    ▼
                              in-memory store
                                    │ GET /api/meshcom/nodes|messages|weather
                                    ▼
                              MeshCom panel + map
```

#### MeshCom firmware setup

Enable UDP output in your MeshCom node firmware. The exact method depends on your firmware version and hardware — typical options:

- **Serial/USB console:** `--extudp on` and `--extudpip 255.255.255.255`
- **Web config UI:** Enable _External UDP_, set IP to `255.255.255.255` (broadcast) or the specific IP of the machine running rig-bridge

The node will broadcast JSON packets to UDP port 1799 on the local network.

#### Rig Bridge setup

1. Open **http://localhost:5555** → **Plugins** tab
2. Enable **MeshCom UDP Receiver**
3. Set the **UDP Listen Port** (default `1799`) — must match the firmware's UDP destination port
4. Click **Save**

You should see in the console:

```
[MeshCom-UDP] Listening on 0.0.0.0:1799
```

When packets arrive:

```
[MeshCom-UDP] RX: {"type":"pos","src":"OE1XYZ-12","lat":48.2,"lat_dir":"N",...}
```

#### Config reference

| Field      | Description                                 | Default           |
| ---------- | ------------------------------------------- | ----------------- |
| `enabled`  | Activate the plugin on startup              | `false`           |
| `bindPort` | UDP port to listen on                       | `1799`            |
| `bindHost` | Network interface to bind (`0.0.0.0` = all) | `0.0.0.0`         |
| `sendHost` | Destination IP for outgoing messages        | `255.255.255.255` |
| `sendPort` | Destination UDP port for outgoing messages  | `1799`            |
| `verbose`  | Log every received packet to the console    | `false`           |

Manual config in `rig-bridge-config.json`:

```json
{
  "meshcom": {
    "enabled": true,
    "bindPort": 1799,
    "bindHost": "0.0.0.0",
    "sendHost": "255.255.255.255",
    "sendPort": 1799,
    "verbose": false
  }
}
```

#### Packet types

| Type    | Description                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pos`   | Node position — callsign, lat/lon, altitude, battery                                                                               |
| `msg`   | Text message — source, destination (callsign, group, or `*` for broadcast)                                                         |
| `telem` | Weather/sensor data — temperature (`temp`→`tempC`), humidity, pressure (`pressure`→`pressureHpa`), CO₂ (`co2`→`co2ppm`), RSSI, SNR |

Altitude is converted from feet (MeshCom GPS) to metres automatically. Firmware version strings are normalised across local-node and relay-hop encoding variants.

#### Deduplication

LoRa mesh networks rebroadcast each packet via multiple paths, so the same packet can arrive many times within seconds. The plugin deduplicates by `hw_id + msg_id` with a 60-second TTL — only the first copy is forwarded.

#### OpenHamClock data retention

On the OHC server, received data is held in memory:

| Data     | Retention                                                        | Env override                    |
| -------- | ---------------------------------------------------------------- | ------------------------------- |
| Nodes    | 60 minutes after last packet (stale nodes removed automatically) | `MESHCOM_NODE_MAX_AGE_MINUTES`  |
| Messages | 8 hours (oldest messages pruned every minute)                    | `MESHCOM_MESSAGE_MAX_AGE_HOURS` |

#### Troubleshooting

| Problem                          | Solution                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No packets arriving              | Verify `--extudp on` is set in MeshCom firmware; check UDP destination IP reaches the rig-bridge host                                |
| Port already in use              | Another app is listening on 1799 — change `bindPort` in rig-bridge and in firmware                                                   |
| Duplicate packets in OHC         | Normal — dedup is active; if you see duplicates, check that `hw_id` is present in firmware packets                                   |
| Nodes appear but no map marker   | Node has no GPS fix yet — position packets without valid coordinates are stored but not mapped                                       |
| Altitude shows wrong value       | Plugin converts MeshCom GPS feet → metres automatically; values should be correct                                                    |
| MeshCom panel not visible in OHC | Requires Cloud Relay to be configured and connected (see [Scenario 3](#scenario-3-cloud-relay-ohc-on-openhamclockcom-radio-at-home)) |

---

### Rotator Plugin

Controls antenna rotators via Hamlib's `rotctld`.

1. Start rotctld: `rotctld -m 202 -r /dev/ttyUSB1 -t 4533`
2. Enable the Rotator plugin in rig-bridge
3. Set host and port (default: `127.0.0.1:4533`)

### Winlink Plugin

Two features:

- **Gateway Discovery** — shows nearby Winlink RMS gateways on the map (requires API key from winlink.org)
- **Pat Client** — integrates with [Pat](https://getpat.io/) for composing and sending Winlink messages over RF

### Cloud Relay Plugin

Bridges a locally-running rig-bridge to a cloud-hosted OpenHamClock instance so cloud users get the same rig control as local users — click-to-tune, PTT, WSJT-X decodes, APRS packets.

See [Scenario 3](#scenario-3-cloud-relay-ohc-on-openhamclockcom-radio-at-home) for setup instructions.

**How latency is minimised:**

| Path                  | Mechanism                                              | Typical latency |
| --------------------- | ------------------------------------------------------ | --------------- |
| Rig state → browser   | Event-driven push + SSE fan-out                        | < 100 ms        |
| Browser command → rig | Long-poll (server wakes rig-bridge on command arrival) | ~RTT (< 100 ms) |

The rig-bridge holds a persistent long-poll connection to the server. The moment you click PTT or a DX spot, the server wakes that connection and delivers the command — no fixed poll tick to wait for.

**Config reference:**

| Field          | Description                                     | Default |
| -------------- | ----------------------------------------------- | ------- |
| `enabled`      | Activate the relay on startup                   | `false` |
| `url`          | Cloud OHC server URL                            | —       |
| `apiKey`       | Relay authentication key (from your OHC server) | —       |
| `session`      | Browser session ID for per-user isolation       | —       |
| `pushInterval` | Fallback push interval for batched data (ms)    | `2000`  |
| `relayRig`     | Relay rig state (freq, mode, PTT)               | `true`  |
| `relayWsjtx`   | Relay WSJT-X decodes                            | `true`  |
| `relayAprs`    | Relay APRS packets from local TNC               | `false` |
| `verbose`      | Log all relay activity to the console           | `false` |

---

## Antenna Rotator _(Alpha)_

Rig Bridge can control antenna rotators via [Hamlib's](https://hamlib.github.io/) `rotctld` daemon.

1. Start rotctld for your rotator model, for example:

   ```bash
   rotctld -m 202 -r /dev/ttyUSB1 -t 4533
   ```

2. In Rig Bridge → Plugins tab → find **Rotator** → tick **Enable**
3. Host → `127.0.0.1`, Port → `4533`
4. Click **Save**

---

## HTTPS Setup

### Do I need this?

**Yes**, if you use openhamclock.com or any other HTTPS-hosted version of OpenHamClock.

**No**, if you run OpenHamClock locally on your own computer (e.g. <http://localhost:3000>) — you can skip this section.

### Why is HTTPS needed?

Web browsers have a security rule called "mixed content": a page loaded over a secure connection (`https://`) is not allowed to communicate with a non-secure address (`http://`). Because openhamclock.com uses HTTPS, it cannot talk to Rig Bridge unless Rig Bridge also uses HTTPS.

Rig Bridge solves this by generating its own security certificate — a small file that proves the connection is encrypted. Because the certificate is created by Rig Bridge itself (not by a certificate authority), your browser will not automatically trust it. You need to install it once, which tells your browser "I trust this certificate on this computer".

### Complete step-by-step setup

#### Step 1 — Enable HTTPS in Rig Bridge

1. Open **h<ttp://localhost:5555>** in your browser
2. Click the **🔒 Security** tab
3. Tick **Enable HTTPS**
4. Rig Bridge will generate a certificate automatically (takes a few seconds)
5. **Quit and restart Rig Bridge**
6. From now on, open **<https://localhost:5555>** (note the `s` in `https`)

#### Step 2 — Deal with the browser warning

The first time you open <https://localhost:5555> after enabling HTTPS, your browser will show a security warning. This is expected — the certificate is genuine, but your browser does not yet trust it.

**Chrome / Edge:**

1. On the warning page, click **Advanced**
2. Click **Proceed to localhost (unsafe)**

**Firefox:**

1. On the warning page, click **Advanced**
2. Click **Accept the Risk and Continue**

**Safari:**

1. Click **Show Details**
2. Click **visit this website**
3. Enter your macOS password if asked

You only need to do this once.

#### Step 3 — Install the certificate so you never see the warning again

Installing the certificate permanently tells your computer to trust Rig Bridge's HTTPS connection. After this, the browser will show a normal padlock icon with no warnings.

**Easiest way — use the Install button:**

1. Make sure you are on **<https://localhost:5555>** (accepted the warning in Step 2)
2. Go to the **🔒 Security** tab
3. Click **⬇ Download Certificate** — save the file `rig-bridge.crt`
4. Click **Install Certificate** — Rig Bridge will try to install it automatically

If the Install button succeeds, you are done. If it asks for a password or fails, follow the manual steps for your operating system below.

---

**macOS — manual install:**

1. Download the certificate from the Security tab
2. Double-click `rig-bridge.crt`
3. Keychain Access opens — the certificate appears under **login** keychain
4. Double-click the certificate in Keychain Access
5. Expand **Trust** → set **When using this certificate** to **Always Trust**
6. Close the window and enter your macOS password when asked
7. Restart your browser

Or in Terminal:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ~/.config/openhamclock/certs/rig-bridge.crt
```

---

**Windows — manual install:**

1. Download the certificate from the Security tab
2. Double-click `rig-bridge.crt`
3. Click **Install Certificate**
4. Select **Local Machine** → click Next
5. Select **Place all certificates in the following store** → click Browse
6. Select **Trusted Root Certification Authorities** → OK
7. Click Next → Finish
8. Restart your browser

Or in Command Prompt (run as Administrator):

```cmd
certutil -addstore -f ROOT %APPDATA%\openhamclock\certs\rig-bridge.crt
```

---

**Linux — manual install:**

1. Download the certificate from the Security tab
2. Open a terminal and run:

   ```bash
   sudo cp ~/Downloads/rig-bridge.crt /usr/local/share/ca-certificates/
   sudo update-ca-certificates
   ```

3. Import the certificate into your browser:
   - **Chrome / Chromium:** Settings → Privacy & Security → Manage Certificates → Authorities → Import
   - **Firefox:** Settings → Privacy & Security → View Certificates → Authorities → Import → tick "Trust this CA to identify websites"

---

#### Step 4 — Update OpenHamClock settings

Now that Rig Bridge is running on HTTPS, update the address in OpenHamClock:

1. Open OpenHamClock → **Settings → Rig Bridge**
2. Change Host from `http://localhost` to **`https://localhost`**
3. Port stays **5555**
4. Click **Save**

#### Step 5 — Verify everything works

- The padlock icon appears in your browser's address bar when visiting <https://localhost:5555> ✓
- The status bar in OpenHamClock shows Rig Bridge as connected ✓
- Clicking a spot tunes your radio ✓

### Reverting to plain HTTP

If you ever want to go back to plain HTTP (for example, if you stop using openhamclock.com):

1. Open <https://localhost:5555> → **🔒 Security** tab
2. Untick **Enable HTTPS**
3. Restart Rig Bridge
4. Open **<http://localhost:5555>** again and update OpenHamClock settings to `http://localhost`

### Certificate storage location

The certificate file is stored here on your computer:

| Operating System  | Certificate file                              |
| ----------------- | --------------------------------------------- |
| **macOS / Linux** | `~/.config/openhamclock/certs/rig-bridge.crt` |
| **Windows**       | `%APPDATA%\openhamclock\certs\rig-bridge.crt` |

The certificate is valid for 10 years and is regenerated only if you click **Regenerate** in the Security tab. It does not expire with Rig Bridge updates.

---

## Troubleshooting

| Problem                                                      | What to try                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **No COM ports shown**                                       | Install the USB driver for your radio. Yaesu/Icom typically use the Silicon Labs CP210x driver. Kenwood and some others use FTDI. |
| **Port opens but radio does not respond**                    | Check the baud rate matches what is set in your radio's menus.                                                                    |
| **Icom not responding**                                      | Double-check the CI-V address matches your exact radio model.                                                                     |
| **PTT not working**                                          | Try enabling **Hardware Flow (RTS/CTS)** in the radio settings (especially for FT-991A, FT-710).                                  |
| **Port already in use**                                      | If you have flrig or rigctld running, close them first — Rig Bridge talks to the radio directly and they would conflict.          |
| **macOS: "Comms Failure"**                                   | Rig Bridge applies a serial port fix automatically on macOS. If problems persist, try unplugging and replugging the USB cable.    |
| **WSJT-X decodes not appearing**                             | Make sure WSJT-X UDP Server is set to `127.0.0.1:2237` in File → Settings → Reporting. Start Rig Bridge before WSJT-X.            |
| **TCI: Connection refused**                                  | Enable TCI Server in your SDR software (Thetis: Setup → CAT Control → Enable TCI Server).                                         |
| **SmartSDR: no connection**                                  | Confirm the FlexRadio is on and reachable on your network. Default API port is 4992.                                              |
| **RTL-SDR: connection refused**                              | Start `rtl_tcp` before Rig Bridge: `rtl_tcp -a 127.0.0.1 -p 1234`. Check no other program (e.g. SDR#) has the dongle open.        |
| **Browser shows mixed-content error**                        | OpenHamClock is on HTTPS but Rig Bridge is on HTTP. Follow the [HTTPS Setup](#https-setup) guide.                                 |
| **HTTPS: browser still shows warning after installing cert** | Restart your browser completely (close all windows, not just the tab).                                                            |
| **Cloud Relay: 401 / 403 error**                             | The API Token in Rig Bridge does not match what OpenHamClock has. Copy the token again from the Rig Bridge setup page.            |
| **Cloud Relay: PTT / tune feels slow**                       | Make sure Rig Bridge version is 2.0 or newer. Older versions used a slower polling method.                                        |

---

## Glossary

### Maturity levels

Components and plugins in Rig Bridge are labelled with a maturity level to help you set
expectations before enabling them.

| Level     | Meaning                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alpha** | Test implementation with no rigid testing yet. Use with caution — behaviour may change and bugs are expected. Feedback and bug reports are especially welcome. |
| **Beta**  | Already tested more intensively, but still experimental status. More stable than Alpha, but not yet considered production-ready.                               |

Unlabelled components (USB radio control, flrig, rigctld, TCI, SmartSDR) are considered
stable and have been tested across multiple hardware setups.

---

## Advanced Topics

The sections below are for technically minded users or developers who want to go deeper.

### Where is the config file stored?

Rig Bridge saves its settings to a file in your user folder. This file survives updates — installing a new version of Rig Bridge will never overwrite your settings.

| Operating System  | Config file location                            |
| ----------------- | ----------------------------------------------- |
| **macOS / Linux** | `~/.config/openhamclock/rig-bridge-config.json` |
| **Windows**       | `%APPDATA%\openhamclock\rig-bridge-config.json` |

### Command-line options

```bash
node rig-bridge.js --port 8080     # Use a different port (default: 5555)
node rig-bridge.js --bind 0.0.0.0  # Allow access from other computers on your network
node rig-bridge.js --debug         # Show raw CAT command traffic in the log
node rig-bridge.js --version       # Print the version number
```

### Building standalone executables

To create the self-contained executables (no Node.js installation required on the target machine):

```bash
npm install
npm run build:win        # Windows (.exe)
npm run build:mac        # macOS Intel
npm run build:mac-arm    # macOS Apple Silicon (M1/M2/M3/M4)
npm run build:linux      # Linux x64
npm run build:linux-arm  # Linux ARM (Raspberry Pi)
npm run build:all        # All of the above
```

Executables are saved to the `dist/` folder.

### API reference

Rig Bridge exposes a simple HTTP API — compatible with the original rig-daemon format:

| Method | Endpoint      | Description                                               |
| ------ | ------------- | --------------------------------------------------------- |
| GET    | `/status`     | Current frequency, mode, PTT state, and connection status |
| GET    | `/stream`     | Real-time updates via SSE (Server-Sent Events)            |
| POST   | `/freq`       | Tune radio: `{ "freq": 14074000 }` (frequency in Hz)      |
| POST   | `/mode`       | Set mode: `{ "mode": "USB" }`                             |
| POST   | `/ptt`        | Key transmitter: `{ "ptt": true }`                        |
| GET    | `/api/ports`  | List available serial ports                               |
| GET    | `/api/config` | Read current configuration                                |
| POST   | `/api/config` | Save configuration and reconnect                          |
| POST   | `/api/test`   | Test a serial port without connecting                     |
| GET    | `/api/status` | Lightweight health check                                  |

### Project structure

```text
rig-bridge/
├── rig-bridge.js          # Entry point
├── core/
│   ├── config.js          # Config load/save, defaults, CLI args
│   ├── tls.js             # HTTPS certificate generation and management
│   ├── state.js           # Shared rig state and SSE broadcast
│   ├── server.js          # HTTP/HTTPS server and all API routes
│   ├── plugin-registry.js # Plugin lifecycle manager
│   └── serial-utils.js    # Serial port helpers
├── lib/
│   ├── message-log.js     # Persistent message log
│   ├── kiss-protocol.js   # KISS frame encode/decode (APRS TNC)
│   ├── wsjtx-protocol.js  # WSJT-X UDP protocol parser
│   └── aprs-parser.js     # APRS packet decoder
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
    ├── wsjtx-relay.js     # WSJT-X UDP listener → OpenHamClock relay
    ├── mshv.js            # MSHV UDP listener (multi-stream digital modes)
    ├── jtdx.js            # JTDX UDP listener (FT8/JT65 enhanced decoding)
    ├── js8call.js         # JS8Call UDP listener (JS8 keyboard messaging)
    ├── aprs-tnc.js        # APRS KISS TNC plugin (Direwolf / hardware TNC)
    ├── meshcom-udp.js     # MeshCom LoRa mesh UDP receiver (port 1799)
    ├── rotator.js         # Antenna rotator via rotctld (Hamlib)
    ├── winlink-gateway.js # Winlink RMS gateway discovery + Pat client
    └── cloud-relay.js     # Cloud relay — bridges local rig-bridge to cloud OHC
```

### Writing a plugin

Each plugin is a JavaScript module that exports a descriptor object:

```js
module.exports = {
  id: 'my-plugin', // unique ID — matches config.radio.type for rig plugins
  name: 'My Plugin',
  category: 'rig', // 'rig' | 'integration' | 'rotator' | 'logger' | 'other'
  configKey: 'radio', // which config section this plugin reads

  create(config, services) {
    const { updateState, state, pluginBus, messageLog } = services;

    return {
      connect() {
        /* open connection to radio */
      },
      disconnect() {
        /* close connection */
      },
      setFreq(hz) {
        /* tune to frequency in Hz */
      },
      setMode(mode) {
        /* set mode string, e.g. 'USB' */
      },
      setPTT(on) {
        /* key or unkey the transmitter */
      },

      // Optional: register extra HTTP routes
      // registerRoutes(app) { app.get('/my-plugin/data', handler) }
    };
  },
};
```

To activate a plugin, call `registry.register(descriptor)` in `rig-bridge.js` before `registry.connectActive()`.

**Plugin categories:**

- `rig` — radio control; `/freq`, `/mode`, `/ptt` are dispatched to the active rig plugin
- `integration` — background service (e.g. WSJT-X relay); started via `registry.connectIntegrations()`
- `rotator`, `logger`, `other` — use `registerRoutes()` to add their own API endpoints
