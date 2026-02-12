# Changelog

All notable changes to OpenHamClock will be documented in this file.

## [15.2.12] - 2026-02-12

### Fixed
- **Critical memory leak (OOM at 4GB after ~24h)** — Multiple unbounded data structures in the PSK-MQTT proxy caused heap exhaustion:
  - `recentSpots` had no cap on insert — spots were `.push()`ed with no limit, only trimmed to 500 every 5 minutes. With 1000+ subscribed callsigns, hundreds of thousands of spots accumulated between cleanups. Now capped at 200 per callsign at insert time.
  - `recentSpots` and `spotBuffer` entries were never cleaned up when callsigns unsubscribed — every callsign that disconnected left behind up to 500 spots for up to 1 hour. Over 24 hours with thousands of unique visitors, this accumulated hundreds of MB of orphaned spot data. Now deleted immediately on unsubscribe.
  - `spotBuffer` entries for unsubscribed callsigns were never cleaned in the 5-minute cleanup cycle (flush only iterated `subscribers`, not `spotBuffer`). Now cleaned.
  - `mySpotsCache` (HamQTH spot lookups) grew forever with no eviction. Now cleaned every 2 minutes.
  - Removed dead `pskReporterSpots` cache (tx/rx Maps with cleanup timer) that was never written to
- **Added memory monitoring** — Logs RSS, heap usage, and data structure sizes every 15 minutes for leak detection
- **Set explicit Node.js heap limit** (512MB) in Dockerfile to fail fast on leaks instead of slow-dying at 4GB

## [15.2.11] - 2026-02-11

### Added
- **ID Timer panel (Dockable layout)** — 10-minute countdown timer that reminds operators to identify their station. Displays a large countdown with progress bar; in the final minute the display turns red and pulses. At expiration, plays three short beeps via Web Audio API and shows a full-screen overlay with your callsign in large blinking text. Clicking anywhere dismisses the alert and resets the timer. Start/Stop button lets operators pause the timer when not on the air. Available from the `+` panel picker as 📢 ID Timer

### Fixed
- **PSK-MQTT reconnect fork bomb** — When the MQTT broker connection dropped, `pskMqttConnect()` called `.end(true)` on the old client, which fired its `close` event, which called `scheduleMqttReconnect()`, which called `pskMqttConnect()` again — each cycle doubling the number of pending reconnect chains. Over hours of downtime this created hundreds of parallel reconnect loops, flooding logs with `Disconnected from mqtt.pskreporter.info` and exhausting resources. Three fixes: (1) strip all event listeners from old client before `.end(true)` so its `close` event can't schedule a reconnect; (2) stale-client guard on `close`/`error`/`offline` handlers — only react if the firing client is still the current one; (3) single reconnect timer — `clearTimeout` before scheduling a new reconnect, preventing multiple pending timers

## [15.2.10] - 2026-02-11

### Added
- **SOTA (Summits on the Air) panel** — New SOTA activator spots panel alongside POTA. In Classic and Modern layouts, the POTA slot now has POTA/SOTA tabs (like the Solar panel cycling) with independent Map ON/OFF toggles for each. In Dockable layout, SOTA is a fully separate panel in the panel picker (⛰️) so you can dock it independently, stack it with POTA, or place it anywhere
- **SOTA map markers** — Orange diamond markers for SOTA activators on the world map (distinct from POTA's green triangles). Callsign labels shown when DX labels are enabled. Popup shows summit reference, name, and points. Separate `showSOTA` map layer toggle. Legend shows `◆ SOTA` when active
- **SOTA data hook** — `useSOTASpots` fetches from the existing `/api/sota/spots` server endpoint (SOTA API v2). Maps summit details including lat/lon, altitude, and activation points. 2-minute refresh cycle matching POTA

### Fixed
- **DX location lock not working** — Clicking callsigns in DX Cluster or PSK Reporter panels moved the DX point even when locked. Lock check was only in the WorldMap click handler; `handleDXChange` in `useDXLocation` now gates all updates through `dxLockedRef`
- **Map overlays disappear at dateline (#327)** — Replaced antimeridian path splitting with world-copy duplication (same approach as the GrayLine plugin). Polylines and circle markers are now rendered at -360°, 0°, +360° longitude offsets so they appear on every visible map copy. Affects DX Cluster paths, PSK Reporter paths, WSJT-X paths, satellite tracks/footprints, great circle lines, and contest QSO lines. Users in Australia, New Zealand, and Pacific islands no longer lose spots when panning

## [15.1.9] - 2026-02-10

### Added
- **Server-side settings sync (opt-in)** — All UI preferences (layout, panel visibility, map layers, filters, theme, temp unit, solar panel mode, etc.) can now be persisted on the server in `data/settings.json`. Enable with `SETTINGS_SYNC=true` in `.env` — designed for single-operator self-hosted/Pi deployments where you want every device (phone, tablet, desktop) to share the same configuration without setting up each browser individually. Disabled by default for multi-user hosted deployments like openhamclock.com where each user's settings live in their own browser localStorage. When enabled: server → browser on page load (server wins), browser → server on any change (2s debounce). First device to connect seeds the server; subsequent devices inherit settings

### Fixed
- **Stale SFI and SSN values** — SFI was reading from `f107_cm_flux.json` which stopped updating at 2025-12-31, showing a month-old value of 170. SSN was reading from `observed-solar-cycle-indices.json` which only has monthly averages. Now uses three-tier fallback: (1) SWPC `summary/10cm-flux.json` for current SFI (updates every few hours), (2) N0NBH/hamqsl.com feed for both SFI and daily SSN (same source as GridTracker, Log4OM, and hamqsl.com), (3) archive endpoints for history graphs only. Propagation predictions also updated to use current values. N0NBH cache pre-warmed on server startup
- **RBN only showing CW spots** — The RBN telnet parser regex required a `WPM` field, which only CW spots have. FT8, FT4, RTTY, and PSK spots were silently dropped. Fixed regex to match all spot formats by terminating at `dB` and optionally extracting WPM/BPS speed afterward. RBN buffer increased from 500 → 2000 spots
- **"fatal: couldn't find remote ref" on update (#293)** — Update script and server-side git functions didn't handle broken git state: missing/wrong remote URL, detached HEAD, stale remote refs, or missing upstream tracking. Now auto-fixes remote URL, fetches with `--prune`, detects and recovers detached HEAD, sets upstream tracking, and falls back to `git reset --hard` if `git pull` fails
- **K-Index forecast bars not rendering** — Extra wrapper `<div>` with `flexDirection: column` broke the parent's `alignItems: flex-end` height calculation, collapsing bar heights to zero
- **PSK-MQTT "Batch subscribe error" log spam** — When the MQTT broker connection was unstable, each reconnect cycle logged `Batch subscribe error: Connection closed` for every attempt. Now suppresses expected "Connection closed" errors in the batch subscribe callback (same fix as v15.1.6 for individual subscribes). Also: MQTT `on('error')` no longer double-logs "Connection closed" alongside `on('close')`; disconnect messages use `logErrorOnce` to dedup; reconnect messages throttled to 1st attempt and every 5th
- **WSPR Heatmap double-logging 503 errors** — Each 503 response logged twice: once from the fetch handler with the backoff duration, and again from the catch block. Also, changing backoff values (`36s`, `72s`, etc.) defeated `logErrorOnce` dedup. Fixed: single log line per failure, stable dedup key

## [15.1.8] - 2026-02-10

### Changed
- **Weather → client-direct Open-Meteo** — Removed entire server-side weather stack (NWS, Open-Meteo proxy, background worker, throttle queue, cache). All weather is now fetched directly by each user's browser from Open-Meteo. Rate limits are distributed across all user IPs instead of concentrated on our server — eliminates the 429 backoff death spirals that plagued 2,000+ user deployments. Optional Open-Meteo API key field in Settings for users who want higher limits. Removed ~400 lines of server code
- **Solar indices panel** — Each section (SFI, K-Index, SSN) now shows contextual detail: condition labels (e.g. "Excellent", "Quiet", "High"), chart descriptions ("10.7cm Solar Flux — 20-day trend"), value ranges, time axis labels on K-Index bars ("Now → +24h"), and fallback explanatory text when no history data is available

### Fixed
- **Blank screen — `filteredSatellites is not defined`** — DockableApp and ClassicLayout passed raw `satellites.data` to WorldMap instead of `filteredSatellites`. The variable was never destructured from props, causing a ReferenceError that crashed the entire React tree with no error boundary to catch it. Fixed all three layouts to properly receive and pass `filteredSatellites`. Also means satellite filters in Settings now actually work in dockable and classic layouts
- **Blank screen after update** — After server updates, browsers with cached old JS chunks would fail to load new modules, crashing the React app with a blank screen (users had to clear cookies/cache to fix). Three fixes: (1) global chunk-load error handler in `index.html` detects stale module import failures and auto-reloads once; (2) `update.sh` now deletes `dist/` before rebuilding to prevent old hashed chunks from being served alongside new ones; (3) backward-compatible `/api/weather` stub endpoint returns `{ _direct: true }` so old cached client code doesn't 404
- **Global error boundary** — Added `ErrorBoundary` component wrapping the entire app. Future render crashes show a recovery UI with "Reload Page" and "Clear Cache & Reload" buttons plus expandable error details, instead of a blank screen

## [15.1.7] - 2026-02-09

### Added
- **Upstream Request Manager** — New `UpstreamManager` class prevents request stampedes on external APIs. Three-layer protection: (1) in-flight request deduplication — 50 concurrent users trigger 1 upstream fetch, not 50; (2) stale-while-revalidate — serve cached data instantly while refreshing in background; (3) exponential backoff with jitter per service. Applied to PSKReporter HTTP and WSPR Heatmap endpoints
- **PSKReporter Server-Side MQTT Proxy** — Server now maintains a single MQTT connection to `mqtt.pskreporter.info` instead of each browser opening its own. Spots are buffered per callsign and pushed to clients via Server-Sent Events (SSE) every 10 seconds. Dynamic subscription management: subscribes when first SSE client connects for a callsign, unsubscribes 30s after last client disconnects, disconnects from broker entirely when no clients are active. Exponential backoff on broker disconnects. Health dashboard shows MQTT proxy stats (connected/callsigns/spots/clients). Client `usePSKReporter` hook rewritten to use `EventSource` instead of `mqtt` library — no more direct browser-to-broker connections
- **GeoIP Country Statistics** — Visitor IPs resolved to country codes via ip-api.com batch endpoint (free, no API key). Results cached persistently across restarts. `/api/health` JSON includes `visitors.today.countries` and `visitors.allTime.countries` (sorted by count). HTML dashboard shows "🌍 Visitor Countries" section with flag emoji badges for today and horizontal bar chart with percentages for all-time data
- **Weather error/retry UI** — WeatherPanel now shows loading skeleton, error messages with retry countdown, and stale-data badges instead of silently disappearing when weather API is rate-limited
- **WSJT-X Decode Retention Control** — New time filter dropdown (5m / 15m / 30m / 60m) in the WSJT-X panel header controls how long decoded messages are kept visible in the list and on the map. Default 30 minutes, persisted in localStorage

### Fixed
- **Weather 429 cascade** — Multiple issues caused weather to disappear for all users: (1) each WeatherPanel called `useWeather()` independently, doubling API calls; now fetched once at App level and passed as `weatherData` prop; (2) no retry on 429 — client waited full 15-min poll; now retries at 15s→30s→60s→120s→300s; (3) `WeatherPanel` returned `null` on error with no feedback; now shows loading/error states
- **Weather overwhelmed at 2000+ users** — Server was exhausting Open-Meteo's free tier (10K/day) by proxying weather for all users through a single IP. Moved weather to client-direct: each user's browser fetches from Open-Meteo directly, distributing rate limits across all user IPs. Optional API key in Settings for higher limits
- **WSJT-X decodes not mapping correctly (#299)** — Only 13 of 100 decodes showed map pins because: (1) only CQ messages were mapped — all QSO exchanges (signal reports, RR73, 73, grid exchanges) were filtered out even when a grid square was present; (2) grid regex `^grid$` only matched if the exchange was *nothing but* a grid — messages like `EN82 a7` (grid + signal report) failed; (3) no memory between decodes — once a station's CQ with grid scrolled off, subsequent exchanges from that callsign lost their location. Fix: map ALL decode types with resolved coordinates, extract grids from anywhere in exchange text, maintain a callsign→grid cache across decodes, and fall back to callsign prefix estimation as a last resort. Prefix-estimated locations shown at reduced opacity with *(est)* label in popup
- **PSKReporter SSE stream stuck at "Connecting"** — Compression middleware was gzip-buffering SSE events; API cache middleware was setting `Cache-Control` on the stream endpoint. Fix: skip compression for `text/event-stream`, skip cache headers for `/stream/` paths, add explicit `res.flush()` after every SSE write, set `Content-Encoding: identity` and `no-transform` headers
- **"vite: not found" after update (#284)** — `npm install` skips devDependencies when `NODE_ENV=production` is set, leaving `vite` and `vitest` uninstalled. Three fixes: (1) all npm scripts now use `npx vite`/`npx vitest` which auto-resolves from `node_modules/.bin`; (2) `update.sh`, `setup-pi.sh`, and `setup-linux.sh` now use `npm install --include=dev` to force devDependency installation regardless of NODE_ENV; (3) `prestart` build step no longer runs tests — `npm start` just builds and starts, tests are separate via `npm test`
- **VOACAP heatmap blocks DX click** — Heatmap grid rectangles had `interactive: true` with popup bindings, which consumed map clicks before they could reach the DX-setting handler. Set to `interactive: false` so clicks pass through. The color-coded grid with legend still communicates propagation reliability visually
- **README/docs cleanup** — Corrected OpenWeatherMap description (only needed for cloud layer overlay, not weather data). Added "Can't find `.env`?" guidance box with instructions for showing hidden files on Linux/Pi/Mac. Added FAQ entry about `.env` location. Weather data sources section updated to reflect client-direct Open-Meteo architecture
- **PSK-MQTT "Connection closed" subscribe spam** — When the MQTT broker connection dropped, a race condition caused `pskMqtt.connected` to still be `true` while the socket was dead. Incoming SSE clients would call `subscribeCallsign()`, which passed the connected check but got "Connection closed" callbacks — one error per callsign, flooding the log with 40+ lines. Fix: suppress expected "Connection closed" errors (reconnect handler re-subscribes all callsigns anyway), and batch all reconnect subscriptions into a single MQTT subscribe call instead of individual calls per callsign

### Removed
- **PSKReporter HTTP backfill** — Removed the `/api/pskreporter/http/:callsign` endpoint and all client-side `fetchHistorical()` code. With 2,000+ concurrent users, every new SSE connection triggered 2 HTTP requests to PSKReporter's retrieve API (TX + RX), causing constant 503 errors and backoff. The backoff was shared with the WSPR heatmap endpoint, so PSK failures were taking WSPR down too. The SSE connected event already delivers up to 500 recent spots from the server's MQTT buffer — no HTTP backfill needed. Net effect: zero HTTP requests to PSKReporter for live spot data, cleaner upstream status on health dashboard
- **WSPR Heatmap had zero backoff** — PSKReporter 503 responses were ignored; WSPR kept hammering on every 2-min poll. Now shares PSKReporter's exponential backoff via UpstreamManager

### Changed
- **WSJT-X decode limits** — Server buffer: 200 → 500 decodes. Max age: 30 → 60 minutes. Client ring buffer: 200 → 500. These are the raw limits; the new retention dropdown (5m/15m/30m/60m) controls what the user actually sees
- **WSPR client polling** — 2 min → 5 min (server caches for 10 min anyway)
- **PSKReporter backoff** — Replaced fixed-duration backoff (15 min / 1 hr) with exponential backoff: 30s → 60s → 120s → ... capped at 30 min, with 0-15s random jitter to prevent synchronized retry storms

## [15.1.1] - 2026-02-09

### Added
- **VOACAP Propagation Heatmap** — New map layer plugin (`voacap-heatmap`) overlays color-coded propagation predictions across the globe for a selected band. Draggable/minimizable control panel with band selector (160m–6m), grid resolution (5°–20°), and color legend. Server-side `/api/propagation/heatmap` endpoint computes reliability grid using ITU-R P.533-style model with live solar indices. 5-minute server cache, 3 world copies for dateline support, click popups with reliability %, distance, and grid coordinates
- **Propagation Mode & Power** — VOACAP predictions now factor in operating mode and TX power. Eight modes supported (SSB, CW, FT8, FT4, WSPR, JS8, RTTY, PSK31) with physically-modeled decode advantages (+34dB for FT8, +41dB for WSPR vs SSB baseline). Power offset in dB relative to 100W. Signal margin widens/narrows effective MUF/LUF window — FT8 shows bands "open" that SSB shows "closed". Configurable in Settings → Station tab with preset power buttons (5W/25W/100W/1.5kW) + custom watt input. Live margin readout. Applied to both main propagation panel and VOACAP heatmap map layer
- **Distance Units** — Global metric/imperial toggle in Settings. Affects all distance displays: DE↔DX distance (LocationPanel), propagation path distance, ionosonde distance, satellite altitude & range, great circle path popup, WSPR spot distances & efficiency, VOACAP heatmap cell popups. Default: Imperial (mi)
- **Custom Terminator** — Replaced CDN-based `L.terminator` with built-in `src/utils/terminator.js` implementation that spans 3 world copies for seamless dateline crossing

### Fixed
- **Gray line disappearing past dateline** — Replaced `splitAtDateLine()` with `unwrapAndCopyLine()` / `unwrapAndCopyPolygon()` in gray line plugin. All 5 render paths fixed (main terminator, enhanced DX zone, civil/nautical/astronomical twilight)
- **Sun/moon marker updates** — Now update every 60 seconds instead of only on initial render
- **DX Cluster frequency format (Classic/Tablet/Compact)** — Frequencies showed `14.1` instead of `14.070` in non-Modern layouts. Fixed `.toFixed(1)` → `.toFixed(3)` and added kHz→MHz conversion for all 3 ClassicLayout DX cluster displays

## [15.0.2] - 2026-02-08

### Added
- **Per-panel font sizing (Dockable Mode)** — A−/A+ buttons in each panel's tabset header. 10 zoom steps from 70% to 200%, persisted per-panel in localStorage. Percentage badge shown when zoomed; click to reset. World Map excluded (has its own zoom)
- **DX News Ticker toggle** — New checkbox in Settings → Map Layers tab to show/hide the scrolling DX news ticker. Persisted in localStorage with other map layer settings
- **Weather proxy** — New `/api/weather` server endpoint proxies Open-Meteo requests. Coordinates rounded to ~11km grid for cache sharing across users. 15-minute cache, 1-hour stale serving on rate limit/errors. Client debounced (2s) to prevent rapid-fire calls when clicking through DX spots

### Changed
- **ITU-R P.533 by default** — All installs now use the public OpenHamClock ITURHFProp service (`proppy-production.up.railway.app`) for propagation predictions out of the box. No `.env` configuration needed. Self-hosting still supported via `ITURHFPROP_URL` override

### Fixed
- **DX Cluster spot clicks** — Clicking a DX cluster spot now updates the DX panel and map. Root cause: `DXClusterPanel` had no `onClick` handler; paths data with coordinates wasn't being looked up. Fixed across Modern, Classic, and Dockable layouts
- **RBN layer showing N0CALL** — RBN (and all plugin layers) showed "N0CALL" instead of the user's callsign. Root cause: `WorldMap` wasn't passing `callsign`, `locator`, or `lowMemoryMode` to `PluginLayer`. Also fixed 4 of 6 `WorldMap` instances across layouts that were missing the `callsign` prop entirely
- **Update button fails with "Local changes detected"** — `git status --porcelain` blocked updates when file permissions changed (e.g., `chmod +x update.sh`) or on cross-platform mode differences. Fix: `git config core.fileMode false` set at server startup, in setup scripts, and in `update.sh`. Auto-update now stashes local changes before pulling instead of refusing
- **Update button missing in Dockable Mode** — `DockableApp` wasn't passing `onUpdateClick`, `updateInProgress`, or `showUpdateButton` to the Header component
- **PSKReporter missing spots** — Only showed spots received after page load (MQTT-only, no history). Now fetches historical spots via `/api/pskreporter/http/:callsign` on connect, then merges with real-time MQTT stream. Also: time window increased from 15 to 30 minutes, max spots increased from 100 to 500 (50 in low-memory mode), deduplication changed from freq-based (dropped legitimate spots) to callsign+band keyed (keeps most recent per station per band), server-side report cap raised from 100 to 500
- **Update script "fatal: couldn't find remote ref master"** — The `main||master` fallback pattern ran `git pull origin master` even after `git pull origin main` succeeded (non-zero exit from suppressed warnings). Script now detects the correct branch once at startup. Same fix applied to server-side auto-update
- **Stale browser cache after updates** — `index.html` was cached for 1 day (`maxAge: '1d'`), causing browsers to load old JavaScript bundles after a local update. New features (like toggles) wouldn't appear until cache expired. Fix: `index.html` now served with `no-cache, no-store, must-revalidate` headers. Hashed JS/CSS assets still cached for 1 year (filenames change on rebuild)
- **WSJT-X relay agent ECONNRESET** — Relay v1.1.0: added `Connection: close` header, startup connectivity test, clear error diagnostics for ECONNRESET/ECONNREFUSED/DNS/timeout
- **Pi kiosk mode loses settings on reboot** — Chromium `--incognito` flag wiped localStorage on every restart. Replaced with dedicated `--user-data-dir` profile. `update.sh` auto-patches existing kiosk installs
- **Open-Meteo 429 rate limiting** — Client-side Open-Meteo calls replaced with server-side proxy (see Weather proxy above)
- **Map jumping near dateline (Australia/NZ/Pacific)** — Panning east or west past 180° longitude caused the map to snap violently. Root cause: `moveend` handler normalized center longitude to ±180°, fighting Leaflet's `worldCopyJump`. Also: tile layer `bounds` restricted to [-180, 180] prevented tiles from loading in world copies. Fix: center longitude no longer normalized (Leaflet manages wrap internally), tile bounds removed for all styles except MODIS (which only covers -180..180)

## [15.0.0] - 2026-02-08

### Added
- **N0NBH Band Conditions** — Real-time band condition data from N0NBH's NOAA-sourced feed replaces the old calculated estimates. Server-side `/api/n0nbh` endpoint with 1-hour caching. Day/night conditions per band, VHF conditions (Aurora, E-skip by region), geomagnetic field status, signal noise level, and MUF. PropagationPanel shows mini day/night indicators when conditions differ between day and night
- **User Profiles** — Save and load named configuration profiles from Settings → Profiles tab. Each profile snapshots all localStorage keys (config, layout, filters, map layers, preferences). Supports save, load, rename, delete, export to JSON file, and import from file. Useful for multi-operator shared stations or switching between personal views (contest mode, field day, everyday)
- **Concurrent User Tracking** — Health dashboard (`/api/health`) now shows real-time concurrent users, peak concurrent count, session duration analytics (avg/median/p90/max), duration distribution buckets, and an active users table with anonymized IPs and session durations
- **Auto-Refresh on Update** — New `useVersionCheck` hook polls `/api/version` every 60 seconds. When a new version is detected after deployment, connected browsers show a toast notification and automatically reload after 3 seconds. Lightweight `/api/version` endpoint with no-cache headers
- **Cloud Layer Restriction** — OWM cloud overlay restricted to local installs only via `localOnly` flag in layer registry. Cloud layer invisible on openhamclock.com, visible on localhost/LAN
- **A-Index Display** — A-index and geomagnetic field status added to Header and ClassicLayout solar stats bars, color-coded by severity
- **Space Weather Extras** — Header shows A-index (color-coded: green <10, amber 10-19, red ≥20) and geomagnetic field status from N0NBH data

### Changed
- **Band Conditions Rewrite** — `useBandConditions` hook completely rewritten. Removed 200+ lines of local SFI/K-index formula calculations. Now fetches from `/api/n0nbh` server proxy and maps N0NBH grouped ranges (80m-40m, 30m-20m, etc.) to individual bands
- **Health Dashboard Auto-Refresh** — HTML health dashboard now auto-refreshes every 30 seconds
- **Stats Grid** — Health dashboard shows 6 stat cards (added Online Now and Peak Concurrent)
- **Donate Buttons** — Hidden in fullscreen mode across Header, ModernLayout, and ClassicLayout
- **CI Pipeline** — Dropped Node 18 (replaced with 20.x/22.x), replaced `npm start` with `node server.js` to skip redundant prestart build, added retry loop for health check (up to 30 attempts), same retry pattern for Docker health check
- **Version** — Bumped to 15.0.0

### Fixed
- **CI Health Check Failure** — `npm start` was running `prestart` (full rebuild) before starting the server, causing the 5-second `sleep` + `curl` to fail every time. Now uses `node server.js` directly since the build step already ran

## [3.12.0] - 2025-02-03

### Added
- **State persistence** — All user preferences survive page refresh: PSK/WSJT-X panel mode, TX/RX tab, solar image wavelength, weather panel expanded state, temperature unit
- **Collapsible weather** — DE location weather section collapses to one-line summary, expands for full details
- **Lunar phase display** — 4th cycling mode in Solar panel shows current moon phase with SVG rendering, illumination %, and next full/new moon dates
- **F°/C° toggle** — Switch temperature units with localStorage persistence; header always shows both
- **Satellite filtering** — Complete satellite filter interface in Settings → Satellites tab. Select/deselect from 40+ satellites, real-time visibility status, persistent filters
- **WSPR heatmap improvements** — Increased brightness (opacity 0.75-1.0), 4-layer glow effect, tighter clustering (radius 50,000m → 6,000m), adjustable opacity slider
- **DX Target enhancements** — Distance calculation (Haversine), beam headings (SP/LP), color-coded display
- **Lightning detection** — WebSocket server fallback system, proximity alerts, RBN history management
- **WSPR data quality** — Spot limit increased from 2,000 to 10,000, detailed marker tooltips with power/SNR/distance/efficiency

### Fixed
- **PSKReporter MQTT** — Field mapping used `sa`/`ra` (ADIF country codes) instead of `sc`/`rc` (callsigns), so no MQTT spots ever matched
- **PSKReporter RX topic** — Subscription pattern had one extra wildcard
- **PSKReporter HTTP fallback** — If MQTT fails within 12 seconds, automatically falls back to HTTP API
- **Map layer persistence** — Map style/zoom save was overwriting plugin layer settings. Now merges correctly
- **Version consistency** — All version numbers now read from package.json as single source of truth
- **PSKReporter 403 spam** — Server backs off for 30 minutes on 403/429 responses
- **WSPR heatmap infinite loop** — Removed heatmapLayer from useEffect dependencies
- **WSPR grid filter** — Supports 2-6 character grids, prefix matching (FN → FN03, FN21)
- **WSPR callsign filter** — Proper suffix stripping (VE3TOS/M → VE3TOS), respects grid filter state
- **Satellite initialization** — Fixed ReferenceError when filteredSatellites referenced satellites.data before hook initialized
- **VOACAP ionosonde label** — Added "Iono:" prefix to clarify it's the data source, not the DX location

### Changed
- **WSPR update frequency** — Polling interval from 5 minutes to 60 seconds
- **WSPR band chart** — Removed pulsing animation, added smooth CSS transition

### Reverted
- **WSPR MQTT** — Real-time MQTT feed attempted and reverted due to mixed content policy (HTTPS pages cannot connect to insecure WebSocket)

## [3.11.0] - 2025-02-02

### Added
- **PSKReporter Integration** — New panel showing stations hearing you (TX) and stations you're hearing (RX). Supports FT8, FT4, JS8, and other digital modes. Configurable time window. Signal paths drawn on map
- **Bandwidth Optimization** — Reduced network egress by ~85%: GZIP compression, server-side caching, reduced polling intervals, HTTP Cache-Control headers

### Fixed
- Empty ITURHFPROP_URL causing "Only absolute URLs supported" error
- Satellite TLE fetch timeout errors handled silently
- Reduced console log spam for network errors

## [3.10.0] - 2025-02-02

### Added
- **Environment-based configuration** — `.env` file auto-created from `.env.example` on first run. Supports CALLSIGN, LOCATOR, PORT, HOST, UNITS, TIME_FORMAT, THEME, LAYOUT
- **Auto-build on start** — `npm start` automatically builds React frontend
- **Update script** — `./scripts/update.sh` for easy local/Pi updates
- **Network access configuration** — `HOST=0.0.0.0` for LAN access
- **Grid locator auto-conversion** — Calculates lat/lon from LOCATOR
- **Setup wizard** — Settings panel auto-opens if callsign or locator missing
- **Retro theme** — 90s Windows style
- **Classic layout** — Original HamClock-style with black background and large colored numbers

### Changed
- Configuration priority: localStorage > .env > defaults
- DX Spider connection uses dxspider.co.uk as primary

### Fixed
- Header clock "shaking" when digits change
- Header layout wrapping on smaller screens
- Reduced log spam with rate-limited error logging

## [3.9.0] - 2025-01-31

### Added
- DX Filter modal with tabs for Zones, Bands, Modes, Watchlist, Exclude
- Spot retention time configurable (5-30 minutes) in Settings
- Satellite tracking with 40+ amateur radio satellites
- Satellite footprints and orbit path visualization
- Map legend showing all 10 HF bands plus DE/DX/Sun/Moon markers

### Fixed
- DX Filter modal crash when opening
- K-Index display showing correct values
- Contest calendar attribution

## [3.8.0] - 2025-01-28

### Added
- Multiple DX cluster source fallbacks
- ITURHFProp hybrid propagation predictions
- Ionosonde real-time corrections

## [3.7.0] - 2025-01-25

### Added
- Modular React architecture with Vite
- 13 extracted components, 12 custom hooks, 3 utility modules
- Railway deployment support
- Docker support

### Changed
- Complete rewrite from monolithic HTML to modular React

## [3.0.0] - 2025-01-15

### Added
- Initial modular extraction from monolithic codebase
- React + Vite build system
- Express backend for API proxying
- Three themes: Dark, Light, Legacy

---

## Version History

- **15.x** — N0NBH band conditions, user profiles, concurrent user tracking, auto-refresh, CI fixes
- **3.12.x** — PSKReporter fixes, state persistence, satellite filtering, WSPR improvements, lunar phase
- **3.11.x** — PSKReporter integration, bandwidth optimization
- **3.10.x** — Environment configuration, themes, layouts
- **3.9.x** — DX filtering, satellites, map improvements
- **3.8.x** — Propagation predictions, reliability improvements
- **3.7.x** — Modular React architecture
- **3.0.x** — Initial modular version
- **2.x** — Monolithic HTML version (archived)
- **1.x** — Original HamClock fork
