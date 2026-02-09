# Changelog

All notable changes to OpenHamClock will be documented in this file.

## [15.1.4] - 2026-02-09

### Added
- **Upstream Request Manager** — New `UpstreamManager` class prevents request stampedes on external APIs. Three-layer protection: (1) in-flight request deduplication — 50 concurrent users trigger 1 upstream fetch, not 50; (2) stale-while-revalidate — serve cached data instantly while refreshing in background; (3) exponential backoff with jitter per service. Applied to PSKReporter HTTP, WSPR Heatmap, and weather endpoints
- **PSKReporter Server-Side MQTT Proxy** — Server now maintains a single MQTT connection to `mqtt.pskreporter.info` instead of each browser opening its own. Spots are buffered per callsign and pushed to clients via Server-Sent Events (SSE) every 10 seconds. Dynamic subscription management: subscribes when first SSE client connects for a callsign, unsubscribes 30s after last client disconnects, disconnects from broker entirely when no clients are active. Exponential backoff on broker disconnects. Health dashboard shows MQTT proxy stats (connected/callsigns/spots/clients). Client `usePSKReporter` hook rewritten to use `EventSource` instead of `mqtt` library — no more direct browser-to-broker connections
- **NWS Weather API (US)** — US coordinates now use the National Weather Service api.weather.gov instead of Open-Meteo. Free government API with no key, no daily limit, and generous rate limits. Server resolves NWS forecast office grid via `/points` endpoint (cached permanently), then fetches current observations from nearest station + daily/hourly forecast in parallel. Response normalized to Open-Meteo format — client code unchanged. Falls back to Open-Meteo on NWS failure. International coordinates continue using Open-Meteo
- **Open-Meteo Throttle Queue** — Outbound Open-Meteo requests now processed through a rate-limited queue at 4 req/s (240/min, well under 600/min free tier limit). With 2000+ users each tracking different DX stations, hundreds of unique coordinates can burst at once — the queue drips them steadily instead of stampeding. Queue auto-pauses during 429 backoff. Requests waiting >60s are dropped. If queue depth >10, server returns HTTP 202 immediately (client retries in 10s to pick up cached result) instead of blocking
- **GeoIP Country Statistics** — Visitor IPs resolved to country codes via ip-api.com batch endpoint (free, no API key). Results cached persistently across restarts. `/api/health` JSON includes `visitors.today.countries` and `visitors.allTime.countries` (sorted by count). HTML dashboard shows "🌍 Visitor Countries" section with flag emoji badges for today and horizontal bar chart with percentages for all-time data
- **Weather error/retry UI** — WeatherPanel now shows loading skeleton, error messages with retry countdown, and stale-data badges instead of silently disappearing when weather API is rate-limited

### Fixed
- **Weather 429 cascade** — Multiple issues caused weather to disappear for all users: (1) each WeatherPanel called `useWeather()` independently, doubling API calls; now fetched once at App level and passed as `weatherData` prop; (2) no retry on 429 — client waited full 15-min poll; now retries at 15s→30s→60s→120s→300s; (3) `WeatherPanel` returned `null` on error with no feedback; now shows loading/error states
- **Weather still overwhelmed at 2000+ users** — Even with NWS for US, international DX targets generated hundreds of unique coordinates bursting simultaneously. Five-layer fix: (1) coordinate grid coarsened from 0.1° to 1° whole degrees (~111km — weather doesn't vary within this); (2) Open-Meteo throttle queue drip-feeds at 4 req/s instead of bursting; (3) per-IP server throttle limits each client to 1 weather request per 30s; (4) client debounce increased from 2s to 30s to absorb rapid DX target changes; (5) non-blocking 202 response for queued requests so clients don't hang
- **WSPR Heatmap had zero backoff** — PSKReporter 503 responses were ignored; WSPR kept hammering on every 2-min poll. Now shares PSKReporter's exponential backoff via UpstreamManager
- **Open-Meteo rate limit exhaustion** — 50+ users × 2 locations × 15-min poll ≈ 9,600 req/day, right at free tier limit. US traffic now routed to NWS (unlimited). Remaining international: 2-hr cache + dedup eliminates concurrent duplicates. Estimated Open-Meteo usage: <500/day

### Changed
- **Weather cache TTL** — Server: 30 min → 2 hours. Client poll: 30 min → 2 hours. Stale TTL: 2 hr → 6 hr. With NWS handling US traffic and aggressive server-side caching, Open-Meteo usage drops from ~9,600/day to under 500/day for typical deployments
- **WSPR client polling** — 2 min → 5 min (server caches for 10 min anyway)
- **PSKReporter/Weather backoff** — Replaced fixed-duration backoff (15 min / 1 hr) with exponential backoff: 30s → 60s → 120s → ... capped at 30 min, with 0-15s random jitter to prevent synchronized retry storms

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
