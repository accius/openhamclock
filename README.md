# OpenHamClock

**A real-time amateur radio dashboard for the modern operator.**

OpenHamClock brings DX cluster spots, space weather, propagation predictions, POTA/SOTA/WWFF/WWBOTA activations, PSKReporter, satellite tracking, WSJT-X integration, direct rig control, an in-browser logbook, and a full emergency-communications mode into a single browser-based interface. Run it locally on a Raspberry Pi, on your desktop, in Docker, or just use the hosted site.

**🌐 Live Site:** [openhamclock.com](https://openhamclock.com)

**📧 Contact:** Chris, K0CJH — [chris@cjhlighting.com](mailto:chris@cjhlighting.com)

**☕ Support the Project:** [buymeacoffee.com/k0cjh](https://buymeacoffee.com/k0cjh) — Running [openhamclock.com](https://openhamclock.com) comes with real hosting costs including network egress, memory, CPU, and the time spent maintaining and improving the project. There is absolutely no obligation to donate — OpenHamClock is and always will be free. But if you find it useful and want to chip in, your donations are greatly appreciated and go directly toward keeping the site running and funding future development.

**🔧 Get Involved:** This is an open-source project and the amateur radio community is encouraged to dig into the code, fork it, and build the features you want to see. Whether it's a new panel, a data source integration, or a bug fix — PRs are welcome. See [Contributing](#contributing) below.

**📝 License:** MIT — See [LICENSE](LICENSE)

---

## Documentation

| Guide                                    | What's in it                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| **[Quick Start](docs/QUICKSTART.md)**    | Use the hosted site, or self-host on Docker, Linux/macOS, Raspberry Pi, Windows, Railway |
| **[User Manual](docs/MANUAL.md)**        | Every panel, map layer, keyboard shortcut, and setting explained                         |
| **[Docker Guide](docs/DOCKER.md)**       | Compose, Portainer, persistence, reverse proxies                                         |
| **[Roadmap](ROADMAP.md)**                | Project history and what's coming                                                        |
| **[Contributing](CONTRIBUTING.md)**      | Dev setup, code style, PR workflow                                                       |
| **[Testing](TESTING.md)**                | Unit test guide                                                                          |
| **[Security Policy](SECURITY.md)**       | Vulnerability disclosure                                                                 |
| **[Architecture](docs/ARCHITECTURE.md)** | Codebase map for contributors                                                            |

Release notes live in the app itself: click the version number in the header to open **What's New**.

---

## Feature Highlights

- **Interactive world map** in three projections — flat (Mercator), azimuthal-equidistant centered on your QTH, and a full 3D globe with real satellite models — with a dozen basemap styles and ~28 toggleable overlay layers (gray line, aurora, MUF, D-RAP, lightning, satellites, RBN, WSPR, Maidenhead grid, CQ/ITU zones, aircraft, and more), most with single-key shortcuts.
- **DX cluster spots** from OpenHamClock's own cluster node (RBN + HamQTH + POTA/SOTA/WWFF + user spots, deduplicated), with band/mode/zone/watchlist filtering, worked-before and dupe badges from your log, click-to-tune, and click-to-listen via the nearest live KiwiSDR.
- **Activations** — live POTA, SOTA, WWFF, and WWBOTA activator panels with map markers.
- **Native logbook** — QSOs stored in your browser (IndexedDB), ADIF import/export, log-from-spot, and worked-before integration across all spot panels.
- **Propagation** — browser-side ITU-R P.533-14 (VOACAP-class) predictions via WebAssembly, point-to-point reliability charts, world heatmap, MUF map, band conditions, and ionosonde-corrected real-time data.
- **Space weather** — SFI/Kp/SSN with history, GOES X-ray flux, NOAA SWPC alerts, aurora forecast, solar imagery, lunar phase.
- **Satellite tracking** — SGP4 tracking of amateur satellites from CelesTrak/AMSAT/SatNOGS (optionally Space-Track), orbit tracks, footprints, pass info, and 3D models on the globe.
- **Rig control** — click any spot and your radio tunes, via the [Rig Bridge](rig-bridge/README.md) (Yaesu, Kenwood, Icom, Elecraft, FlexRadio, flrig, rigctld, and more) with a cloud relay for hosted use.
- **Digital modes** — WSJT-X/JTDX decodes on the map (UDP or cloud relay), JS8Call/MSHV control, PSKReporter TX/RX reports in real time.
- **Contest tools** — contest calendar, N1MM+/DXLog QSOs plotted live on the map, band plan overlay on the rig display.
- **EmComm layout** — ARES/RACES dashboard with APRS (internet + RF via local TNC), net roster, point-to-point messaging, resource token aggregation, telemetry dashboards, NWS alerts, FEMA shelters and disaster declarations, Winlink gateways and Pat client.
- **Meshtastic & MeshCom** — mesh network nodes and messages on the map and in dockable panels.
- **Works your way** — dockable drag-anywhere layout, Classic (original HamClock style), and EmComm layouts; five themes including a custom theme editor; named profiles; 16 languages; PWA offline mode with cached data.

---

## Quick Start

**Just want to use it?** Open **[openhamclock.com](https://openhamclock.com)**, set your callsign and grid, done.

**Self-host with Docker:**

```bash
docker run -d -p 3000:3000 --name openhamclock ghcr.io/accius/openhamclock:latest
```

**Prebuilt executable** (no Node.js, no Docker): download the file for your OS from the **[latest release](https://github.com/accius/openhamclock/releases/latest)**, extract, run. Windows, macOS (Apple Silicon and Intel), Linux, and Raspberry Pi (64-bit) — see the [Quick Start guide](docs/QUICKSTART.md#prebuilt-executable-no-nodejs-needed).

**Self-host from source** (Node.js 22 LTS recommended):

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
npm ci
npm start
```

Open <http://localhost:3000>. A setup wizard walks you through callsign and grid on first run.

**One-line installers** for Linux/macOS (`scripts/setup.sh`), Raspberry Pi kiosk (`scripts/setup-pi.sh`), and Windows (`scripts/setup-windows.ps1`) — full commands and per-platform details in the **[Quick Start guide](docs/QUICKSTART.md)**.

For development with hot reload:

```bash
# Terminal 1 — Backend (http://localhost:3001)
node server.js

# Terminal 2 — Frontend (hot reload on http://localhost:3000)
npm run dev
```

---

## Deployment Matrix

| Platform                | Method                                                                                         | Guide                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Nothing (hosted)        | [openhamclock.com](https://openhamclock.com)                                                   | [Quick Start](docs/QUICKSTART.md)                                      |
| Prebuilt executable     | Download from [Releases](https://github.com/accius/openhamclock/releases/latest), extract, run | [Quick Start](docs/QUICKSTART.md#prebuilt-executable-no-nodejs-needed) |
| Docker / Portainer      | `docker compose up -d` or `ghcr.io/accius/openhamclock:latest`                                 | [docs/DOCKER.md](docs/DOCKER.md)                                       |
| Linux / macOS / FreeBSD | `scripts/setup.sh` (add `--service` for systemd on Linux)                                      | [Quick Start](docs/QUICKSTART.md#linux--macos--freebsd-one-liner)      |
| Raspberry Pi (3B–5)     | `scripts/setup-pi.sh` (`--kiosk` for a dedicated display)                                      | [Quick Start](docs/QUICKSTART.md#raspberry-pi)                         |
| Windows                 | `scripts/setup-windows.ps1`                                                                    | [Quick Start](docs/QUICKSTART.md#windows)                              |
| Railway (cloud)         | `railway up` or connect the GitHub repo                                                        | [Quick Start](docs/QUICKSTART.md#railway-cloud)                        |
| Desktop app             | `npm run electron` (experimental)                                                              | —                                                                      |
| Android TV / Fire TV    | Sideload the WebView wrapper APK (`android-tv/build.sh`, `install-firetv.sh`)                  | [TV app guide](android-tv/README.md)                                   |
| Roku                    | Sideload the native channel zip (`roku/package.sh`)                                            | [Roku guide](roku/README.md)                                           |

**Hardware:** the server side is light (~100–150 MB RAM); it's the browser rendering the map that works a machine. A Pi 4 (2 GB+) or Pi 5 makes a smooth kiosk; a Pi 3B+ is best as a headless server or with Low Memory Mode enabled in Settings. The 3D globe wants WebGL — without it the app falls back to the flat map automatically.

---

## Configuration

All configuration lives in `.env` (auto-created from `.env.example` on first run) — and almost everything can also be changed in the in-app Settings panel, which takes priority. The only two lines most people touch:

```bash
CALLSIGN=K0CJH
LOCATOR=EN10
```

> Files starting with a dot are hidden by default — `ls -la` in a terminal, `Ctrl+H` in a Linux file manager, `Cmd+Shift+.` in macOS Finder.

**Settings priority:** browser Settings panel (localStorage) → `.env` → built-in defaults. Your `.env` is never overwritten by updates. Self-hosted single-operator installs can set `SETTINGS_SYNC=true` to store UI settings on the server so every device gets the same setup.

### Common variables

The complete annotated list lives in [`.env.example`](.env.example). Highlights:

| Variable                                                           | Default           | Description                                                                                           |
| ------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `CALLSIGN`                                                         | `N0CALL`          | Your callsign — used for DX cluster login, PSKReporter queries, and "my spots" tracking               |
| `LOCATOR`                                                          | `FN31`            | Maidenhead grid (4 or 6 characters); `LATITUDE`/`LONGITUDE` override the derived coordinates          |
| `PORT`                                                             | `3001` (dev)      | Backend port. Containers run on `3000`; in dev, Vite owns `3000` and proxies `/api` to `3001`         |
| `HOST`                                                             | `localhost`       | Set `0.0.0.0` to allow other devices on your LAN                                                      |
| `THEME` / `LAYOUT`                                                 | `dark` / `modern` | Startup theme (`dark`, `light`, `legacy`, `retro`) and layout (`modern`, `classic`)                   |
| `DISTUNITS` / `TEMPUNITS` / `PRESSUNITS`                           | `imperial`        | Distance, temperature, and pressure units (`imperial` or `metric`); `UNITS` is deprecated             |
| `TIME_FORMAT`                                                      | `12`              | `12` or `24` hour clock                                                                               |
| `SETTINGS_SYNC`                                                    | `false`           | Store all UI settings server-side (single-operator self-host only)                                    |
| `WSJTX_ENABLED`                                                    | `true`            | WSJT-X/JTDX UDP listener (legacy name `WSJTX_UDP_ENABLED` still honored)                              |
| `WSJTX_UDP_PORT`                                                   | `2237`            | Must match WSJT-X Settings → Reporting → UDP Server                                                   |
| `WSJTX_MULTICAST_ADDRESS`                                          | _(none)_          | Set when WSJT-X broadcasts to a multicast group (e.g. `224.0.0.1`)                                    |
| `WSJTX_RELAY_KEY`                                                  | _(none)_          | Shared secret for the WSJT-X relay agent (cloud deployments only)                                     |
| `AUTO_UPDATE_ENABLED`                                              | `false`           | Periodic git self-update (legacy name `AUTO_UPDATE` still honored)                                    |
| `AUTO_UPDATE_INTERVAL_MINUTES`                                     | `60`              | Update check interval (legacy name `AUTO_UPDATE_INTERVAL` still honored)                              |
| `DX_CLUSTER_SOURCE`                                                | `auto`            | `auto`, `proxy`, `hamqth`, or `dxspider`; see the [manual](docs/MANUAL.md#dx-cluster-in-depth)        |
| `DX_CLUSTER_CALLSIGN`                                              | `CALLSIGN-56`     | Cluster login (use `-57` for a second/staging instance)                                               |
| `SPOT_RETENTION_MINUTES`                                           | `30`              | How long DX spots stay in the list (5–30)                                                             |
| `APRS_ENABLED`                                                     | `false`           | Read-only APRS-IS feed; filter with `APRS_FILTER` (e.g. `r/40.12/-74.82/500`)                         |
| `N1MM_UDP_ENABLED`                                                 | `false`           | Contest logger UDP listener on `N1MM_UDP_PORT` (12060) — see [docs/N1MM-SETUP.md](docs/N1MM-SETUP.md) |
| `QRZ_USERNAME`/`QRZ_PASSWORD`, `HAMQTH_USERNAME`/`HAMQTH_PASSWORD` | _(none)_          | Optional callbook credentials for better callsign lookups                                             |
| `OPENWEATHER_API_KEY`                                              | _(none)_          | Only needed for the Cloud Layer map overlay (also set `VITE_OPENWEATHER_API_KEY`)                     |
| `API_WRITE_KEY`                                                    | _(none)_          | Protects write endpoints — **required for public/cloud deployments**                                  |
| `METRICS_AUTH_KEY`                                                 | _(none)_          | Bearer-token auth for the Prometheus `/metrics` endpoint                                              |
| `CELESTRAK_ENABLED` / `AMSAT_TLE_ENABLED` / `SATNOGS_TLE_ENABLED`  | `true`            | Satellite element-set sources; `SPACE_TRACK_USERNAME`/`_PASSWORD` enable Space-Track as primary       |
| `ITURHFPROP_URL`                                                   | _(built-in)_      | External ITU-R P.533 service — only if self-hosting `iturhfprop-service/`                             |
| `WINLINK_API_KEY`                                                  | _(none)_          | Winlink gateway proxy (cloud deployments; local installs use the rig-bridge plugin instead)           |

---

## API Overview

The backend exposes a JSON REST API under `/api`, heavily cached server-side to be kind to upstream services. Notable endpoints:

| Endpoint                                                                                        | Description                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/config`, `GET /api/version`                                                           | Station config and lightweight version check (drives the update toast)                                 |
| `GET /api/health`                                                                               | Live server dashboard — uptime, visitors, sessions, per-endpoint traffic (`?format=json` for raw data) |
| `GET /api/dxcluster/spots`, `/paths`, `/sources`                                                | DX cluster spots, map paths, and available source backends                                             |
| `POST /api/dxcluster/spot`                                                                      | Submit a spot to the OHC cluster                                                                       |
| `GET /api/pota/spots`, `/api/sota/spots`, `/api/wwff/spots`                                     | Activator spots (1–2 min cache)                                                                        |
| `GET /api/solar-indices`, `/api/noaa/xray`, `/api/noaa/aurora`, `/api/drap`, `/api/swpc/alerts` | Space weather feeds                                                                                    |
| `GET /api/n0nbh`                                                                                | N0NBH band conditions                                                                                  |
| `GET /api/propagation`, `/heatmap`, `/mufmap`                                                   | Point-to-point prediction, world heatmap, MUF map                                                      |
| `GET /api/p533-data/:file`                                                                      | ITU-R P.533 coefficient tables for the in-browser WASM engine                                          |
| `GET /api/satellites/data`                                                                      | Merged satellite element sets (CelesTrak / AMSAT / SatNOGS / Space-Track)                              |
| `GET /api/callsign/:call`, `/api/cty`                                                           | Callsign lookup and the AD1C cty.dat prefix database                                                   |
| `GET /api/rbn/spots`, `/api/wspr/heatmap`                                                       | Reverse Beacon Network spots and WSPR heatmap                                                          |
| `GET /api/pskreporter/stream/:id`                                                               | Live PSKReporter spots over SSE (server-side MQTT proxy)                                               |
| `GET /api/wsjtx/decodes`, `POST /api/wsjtx/relay`                                               | WSJT-X decodes and the cloud relay ingest                                                              |
| `GET /api/contests`, `/api/dxpeditions`, `/api/dxnews`                                          | Contest calendar, DXpeditions, DX news                                                                 |
| `GET/POST /api/contest/qsos`                                                                    | N1MM/DXLog contest QSOs (UDP-fed, plus HTTP ingest)                                                    |
| `GET /api/aprs/stations`, `/messages`, `/telemetry`, `/net`                                     | APRS stations, messaging, telemetry, net roster                                                        |
| `GET /api/emcomm/alerts`, `/shelters`, `/disasters`                                             | NWS alerts, FEMA shelters and disaster declarations                                                    |
| `GET /api/winlink/gateways`                                                                     | Winlink RMS gateways (needs `WINLINK_API_KEY` server-side)                                             |
| `GET /api/websdr/receivers`                                                                     | Nearest live KiwiSDR/WebSDR receivers for click-to-listen                                              |
| `GET /api/aircraft`, `/api/atc/sectors`                                                         | ADS-B aircraft (adsb.lol) and ATC sector boundaries                                                    |
| `GET /metrics`                                                                                  | Prometheus metrics (optionally gated by `METRICS_AUTH_KEY`)                                            |

Write endpoints (settings, rig, rotator, spot submission, etc.) are rate-limited and honor `API_WRITE_KEY` when set.

---

## Architecture

React 18 + Vite frontend, Express backend. The backend is an API proxy and data aggregator — external calls are cached server-side so any number of browsers add near-zero upstream load. Real-time data flows over SSE (DX cluster, PSKReporter, RBN), UDP (WSJT-X, N1MM), and a server-side MQTT proxy.

Companion services in this repo:

| Directory             | Service                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `rig-bridge/`         | Local rig control bridge — 20+ plugins (radios, digital modes, APRS TNC, rotator, Winlink)                                                  |
| `ohc-cluster/`        | OpenHamClock's own DX cluster node (telnet :7300 + HTTP), aggregating RBN, HamQTH, POTA/SOTA/WWFF, Parks n Peaks, DX Summit, and user spots |
| `dxspider-proxy/`     | Persistent telnet connection to the DX Spider network, served over HTTP                                                                     |
| `iturhfprop-service/` | ITU-R P.533-14 propagation engine as a REST API (self-host alternative)                                                                     |
| `wasm-build/`         | Builds the P.533 engine to WebAssembly for in-browser predictions                                                                           |
| `wsjtx-relay/`        | WSJT-X UDP → HTTPS relay for cloud-hosted instances                                                                                         |
| `fletcher/`           | TLE fetch egress proxy used by the hosted deployment                                                                                        |
| `watchtower/`         | Cloudflare Worker uptime probe                                                                                                              |

Full codebase map: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Updating

- **Hosted site** — nothing to do; a toast appears when a new version deploys.
- **Git installs** — `./scripts/update.sh` (Linux/macOS/Pi) or `.\scripts\update.ps1` (Windows), then restart. Local installs also get an **UPDATE** button in the header. Optional auto-update via `AUTO_UPDATE_ENABLED=true`. If an update was cut off part way (SSH session dropped, out of memory) and the server will not start, `./scripts/update.sh --repair` reinstalls the dependencies and rebuilds; the script also offers this itself when it finds the install incomplete.
- **Docker** — `docker compose pull && docker compose up -d`.
- **Railway** — push to the connected repo, or `railway up`.

The update scripts back up `.env`, pull, rebuild, and restore `.env` — your configuration is never lost.

---

## FAQ

**Do I need a license to use OpenHamClock?** No — it's a receive-only dashboard. A callsign makes PSKReporter "my signal" views and cluster login meaningful, but anyone can watch spots and space weather.

**Can multiple people use one server?** Yes. Each browser keeps its own settings, filters, and DX target; the server cache means extra users add no upstream load. Shared-station operators can use **Profiles** (Settings → Profiles) to switch setups.

**Why don't I see DX spots / PSK reports?** Make sure your callsign is set. PSKReporter falls back from the live stream to HTTP automatically; check the panel footer for the active method. For clusters, check the server console and any custom `DXSPIDER_PROXY_URL`.

**Emoji show as boxes on Linux/Pi?** Install a color emoji font on the machine running the _browser_: `sudo apt install fonts-noto-color-emoji`, then restart the browser. The Pi setup script does this automatically.

**Where's the `.env` file?** In the repo root, hidden by the leading dot — `ls -la` shows it. Run `npm start` once and it's created from `.env.example` automatically.

More Q&A throughout the **[User Manual](docs/MANUAL.md)**.

---

## Monitoring

OpenHamClock exposes a Prometheus-compatible endpoint at `/metrics` (optionally protected with `METRICS_AUTH_KEY` as a bearer token) and a human-friendly health dashboard at `/api/health`.

---

## Contributing

OpenHamClock is built by the ham radio community — 40+ contributors and growing. Whether it's a bug fix, a new panel, a map layer plugin, or better docs, PRs are welcome.

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
git checkout Staging
npm ci
node server.js   # Terminal 1 — Backend on :3001
npm run dev      # Terminal 2 — Frontend on :3000
```

Open pull requests against **`Staging`**, not `main`. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow, code style, and the documentation policy, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the codebase map.

**Community:**

- [GitHub Issues](https://github.com/accius/openhamclock/issues) — bug reports and feature requests
- [Facebook Group](https://www.facebook.com/groups/1217043013897440) — discussion and help
- [Reddit r/OpenHamClock](https://www.reddit.com/r/OpenHamClock/) — community discussion
- **Settings → Community** in the app — the contributors wall

---

## Credits

- **K0CJH (Chris Hetherington)** — Creator and maintainer — [chris@cjhlighting.com](mailto:chris@cjhlighting.com)
- **Elwood Downey, WB0OEW (SK)** — Creator of the original HamClock that inspired this project. OpenHamClock is dedicated to his memory.
- **Claude AI (Anthropic)** — Accelerated development by assisting with bug fixes, code structure, and feature implementation
- **Keith, G6NHU** — DX Spider cluster operator at dxspider.co.uk
- **NOAA Space Weather Prediction Center** — Space weather data (SFI, Kp, SSN, X-ray flux, aurora, D-RAP)
- **N0NBH (Paul Herrman)** — Real-time band conditions data feed
- **POTA / SOTA / WWFF / WWBOTA** — Activator spot APIs
- **PSKReporter** — Digital mode reception report network
- **Reverse Beacon Network** — CW/RTTY/FT skimmer spots
- **Open-Meteo** — Free weather API
- **Leaflet** — Open-source mapping library
- **CelesTrak · AMSAT · SatNOGS** — Satellite orbital element data
- **NASA** — Imagery, EONET hazards data, and the ISS 3D model (NASA/VTAD)
- **KC2G / GIRO** — Ionospheric sounding data ([acknowledgements](https://giro.uml.edu/didbase/acknowledgements.html))
- **AD1C** — cty.dat DXCC entity database
- **Hessu, OH7LZB / aprs.fi** — [aprs-deviceid](https://github.com/aprsorg/aprs-deviceid) APRS device identification table (CC BY-SA 2.0)
- **NG3K** — DXpedition listing
- **DXNews.com / DX-World** — DX news headlines
- **WA7BNM** — Contest calendar data
- **adsb.lol** — Community ADS-B aircraft feed

And thank you to **every contributor** — the full wall lives in the app under Settings → Community.

---

## License

MIT License — See [LICENSE](LICENSE) file.

---

73 de K0CJH
[openhamclock.com](https://openhamclock.com) · [chris@cjhlighting.com](mailto:chris@cjhlighting.com)
