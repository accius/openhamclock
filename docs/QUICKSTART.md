# OpenHamClock Quick Start

Get on the air with OpenHamClock in five minutes — either on the hosted site or on your own hardware.

- [Option 1: Just use openhamclock.com](#option-1-just-use-openhamclockcom)
- [Option 2: Self-host](#option-2-self-host)
  - [Prebuilt executable (no Node.js needed)](#prebuilt-executable-no-nodejs-needed)
  - [Docker / Docker Compose](#docker--docker-compose)
  - [Linux / macOS / FreeBSD one-liner](#linux--macos--freebsd-one-liner)
  - [Raspberry Pi](#raspberry-pi)
  - [Windows](#windows)
  - [Bare Node.js (any platform)](#bare-nodejs-any-platform)
  - [Railway (cloud)](#railway-cloud)
- [First-run checklist](#first-run-checklist)
- [Updating](#updating)
- [Where to go next](#where-to-go-next)

---

## Option 1: Just use openhamclock.com

No install, no server, no account. Open **[openhamclock.com](https://openhamclock.com)** in any modern browser.

1. **Set your station.** The setup wizard asks for your callsign and Maidenhead grid locator on first visit. You can change these any time via **Settings** (click your callsign in the header).
2. **Pick a layout.** Settings → Display lets you choose between the dockable layout (drag panels anywhere), Classic (original-HamClock style for dedicated displays), and EmComm (emergency communications dashboard).
3. **Take the five-minute tour:**
   - The **map** is the centerpiece — click anywhere to set a DX target, and the propagation panels recalculate for that path.
   - **DX Cluster** shows live spots from OpenHamClock's own cluster node. Click a spot to set it as your DX target; the 🎧 button opens a web SDR already tuned to the spot.
   - **Map layers** (gray line, satellites, aurora, MUF, and two dozen more) toggle from Settings → Map Layers or with single-key shortcuts — press the key shown next to each layer name.
   - **POTA / SOTA / WWFF / WWBOTA** panels list who's activating right now, with markers on the map.
   - The **Logbook** panel logs QSOs right in your browser (stored locally — export ADIF for backup).

Everything you configure is saved in your browser, so your setup is there when you come back.

**Hosted vs. self-hosted:** a few features need local hardware access and only appear on self-hosted/LAN installs (rotator control, some local-only map layers). Rig control works on the hosted site through the [Rig Bridge](../rig-bridge/README.md) helper app. Details in the [User Manual](MANUAL.md#hosted-site-vs-self-hosted).

---

## Option 2: Self-host

All self-host options need nothing but the repo — no API keys, no accounts. Optional keys (QRZ, OpenWeatherMap, etc.) unlock extras later.

### Prebuilt executable (no Node.js needed)

Every release ships single-file executables: Node.js, the server, and the built frontend in one file. Nothing to install, nothing to build. Download the one for your machine from the **[latest release](https://github.com/accius/openhamclock/releases/latest)**:

| File                                 | For                                                                  |
| ------------------------------------ | -------------------------------------------------------------------- |
| `openhamclock-v*-win-x64.zip`        | Windows 10/11 (64-bit)                                               |
| `openhamclock-v*-macos-arm64.tar.gz` | Mac with Apple Silicon (M1 or later)                                 |
| `openhamclock-v*-macos-x64.tar.gz`   | Intel Mac                                                            |
| `openhamclock-v*-linux-x64.tar.gz`   | Linux PCs and servers (64-bit)                                       |
| `openhamclock-v*-linux-arm64.tar.gz` | Raspberry Pi 3B+/4/5 on 64-bit Raspberry Pi OS (the default OS)      |
| `openhamclock-v*-linux-armv7.tar.gz` | 32-bit Raspberry Pi OS (best effort — use the one-liner if it fails) |

`SHA256SUMS.txt` on the release page lets you verify a download.

**Windows:** extract the zip and double-click `openhamclock.exe`. A console window shows the server log; closing it stops OpenHamClock.

**macOS:** extract, then on the first launch right-click `openhamclock` → **Open** (Gatekeeper flags it as from an unidentified developer because it is not notarized). Or from Terminal:

```bash
xattr -d com.apple.quarantine openhamclock
./openhamclock
```

**Linux / Raspberry Pi:**

```bash
tar -xzf openhamclock-v*-linux-arm64.tar.gz   # or -linux-x64
./openhamclock
```

A browser window opens automatically when you launch from a desktop; otherwise go to the address printed in the terminal (<http://localhost:3001> by default). The setup wizard asks for your callsign and grid.

Good to know:

- **Settings and data** (`.env`, `config.json`, `data/`) are created next to the executable on first run, so keep it in its own folder. Set `OPENHAMCLOCK_HOME=/some/dir` to store them elsewhere.
- **LAN access:** browse to `http://<your-ip>:3001` from phones and tablets — the server listens on every interface by default. To keep it on this computer only, set `BIND_HOST=127.0.0.1` in `.env`. `PORT` lives in the same file.
- **Run on boot (Linux / Pi):** save this as `/etc/systemd/system/openhamclock.service` (adjust the paths and user), then `sudo systemctl enable --now openhamclock`:

  ```ini
  [Unit]
  Description=OpenHamClock
  After=network-online.target

  [Service]
  ExecStart=/home/pi/openhamclock/openhamclock
  WorkingDirectory=/home/pi/openhamclock
  User=pi
  Restart=always

  [Install]
  WantedBy=multi-user.target
  ```

- **Kiosk display on a Pi:** the executable is just the server. For a Pi that boots straight into fullscreen Chromium, the [Raspberry Pi one-liner](#raspberry-pi) with `--kiosk` still does the whole setup.
- **Not included:** git-based auto-update (download the new release and replace the file instead) and the helper apps launched from the UI — [Rig Bridge](../rig-bridge/README.md), [Rig Listener](../rig-listener/README.md), and the WSJT-X relay have their own downloads.

### Docker / Docker Compose

The fastest self-host path. Prebuilt images are published to `ghcr.io/accius/openhamclock`.

```bash
docker run -d -p 3000:3000 --name openhamclock ghcr.io/accius/openhamclock:latest
```

Or with Compose (recommended — maps the WSJT-X and N1MM UDP ports too):

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
docker compose up -d
```

Open <http://localhost:3000>. To set your callsign and grid, copy `stack.env.example` to `stack.env`, edit `CALLSIGN` and `LOCATOR`, and restart:

```bash
cp stack.env.example stack.env
# edit stack.env, then:
docker compose down && docker compose up -d
```

Full Docker guide (Portainer, persistence, reverse proxies, updating): [docs/DOCKER.md](DOCKER.md)

### Linux / macOS / FreeBSD one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup.sh | bash
```

This clones the repo to `~/openhamclock`, installs dependencies, builds the frontend, creates a `.env`, and generates a `run.sh` launcher. On Linux, add `-s -- --service` to also install a systemd service that starts on boot:

```bash
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup.sh | bash -s -- --service
```

Then set your station and start it:

```bash
nano ~/openhamclock/.env        # set CALLSIGN and LOCATOR
~/openhamclock/run.sh           # or: sudo systemctl restart openhamclock
```

### Raspberry Pi

One-liner installs for Pi 3B/3B+/4/5 (Raspberry Pi OS Bookworm recommended, Trixie supported). Pick your flavor:

```bash
# Kiosk mode — boots straight into fullscreen Chromium (dedicated shack display)
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash -s -- --kiosk

# Headless server — browse from other machines on your LAN
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash -s -- --server

# Standard — installed with a systemd service, launch a browser yourself
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash
```

The script installs Node.js 22 LTS, builds the app, creates the `openhamclock` systemd service, enables server-side settings sync, and (in kiosk mode) configures Chromium for X11 or Wayland automatically. Afterwards:

```bash
nano ~/openhamclock/.env              # set CALLSIGN and LOCATOR
sudo systemctl restart openhamclock   # apply changes
```

A Pi 4 (2 GB+) or Pi 5 is recommended for a smooth kiosk display; a Pi 3B+ works best in server-only mode or with Low Memory Mode enabled in Settings.

### Windows

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iex (iwr https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-windows.ps1).Content
```

Installs to `%USERPROFILE%\openhamclock` with a `start.bat` launcher and desktop shortcut. Edit `%USERPROFILE%\openhamclock\.env` to set `CALLSIGN` and `LOCATOR`, then run `start.bat`.

### Bare Node.js (any platform)

Requires **Node.js 22 LTS (recommended) or Node 20** — the Node 18 that `apt install nodejs` gives you on Ubuntu/Debian is too old for the build; use [nvm](https://github.com/nvm-sh/nvm) or [NodeSource](https://deb.nodesource.com) instead.

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
npm ci
npm start
```

`npm start` builds the frontend and starts the server; open <http://localhost:3000>. On first run a `.env` is created from `.env.example` — set `CALLSIGN` and `LOCATOR` there (or use the in-browser setup wizard) and restart with `npm start`.

To reach it from phones/tablets on your LAN, browse to `http://<your-ip>:3000` (set `BIND_HOST=127.0.0.1` in `.env` to keep it on this machine only).

### Railway (cloud)

The repo ships `railway.toml` / `railway.json` for one-click deploys. Connect your GitHub fork to Railway, or from the CLI:

```bash
railway up
```

Set at least `CALLSIGN`, `LOCATOR`, and `HOST=0.0.0.0` in the Railway dashboard, and `LOG_LEVEL=warn` to stay under Railway's log rate limit.

---

## First-run checklist

1. **Callsign + grid** — via the setup wizard, Settings, or `CALLSIGN`/`LOCATOR` in `.env`. This drives DX cluster login, PSKReporter queries, propagation paths, and "my spots" tracking.
2. **Pick a theme and layout** — Settings → Display.
3. **Turn on the map layers you care about** — Settings → Map Layers.
4. **Optional integrations** — WSJT-X (UDP port 2237), N1MM+ (see [docs/N1MM-SETUP.md](N1MM-SETUP.md)), rig control ([rig-bridge/README.md](../rig-bridge/README.md)), APRS (`APRS_ENABLED=true` in `.env`).
5. **Self-hosted single-operator installs:** consider `SETTINGS_SYNC=true` in `.env` so every browser that connects gets your saved configuration.

## Updating

- **Hosted site:** nothing to do — a toast appears when a new version deploys.
- **Prebuilt executable:** download the new release and replace the file. Your `.env`, `config.json`, and `data/` next to it are kept.
- **Git installs (Linux/macOS/Pi):** `./scripts/update.sh` from the install directory, then restart. Or set `AUTO_UPDATE_ENABLED=true` in `.env`. The frontend build step needs about **1 GB of memory** — on a small Pi or container, add a swap file first (the script prints the exact commands if the build runs out), or build elsewhere and copy `dist/` over. If the update is interrupted (dropped SSH session, out of memory) and the server then fails to start, run `./scripts/update.sh --repair` — it reinstalls dependencies and rebuilds without needing a newer version; on a small board run it inside `screen` so a dropped session cannot cut it off again.
- **Windows:** `.\scripts\update.ps1` from the install directory.
- **Docker:** `docker compose pull && docker compose up -d`.

## Where to go next

- **[User Manual](MANUAL.md)** — every panel, map layer, keyboard shortcut, and setting explained
- **[README](../README.md)** — project overview, configuration reference, architecture
- **[Docker guide](DOCKER.md)** — persistence, Portainer, reverse proxies
- **[Contributing](../CONTRIBUTING.md)** — dev setup and PR workflow
- **Community** — [GitHub Issues](https://github.com/accius/openhamclock/issues), the [Facebook group](https://www.facebook.com/groups/1217043013897440), and [r/OpenHamClock](https://www.reddit.com/r/OpenHamClock/); contributors are celebrated in Settings → Community inside the app
