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
7. [Forwarding QSOs to Wavelog _(Beta)_](#forwarding-qsos-to-wavelog-beta)
8. [APRS via Local TNC _(Beta)_](#aprs-via-local-tnc-beta)
9. [MeshCom UDP _(Beta)_](#meshcom-udp-plugin-beta)
10. [Winlink Express CSV Ingest _(Beta)_](#winlink-express-csv-ingest-beta)
11. [NBEMS: fldigi and flmsg _(Beta)_](#nbems-fldigi-and-flmsg-beta)
12. [Antenna Rotator](#antenna-rotator-alpha)
13. [Raspberry Pi Hardware _(Alpha)_ — GPS, BME280, GPIO, brightness](#raspberry-pi-hardware-alpha)
14. [HTTPS Setup (needed for openhamclock.com)](#https-setup)
15. [Troubleshooting](#troubleshooting)
16. [Glossary](#glossary)
17. [Advanced Topics](#advanced-topics)

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

### Mode overrides (per-rig mode names)

When you click a spot, OpenHamClock sends the rig a standard mode name: `CW`, `CW-R`, `USB`, `LSB`, `DATA-USB`, `DATA-LSB`, `FM`, or `AM` (digital modes like FT8 arrive as `DATA-USB`/`DATA-LSB`). Some radios want a different name — an FT-817/818 via flrig calls its digital mode `DIG`, some Hamlib backends use `PKTUSB` instead of `DATA-USB`, and some ops simply prefer `CW-R` over `CW`.

Mode overrides let you remap any incoming mode before it reaches your radio. They work with **every** radio type (USB CAT, flrig, rigctld, TCI, SmartSDR).

**Setup page:** Radio tab → **Mode Overrides** — one `FROM = TO` pair per line:

```
DATA-USB = DIG
CW = CW-R
```

**Config file:** add a `modeOverrides` object to the `radio` section:

```json
"radio": {
  "type": "flrig",
  "modeOverrides": {
    "DATA-USB": "DIG",
    "CW": "CW-R"
  }
}
```

Notes:

- The `FROM` side is matched case-insensitively; the `TO` side is sent to the rig exactly as written.
- The `TO` value must be a mode your backend understands — flrig wants the mode names it shows in its own mode list, rigctld wants Hamlib names (`PKTUSB`, `PKTLSB`, etc.), and direct USB CAT rigs support the standard names built into the protocol (unknown names are ignored).
- Overrides only affect commands _to_ the radio. The mode reported back from the radio is shown unchanged.
- An empty list means no remapping — everything behaves exactly as before.

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
5. In the Rig Bridge setup page (Plugins → **Cloud Relay**), enter the **OHC Server URL**, **Relay API Key**, **Session ID** and **Command Key** shown by OpenHamClock (they are also on your clipboard), and save.

The **Command Key** is made by your browser and goes only to Rig Bridge — the OpenHamClock server never sees it. Every tune, PTT or transmit command from that browser is signed with it, and Rig Bridge refuses commands without a valid signature, so neither the server nor anyone who learns your session id can operate your radio. Each command can be used once and only within five minutes, so a captured command cannot be replayed. Using another browser? Press **Connect Cloud Relay** there and paste the new settings; the old browser then stops working.

The same key also protects **reading** the relay — your rig state, decodes, APRS and the live stream. Rig Bridge derives a separate read token from it and gives the server only that token's hash; your browser derives the same token and presents it, so knowing the session id is no longer enough to watch your station. The live stream opens with a one-time ticket, so no secret ever appears in a URL. A relay paired before command keys existed can still be read with the session id alone until **31 January 2027** (the server logs a reminder), then reads are refused until you reconnect it.

**Paired before command keys existed?** Rig Bridge keeps accepting unsigned **tuning** (frequency and mode) from such a pairing until **31 January 2027** (`unsignedGraceUntil` in the `cloudRelay` settings) and logs a reminder; it never accepts unsigned **PTT** or anything that transmits. To fix it, press **Disconnect Cloud Relay** and then **Connect Cloud Relay** in OpenHamClock Settings and paste the new settings into Rig Bridge. `"allowUnsigned": true` restores the old behaviour of accepting every command unsigned; it is unsafe and only meant for a bridge you cannot re-pair yet.

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

## Forwarding QSOs to Wavelog _(Beta)_

The **wavelog-forward** plugin sends every QSO your logger records to a
[Wavelog](https://www.wavelog.org) logbook, with no browser needed. It listens
for the "QSO logged" ADIF packets that N1MM-compatible loggers broadcast on
the LAN and posts each one to Wavelog's API.

**1. Make your logger broadcast logged QSOs as ADIF.** In RUMlogNG: Preferences
→ UDP → set a "Contact info" row to **Contact info ADIF** (or **Contact N1MM &
ADIF**), host `255.255.255.255`, port `12060`. Other loggers that send
`<QsoLoggedInfoAdif>` packets work the same way.

**2. Create an API key in Wavelog** with read/write rights (Account → API
keys), and note the station profile ID the QSOs belong to (shown in the URL
when editing a station profile).

**3. Configure Rig Bridge** in `rig-bridge-config.json`:

```json
"wavelogForward": {
  "enabled": true,
  "url": "https://log.example.com",
  "apiKey": "your-wavelog-api-key",
  "stationProfileId": "1",
  "udpPort": 12060
}
```

Restart Rig Bridge; the log shows `[WavelogForward] Listening on UDP …` and
`Forwarded <call> <date> <time> <band> <mode>` for each QSO. Status is at
`/api/wavelog-forward/status`.

- **Nothing is lost while Wavelog is unreachable**: QSOs are queued in
  `wavelog-forward-queue.json` next to the config file and retried with
  backoff, including after a restart. Wavelog skips duplicates on import, so a
  retry never logs a QSO twice.
- **Rejected QSOs are dropped**, not retried: a wrong API key or station
  profile shows up as `Wavelog rejected …` in the log and in `lastError`.
- **Only new QSOs are sent.** Edits and deletes in the logger arrive as N1MM
  replace/delete packets, which Wavelog's API cannot apply.
- The UDP port is shared (`reuseAddr`), so other programs can listen on
  `12060` too.

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

### MeshCom UDP Plugin _(Beta)_

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

### MeshCom UDP Plugin _(Beta)_

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

| Problem                          | Solution                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No packets arriving              | Verify `--extudp on` is set in MeshCom firmware; check UDP destination IP reaches the rig-bridge host                                                    |
| Port already in use              | Another app is listening on 1799 — change `bindPort` in rig-bridge and in firmware                                                                       |
| Duplicate packets in OHC         | Normal — dedup is active; if you see duplicates, check that `hw_id` is present in firmware packets                                                       |
| Nodes appear but no map marker   | Node has no GPS fix yet — position packets without valid coordinates are stored but not mapped                                                           |
| Altitude shows wrong value       | Plugin converts MeshCom GPS feet → metres automatically; values should be correct                                                                        |
| MeshCom panel not visible in OHC | Works in both local/direct mode and Cloud Relay mode. Check that the `meshcom` plugin is enabled in rig-bridge config and that OHC can reach rig-bridge. |

---

## Winlink Express CSV Ingest _(Beta)_

Feeds Winlink Express form traffic into OpenHamClock's **EmComm layout**. At an EOC, Winlink Express accumulates a continuously-updated CSV of received forms (Field Situation Reports, Damage Assessments, ICS-213, ...) with embedded geolocation. There is no Winlink Express API — the CSV file on disk **is** the interface, so this plugin watches that file and forwards new rows to your OpenHamClock server, where they appear in the EmComm sidebar's **Field Reports** panel and as 📋 markers on the map.

```
Winlink Express ──writes──→ forms CSV on disk
                                  │ fs.watch + 30 s polling fallback
Rig Bridge — winlink-express-csv plugin
                                  │ tolerant parse → dedupe by row hash
                                  │ POST /api/emcomm/field-reports
OpenHamClock server ──→ EmComm layout (Field Reports panel + map markers)
```

#### Setup

1. In Winlink Express, note the path of the CSV export the EOC workflow maintains (or set one up via the form export/auto-export feature).
2. In `rig-bridge-config.json`, enable the plugin and point it at that file:

```json
{
  "winlinkExpressCsv": {
    "enabled": true,
    "csvPath": "C:\\Winlink Express\\Exports\\field-reports.csv",
    "pollInterval": 30,
    "ohcUrl": "http://localhost:8080",
    "verbose": false
  }
}
```

3. Restart rig-bridge. New rows are forwarded within a second of a file change (or at worst one poll interval later). Switch OpenHamClock to the EmComm layout to see them.

#### Config reference

| Field          | Description                                                       | Default                 |
| -------------- | ----------------------------------------------------------------- | ----------------------- |
| `enabled`      | Activate the plugin on startup                                    | `false`                 |
| `csvPath`      | Absolute path to the Winlink Express CSV export file              | `""` (required)         |
| `pollInterval` | Seconds between polls (fs.watch also fires immediately on change) | `30`                    |
| `ohcUrl`       | URL of the OpenHamClock server to POST reports to                 | `http://localhost:8080` |
| `verbose`      | Log every parse/post to the console                               | `false`                 |

#### Parsing tolerance

Column sets vary between Winlink Express versions and form templates, so parsing is **header-driven**: the first row's column names are matched case-insensitively (punctuation and spacing ignored) against known aliases:

| Canonical field | Recognized column names (examples)                             |
| --------------- | -------------------------------------------------------------- |
| Callsign        | `Callsign`, `Call`, `From`, `Sender`, `Station`                |
| Form type       | `Form Type`, `Form`, `Template`, `Message Type`, `Type`        |
| Latitude        | `Latitude`, `Lat`, `GPS Latitude`                              |
| Longitude       | `Longitude`, `Lon`, `Long`, `Lng`, `GPS Longitude`             |
| Timestamp       | `Date/Time`, `Date`, `Time Received`, `Timestamp`, `Posted`    |
| Free text       | `Comments`, `Remarks`, `Message`, `Notes`, `Brief Description` |

Coordinates accept decimal degrees (`39.0997`, `-94.5786`), hemisphere suffixes (`38.95N`, `94.60W`), and degrees-decimal-minutes (`35-07.40N`). Quoted fields with embedded commas/newlines, repeated header lines, and blank lines are handled. **Unknown columns are preserved** and forwarded alongside the report, so template-specific fields aren't lost.

Rows are deduplicated by a content hash, so re-reading the whole file after every change never re-posts old reports. The OHC server keeps the most recent 500 reports (persisted across restarts).

#### Troubleshooting

| Problem                         | Solution                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "CSV not found" in the log      | Check `csvPath` — it must be an absolute path readable by the rig-bridge process                          |
| No reports in the EmComm panel  | Check `ohcUrl` points at your OHC server; watch rig-bridge logs for `POST failed` lines                   |
| Reports have no map marker      | The row's latitude/longitude column was missing or unparseable — the report still shows in the panel list |
| Changes only appear after ~30 s | fs.watch is unreliable on network shares — polling picks changes up; lower `pollInterval` if needed       |

Plugin status endpoint: `GET http://localhost:5555/api/winlink-express-csv/status`

---

## NBEMS: fldigi and flmsg _(Beta)_

NBEMS (fldigi for the modem, flmsg for the forms) is how many ARES groups pass ICS-213 messages and radiograms over HF and VHF. The `fldigi` plugin brings both into OpenHamClock's **EmComm layout**:

- **fldigi** — connection, mode, dial frequency, audio offset and TX/RX state; a live tail of the receive pane; a send box; a mode picker; and a compact ICS-213 form that goes out through fldigi. All of it shows in the EmComm layout's **NBEMS** panel, on the same network or through the Cloud Relay.
- **flmsg** — forms received over the air (ICS-213, radiograms, and other flmsg forms, compressed or not) are parsed and forwarded to your OpenHamClock server. They appear in the **Field Reports** panel tagged **NBEMS**, with the form type (for example `ICS-213 (NBEMS)`), and as 📋 map markers when the form carries a position.

```
fldigi ◀──XML-RPC :7362──▶ Rig Bridge — fldigi plugin ──SSE /stream (or Cloud Relay)──▶ EmComm · NBEMS panel
                                       │
~/NBEMS.files/WRAP/recv    ──watch──▶  │ received transfers
~/NBEMS.files/ICS/messages ──watch──▶  │ forms saved in flmsg (received ones only)
                                       │ POST /api/emcomm/field-reports
                                       ▼
                         OpenHamClock server ──▶ Field Reports panel + map markers
```

#### Setup

1. **fldigi:** nothing to change — its XML-RPC server listens on `127.0.0.1:7362` by default. If you changed it, it is under fldigi's _Configure → Misc → TCP-IP sockets_ (XML-RPC).
2. **flmsg:** keep using it as usual. fldigi saves every flmsg transfer it decodes to `NBEMS.files/WRAP/recv` (as `extract-<date>-<time>.wrap`), and flmsg saves the forms you open, write or send to `NBEMS.files/ICS/messages`. Both folders sit in your home directory on Linux, macOS and Windows (`C:\Users\<you>\NBEMS.files` on Windows).
3. In the Rig Bridge setup page, open **Plugins**, switch on **fldigi + flmsg (NBEMS)**, set **Your Callsign** (it goes into the header of forms you send, and tells your own forms from received ones) and the **OpenHamClock server URL**, then save. Or in `rig-bridge-config.json`:

```json
{
  "fldigi": {
    "enabled": true,
    "url": "http://127.0.0.1:7362",
    "callsign": "KE8PLM",
    "ohcUrl": "http://localhost:3000"
  }
}
```

Leave **Your Callsign** blank and the plugin uses the callsign set in flmsg.

4. Switch OpenHamClock to the EmComm layout. The **NBEMS** panel shows fldigi's state within a second, and forms received in the last 72 hours appear in Field Reports.

Sending (text, ICS-213, mode change, Stop TX) on the same network goes from the browser straight to Rig Bridge, like click-to-tune, with your Rig Bridge API token when one is set (Settings → Rig Bridge). With the Cloud Relay the command travels through your OpenHamClock server, signed with the relay's command key — see [NBEMS over the Cloud Relay](#nbems-over-the-cloud-relay) below.

#### Config reference

| Field               | Description                                                                                                                        | Default                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `enabled`           | Activate the plugin on startup                                                                                                     | `false`                 |
| `url`               | fldigi's XML-RPC address                                                                                                           | `http://127.0.0.1:7362` |
| `pollInterval`      | Milliseconds between status and receive-text polls (minimum 250)                                                                   | `1000`                  |
| `rxBufferChars`     | Receive text kept for browsers that connect later                                                                                  | `4000`                  |
| `maxTxSeconds`      | Transmit watchdog: a transmission still running after this long is aborted and fldigi set to receive                               | `600`                   |
| `callsign`          | This station's callsign: written into forms you send, and used to tell your own forms from received ones. Blank = flmsg's callsign | `""`                    |
| `flmsgEnabled`      | Watch the flmsg folders for forms                                                                                                  | `true`                  |
| `flmsgDirs`         | Folders to watch, separated by `;` — blank means `NBEMS.files/WRAP/recv` and `NBEMS.files/ICS/messages`                            | `""`                    |
| `flmsgPollInterval` | Seconds between folder scans (file-system events also trigger a scan straight away)                                                | `15`                    |
| `flmsgMaxAgeHours`  | At start-up, forms older than this are remembered but not reported                                                                 | `72`                    |
| `flmsgIncludeLocal` | Also forward your own drafts and sent forms to Field Reports (tagged LOCAL)                                                        | `false`                 |
| `flmsgDateFormat`   | How dates such as `03/04/26` are read: `auto`, `mdy`, `dmy`, `ymd` or `ydm` — see [Dates](#form-dates)                             | `auto`                  |
| `serverForward`     | POST forms to the OpenHamClock server                                                                                              | `true`                  |
| `ohcUrl`            | OpenHamClock server URL                                                                                                            | `http://localhost:3000` |
| `verbose`           | Log every TX completion and other detail                                                                                           | `false`                 |

Changes saved from the setup page restart the plugin; no Rig Bridge restart is needed.

#### How it talks to fldigi

| Job          | fldigi XML-RPC calls                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Status       | `main.get_frequency`, `modem.get_name`, `modem.get_carrier`, `main.get_trx_status` (`rx`, `tx` or `tune`)                  |
| On connect   | `fldigi.version`, `modem.get_names` (the mode list for the picker)                                                         |
| Receive text | `text.get_rx_length` + `text.get_rx` — reads the receive pane without consuming it (`rx.get_data` on builds without these) |
| Send         | `text.add_tx` with `^r` appended, then `main.tx`                                                                           |
| Mode         | `modem.set_by_name`                                                                                                        |
| Stop TX      | `main.abort`, `text.clear_tx`, `main.rx`                                                                                   |

Text added with `text.add_tx` goes into fldigi's transmit pane, where `^r` is a control code: when fldigi reaches it, it clears the pane and returns to receive. That is why `^` typed in your own text is sent as a space. Messages go out one at a time; the next starts only after fldigi is back on receive. If fldigi is closed or restarted the panel shows _not connected_ and the plugin retries every 2 s, backing off to 30 s, until it answers again.

#### Forms

- **Received or yours?** Everything in `WRAP/recv` was received over the air. `ICS/messages` holds whatever flmsg saved: your drafts, forms you sent, and received forms you opened and saved. flmsg records who sent a form in its header, and only when it is actually sent, so the plugin reads that: a form never sent is a draft, a form last sent by your callsign is yours, a form last sent by another station is received. Only received forms go to Field Reports, unless `flmsgIncludeLocal` is on (then yours show with a LOCAL tag). This needs your callsign (the plugin's **Your Callsign**, or the one set in flmsg): without it a sent form in `ICS/messages` could be yours or someone else's, so it is forwarded tagged **ORIGIN?**, and the NBEMS panel and the Rig Bridge setup page show a warning. Drafts (never sent) are recognised either way. A received transfer and the copy you saved from it count once.
- **ICS-213** fields (incident, to/from with positions, subject, date, time, message, approved-by) are read by name. The report's text is the subject and message; the details travel with it. **HICS-213**, **radiograms** and **IARU messages** are read by their own fields (for radiograms the station of origin becomes the report's callsign). Other flmsg forms (ICS-205, ICS-214, plain text, ...) are listed under their form name with their raw fields.
- **Positions:** an ICS-213 has no position field, so put one in the message: `GRID EM29qb`, `LAT 39.10 LON -94.58`, or a decimal pair such as `39.0997, -94.5786`. Forms without one still appear in the list.
- **Checksums:** received transfers are checked against their CRC-16 the way flmsg checks them, including transfers whose line ends changed on the air. A mismatch shows in the report's details as `checksum: MISMATCH`; the form is still listed.
- **Compressed transfers** (flmsg's compression option) are decoded. If the log says the LZMA decoder is missing, run `npm install` in the `rig-bridge` folder (installs from source only; the standalone builds include it).

**Send ICS-213** (the ICS-213 button in the NBEMS panel, or `POST /api/fldigi/send-ics213`) writes the form exactly as flmsg does, dated now in UTC, wraps it with flmsg's checksum and transmits it in fldigi's current mode, framed the way flmsg frames its own transfers. A receiving station running fldigi and flmsg gets it as a normal flmsg transfer. Accented and other non-ASCII characters are converted to plain letters first (`é` → `e`, `ß` → `ss`): flmsg's checksum of those characters comes out differently on most PCs and Macs than on Linux on ARM (such as a Raspberry Pi), so a form containing them could fail the check at the other end.

#### Form dates

flmsg writes dates in the format its operator chose: `2026-10-15`, `10/15/26`, `15/10/26`, `2026-15-10` or `20261510`. When a part is above 12 the order is obvious; otherwise (`03/04/26`) the plugin uses `flmsgDateFormat`:

- `auto` (default) — the date format set in your own flmsg (read from `NBEMS.files/w1hkj.com/flmsg.prefs`); if that cannot be read, your computer's regional setting.
- `mdy` / `dmy` — slash dates are month-first / day-first.
- `ymd` / `ydm` — year-first dates are year-month-day / year-day-month.

A form carries no record of the sender's date setting, so a net whose stations use different settings should agree on one; `GET /api/fldigi/status` shows the order in use under `flmsg.dateOrder`. Radiogram dates (`OCT 15`) take the year from the form's header.

#### NBEMS over the Cloud Relay

With the [Cloud Relay](#cloud-relay-plugin) running, the NBEMS panel works on a hosted OpenHamClock too: fldigi's status and receive text, and received forms, travel up with the relay's regular pushes, and the server replays the latest status and receive text to a browser that opens the page later. Send, ICS-213, mode change and Stop TX travel down the relay's command channel. Like every relay command they are signed with the command key that Connect Cloud Relay shared between your browser and Rig Bridge; Rig Bridge refuses them unsigned (they transmit, so the grace period for old pairings does not apply), and no API token passes through the server. The panel waits for Rig Bridge's answer (typically about a second) and shows any refusal. To keep NBEMS off the relay, set `"relayFldigi": false` in the `cloudRelay` section.

#### API

| Endpoint                       | Description                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/fldigi/status`       | Connection, mode, frequency, TX queue, station callsign, folder watcher (folders, received/local counts, date order) and counters |
| `GET /api/fldigi/rx`           | The receive-text tail                                                                                                             |
| `GET /api/fldigi/forms`        | The last 50 forms read from the flmsg folders, received and local, with their `origin`                                            |
| `POST /api/fldigi/send`        | `{ "text": "..." }` — queue text for transmit (token)                                                                             |
| `POST /api/fldigi/send-ics213` | `{ "to", "from", "subject", "message", ... }` — send an ICS-213 (token)                                                           |
| `POST /api/fldigi/mode`        | `{ "mode": "MT63-2KL" }` — change fldigi's mode (token)                                                                           |
| `POST /api/fldigi/abort`       | Stop transmitting and clear the queue (token)                                                                                     |

"(token)" endpoints need the `X-RigBridge-Token` header when an API token is configured. Live updates reach the browser on `/stream` as plugin events `fldigi` (status), `fldigi-rx` (receive text) and `nbems-form` (a received form).

#### Known limitations

- A form's date setting is not part of the form; see [Dates](#form-dates).
- Without a callsign (in the plugin or in flmsg), sent forms in `ICS/messages` cannot be attributed and are forwarded tagged ORIGIN?; a warning says so. Received transfers in `WRAP/recv` are unaffected.
- flmsg's `[b128:...]` and `[b256:...]` encodings are recognised but not decoded; flmsg itself does not use them for forms.

#### Troubleshooting

| Problem                                                   | Solution                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| NBEMS panel says _not connected_                          | Is fldigi running? Check `url` and fldigi's XML-RPC port (Configure → Misc → TCP-IP sockets)                                           |
| Send says the API token was rejected                      | Copy the token from the Rig Bridge setup page into OpenHamClock Settings → Rig Bridge                                                  |
| "No answer from Rig Bridge through the cloud relay"       | Check the Cloud Relay is running and `relayFldigi` is not `false`                                                                      |
| No forms in Field Reports                                 | `GET /api/fldigi/status` → `flmsg.dirs` shows which folders exist and `flmsg.byOrigin` what was found; check `ohcUrl` and `postErrors` |
| Forms tagged ORIGIN?, or your own forms, in Field Reports | Set **Your Callsign** (or your callsign in flmsg), and leave `flmsgIncludeLocal` off                                                   |
| A form shows but has no map marker                        | Add `GRID ...` or `LAT ... LON ...` to the message — ICS-213 has no position field                                                     |
| A form shows the wrong day                                | Set `flmsgDateFormat` to the date order your net uses                                                                                  |
| Log says the LZMA decoder is missing                      | Run `npm install` in the `rig-bridge` folder                                                                                           |
| Transmission cut off after a few minutes                  | The watchdog (`maxTxSeconds`) stopped it — raise it for long messages in slow modes                                                    |

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

### KiwiSDR Beacon Monitor Plugin _(Alpha)_

Turns a KiwiSDR into an automated NCDXF/IBP beacon logger. The plugin opens one audio channel on the receiver (the same WebSocket handshake kiwiclient uses), follows the beacon schedule in UTC and, every 10-second slot, retunes to the beacon transmitting on the band whose turn it is (CW, 300–700 Hz passband), reads the Kiwi's S-meter during seconds 1–9 and records SNR against a per-band noise floor (median of the quietest 20 % of readings on that band over the last cycle). With all five bands enabled every beacon/band pair is measured once per 15 minutes.

1. Enable **KiwiSDR Beacon Monitor** in the Plugins tab (or push the settings from OpenHamClock's Settings → Rig Bridge → Beacon monitor section, which can also pick the nearest public Kiwi for you).
2. Set the Kiwi host and port (`8073` by default) and the password if the receiver needs one.
3. Optional: callsign and grid of the listening station, bands to rotate through, and the OpenHamClock server URL (plus its `API_WRITE_KEY` if set) to forward measurements to.

Measurements are served locally from `GET http://localhost:5555/api/beacon-monitor/measurements?hours=24` (status at `/api/beacon-monitor/status`) and, with forwarding on, POSTed once per 3-minute cycle to the server's `/api/ibp/measurements`. The IBP Beacons panel's **MEASURED** view and the Prediction Check panel read them.

Etiquette: the monitor holds one receiver slot 24/7. Use a Kiwi you own or have permission to park on — public receivers usually cap session length per IP, and the monitor will simply reconnect with backoff when kicked.

### KiwiSDR Audio Plugin _(Alpha)_

Streams a KiwiSDR's demodulated audio to OpenHamClock's **Decoder** panel, which shows it on a waterfall and runs the CW or FT8 decoder on it — so you can copy what that receiver hears without a radio or sound card. The browser can't open a Kiwi socket itself (Kiwis are plain `ws://` and need a handshake), so the bridge holds the socket and relays the audio.

1. Enable **KiwiSDR Audio (Decoder panel)** in the Plugins tab.
2. Set the Kiwi host/port/password — or leave the host blank to use the Beacon Monitor's receiver.
3. In OpenHamClock, open the Decoder panel, pick **KiwiSDR (Rig Bridge)** as the source, enter a frequency and press Start.

It connects **only while the panel is listening** and closes the Kiwi socket as soon as the panel stops or the tab closes. One stream at a time: a second listener replaces the first.

- **CW pitch.** A Kiwi demodulates CW as upper sideband relative to the frequency it is sent, so — like the Kiwi's own web page, which subtracts the passband centre — the bridge tunes the Kiwi 600 Hz below the frequency you enter (passband 200–1000 Hz). A CW station on the entered frequency is heard at **600 Hz**, the Decoder's default tone; the stream says so in an `X-CW-Pitch: 600` header. FT8 uses USB at the dial frequency, 100–3000 Hz.
- **One receiver slot.** If the Beacon Monitor runs on the same Kiwi it is **paused** while someone listens (its Kiwi socket closes; measurements simply skip those slots) and resumes afterwards. Set _Beacon Monitor on the same Kiwi while listening_ (`kiwiAudio.beaconMonitor`) to `keep` to run both on two slots.
- **Cloud Relay.** With _Relay KiwiSDR audio to the Decoder panel_ (`cloudRelay.relayAudio: true`) the hosted site can listen too: the panel sends a **signed** `kiwiAudioStart` command through the server (like every relay command, verified here with the command key — it starts a receiver, so it is never accepted unsigned and has no grace period) and reads the audio with the session's read token; the bridge opens the Kiwi and uploads the audio as 8-bit µ-law (~12 kB/s for a 12 kHz Kiwi) in one long HTTP request, rolled over to a fresh request every 4 minutes. The server ends the upload — and the bridge the Kiwi session — when the last listener goes away. Off by default.

Endpoints: `GET /api/kiwi-audio/status`; `GET /api/kiwi-audio/stream?freq=<kHz>&mode=cw|usb|lsb|am&codec=s16be|ulaw` (API token) — `application/octet-stream`, mono audio as 16-bit big-endian PCM (default) or µ-law, with `X-Sample-Rate`, `X-Audio-Format` and (CW) `X-CW-Pitch` headers; `POST /api/kiwi-audio/tune` `{ freqKHz, mode }` and `POST /api/kiwi-audio/stop` (API token).

### Cloud Relay Plugin

Bridges a locally-running rig-bridge to a cloud-hosted OpenHamClock instance so cloud users get the same rig control as local users — click-to-tune, PTT, WSJT-X decodes, APRS packets — and, opt-in (`relayAudio`), KiwiSDR audio for the Decoder panel (see the KiwiSDR Audio plugin above).

See [Scenario 3](#scenario-3-cloud-relay-ohc-on-openhamclockcom-radio-at-home) for setup instructions.

**How latency is minimised:**

| Path                             | Mechanism                                              | Typical latency |
| -------------------------------- | ------------------------------------------------------ | --------------- |
| Rig state → browser              | Event-driven push + SSE fan-out                        | < 100 ms        |
| Browser command → rig            | Long-poll (server wakes rig-bridge on command arrival) | ~RTT (< 100 ms) |
| KiwiSDR audio → browser (opt-in) | Streamed µ-law upload, fanned out by the server        | ~0.5–1 s        |

The rig-bridge holds a persistent long-poll connection to the server. The moment you click PTT or a DX spot, the server wakes that connection and delivers the command — no fixed poll tick to wait for.

**Commands are signed end to end.** The browser that pressed Connect Cloud Relay and this Rig Bridge share a command key the server never sees; each command carries an HMAC-SHA256 signature with a timestamp and a one-time nonce, checked by Rig Bridge before anything happens (see [Scenario C](#scenario-c--using-the-cloud-version-at-openhamclockcom-cloud-relay-alpha)). Once Rig Bridge reports that it holds a key, the server also refuses unsigned commands for that session straight away.

| Setting              | Meaning                                                                                    | Default        |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| `commandKey`         | 64-hex key from Connect Cloud Relay; when set, only signed commands run                    | `""`           |
| `unsignedGraceUntil` | Without a key, unsigned tuning (frequency, mode) is accepted until this date; never PTT/TX | `"2027-01-31"` |
| `allowUnsigned`      | Accept every command unsigned, PTT included (old behaviour; unsafe)                        | `false`        |

`GET /api/cloud-relay/status` shows `commandAuth` (`hmac-sha256`, `legacy` or `unsigned-allowed`) and how many commands were refused.

When Rig Bridge refuses a relayed command (unsigned, expired, replayed or with a wrong signature) it says so back through the relay, and OpenHamClock shows _Rig Bridge refused the command — re-pair Cloud Relay_ for tuning, mode, PTT and display indicators alike (NBEMS shows it in its own panel). The notice appears at most once a minute.

Reads are protected too: Rig Bridge registers the hash of a read token derived from the command key (HKDF, separate label), and the server then requires that token for `/relay/state`, `/relay/decodes` and `/relay/aprs` (`X-Relay-Read` header) and a one-time ticket from `POST /relay/stream-ticket` for the live stream. The same rule covers the session's MeshCom data (`/api/meshcom/nodes`, `messages`, `weather`, `status`) and WSJT-X relay data (`/api/wsjtx`, `/api/wsjtx/decodes`) when they are read with `?session=`. The server keeps only the hash, persisted with the session. Self-hosters can move the grace date for unpaired sessions with `RELAY_UNSIGNED_GRACE_UNTIL` in `.env`.

The relay also carries the NBEMS panel (fldigi status, receive text, received flmsg forms, and signed send / mode / Stop TX commands) — see [NBEMS over the Cloud Relay](#nbems-over-the-cloud-relay). Set `"relayFldigi": false` in `cloudRelay` to leave it out.

### MQTT Publish Plugin _(Beta)_

Publishes rig and rotator state to an MQTT broker so Home Assistant, Node-RED or any dashboard can react to your shack:

| Topic (prefix default `openhamclock`) | Payload                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `<prefix>/rig`                        | `{ connected, freq_hz, freq_mhz, band, mode, width, ptt, aprs_received, updated_at }`             |
| `<prefix>/rotator`                    | `{ enabled, connected, az, el, target_az, target_el, updated_at }` (when the Rotator plugin runs) |
| `<prefix>/bridge/status`              | `{ state: "online" \| "offline" }` — retained, with a Last-Will so HA marks entities unavailable  |

1. Rig Bridge → **Plugins** tab → **MQTT Publish (Home Assistant)** → tick **Enable**
2. Broker URL (`mqtt://192.168.1.10:1883`, `mqtts://…` or `ws://…`), username/password if your broker needs them, topic prefix
3. Leave **Home Assistant discovery** on to get entities created automatically (`homeassistant/sensor/openhamclock_rig_bridge_*/config`): Rig Frequency, Mode, Band, PTT and Connected binary sensors, Rotator Azimuth/Elevation, APRS Packets Received
4. **Save** — the plugin restarts with the new settings, no bridge restart needed

PTT changes publish immediately; frequency/mode changes are throttled to one publish per second; everything is re-published every minute as a keepalive. Config section `mqtt`: `enabled`, `url`, `username`, `password`, `prefix`, `haDiscovery`, `publishInterval` (ms).

The `mqtt` npm module is an optional dependency. Prebuilt binaries include it; when running from source, `npm install` installs it unless it fails, in which case the plugin logs `The "mqtt" module is not installed` and stays idle — run `npm install mqtt` inside `rig-bridge/`.

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

## Raspberry Pi Hardware _(Alpha)_

Four plugins bring Raspberry Pi hardware into the shack display: a GPS receiver, BME280 environment sensors, the GPIO header lines (ON-AIR, alarm, countdown, satellite, lightning relay, buttons) and an ambient-light sensor driving the display brightness. None of them needs a compiled Node module: serial and TCP go through `serialport`/`net`, I2C goes through the optional `i2c-bus` package, and GPIO uses the `gpiod` command-line tools or sysfs. Everything also has a **mock** mode, so the OpenHamClock panels can be tried on any computer without a Pi.

All four are enabled on the **Plugins** tab of the setup page (<http://localhost:5555>) and restart in place when you change their settings — no rig-bridge restart needed. The browser receives their state over the same `/stream` connection as the rig (`{ type:'plugin', event:'gps'|'env'|'gpio'|'brightness' }`), and the latest state is replayed to every new browser connection.

> **Hardware status:** these plugins were written against the datasheets and tested with mocks and unit tests only. If you run them on real hardware, please report what you see (good or bad) in a GitHub issue.

### Raspberry Pi preparation

```bash
sudo raspi-config          # Interface Options → I2C → enable (for BME280 / LTR-329)
sudo apt install gpiod i2c-tools
sudo usermod -aG gpio,i2c,dialout,video $USER   # GPIO, I2C, serial GPS, vcgencmd
cd ~/openhamclock/rig-bridge && npm install i2c-bus   # optional native module for I2C
i2cdetect -y 1             # BME280 shows at 76 or 77, LTR-329 at 29
```

Log out and back in after the `usermod`. The compiled rig-bridge binaries cannot load `i2c-bus`; run from source (`node rig-bridge.js`) on the Pi when you use I2C sensors.

### GPS plugin

Feeds the station position into OpenHamClock: **Settings → Station → GPS** chooses _Off_, _Set once_ (first fix after start-up sets DE lat/lon, grid and altitude) or _Follow_ (rover mode — DE tracks the receiver, the **Rover** panel comes alive, QSOs are logged with the live `MY_GRIDSQUARE`, and a grid change rings the _Grid Change (Rover)_ alert). The browser also warns when the GPS time differs from the computer clock by more than 2 s (warning only).

| Setting           | Default              | Description                                                            |
| ----------------- | -------------------- | ---------------------------------------------------------------------- |
| `source`          | `serial`             | `serial` (NMEA), `gpsd` (JSON on TCP 2947), `file` (fifo/file), `mock` |
| `serialPort`      | —                    | `/dev/ttyACM0`, `/dev/ttyUSB0`, `COM5` …                               |
| `baudRate`        | `9600`               | Most USB pucks: 9600; u-blox M8/M9 often 9600 or 38400                 |
| `gpsdHost/Port`   | `127.0.0.1` / `2947` | gpsd — the plugin sends `?WATCH={"enable":true,"json":true}`           |
| `filePath`        | —                    | A UNIX fifo (`mkfifo /tmp/nmea`) or a file something appends NMEA to   |
| `publishInterval` | `1000` ms            | How often a new fix is pushed to the browser                           |

Sentences parsed: **RMC** (fix, lat/lon, speed, course, UTC date+time), **GGA** (altitude, satellites used, HDOP, fix quality) and **GSA** (2D/3D). Any talker ID works (GP, GN, GL, GA, BD). Checksum failures are dropped.

Typical setups:

- **USB GPS puck on the Pi:** `source: serial`, `serialPort: /dev/ttyACM0`.
- **Pi GPS HAT on the UART:** enable the serial port in `raspi-config` (disable the login shell on it), then `serialPort: /dev/serial0`.
- **Already running gpsd** (chrony/NTP setups): `source: gpsd` — nothing else to configure.
- **Bluetooth or network GPS:** pipe it into a fifo, e.g. `mkfifo /tmp/nmea && socat -u TCP:phone:10110 PIPE:/tmp/nmea`, and set `source: file`, `filePath: /tmp/nmea`.

API: `GET /api/gps/status`.

### Environment Sensors plugin (BME280 / BMP280 / HTTP)

Temperature, humidity, dew point and station pressure, shown in the **Environment Sensors** panel with the two-sensor split HamClock uses and a 24 h history graph (one sample per minute is kept in the bridge and served from `GET /api/env/history`).

| Setting                            | Default                | Description                                                                        |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `pollInterval`                     | `10` s                 | Sensor read interval                                                               |
| `i2cBus`                           | `1`                    | `/dev/i2c-1` on every Pi since the B+                                              |
| `sensorA.enabled/address/name`     | on / `0x76` / Indoor   | First BME280/BMP280 (chip id read from register 0xD0)                              |
| `sensorB.enabled/address/name`     | off / `0x77` / Outdoor | Second sensor — tie SDO high for 0x77                                              |
| `sensorX.dTemp` / `dPres` / `dHum` | `0`                    | Corrections added to the reading (dTemp/dPres), e.g. −1.5 °C for self-heating      |
| `http.enabled/url`                 | off                    | Any JSON URL: ESPHome `/sensor/…`, Tasmota `cm?cmnd=Status%2010`, Home Assistant … |
| `http.tempPath/humPath/presPath`   | `temperature` …        | Dotted field paths, e.g. `StatusSNS.BME280.Temperature`, `list[0].value`           |
| `http.tempUnit` / `presUnit`       | `C` / `hPa`            | Convert from `F`, `Pa`, `kPa`, `inHg`, `mmHg`                                      |
| `mock`                             | `false`                | Two simulated sensors — try the panel without hardware                             |

**Wiring (I2C, 3.3 V only):** BME280 VCC → pin 1 (3V3), GND → pin 6, SDA → pin 3 (GPIO 2), SCL → pin 5 (GPIO 3). For two sensors on one bus pull SDO of the second one to 3V3 (address 0x77). Keep I2C leads short (< 30 cm) or use a bus extender.

The compensation math is Bosch's double-precision reference implementation (`lib/bme280.js`, unit-tested against the datasheet example values). Measurements use forced mode with 1× oversampling, so the sensor sleeps between reads and self-heating stays negligible.

API: `GET /api/env/status`, `GET /api/env/history`.

### GPIO plugin (Pi header lines)

Drives indicator and switch lines on the Pi header, plus a PTT sense input. Pin numbers below are **BCM GPIO numbers** (what `gpioinfo` shows); the header position is in brackets. You may also type a header pin as `P37` in the config.

| Function            | Direction | Default BCM (header)           | Notes                                                                                     |
| ------------------- | --------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `pttIn`             | input     | 16 (36)                        | PTT / ON-AIR sense, active low → bridge `onAir` state → browser shows ON AIR              |
| `countdownResetIn`  | input     | 26 (37)                        | Button to restart the ID / countdown timer                                                |
| `alarmSilenceIn`    | input     | 5 (29)                         | Button to silence the alarm line                                                          |
| `onAirOut`          | output    | 21 (40)                        | ON-AIR LED — rig PTT (CAT) or `pttIn` active                                              |
| `alarmOut`          | output    | 6 (31)                         | Alarm ringing — the ID timer has expired                                                  |
| `countdownGreenOut` | output    | 13 (33)                        | Countdown running                                                                         |
| `countdownRedOut`   | output    | 19 (35)                        | Countdown expired                                                                         |
| `satOut`            | output    | 20 (38)                        | 1 Hz the minute before AOS, steady during the pass, 2 Hz the last minute (SA)             |
| `lightningOut`      | output    | off (suggested 25 / header 22) | Lightning antenna-protection relay — see [Lightning relay](#lightning-relay-lightningout) |

Set a pin to `-1` to disable that function. Pins are BCM numbers or header pins written `P37`, both in the config file and on the setup page. `activeLow` (default on) means switches pull the input to ground; `outputActiveLow` inverts the outputs for sink-driven LEDs.

**Wiring:** LEDs through a 330 Ω–1 kΩ resistor to ground (3.3 V logic, ≤ 8 mA per pin — use a transistor or relay module for anything bigger). Switches between the input pin and ground; the plugin requests internal pull-ups, but GPIO 9–27 default to pull-_down_ at boot, so add this to `/boot/firmware/config.txt` (older images: `/boot/config.txt`) and reboot:

```text
gpio=5,16,26=pu
```

**Backends** (`backend`): `auto` picks sysfs when `/sys/class/gpio` exists (every Raspberry Pi OS release so far) and otherwise the libgpiod tools (`gpioget`/`gpioset`/`gpiomon`, v1 or v2 — install with `sudo apt install gpiod`). `mock` keeps everything in memory; `POST /api/gpio/mock/input { "name": "pttIn", "level": 1 }` presses a virtual button so you can watch the ON AIR panel react.

The browser tells the bridge what to show by posting its indicator state to `POST /api/indicators` (`{ satVisible, satAosInSec, satLosInSec, countdown: off|running|expired, alarm, lightning?: clear|warn|alarm, lightningRelay?: bool, lightningAllClearMin?, lightningOverride?: auto|on|off, displayId? }`, token-protected, every 15 s and on change; in Cloud Relay mode it arrives through the cloud-relay plugin). Any plugin can subscribe with `pluginBus.on('indicators', fn)`. Physical button presses go the other way as `{ type:'plugin', event:'gpio-button' }` — the **ID Timer** panel restarts on `countdown-restart` and dismisses its reminder on `alarm-silence`.

API: `GET /api/gpio/status`, `POST /api/gpio/mock/input`, `POST /api/indicators`, `GET /api/indicators`.

#### Lightning relay (`lightningOut`)

> ⚠️ **Safety first.** The lightning relay is a **convenience, not lightning protection.** Lightning data can arrive late or not at all, and the browser, network, Pi or relay can fail. A relay a few millimetres apart does not stop a direct or nearby strike. It does **not** replace a proper station ground, bonding, coax surge arrestors at the entry panel, and disconnecting antennas by hand when storms are forecast. Never use it to make outdoor work safe.

The GPIO plugin can drive one more output, `lightningOut`, from the **lightning guard** (OpenHamClock → Settings → Alerts → Lightning guard): the relay engages when strikes come inside the alarm radius (or the warning radius, if chosen there) and releases after the all-clear time.

**Who decides.** Every OpenHamClock display that drives the relay sends `lightningRelay: true|false`, its guard level `lightning`, its all-clear time `lightningAllClearMin`, any manual override `lightningOverride` and a stable `displayId` in the indicator payload above — directly, or through Cloud Relay (the browser queues an `indicators` command; the cloud-relay plugin posts it to the local `/api/indicators`). Rig Bridge keeps one claim per display:

- the relay is **engaged while any display wants protection**, and released only when none does;
- a display that asked for protection and then went quiet (tab closed, network gone) **keeps its claim for its own all-clear time** after its last request — Rig Bridge releases the relay on its own then, without waiting for the browser (`lightningHoldWhenStale: false` ends the claim with the 90 s stale window instead);
- a manual override from a live display wins (_Force protect_ / _Hold connected_; the most recent one counts);
- displays that don't drive the relay leave the fields out and change nothing.

**Headless guard (no browser needed).** With `lightningHeadless.enabled` Rig Bridge connects to Blitzortung.org itself (`ws`) and runs the same guard logic as the browser — the code is generated from OpenHamClock's `src/utils/lightningGuard.js` into `lib/lightning-guard-logic.js` (`npm run lightning:sync` in the repository root; a test fails when the copy is stale). It counts as one more display. Its location and guard settings follow the displays: every display that drives the relay sends `lightningGuard` (`lat`, `lon`, `warnKm`, `alarmKm`, `allClearMin`, `minStrikes`, `hysteresisPct`, `repeatCloser`, `relayOn`) with its indicators, and the GPIO plugin applies changes immediately and saves them to the config (the most recent report wins). `enabled` stays a bridge-side choice — OpenHamClock's _Run the guard inside Rig Bridge_ box sets it with **Push to Rig Bridge**, which otherwise only carries the pin, fail-safe and hold settings. A location arriving after start-up starts the watch.

| Setting                                | Default | Description                                                                                                                       |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pins.lightningOut`                    | `-1`    | BCM line for the relay (`-1` = off). Suggested `25` (header 22) — free on a bare Pi. `P22` also works, here and on the setup page |
| `lightningFailSafe`                    | `false` | Invert this line only: energised = antenna **connected**. Power loss, a crash or a stopped bridge then disconnects the antenna    |
| `lightningHoldWhenStale`               | `true`  | A quiet display keeps its claim for its all-clear time. Off: the claim ends after 90 s without a report                           |
| `lightningHeadless.enabled`            | `false` | Run the guard inside Rig Bridge                                                                                                   |
| `lightningHeadless.lat` / `lon`        | —       | Station location — set automatically from the displays' reports                                                                   |
| `lightningHeadless.warnKm` / `alarmKm` | 50 / 25 | Radii (km)                                                                                                                        |
| `lightningHeadless.allClearMin`        | 30      | All-clear time (min); also `minStrikes` (1), `hysteresisPct` (20) and `repeatCloser` — all set from the displays' reports         |
| `lightningHeadless.relayOn`            | `alarm` | Engage at `alarm` or already at `warn`                                                                                            |

`GET /api/gpio/status` reports `features` (`lightning-relay`, `lightning-arbiter`, `lightning-headless`, `lightning-guard-settings` — OpenHamClock shows an update notice when they are missing) and `lightning: { pin, relay, engaged, reason, holdUntil, reporters[], failSafe, holdWhenStale, headless }` — `reason` is `requested`, `hold` (only quiet displays' claims are left), `override-on`/`override-off` or `clear`. `POST /api/gpio/lightning/test { "distanceKm": 8, "bearingDeg": 90 }` (token-protected) places a synthetic strike for the headless guard. With the **mock** backend you can watch everything without hardware: `mockLevels` in the status shows the line switching.

**Wiring:**

- A Pi GPIO gives 3.3 V and a few milliamps — drive a **relay module** (one with a transistor driver and flyback diode on board, logic input rated for 3.3 V), never a bare relay coil. Feed the module from the Pi's 5 V pin or its own supply, and tie the grounds together.
- Switch the antenna with a relay or **coax switch rated for your RF power and frequency** (a proper coaxial relay for anything above a few watts); a PCB signal relay is only good for a receive antenna. Only switch while receiving.
- A common layout: the antenna feedline on the relay's common (C) contact, the radio on one throw and a grounded dummy load or a direct ground on the other. Which throw is "protected" decides the wiring:
  - **Normal mode** (`lightningFailSafe: false`): the line is high while protecting. Radio on **NC** (connected while the coil is off), ground/load on **NO**. If the Pi or bridge stops, the antenna stays connected to the radio.
  - **Fail-safe** (`lightningFailSafe: true`): the line is high while it is safe to connect. Radio on **NO**, ground/load on **NC**. Anything that removes power — Pi off, bridge stopped, crash, a pulled wire — disconnects the antenna. Remember the antenna is then also disconnected whenever the bridge isn't running.
- Many relay modules switch on a _low_ input; use `outputActiveLow` for those (it inverts every output line, so check your LEDs), or pick an active-high module.

### Light Sensor / Brightness plugin

Maps ambient light to display brightness with a two-point calibration and applies it to the panel.

| Setting                         | Default       | Description                                                                                        |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `source`                        | `none`        | `ltr329` (I2C 0x29), `http` (lux field from a JSON URL), `mock`, `none` (manual only)              |
| `calDimLux` / `calDimPct`       | `5` / `15`    | In a dark room: the lux you read and the brightness you want                                       |
| `calBrightLux` / `calBrightPct` | `400` / `100` | In a bright room: the lux you read and the brightness you want                                     |
| `min`                           | `5` %         | Never dim below this                                                                               |
| `auto` / `manual`               | on / `100`    | Follow the sensor, or hold a fixed level (also set from the browser)                               |
| `backlightPath`                 | auto          | `/sys/class/backlight/<dev>` — auto-detected (official 7" display: `10-0045` / `rpi_backlight`)    |
| `powerMethod`                   | `auto`        | Display off/on for the display schedule: `bl_power`, `vcgencmd display_power`, `xset dpms`, `none` |

Read the current lux from `GET /api/brightness/status` while calibrating. The plugin writes the backlight when it is writable — add `SUBSYSTEM=="backlight", RUN+="/bin/chmod 0666 /sys/class/backlight/%k/brightness /sys/class/backlight/%k/bl_power"` as `/etc/udev/rules.d/99-backlight.rules` so it works without root. With no controllable backlight the level is still published and OpenHamClock dims with a translucent overlay (**Settings → Display → Brightness**: slider + _Auto brightness_). The display schedule (Settings → Station) switches the backlight off and on through `POST /api/brightness { "power": false|true }`.

**Wiring (LTR-329, 3.3 V):** VCC → pin 1, GND → pin 9, SDA → pin 3, SCL → pin 5 — it shares the bus with the BME280.

API: `GET /api/brightness/status`, `POST /api/brightness { brightness?: 0-100, auto?: bool, power?: bool }` (token-protected).

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

| Method | Endpoint                                                                                               | Description                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| GET    | `/status`                                                                                              | Current frequency, mode, PTT state, and connection status                        |
| GET    | `/stream`                                                                                              | Real-time updates via SSE (Server-Sent Events)                                   |
| POST   | `/freq`                                                                                                | Tune radio: `{ "freq": 14074000 }` (frequency in Hz)                             |
| POST   | `/mode`                                                                                                | Set mode: `{ "mode": "USB" }`                                                    |
| POST   | `/ptt`                                                                                                 | Key transmitter: `{ "ptt": true }`                                               |
| GET    | `/api/ports`                                                                                           | List available serial ports                                                      |
| GET    | `/api/config`                                                                                          | Read current configuration                                                       |
| POST   | `/api/config`                                                                                          | Save configuration and reconnect                                                 |
| POST   | `/api/test`                                                                                            | Test a serial port without connecting                                            |
| GET    | `/api/status`                                                                                          | Lightweight health check                                                         |
| POST   | `/api/indicators`                                                                                      | Browser → hardware: `{ satVisible, satAosInSec, satLosInSec, countdown, alarm }` |
| GET    | `/api/gps/status`, `/api/env/status`, `/api/env/history`, `/api/gpio/status`, `/api/brightness/status` | Hardware plugin state                                                            |
| POST   | `/api/brightness`                                                                                      | `{ brightness?: 0-100, auto?: bool, power?: bool }`                              |
| POST   | `/api/gpio/mock/input`                                                                                 | Press a virtual button in GPIO mock mode                                         |
| GET    | `/api/beacon-monitor/status`                                                                           | KiwiSDR beacon monitor connection state                                          |
| GET    | `/api/beacon-monitor/measurements`                                                                     | Beacon SNR log: `?band=20m&hours=24` or `?since=<ms>`                            |
| GET    | `/api/kiwi-audio/status`                                                                               | KiwiSDR audio relay state (Decoder panel)                                        |
| GET    | `/api/kiwi-audio/stream`                                                                               | Live Kiwi audio: `?freq=<kHz>&mode=cw&codec=s16be\|ulaw` (token)                 |
| POST   | `/api/kiwi-audio/tune`, `/api/kiwi-audio/stop`                                                         | Retune `{ freqKHz, mode }` / end the live stream (token)                         |

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
│   ├── aprs-parser.js     # APRS packet decoder
│   ├── nmea.js            # NMEA 0183 RMC/GGA/GSA parser (GPS)
│   ├── gpsd.js            # gpsd TPV/SKY → fix mapping
│   ├── maidenhead.js      # lat/lon → grid locator
│   ├── bme280.js          # Bosch BME280/BMP280 compensation math
│   ├── ltr329.js          # LTR-329 light sensor registers + lux formula
│   ├── gpio-logic.js      # GPIO pin map, output state machine, gpiod parsers
│   ├── brightness-map.js  # lux → brightness two-point calibration
│   ├── http-json.js       # dotted-path field picking for HTTP JSON sensors
│   └── sample-ring.js     # 1-sample-per-minute 24 h ring buffer
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
    ├── winlink-express-csv.js # Winlink Express form-export CSV → EmComm field reports
    ├── fldigi.js          # NBEMS: fldigi XML-RPC (status, RX, TX, ICS-213) + flmsg form folders
    ├── cloud-relay.js     # Cloud relay — bridges local rig-bridge to cloud OHC
    ├── gps.js             # GPS receiver (serial NMEA / gpsd / fifo / mock)
    ├── env-sensors.js     # BME280/BMP280 over I2C + HTTP JSON sensors, 24 h history
    ├── gpio.js            # Raspberry Pi GPIO lines (gpiod CLI / sysfs / mock)
    └── brightness.js      # LTR-329 / HTTP lux → backlight brightness
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
