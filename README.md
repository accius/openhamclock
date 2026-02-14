# OpenHamClock

**A real-time amateur radio dashboard for the modern operator.**

OpenHamClock brings DX cluster spots, space weather, propagation predictions, POTA activations, WWFF activations, PSKReporter, satellite tracking, WSJT-X integration, and more into a single browser-based interface. Run it locally on a Raspberry Pi, on your desktop, or access it from anywhere via a cloud deployment.

**🌐 Live Site:** [openhamclock.com](https://openhamclock.com)

**📧 Contact:** Chris, K0CJH — [chris@cjhlighting.com](mailto:chris@cjhlighting.com)

**☕ Support the Project:** [buymeacoffee.com/k0cjh](https://buymeacoffee.com/k0cjh) — Running [openhamclock.com](https://openhamclock.com) comes with real hosting costs including network egress, memory, CPU, and the time spent maintaining and improving the project. There is absolutely no obligation to donate — OpenHamClock is and always will be free. But if you find it useful and want to chip in, your donations are greatly appreciated and go directly toward keeping the site running and funding future development.

**🔧 Get Involved:** This is an open-source project and the amateur radio community is encouraged to dig into the code, fork it, and build the features you want to see. Whether it's a new panel, a data source integration, or a bug fix — PRs are welcome. See [Contributing](#contributing) below.

**📝 License:** MIT — See [LICENSE](LICENSE)

---

## Quick Start

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser. On first run, the server creates a `.env` file from `.env.example` and builds the React frontend automatically. A setup wizard will walk you through entering your callsign and grid locator.

You can also configure your station by editing `.env` directly:

```bash
# .env — the only two lines you need to change
CALLSIGN=K0CJH
LOCATOR=EN10
```

Restart with `npm start` after editing `.env` to apply changes.

For development with hot reload:

```bash
# Terminal 1 — Backend
node server.js

# Terminal 2 — Frontend (hot reload on http://localhost:5173)
npm run dev
```

---

## Table of Contents

- [Dashboard Modules](#dashboard-modules)
  - [World Map](#world-map)
  - [DX Cluster](#dx-cluster)
  - [PSKReporter](#pskreporter)
  - [POTA — Parks on the Air](#pota--parks-on-the-air)
  - [WWFF — World Wide Flora and Fauna](#wwff---world-wide-flora-and-fauna)
  - [Space Weather](#space-weather)
  - [Solar Panel](#solar-panel)
  - [Band Conditions](#band-conditions)
  - [Propagation Predictions](#propagation-predictions)
  - [Satellites](#satellites)
  - [Contests](#contests)
  - [DXpeditions](#dxpeditions)
  - [DX News Ticker](#dx-news-ticker)
  - [WSJT-X Integration](#wsjt-x-integration)
  - [Weather](#weather)
  - [DE / DX Location Panels](#de--dx-location-panels)
  - [Header Bar](#header-bar)
  - [Analog Clock](#analog-clock)
- [Themes and Layouts](#themes-and-layouts)
- [Map Layers and Plugins](#map-layers-and-plugins)
- [Languages](#languages)
- [Profiles](#profiles)
- [Auto-Refresh on Update](#auto-refresh-on-update)
- [Health Dashboard](#health-dashboard)
- [Configuration Reference](#configuration-reference)
- [Deployment](#deployment)
  - [Local / Desktop](#local--desktop)
  - [Raspberry Pi](#raspberry-pi)
  - [Docker](#docker)
  - [Railway (Cloud)](#railway-cloud)
- [DX Spider Proxy](#dx-spider-proxy)
- [WSJT-X Relay Agent](#wsjt-x-relay-agent)
- [Updating](#updating)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

---

## Dashboard Modules

OpenHamClock is built from independent modules, each focused on a specific data source or function. Every module fetches its own data, manages its own refresh cycle, and can be toggled on or off. Below is a detailed walkthrough of each one.

---

### World Map

The central interactive map is the heart of the dashboard. It ties every other module together visually — DX spots, POTA/WWFF activators, satellite orbits, signal paths, and your own station location all appear here.

**What it shows:**

- **Your station (DE)** — A labeled marker at your configured location with your callsign.
- **DX cluster spots** — Colored circle markers for each DX spot, color-coded by band (160m = dark red, 80m = orange, 40m = yellow, 20m = green, 15m = cyan, 10m = magenta, etc.). Click any marker to see the full callsign, frequency, mode, spotter, and DXCC entity.
- **Great-circle signal paths** — Lines drawn from your station to each DX spot showing the shortest path on the globe. These are true great-circle paths, not straight lines.
- **POTA activators** — Green triangle markers for Parks on the Air activators. Click for park name, reference number, frequency, mode, and spot time.
- **WWFF activators** - Light Green inverted triangle markers for World Wide Flora and Fauna activators. Click for park name, reference number, frequency, mode, and spot time.
- **Satellite positions** — Colored markers for amateur radio satellites with orbital track lines showing their predicted path.
- **PSKReporter paths** — Signal paths from the PSKReporter network showing who is hearing whom on digital modes.
- **Day/night terminator** — A shaded overlay showing which parts of the Earth are in darkness, updated in real time.
- **Map legend** — Bottom-left corner shows the color key for all band markers plus DE, DX, sun, and moon icons.

**How to use it:**

- **Pan and zoom:** Click and drag to pan, scroll wheel to zoom. Double-click to zoom in.
- **Toggle overlays:** Use the header bar buttons to turn DX Paths, DX Labels, POTA, WWFF, Satellites, PSKReporter, and WSJT-X overlays on and off. Each button shows its current state (highlighted = on).
- **Click any marker** to see detailed information in a popup.
- **Set a DX target:** Click anywhere on the map to set a DX target location for propagation predictions. The DX panel on the right sidebar updates with the bearing, distance, and grid square of wherever you clicked.

**How it works under the hood:** The `WorldMap.jsx` component uses [Leaflet.js](https://leafletjs.com/) for rendering. DX spot coordinates are resolved in order of precision: callsign database lookup → DXCC prefix table → Maidenhead grid square extracted from spot comments. Great-circle paths are calculated using the Haversine formula and rendered as polylines with intermediate waypoints for visual accuracy. The day/night terminator is computed from the current solar declination and hour angle. The map tile style adapts to your selected theme (dark tiles for dark themes, light tiles for light themes).

---

### DX Cluster

Live DX spots streamed from the worldwide DX Spider cluster network. This is the primary data feed for most operators — every spot that comes through the cluster appears here in real time.

**What it shows:**

- A scrollable list of all active DX spots
- Each spot includes: spotted callsign, frequency (MHz), mode, spotter callsign, time (UTC), and DXCC entity name
- Spots are color-coded by band for quick visual scanning
- A "My Spots" indicator highlights when your callsign is spotted by someone else
- The spot count and active filter count are shown in the panel header

**How to use it:**

1. **View spots:** Spots appear automatically in the panel, newest at the top. The list scrolls and shows all spots within the retention window.
2. **Hover over a spot** to highlight its signal path on the map.
3. **Open filters:** Click the funnel icon (⊕ Filter) to open the DX Filter Manager.
4. **Toggle map display:** Click the "⊞ Map ON/OFF" button in the panel header to show or hide DX spots on the map.

**Filtering (DX Filter Manager):**

The filter manager has six tabs, each with its own set of filters. Filters are AND-combined (a spot must pass all active filters to be shown):

- **Zones** — Filter by continent (NA, SA, EU, AF, AS, OC, AN), CQ zone (1–40), or ITU zone (1–90). Click a continent or zone number to toggle it. "Select All" and "Clear" buttons at the top of each section.
- **Bands** — Show only spots on specific bands: 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 11m, 10m, 6m, 2m, 70cm. Click each band to toggle.
- **Modes** — Filter by operating mode: CW, SSB, FT8, FT4, RTTY, PSK, JT65, JS8, SSTV, AM, FM. Click each mode to toggle.
- **Watchlist** — Enter specific callsigns you want to track (e.g., rare DX or friends). When "Watchlist Only" is checked, the panel shows only those callsigns.
- **Exclude** — Enter callsigns to always hide (e.g., pirate stations or stations you've already worked).
- **Settings** — Configure the DX cluster data source and spot retention time.

All filter settings are saved to your browser's localStorage and persist across sessions.

**DX cluster source options (configurable in Settings → DX Cluster tab or in .env):**

| Source | Description |
|--------|-------------|
| **DX Spider Proxy** (default) | Persistent telnet connection to the DX Spider network via a proxy microservice. Most reliable, best spot volume. |
| **HamQTH** | Spots from HamQTH's DX cluster HTTP feed. No telnet required. |
| **DXWatch** | Spots from the DXWatch cluster. |
| **Auto** | Tries all sources in order and uses the first one that responds. |

**Spot retention:** Spots remain in the list for 30 minutes by default. Change this via the `SPOT_RETENTION_MINUTES` variable in `.env` (range: 5–30 minutes) or in the DX Filter Manager settings tab.

**How it works under the hood:** The backend (`server.js`) connects to the DX Spider cluster network through the DX Spider Proxy microservice (a separate Node.js process that maintains a persistent telnet connection). The proxy parses incoming spot lines, and the main server resolves station locations through a built-in DXCC prefix table (340+ prefixes covering all DXCC entities). The frontend polls `/api/dxcluster/spots` every 5 seconds. Coordinates are resolved in priority order: direct callsign database → DXCC prefix → Maidenhead grid square extracted from the spot comment field.

---

### PSKReporter

Real-time digital mode reception reports from the PSKReporter network. Shows who is hearing whom across all digital modes worldwide — an invaluable tool for checking your signal reach on FT8, FT4, JS8, and other digital modes.

**What it shows:**

- A two-tab panel: **TX** (who is hearing your signal) and **RX** (who you are hearing)
- Each report includes: callsign, frequency, mode, SNR (signal-to-noise ratio in dB), grid square, and age of the report
- Signal paths drawn on the map between senders and receivers
- Total report count displayed in the panel header

**How to use it:**

1. **TX tab:** Shows stations that have reported receiving your signal. This tells you where your signal is reaching. Sort by SNR to see your strongest reports.
2. **RX tab:** Shows stations whose signals you are receiving (as reported to PSKReporter by your software). This shows what you can hear.
3. **Open filters:** Click the PSK filter button to configure band, mode, and time window filters.
4. **Toggle map display:** Click "⊞ Map ON/OFF" to show or hide PSKReporter signal paths on the map.
5. **Click any report** to center the map on that station's location.

**PSK Filter Manager options:**

- **Band filter** — Show only specific bands
- **Mode filter** — FT8, FT4, JS8, WSPR, JT65, etc.
- **Time window** — 5 minutes, 15 minutes, 30 minutes, or 1 hour
- **My callsign only** — Toggle between showing only your reports or all traffic in view

**Data sources (automatic, no configuration needed):**

1. **MQTT WebSocket** (primary) — Connects directly to `mqtt.pskreporter.info` over WebSocket for true real-time streaming. New reports appear within seconds. The client subscribes to MQTT topics matching your callsign and filters.
2. **HTTP API** (fallback) — If the MQTT connection fails to establish within 12 seconds, the system automatically falls back to polling the PSKReporter HTTP API through the server proxy. This still works, just with slightly less immediacy.

The current connection method is shown in the panel footer. You don't need to configure anything — the system handles failover automatically.

**How it works under the hood:** The `usePSKReporter` hook in the frontend connects to the PSKReporter MQTT broker over a WebSocket connection, subscribes to spot topics matching your callsign and active filters, and parses the compact binary message format (sender call, receiver call, locators, frequency, mode, SNR). Grid squares are converted to latitude/longitude for map display using the Maidenhead locator system. The server provides an HTTP fallback via `/api/pskreporter/http/:call` with a 2-minute cache and automatic backoff on 403/429 responses.

---

### POTA — Parks on the Air

Shows all currently active POTA activators worldwide with their park references, frequencies, and map locations. If you're a POTA hunter, this panel tells you exactly who is on the air right now and where.

**What it shows:**

- A scrollable list of all active POTA activators with:
  - Callsign (green)
  - Location code (state/province abbreviation like US-FL, CA-ON)
  - Frequency (MHz)
  - Spot time (UTC)
- Total activator count in the panel header (e.g., "▲ POTA ACTIVATORS (42)")
- Green triangle markers on the map for each activator
- Callsign labels on map (visible when DX Labels are enabled)
- Click a map marker to see the full park name, reference number (e.g., US-3844), frequency, mode, and spot time

**How to use it:**

1. **Scan the panel** for interesting activations — look for states, provinces, or countries you need.
2. **Click "⊞ Map ON/OFF"** to toggle POTA markers on the map. Green triangles appear at each activator's park location.
3. **Click any green triangle** on the map for full details including park name.
4. **Enable DX Labels** (in the header bar) to see callsign labels next to each triangle on the map.

**Smart filtering (automatic, no configuration needed):**

- Operators who have signed off (comments containing "QRT") are automatically hidden
- Expired spots (less than 60 seconds remaining on the POTA server) are filtered out
- Spots are sorted newest-first so the freshest activations are always at the top
- The POTA API typically returns 40-80 active activators during daylight hours

**How it works under the hood:** The server proxies the POTA API (`api.pota.app/spot/activator`) with a 1-minute cache to reduce load on the upstream service. The `usePOTASpots` hook fetches spots every 60 seconds, filters out QRT/expired entries, sorts by recency, and resolves coordinates from the API's latitude/longitude fields. For the rare case where the API returns a spot without coordinates, the hook falls back to Maidenhead grid square conversion (grid6 → grid4 → center of grid).

---

### WWFF - World Wide Flora and Fauna

Shows all currently active WWFF activators worldwide with their park references, frequencies, and map locations. If you're a WWFF chaser, this panel tells you exactly who is on the air right now and where.

**What it shows:**

- A scrollable list of all active WWFF activators with:
  - Callsign (green)
  - Park Reference
  - Frequency (KHz)
  - Spot time (UTC)
- Total activator count in the panel header (e.g., "▲ WWFF ACTIVATORS (42)")
- Inverted Light Green triangle markers on the map for each activator
- Callsign labels on map (visible when DX Labels are enabled)
- Click a map marker to see the full park name, reference number (e.g., VKFF-0056), frequency, mode, and spot time

**How to use it:**

1. **Scan the panel** for interesting activations — look for states, provinces, or countries you need.
2. **Click "⊞ Map ON/OFF"** to toggle WWFF markers on the map. Inverted Light Green triangles appear at each activator's park location.
3. **Click any light green triangle** on the map for full details including park name.
4. **Enable DX Labels** (in the header bar) to see callsign labels next to each triangle on the map.

**Smart filtering (automatic, no configuration needed):**

- Operators who have signed off (comments containing "QRT") are automatically hidden
- Spots older than 60 minutes are filtered out
- Spots are sorted newest-first so the freshest activations are always at the top

**How it works under the hood:** The server proxies the WWFF API (`spots.wwff.co/static/spots.json`) with a 90 second cache to reduce load on the upstream service. The `useWWFFSpots` hook fetches spots every 60 seconds, filters out QRT/expired entries, sorts by recency, and resolves coordinates from the API's latitude/longitude fields.

---

### Space Weather

Displays the three key solar indices that affect HF radio propagation. If you operate HF, these numbers directly determine what bands will be open.

**What it shows:**

- **SFI (Solar Flux Index)** — The 10.7 cm solar radio flux, measured daily at the Dominion Radio Astrophysical Observatory. This is the single most important number for HF propagation:
  - SFI < 70: Poor conditions, only lower bands (40m–160m) reliably open
  - SFI 70–100: Fair conditions, mid-bands (20m–30m) open
  - SFI 100–150: Good conditions, higher bands (15m–17m) opening
  - SFI > 150: Excellent conditions, 10m and 12m wide open
- **K-Index (Kp)** — Planetary geomagnetic disturbance level on a 0–9 scale. Lower is better for HF:
  - Kp 0–2 (green): Quiet — excellent HF conditions
  - Kp 3–4 (amber): Unsettled — noticeable degradation, especially on polar paths
  - Kp 5+ (red): Storm — significant HF disruption, possible blackouts on higher bands
- **SSN (Sunspot Number)** — Daily sunspot count from the Royal Observatory of Belgium. Correlates with the 11-year solar cycle. Higher SSN means more ionization and better HF conditions.
- **Band conditions summary** — An overall assessment combining SFI and Kp: EXCELLENT, GOOD, FAIR, or POOR.

**How to use it:** Check these numbers before getting on the air. High SFI + low Kp = good day for DX. The space weather values are also displayed in the header bar for quick reference without scrolling.

**Data source:** NOAA Space Weather Prediction Center (SWPC) JSON feeds. Updates every 5 minutes.

---

### Solar Panel

A multi-view panel that cycles through four displays. Click the toggle button in the panel header to switch between them. Your selection persists across sessions.

**View 1 — Solar Image:**
Live solar imagery showing current sunspot activity and coronal features. Useful for spotting active regions that may produce flares.

**View 2 — Solar Indices:**
Detailed SFI, K-index, and SSN values with 30-day history sparkline charts. This gives you a trend view — is the SFI trending up or down this month? Are geomagnetic storms becoming more frequent?

**View 3 — X-Ray Flux:**
Real-time GOES satellite X-ray flux chart showing solar flare activity over the past 6 hours. Flares are classified by peak flux: A (quiet) → B → C → M → X (intense). M-class and X-class flares can cause HF radio blackouts on the sunlit side of Earth. The current flare class is displayed prominently.

**View 4 — Lunar Phase:**
Current moon phase with a visual SVG rendering, illumination percentage, and calculated dates for the next full and new moon. Useful for EME (Earth-Moon-Earth) operators who need to know moon position and illumination for moonbounce contacts.

**How to use it:** Click the cycle button (◀ ▶ arrows or the view label) in the panel header to rotate through all four views. The panel remembers which view you last used.

**Data sources:** Solar indices from NOAA SWPC. X-ray flux from GOES satellite primary sensor feed. Lunar phase calculated astronomically from the current date using the synodic month (29.53059 days).

---

### Band Conditions

Real-time HF and VHF band conditions from the N0NBH solar conditions feed, sourced from NOAA data. This is your at-a-glance guide for which bands are worth tuning to right now.

**What it shows:**

Each HF band from 80m through 10m with day and night condition indicators:
- **Green (GOOD)** — Band is open with good propagation. Get on the air!
- **Amber (FAIR)** — Band may be usable but conditions are degraded.
- **Red (POOR)** — Band is not supporting propagation.

Additional information in the panel:
- **Day/night indicator** — Shows current conditions with a ☀/☾ marker, plus mini indicators when day and night conditions differ
- **VHF conditions** — Aurora and E-skip status by region (Europe, North America) with green/gray color coding
- **Footer stats** — SFI, K-index, geomagnetic field status (color-coded: green=QUIET, amber=UNSETTLED, red=ACTIVE/STORM), signal noise level
- **N0NBH attribution** — Source and last-updated timestamp

**How to use it:** Before tuning to a band, check its condition indicator here. Hover over any band tile to see the full day/night breakdown in a tooltip. The VHF section is especially useful for 6m operators watching for E-skip openings.

**How it works under the hood:** The server fetches N0NBH's XML solar data feed (`hamqsl.com/solarxml.php`) via the `/api/n0nbh` endpoint with a 1-hour server-side cache (N0NBH updates every 3 hours). The `useBandConditions` hook maps N0NBH's grouped band ranges (80m-40m, 30m-20m, 17m-15m, 12m-10m) to individual bands, with separate day and night conditions. The current condition displayed is based on UTC time (day = 06:00-18:00 UTC).

---

### Propagation Predictions

HF propagation reliability predictions between your station (DE) and whatever DX target you've selected on the map.

**What it shows:**

- Per-band signal reliability as a percentage for each HF band
- Color-coded bars: green (>60% reliable), amber (30–60%), red (<30%)
- Predictions update automatically when you change your DX target on the map

**How to use it:**

1. Click anywhere on the map to set a DX target location (or use the DX panel to enter coordinates).
2. The propagation panel recalculates predictions for the path between your station and that target.
3. Look for bands with high reliability percentages — those are your best bets for making contact.
4. Predictions change throughout the day as ionospheric conditions evolve, so check back periodically.

**Standard mode:** Uses a built-in propagation model based on current SFI, SSN, Kp, great-circle path distance, solar zenith angle, geomagnetic latitude, and estimated MUF (Maximum Usable Frequency) for each band.

**ITU-R P.533-14 predictions:** By default, all installs use the public OpenHamClock ITURHFProp prediction service for ITU-R P.533-14 propagation calculations — the international standard for HF propagation prediction. If you prefer to self-host, deploy the optional ITURHFProp microservice (in the `iturhfprop-service/` directory) and set `ITURHFPROP_URL` in `.env` to your own instance.

**Hybrid correction:** When ionosonde data is available from `prop.kc2g.com`, the system applies real-time corrections based on actual measured ionospheric conditions rather than just modeled values. This can catch unusual propagation events that models miss.

**Data refresh:** Predictions update every 10 minutes.

---

### Satellites

Real-time tracking of amateur radio satellites with orbital visualization on the map.

**What it shows:**

- Satellite positions as colored markers on the map, updated every 5 seconds
- Orbital track lines showing each satellite's path over the next pass
- Satellite name, altitude, and coordinates in the popup

**How to use it:**

1. Toggle satellites on/off using the satellite button (🛰) in the header bar.
2. Satellites that are currently above the horizon from your location are highlighted.
3. Click any satellite marker on the map to see its name, altitude, and current position.

**Satellite catalog:** Includes 40+ amateur radio satellites from CelesTrak's amateur radio TLE catalog: ISS, RS-44, AO-91, AO-92, QO-100, FO-99, CAS-4A/B, and many more.

**How it works under the hood:** The server fetches Two-Line Element (TLE) data from CelesTrak every 6 hours. The frontend uses the `satellite.js` library to run SGP4 orbital mechanics calculations in the browser, predicting each satellite's position at the current time. Position updates run every 5 seconds for smooth motion on the map.

---

### Contests

Upcoming and currently active amateur radio contests from the global contest calendar.

**What it shows:**

- Contest name, dates, modes, and bands
- Active contests are highlighted so you know what's happening right now
- Countdown timer to upcoming contests

**How to use it:** Check this panel when planning your weekend operating. If a major contest is active, expect the bands to be packed — great for quick QSOs, less great for ragchewing.

**Data source:** Contest Calendar RSS feed from `contestcalendar.com`, updated every 30 minutes.

---

### DXpeditions

Active and upcoming DXpeditions to rare DXCC entities. If you're chasing new countries for DXCC, this is where you find out who's operating from where.

**What it shows:**

- Callsign, target DXCC entity, dates, and operating frequencies/modes
- Active DXpeditions highlighted
- Upcoming expeditions with start dates

**Data source:** Parsed from NG3K's DXpedition listing, updated every 30 minutes.

---

### DX News Ticker

A scrolling ticker across the top of the dashboard showing the latest DX news headlines. Stay informed about upcoming activations, band openings, and amateur radio events without leaving the dashboard.

**Data source:** Scraped from DXNews.com, updated every 30 minutes.

---

### WSJT-X Integration

Live decoded FT8, FT4, JT65, JT9, and WSPR messages from WSJT-X, JTDX, or any compatible digital mode software. See decoded stations on the map in real time as they come in.

**What it shows:**

- Decoded callsigns, frequencies, signal reports (SNR), and grid squares
- Real-time list of incoming decodes as they happen
- Decoded stations plotted on the map when grid squares are available

**Local setup (WSJT-X on the same machine):**

1. Make sure `WSJTX_ENABLED=true` in your `.env` (this is the default).
2. In WSJT-X: go to **Settings → Reporting → UDP Server**.
3. Set **Address** to `127.0.0.1` and **Port** to `2237`.
4. Check "Enable" if it isn't already.
5. Start decoding — spots should appear in OpenHamClock within seconds.

**Network setup (WSJT-X on a different machine on your LAN):**

1. Set `HOST=0.0.0.0` in OpenHamClock's `.env` so it accepts connections from other machines.
2. In WSJT-X: set the UDP Server address to your OpenHamClock machine's IP (e.g., `192.168.1.100`) and port `2237`.
3. Make sure UDP port 2237 is not blocked by a firewall.

**Cloud setup (OpenHamClock on a remote server):**

WSJT-X sends data over UDP, which only works on a local network. For cloud deployments (like Railway or openhamclock.com), you need the WSJT-X Relay Agent to bridge the gap. See the [WSJT-X Relay Agent](#wsjt-x-relay-agent) section below.

**How it works under the hood:** The Node.js server (`server.js`) opens a UDP listener on port 2237 (configurable via `WSJTX_UDP_PORT`). It parses the WSJT-X binary protocol (QDataStream format) to extract decoded messages, heartbeat status, and QSO logs. The frontend polls `/api/wsjtx/decodes` every 2 seconds. For cloud deployments, the relay agent captures UDP packets locally and forwards them to the server over HTTPS using a shared secret key.

---

### Weather

Current weather conditions at your station location, displayed in the header bar and the DE location panel and, optionally, weather at the currently selected DX target station.

**In the header:**

- Weather description icon and temperature in both °F and °C

**Below the DE and optionally DX Location panel:**
- Temperature in either °F or °C with a toggle to select which one (note that the toggle affects both the DE and DX temperature display)
- Weather description (clear, cloudy, rain, snow, etc.) with an emoji icon
- Humidity and wind speed
- Collapsible detail view in the DE panel (click to expand/collapse)

**How to use it:** The weather is shown automatically based on your configured station coordinates and, optionally, at the currently selected DX target station. Click the weather line in the DE/DX panel to expand full details or collapse to a one-line summary.

**Data sources:**

- **Open-Meteo** — Free weather API, no API key required. Fetched directly by each user's browser (rate limits are per-user, not per-server). Optional API key support in Settings for higher rate limits.

No configuration needed — weather works automatically based on your station coordinates.

**Refresh interval:** Every 2 hours (weather data is cached server-side).

---

### DE / DX Location Panels

Information panels for your station (DE) and the currently selected DX target station.

**DE Panel (left sidebar) shows:**

- Your callsign and Maidenhead grid square
- Latitude/longitude coordinates
- DXCC entity, CQ zone, and ITU zone
- Sunrise and sunset times at your location
- Local weather (collapsible)

**DX Panel (right sidebar) shows:**

- DX target callsign or location
- Grid square, lat/lon coordinates
- DXCC entity, CQ zone, and ITU zone
- Bearing (azimuth) and distance from your station
- Sunrise and sunset times at the DX location
- DX location weather (optional and collapsible)

**How to use it:** The DX panel updates whenever you click a spot in the DX cluster, click a location on the map, or manually enter a callsign/grid in the DX panel. The bearing shown is useful for rotating a directional antenna.

---

### Header Bar

The persistent bar across the top of the dashboard provides at-a-glance information and quick controls.

**From left to right:**

- **Callsign** — Your callsign displayed prominently. Click it to open Settings.
- **Version** — Current OpenHamClock version number.
- **UTC Clock** — Current UTC time in large digits with the date. Essential for logging.
- **Local Clock** — Your local time with date. Click it to toggle between 12-hour and 24-hour format.
- **Weather** — Current temperature (°F/°C) with weather icon and wind info on hover.
- **SFI / K / SSN** — Live space weather indices. The K-index turns red when Kp ≥ 4 (storm conditions).
- **Donate** — Link to support the project.
- **Settings** — Opens the settings modal.
- **Fullscreen** — Toggle fullscreen mode (great for dedicated shack displays).

---

### Analog Clock

A classic analog clock display showing local time with additional station information.

**What it shows:**

- **Clock face** — Round analog clock with hour, minute, and second hands. Major tick marks every 5 minutes, minor ticks every minute, with hour numbers 1-12.
- **Day of week** — Displayed above the clock on the left (e.g., "Mon", "Tue").
- **Date** — Displayed above the clock on the right (e.g., "Feb 5").
- **Sunrise time** — Displayed below the clock on the left with a sun symbol.
- **Sunset time** — Displayed below the clock on the right with a moon symbol.

**How to use it:** The clock automatically sizes to fit whatever panel size you give it. In the dockable layout, you can add it via the "+" button and resize the panel as desired. A larger panel gives you a bigger, more readable clock face.

**Availability:** Always available in the dockable layout via the "Add Panel" menu. In the classic layout, enable it by setting `CLASSIC_ANALOG_CLOCK=true` in your `.env` file (disabled by default to keep the classic layout compact).

---

## Themes and Layouts

### Themes

Four visual themes, selectable in Settings or via `THEME` in `.env`:

| Theme | Description |
|-------|-------------|
| **Dark** | Modern dark interface with amber and cyan accents on a charcoal background. Easy on the eyes for late-night operating. This is the default. |
| **Light** | Light background with darker text. Best for daytime use or brightly lit environments where a dark screen causes too much contrast. |
| **Legacy** | Classic green-on-black terminal aesthetic reminiscent of vintage station monitors. Monochrome green text with a true-black background. |
| **Retro** | 90s-era GUI style with teal backgrounds, silver beveled panels, and shadow effects. A nostalgic throwback to early Windows and OS/2 interfaces. |

All themes use CSS custom properties defined in `src/styles/main.css`. To create your own theme, add a new set of CSS variables following the existing pattern.

### Layouts

Two layout modes, selectable in Settings or via `LAYOUT` in `.env`:

| Layout | Description |
|--------|-------------|
| **Modern** | Responsive 3-column grid layout. The map fills the center column, with sidebar panels on the left and right. Designed for widescreen monitors (1920×1080 and above). Panels reflow on smaller screens. |
| **Classic** | Inspired by the original HamClock by Elwood Downey, WB0OEW (SK). Features a black background, large colored numeric displays for callsign and frequency, a rainbow frequency bar, and a full-width map. Optimized for dedicated displays and Raspberry Pi kiosk mode. |

---

## Map Layers and Plugins

OpenHamClock has a plugin system for adding custom map overlays without modifying the core code. Plugins are self-contained React hooks that handle their own data fetching, rendering, and lifecycle.

**Built-in plugins:**

| Layer | Description |
|-------|-------------|
| **Aurora** | Real-time auroral oval overlay from the NOAA OVATION model. Shows the current extent of the aurora borealis/australis. Useful for VHF operators (aurora can enable 2m and 6m contacts) and HF operators (aurora degrades polar HF paths). |
| **Earthquakes** | Recent seismic activity markers from USGS. Large earthquakes can temporarily affect HF propagation through atmospheric acoustic-gravity waves. |
| **Weather Radar** | Precipitation overlay showing rain, snow, and storms. |

**How to enable/disable layers:**

1. Open **Settings** (gear icon in header).
2. Click the **Map Layers** tab.
3. Toggle each layer on or off with the switch.
4. Adjust layer opacity with the slider to see through overlays to the base map.

Layer preferences persist in localStorage.

**Creating your own plugin:** See `src/plugins/OpenHamClock-Plugin-Guide.md` for the complete developer guide. In short: create a new React hook in `src/plugins/layers/`, register it in `layerRegistry.js`, and it appears automatically in the Settings panel. No modifications to `WorldMap.jsx` are needed.

---

## Languages

The interface is available in 10 languages, selectable in Settings:

🇬🇧 English · 🇫🇷 Français · 🇪🇸 Español · 🇩🇪 Deutsch · 🇳🇱 Nederlands · 🇧🇷 Português · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇮🇹 Italiano · 🇸🇮 Slovenščina

Language files are in `src/lang/`. Each is a JSON file with translation keys. Contributions of new translations are welcome — just copy `en.json`, translate the values, and submit a PR.

---

## Profiles

Save and switch between named configuration profiles. Useful when multiple operators share a single HamClock, or when you want to quickly toggle between different personal setups (contest mode, field day, everyday).

**What a profile captures:** Everything — your callsign, location, theme, layout, dock arrangement, map layers, DX filters, PSK filters, satellite filters, VOACAP preferences, temperature unit, time format, and all other `openhamclock_*` settings.

**How to use it:**

1. Open **Settings → Profiles** tab
2. Enter a name (e.g., your callsign, "Contest", "Field Day") and click **Save**
3. Your current state is captured as a named profile
4. To switch profiles, click **▶ Load** on any saved profile — the page reloads with that configuration
5. To update a profile with your current changes, click **↻** (update)
6. To share a profile or move it between devices, click **⤓** (export) to download a JSON file, then use **Import Profile from File** on the other device

**Profile actions:**
- **▶ Load** — Restores the profile and reloads the page
- **↻ Update** — Overwrites the saved profile with your current live state
- **✎ Rename** — Inline rename
- **⤓ Export** — Downloads as a `.json` file
- **✕ Delete** — With confirmation

Profiles are stored in your browser's localStorage. The currently active profile is shown with a green indicator.

---

## Auto-Refresh on Update

When the server is updated with a new version (e.g., via `git pull` + restart, or a Railway deployment), all connected browsers automatically detect the change and reload. There is nothing to configure.

**How it works:** The frontend polls `/api/version` every 60 seconds. When the returned version number changes, a toast notification appears at the bottom of the screen ("🔄 OpenHamClock Updated — v15.0.0 → v15.1.0 — Reloading...") and the page reloads after 3 seconds. The version is read from `package.json` as the single source of truth.

---

## Health Dashboard

Visit `/api/health` in your browser for a real-time server status dashboard. The page auto-refreshes every 30 seconds.

**What it shows:**
- **Online Now** — Real-time concurrent user count (sessions expire after 5 minutes of inactivity)
- **Peak Concurrent** — Highest simultaneous users since last restart
- **Visitors Today / All-Time** — Unique IP counts with daily average
- **Visitor Trend** — 14-day bar chart with week-over-week growth percentage
- **Session Duration Analytics** — Average, median, 90th percentile, and max session durations. Duration distribution chart bucketed into <1m, 1-5m, 5-15m, 15-30m, 30m-1h, 1h+
- **Active Users Table** — Current online users with anonymized IPs, session duration, and request count
- **API Traffic Monitor** — Per-endpoint request counts, bandwidth usage, average response times, and estimated monthly egress

The JSON API (`/api/health?format=json`) returns all the same data in structured JSON, including a 24-hour `recentTrend` array and the full `sessions` object.

Visitor stats persist across restarts via file-based storage. Configure the storage location with `STATS_FILE` in `.env` (defaults to `./data/stats.json` locally or `/data/stats.json` on Railway volumes).

---

## Configuration Reference

All configuration is done through the `.env` file. On first run, this file is auto-created from `.env.example`. You can also change most settings through the browser-based Settings panel.

> **Can't find the `.env` file?** Files starting with a dot are hidden by default on Linux, Mac, and Raspberry Pi.
> - **Terminal:** `ls -la` to see hidden files, or `nano .env` to edit directly
> - **File manager (Pi/Linux):** Press `Ctrl+H` to toggle hidden files
> - **Mac Finder:** Press `Cmd+Shift+.` to toggle hidden files
> - **If the file doesn't exist yet:** Run `npm start` once and it will be auto-created, or copy it manually: `cp .env.example .env`
>
> The `.env` file is located in the root of your OpenHamClock directory (same folder as `server.js` and `package.json`).

### Station Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLSIGN` | `N0CALL` | Your amateur radio callsign. This is shown in the header bar and used for DX cluster login, PSKReporter queries, and "My Spots" tracking. |
| `LOCATOR` | `FN31` | Your Maidenhead grid locator (4 or 6 characters). Used to calculate your station coordinates if LATITUDE/LONGITUDE aren't set. |
| `LATITUDE` | *(from locator)* | Station latitude in decimal degrees. Overrides the latitude calculated from LOCATOR. |
| `LONGITUDE` | *(from locator)* | Station longitude in decimal degrees. Overrides the longitude calculated from LOCATOR. |

### Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port. Change if 3000 is already in use. |
| `HOST` | `localhost` | Bind address. Set to `0.0.0.0` to make OpenHamClock accessible from other devices on your LAN (tablets, phones, other PCs). |
| `LOG_LEVEL` | `warn` | Server log verbosity: `debug` (everything), `info` (operational), `warn` (problems), `error` (failures only). Use `warn` for production. |

### Display Preferences

| Variable | Default | Description |
|----------|---------|-------------|
| `UNITS` | `imperial` | `imperial` (°F, miles) or `metric` (°C, km). Affects weather display and distance calculations. |
| `TIME_FORMAT` | `12` | `12` or `24` hour clock format. Can also be toggled by clicking the local clock in the header. |
| `THEME` | `dark` | `dark`, `light`, `legacy`, or `retro`. See [Themes and Layouts](#themes-and-layouts). |
| `LAYOUT` | `modern` | `modern` or `classic`. See [Themes and Layouts](#themes-and-layouts). |
| `TZ` | *(browser)* | IANA timezone identifier (e.g., `America/New_York`, `Europe/London`). Only needed if your browser spoofs the timezone (common with privacy browsers like Librewolf). |

### Feature Toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `SHOW_POTA` | `true` | Show POTA activator markers on the map. |
| `SHOW_SATELLITES` | `true` | Show satellite tracks on the map. |
| `SHOW_DX_PATHS` | `true` | Show great-circle DX signal paths on the map. |
| `SHOW_DX_WEATHER` | `true` | Show weather for the selected DX location. |
| `CLASSIC_ANALOG_CLOCK` | `false` | Show analog clock panel in the classic layout. Always available in dockable layout. |

### External Services

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENWEATHER_API_KEY` | *(none)* | OpenWeatherMap API key. Only needed for the **Cloud Layer** map overlay — weather data uses Open-Meteo directly from each user's browser with no key. Get a free key at [openweathermap.org/api](https://openweathermap.org/api). Also set `VITE_OPENWEATHER_API_KEY` to the same value. |
| `ITURHFPROP_URL` | Public service | URL for ITU-R P.533 propagation predictions. Defaults to the public OpenHamClock service. Override only if self-hosting the `iturhfprop-service/`. |
| `DXSPIDER_PROXY_URL` | *(none)* | URL of your DX Spider proxy. A default proxy is provided, so you only need this if you're running your own. |

### WSJT-X Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `WSJTX_ENABLED` | `true` | Enable the WSJT-X UDP listener on the server. |
| `WSJTX_UDP_PORT` | `2237` | UDP port for receiving WSJT-X decoded messages. Must match the port configured in WSJT-X Settings → Reporting → UDP Server. |
| `WSJTX_RELAY_KEY` | *(none)* | Shared secret key for the WSJT-X relay agent. Required only for cloud deployments where WSJT-X can't reach the server directly over UDP. Pick any strong random string. |

### DX Cluster

| Variable | Default | Description |
|----------|---------|-------------|
| `DX_CLUSTER_CALLSIGN` | *(CALLSIGN-56)* | Callsign used for DX cluster login. Defaults to your callsign with SSID suffix -56. Use -57 for a staging/test instance to avoid conflicts. |
| `SPOT_RETENTION_MINUTES` | `30` | How long DX spots stay in the list before aging out. Range: 5–30 minutes. |

### Configuration Priority

Settings are loaded in this order (first match wins):

1. **localStorage** — Changes you make in the browser Settings panel are saved here and take top priority.
2. **.env file** — Your station configuration file. This is where you set your callsign and locator.
3. **Defaults** — Built-in fallback values (N0CALL, FN31, dark theme, modern layout).

Your `.env` file is never overwritten by updates, so your configuration is always safe.

---

## Deployment

### Local / Desktop

The simplest option. Just need Node.js 20 or newer.

```bash
git clone https://github.com/accius/openhamclock.git
cd openhamclock
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

**Access from other devices on your LAN** (phone, tablet, another PC):

1. Edit `.env` and set `HOST=0.0.0.0`
2. Restart with `npm start`
3. Open `http://<your-computer-ip>:3000` from the other device (e.g., `http://192.168.1.100:3000`)

To find your local IP: run `ipconfig` (Windows) or `ifconfig` / `ip addr` (Mac/Linux).

### Raspberry Pi

One-line install for Raspberry Pi (3B, 3B+, 4, 5). Supports both graphical and headless operation.

**Standard install (kiosk mode — auto-starts fullscreen on boot):**

```bash
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash -s -- --kiosk
```

This is the recommended option for a dedicated shack display. The Pi boots directly into a fullscreen Chromium browser showing OpenHamClock. No desktop environment needed.

**Server-only install (headless, no GUI):**

```bash
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash -s -- --server
```

Runs OpenHamClock as a web server only. Access it from any browser on your LAN.

**Standard install (manual browser launch):**

```bash
curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-pi.sh | bash
```

After installation, configure your station:

```bash
cd ~/openhamclock
nano .env          # Set your callsign and locator
./restart.sh       # Apply changes
```

The Pi setup script installs Node.js 20, clones the repository, builds the frontend, creates a systemd service (`openhamclock.service`) for automatic startup, and optionally configures Chromium in kiosk mode.

### Docker

**Docker Compose (recommended):**

```bash
docker-compose up -d
```

**Manual Docker build:**

```bash
docker build -t openhamclock .
docker run -d -p 3000:3000 -p 2237:2237/udp --name openhamclock openhamclock
```

The Dockerfile uses a multi-stage build: Stage 1 compiles the React frontend with Vite, Stage 2 creates a minimal production image with only the server and built assets. The UDP port mapping (`-p 2237:2237/udp`) is only needed if you use WSJT-X integration.

**Environment variables:** Pass your configuration via Docker environment variables:

```bash
docker run -d \
  -p 3000:3000 \
  -e CALLSIGN=K0CJH \
  -e LOCATOR=EN10 \
  -e HOST=0.0.0.0 \
  openhamclock
```

### Railway (Cloud)

Railway deployment files (`railway.toml`, `railway.json`) are included for one-click cloud deployment.

**Deploy from CLI:**

```bash
railway up
```

**Deploy from GitHub:** Connect your GitHub repository to Railway for automatic deploys on every push.

**Environment variables to set in Railway's dashboard:**

| Variable | Value | Notes |
|----------|-------|-------|
| `CALLSIGN` | Your callsign | Required |
| `LOCATOR` | Your grid | Required |
| `HOST` | `0.0.0.0` | Required for Railway |
| `LOG_LEVEL` | `warn` | Recommended to stay under Railway's 500 logs/sec limit |
| `WSJTX_RELAY_KEY` | *(random string)* | Only if using the WSJT-X relay agent |

**Cost:** Railway's free tier is usually sufficient for a single-user instance.

---

## DX Spider Proxy

The DX Spider Proxy is a standalone microservice (in the `dxspider-proxy/` directory) that maintains a persistent telnet connection to the DX Spider cluster network and serves spots over HTTP.

**Why a separate proxy?** DX Spider uses telnet (a raw TCP protocol), which browsers cannot speak directly. The proxy solves three problems:

1. **Protocol bridge** — Translates telnet into HTTP/JSON that the browser can consume.
2. **Connection sharing** — One proxy serves all browser tabs/sessions. Without it, each tab would open its own telnet connection, which would get your callsign banned from the cluster.
3. **Persistence** — The proxy keeps the telnet connection alive 24/7 even when no browsers are open, so spots are immediately available when you connect.

**Cluster nodes (tried in order of priority):**

1. `dxspider.co.uk:7300` — Operated by Keith, G6NHU (primary, UK)
2. `dxc.nc7j.com:7373` — NC7J
3. `dxc.ai9t.com:7373` — AI9T
4. `dxc.w6cua.org:7300` — W6CUA

If the primary node is down, the proxy automatically tries the next one.

**SSID management:** Every DX Spider connection requires a unique callsign-SSID combination. OpenHamClock uses:

- `CALLSIGN-56` for production (your live dashboard)
- `CALLSIGN-57` for staging/development (to avoid connection conflicts)

The original HamClock uses `-55`, so there's no conflict between OpenHamClock and HamClock.

**Deploying your own proxy:** The proxy is typically deployed separately (e.g., on Railway) and connected to the main app via the `DXSPIDER_PROXY_URL` environment variable. A default shared proxy is provided out of the box, so most users don't need to run their own.

---

## WSJT-X Relay Agent

The relay agent (`wsjtx-relay/relay.js`) bridges WSJT-X on your local machine to a cloud-hosted OpenHamClock instance.

**The problem:** WSJT-X sends decoded messages over UDP, which only works on a local network. If your OpenHamClock is running in the cloud (e.g., on Railway or at openhamclock.com), UDP packets can't reach it.

**The solution:** The relay agent runs on your local machine, captures WSJT-X UDP packets, and forwards them to your remote server over HTTPS.

**Setup:**

1. On your server (or Railway dashboard), set `WSJTX_RELAY_KEY` to any strong random string:
   ```
   WSJTX_RELAY_KEY=my-super-secret-relay-key-2024
   ```

2. On your local machine (where WSJT-X runs), start the relay:
   ```bash
   cd wsjtx-relay
   node relay.js --url https://openhamclock.com --key my-super-secret-relay-key-2024
   ```

   Or with environment variables:
   ```bash
   OPENHAMCLOCK_URL=https://openhamclock.com RELAY_KEY=my-super-secret-relay-key-2024 node relay.js
   ```

3. In WSJT-X: Settings → Reporting → UDP Server → `127.0.0.1:2237`

The relay agent has zero npm dependencies (uses only Node.js built-ins), batches messages for efficiency (sends every 2 seconds instead of per-decode), and automatically reconnects if the connection drops. Each browser session gets its own relay data stream, so multiple operators can share the same server.

---

## Updating

### Git installations (local/Pi):

```bash
cd ~/openhamclock
./scripts/update.sh
```

The update script: backs up your `.env` → pulls latest code → installs new dependencies → rebuilds the frontend → restores your `.env`. Then restart:

```bash
sudo systemctl restart openhamclock
# or
./restart.sh
```

### Auto-update (Git installations):

Enable automatic updates by setting the following in `.env`:

```
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_INTERVAL_MINUTES=60
AUTO_UPDATE_ON_START=false
AUTO_UPDATE_EXIT_AFTER=true
```

When enabled, OpenHamClock periodically checks GitHub for updates and runs `./scripts/update.sh --auto`. After a successful update it exits so a supervisor (systemd/pm2) can restart it. If you're running in a terminal, you'll need to restart manually.

On local installs, you can also click the **UPDATE** button in the header to start the update process on demand.

### Zip file installations:

1. Back up your `.env` file
2. Download the new zip from GitHub
3. Extract it (overwriting old files)
4. Restore your `.env`
5. Run `npm install && npm run build`
6. Restart

### Docker:

```bash
docker-compose pull
docker-compose up -d
```

### Railway:

Push to your connected GitHub repo, or run `railway up`. Railway redeploys automatically.

---

## Architecture

OpenHamClock is a React + Node.js application. The Node.js backend acts as an API proxy and data aggregator — all external API calls go through it, cached to reduce load on upstream services. The React frontend handles all rendering and user interaction.

```
openhamclock/
├── server.js                 # Node.js backend — API proxy, data aggregation, WSJT-X listener
├── config.js                 # Server configuration loader (.env → runtime config)
├── src/
│   ├── App.jsx               # Main React application — state management, layout, component wiring
│   ├── main.jsx              # React entry point
│   ├── components/           # UI components (one per panel/feature)
│   │   ├── WorldMap.jsx      # Leaflet map with all overlays (DX, POTA, WWFF, satellites, paths)
│   │   ├── Header.jsx        # Top bar — callsign, clocks, weather, SFI/K/SSN, controls
│   │   ├── DXClusterPanel.jsx    # DX spot list with band coloring and hover highlighting
│   │   ├── DXFilterManager.jsx   # DX cluster filter modal (zones, bands, modes, watchlist, exclude)
│   │   ├── PSKReporterPanel.jsx  # PSKReporter TX/RX tabs with signal reports
│   │   ├── PSKFilterManager.jsx  # PSKReporter filter modal (bands, modes, time window)
│   │   ├── POTAPanel.jsx         # POTA activators scrollable list with map toggle
│   │   ├── WWFFPanel.jsx         # WWFF activators scrollable list with map toggle
│   │   ├── SpaceWeatherPanel.jsx # SFI / K-index / SSN gauges
│   │   ├── SolarPanel.jsx        # 4-view cycling: solar image, indices, x-ray flux, lunar phase
│   │   ├── BandConditionsPanel.jsx # HF band open/closed indicators
│   │   ├── PropagationPanel.jsx  # Per-band propagation reliability predictions
│   │   ├── ContestPanel.jsx      # Upcoming/active contest calendar
│   │   ├── DXpeditionPanel.jsx   # Active DXpedition list
│   │   ├── DXNewsTicker.jsx      # Scrolling DX news headline bar
│   │   ├── LocationPanel.jsx     # DE/DX station info panels
│   │   ├── SettingsPanel.jsx     # Settings modal (station, theme, layout, DX source, map layers)
│   │   ├── Icons.jsx             # SVG icon components
│   │   └── PluginLayer.jsx       # Plugin system mount point for map overlays
│   ├── hooks/                # Data fetching hooks — one per data source, each manages its own polling
│   │   ├── useDXCluster.js       # DX Spider spots — polls every 5 seconds
│   │   ├── usePSKReporter.js     # PSKReporter MQTT + HTTP fallback — real-time
│   │   ├── usePOTASpots.js       # POTA activators — polls every 60 seconds
│   │   ├── useWWFFSpots.js       # WWFF activators — polls every 60 seconds
│   │   ├── useSpaceWeather.js    # NOAA SFI/Kp/SSN — polls every 5 minutes
│   │   ├── useSolarIndices.js    # Extended solar data with history — polls every 15 minutes
│   │   ├── useBandConditions.js  # Band conditions — recalculates when SFI/Kp change
│   │   ├── usePropagation.js     # Propagation model — polls every 10 minutes
│   │   ├── useSatellites.js      # Satellite tracking — SGP4 position every 5 seconds
│   │   ├── useContests.js        # Contest calendar — polls every 30 minutes
│   │   ├── useDXpeditions.js     # DXpedition list — polls every 30 minutes
│   │   ├── useDXPaths.js         # DX spot paths for map — polls every 10 seconds
│   │   ├── useMySpots.js         # Your callsign spotted by others — polls every 30 seconds
│   │   ├── useWeather.js         # Weather — polls every 15 minutes
│   │   └── useWSJTX.js           # WSJT-X decoded messages — polls every 2 seconds
│   ├── utils/
│   │   ├── config.js             # App configuration (localStorage read/write, theme application)
│   │   ├── geo.js                # Grid square conversion, bearings, distances, sun/moon calculations
│   │   └── callsign.js           # Band detection, mode detection, DXCC prefix lookup
│   ├── plugins/                  # Map layer plugin system
│   │   ├── layerRegistry.js      # Central plugin registration
│   │   └── layers/               # Built-in plugins (aurora, earthquakes, weather radar)
│   ├── lang/                     # i18n translation files (8 languages)
│   └── styles/
│       └── main.css              # Theme CSS variables, base styles, responsive breakpoints
├── dxspider-proxy/           # DX Spider telnet proxy microservice
├── iturhfprop-service/       # ITU-R P.533 propagation prediction microservice (self-host alternative)
├── wsjtx-relay/              # WSJT-X UDP → HTTPS relay agent
├── electron/                 # Electron desktop app wrapper (experimental)
├── scripts/                  # Setup and update scripts
│   ├── setup-pi.sh               # Raspberry Pi one-line installer
│   ├── setup-linux.sh            # Generic Linux installer
│   ├── setup-windows.ps1         # Windows PowerShell installer
│   └── update.sh                 # Update script (backup → pull → rebuild → restore)
├── Dockerfile                # Multi-stage Docker build
├── docker-compose.yml        # Docker Compose configuration
├── railway.toml              # Railway deployment configuration
├── railway.json              # Railway build settings
└── .env.example              # Configuration template (auto-copied to .env on first run)
```

### Data Flow

All external API calls go through the Node.js backend, which caches responses to reduce load on upstream services. The frontend never contacts external APIs directly (except PSKReporter MQTT, which uses a WebSocket connection from the browser).

```
NOAA SWPC ──┐
POTA API ───┤
WWFF API ───┤
SOTA API ───┤                              ┌─ WorldMap
DX Spider ──┼──► Node.js Server ──► React ─┼─ DX Cluster Panel
CelesTrak ──┤   (API proxy +              ├─ Space Weather Panel
N0NBH ──────┤    data cache)              ├─ Band Conditions (N0NBH)
HamQTH ─────┤                              ├─ Propagation Panel
Contest Cal ┤                              └─ ... all other panels
Ionosonde ──┘

WSJT-X UDP ──► Server listener ──► React ──► WSJT-X Panel
                 (or Relay Agent)

PSKReporter MQTT ──────────────► React ──► PSKReporter Panel
  (direct WebSocket)
```

---

## API Endpoints

The backend exposes these REST endpoints. All data endpoints return JSON. Cache durations shown are server-side; the frontend may poll at different intervals.

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /api/config` | Server configuration (callsign, location, features, version) | — |
| `GET /api/version` | Lightweight version check (for auto-refresh polling) | no-cache |
| `GET /api/health` | Health dashboard with uptime, visitors, concurrent users, session analytics, API traffic | — |
| `GET /api/n0nbh` | N0NBH band conditions (SFI, K, bands, VHF, geomag, signal noise, MUF) | 1 hr |
| *(weather)* | Weather is fetched directly from Open-Meteo by each user's browser — no server endpoint needed | — |
| `GET /api/dxcluster/spots` | Current DX cluster spots (array of spot objects) | 5 sec |
| `GET /api/dxcluster/paths` | DX spots with resolved coordinates for map display | 5 sec |
| `GET /api/dxcluster/sources` | Available DX cluster source backends | — |
| `GET /api/solar-indices` | SFI, Kp, SSN with 30-day history arrays | 15 min |
| `GET /api/noaa/flux` | Raw 10.7 cm solar flux from NOAA | 15 min |
| `GET /api/noaa/kindex` | Raw planetary K-index from NOAA | 15 min |
| `GET /api/noaa/sunspots` | Raw sunspot number from NOAA | 15 min |
| `GET /api/noaa/xray` | GOES X-ray flux (6-hour dataset) | 15 min |
| `GET /api/noaa/aurora` | Aurora oval boundary data from OVATION model | 15 min |
| `GET /api/hamqsl/conditions` | HamQSL band conditions XML (parsed to JSON) | 30 min |
| `GET /api/propagation` | HF propagation predictions (per-band reliability %) | 10 min |
| `GET /api/pota/spots` | POTA activator spots from api.pota.app | 1 min |
| `GET /api/wwff/spots` | WWFF activator spots from spots.wwff.co | 90 sec |
| `GET /api/sota/spots` | SOTA activator spots from api2.sota.org.uk | 2 min |
| `GET /api/satellites/tle` | Satellite TLE data from CelesTrak | 6 hr |
| `GET /api/contests` | Contest calendar from contestcalendar.com | 30 min |
| `GET /api/dxpeditions` | Active DXpeditions from NG3K | 30 min |
| `GET /api/dxnews` | DX news headlines from DXNews.com | 30 min |
| `GET /api/callsign/:call` | Callsign lookup (DXCC entity, grid, country, continent) | — |
| `GET /api/myspots/:callsign` | Recent spots of a specific callsign | 30 sec |
| `GET /api/ionosonde` | Ionospheric sounding data from prop.kc2g.com | 5 min |
| `GET /api/pskreporter/config` | PSKReporter MQTT connection configuration | — |
| `GET /api/pskreporter/http/:call` | PSKReporter HTTP API fallback | 2 min |
| `GET /api/wsjtx` | WSJT-X connection status and active client list | — |
| `GET /api/wsjtx/decodes` | WSJT-X decoded messages (latest batch) | — |
| `POST /api/wsjtx/relay` | WSJT-X relay agent data ingest endpoint | — |
| `GET /api/qrz/lookup/:callsign` | QRZ.com callsign lookup | — |

---

## Frequently Asked Questions

**Q: Do I need an amateur radio license to use OpenHamClock?**
A: No. OpenHamClock is a receive-only dashboard. Anyone can view DX spots, space weather, and POTA/WWFF activations. However, a callsign is needed for PSKReporter data (which tracks your transmitted signals) and for DX cluster login.

**Q: How much bandwidth does OpenHamClock use?**
A: Very little. All external API calls are cached server-side, and the backend serves compressed (gzip) responses. Typical usage is under 1 MB/minute. Most data sources update every 5–30 minutes.

**Q: Can I run this on a Raspberry Pi 3?**
A: Yes. The Pi 3B/3B+ works fine, though initial build time is slower (~5 minutes). A Pi 4 or 5 is recommended for the best experience. The server uses about 100–150 MB of RAM.

**Q: Why don't I see any DX spots?**
A: Check that: (1) Your callsign is set in `.env` — the DX Spider proxy uses it to log in. (2) Your internet connection is working. (3) If using a custom `DXSPIDER_PROXY_URL`, make sure it's reachable. Check the server console for error messages.

**Q: Why does PSKReporter show no data?**
A: PSKReporter requires your callsign to be set correctly. If MQTT fails (some corporate firewalls block WebSocket connections), the system falls back to the HTTP API automatically. Check the panel footer to see which connection method is active.

**Q: Can multiple people use the same server?**
A: Yes. The web interface is stateless — each browser session gets its own filter settings, theme preferences, and DX target. The server caches all API responses, so additional users add zero extra load on upstream services. For shared stations where operators want different layouts and configurations, use the **Profiles** feature (Settings → Profiles tab) to save and switch between named profiles.

**Q: How do I change the DX cluster source?**
A: Open Settings → Station tab → DX Cluster Source dropdown. Or set `dxClusterSource` in the browser settings. The four options are: DX Spider Proxy (recommended), HamQTH, DXWatch, and Auto.

**Q: Can I use this with JTDX instead of WSJT-X?**
A: Yes. JTDX uses the same UDP protocol as WSJT-X. Configure JTDX's UDP settings the same way (address: `127.0.0.1`, port: `2237`).

**Q: Why are some POTA spots not on the map?**
A: A spot will appear in the panel list but not on the map if its coordinates couldn't be resolved. This is rare — the POTA API provides coordinates for almost all parks, and OpenHamClock has a grid-square fallback for the rest.

**Q: How do I get the Classic layout to look like the original HamClock?**
A: Set `LAYOUT=classic` in `.env` (or select it in Settings). The Classic layout uses a black background with large colored number displays, matching the style of the original HamClock by WB0OEW.

**Q: I can't find the `.env` file — where is it?**
A: The `.env` file is in the root OpenHamClock directory (same folder as `server.js`). Files starting with `.` are hidden by default — use `ls -la` in a terminal to see it, or `Ctrl+H` in a Linux file manager. If it doesn't exist yet, run `npm start` once (it's auto-created from `.env.example`) or copy it manually: `cp .env.example .env`. Most settings can also be changed through the browser Settings panel without editing `.env` at all.

---

## Contributing

1. Fork the repository
2. Pick a component or hook to improve
3. Make changes in the appropriate file
4. Test with all four themes and both layouts
5. Submit a PR

The codebase uses functional React components with hooks, CSS-in-JS for component-specific styles, and CSS custom properties for theming. Each data source has its own hook in `src/hooks/`, and each UI section has its own component in `src/components/`.

For development:

```bash
npm run dev    # Vite dev server with hot reload on http://localhost:5173
node server.js # Backend API server on http://localhost:3000
```

---

## Credits

- **K0CJH (Chris)** — OpenHamClock creator and maintainer — [chris@cjhlighting.com](mailto:chris@cjhlighting.com)
- **Claude AI (Anthropic)** — Accelerated development by assisting with bug fixes, code structure, and feature implementation that would have otherwise taken significantly longer to learn and build from scratch
- **Elwood Downey, WB0OEW (SK)** — Creator of the original HamClock that inspired this project
- **Keith, G6NHU** — DX Spider cluster operator at dxspider.co.uk, provided direct support for cluster connections
- **NOAA Space Weather Prediction Center** — Space weather data (SFI, Kp, SSN, X-ray flux, aurora)
- **N0NBH (Paul Herrman)** — Real-time band conditions data feed sourced from NOAA
- **POTA (Parks on the Air)** — Activator spot API
- **WWFF (World Wide Flora and Fauna)** - Activator spot API
- **SOTA (Summits on the Air)** — Activator spot API
- **PSKReporter** — Digital mode reception report network
- **Open-Meteo** — Free weather API
- **Leaflet** — Open-source mapping library
- **Contest Calendar** — Contest scheduling data
- **CelesTrak** — Satellite TLE orbital data
- **KC2G** — Ionospheric sounding data
- **NG3K** — DXpedition listing
- **DXNews.com** — DX news headlines

---

## License

MIT License — See [LICENSE](LICENSE) file.

---

73 de K0CJH
[openhamclock.com](https://openhamclock.com) · [chris@cjhlighting.com](mailto:chris@cjhlighting.com)
