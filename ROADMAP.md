# OpenHamClock Roadmap

> Amateur Radio Dashboard — A modern web-based HamClock alternative
> Created by K0CJH | Current version: v26.10.1 (v26.11.0 on Staging) | License: MIT

---

## Project History

### Origins (v1.x — Jan 2026)

OpenHamClock was built from scratch as a modern, web-based amateur radio dashboard. Inspired by the concept of WB0OEW's HamClock — displaying solar conditions, DX cluster spots, and propagation data — but written entirely from the ground up as a web application. No code was forked or inherited. The goal was a browser-based ham radio dashboard that anyone could run locally or access from anywhere.

### Monolithic Era (v2.x — Jan 2026)

The first web version was a single monolithic HTML file with embedded JavaScript. It worked, but adding features meant editing a massive file with tangled dependencies. This era established the core feature set: world map, DX cluster, solar data, and basic propagation display.

### React Rewrite (v3.0 — v3.12 — Jan–Feb 2026)

A complete rewrite into modular React with Vite and an Express backend. This was the inflection point — the architecture went from a single HTML file to 13 components, 12 hooks, and 3 utility modules. Key milestones:

- **v3.7** — Modular React architecture, Railway and Docker deployment
- **v3.8** — ITURHFProp hybrid propagation predictions, ionosonde corrections
- **v3.9** — Satellite tracking (40+ satellites), DX filtering, map legend
- **v3.10** — Environment-based config (.env), Classic layout, Retro theme
- **v3.11** — PSKReporter integration, 85% bandwidth reduction
- **v3.12** — State persistence, lunar phase, WSPR heatmap, lightning detection

### Scaling & Stability (v15.0 — v15.2 — Feb 2026)

The project hit 2,000+ concurrent users on openhamclock.com, exposing every possible scaling issue:

- **Memory leaks** — Unbounded caches (PSK-MQTT proxy, callsign lookups, propagation heatmap) caused OOM crashes at 4GB after 24 hours. Fixed with entry caps, eviction policies, and memory monitoring.
- **MQTT fork bombs** — Reconnect logic created exponential chains of parallel reconnect loops during broker outages.
- **Request stampedes** — 50 users refreshing simultaneously meant 50 upstream API calls. Built UpstreamManager with request deduplication, stale-while-revalidate, and exponential backoff.
- **PSK-MQTT proxy** — Replaced per-browser MQTT connections with a single server-side connection, cutting SSE traffic in half.
- **Weather 429 cascades** — Moved weather to client-direct Open-Meteo, distributing rate limits across user IPs instead of concentrating on the server.

Also shipped: VOACAP heatmap, rig control, SOTA panel, N0NBH band conditions, user profiles, and server-side settings sync.

### Feature Expansion (v15.4 — v15.5 — Feb 2026)

With stability solved, focus shifted to features and polish:

- **Direct rig control** — Click any spot to tune your radio (Yaesu, Kenwood, Elecraft, Icom via USB serial)
- **Satellite tracker overhaul** — Floating data window, visibility indicators, pinned tracking
- **APRS-IS live tracking** — Full APRS integration with watchlist groups for EmComm
- **Wildfire & storm map layers** — NASA EONET satellite detection
- **13 languages at 100% coverage** — en, de, es, fr, it, ja, ko, ms, nl, pt, sl, ru, ka
- **Ultrawide monitor support** — Sidebars scale proportionally with viewport

### Security Hardening (v15.6 — Mar 2026)

Comprehensive security audit and hardening pass:

- CORS lockdown with explicit origin allowlist
- SSRF elimination for custom DX cluster hosts
- API write key authentication for rotator and QRZ endpoints
- SSE connection limiter, telnet command injection prevention
- DOM XSS fixes, ReDoS fixes, URL encoding
- Dockerfile runs as non-root user

### New Versioning & EmComm (v26.1.1 — Mar 2026)

Adopted year-based versioning: X = year, Y = visual/UI, Z = backend. The jump from v15 to v26 resets the scheme to something meaningful.

- **EmComm layout** — Dedicated emergency communications dashboard with range rings, NWS alerts, FEMA declarations, shelters, filtered APRS stations, net operations, and point-to-point messaging
- **APRS resource tokens** — Structured emergency data in beacon comments with visual resource cards and aggregation dashboard
- **Classic layout redesign** — Refreshed while keeping the WB0OEW spirit
- **Active users map layer** — See other operators in real time
- **Audio alerts** — Configurable tones per feed (POTA, SOTA, DX Cluster, etc.)
- **SDR integration** — FlexRadio SmartSDR and RTL-SDR support via rig-bridge
- **DX favorites** — Save up to 10 DX target grid squares for quick switching

### Monthly Releases & Real Physics (v26.3 — v26.6 — May–Sep 2026)

The project settled into a monthly release cadence (first Tuesday), and each drop carried a headline. v26.3 brought VOACAP-grade propagation: the actual ITU-R P.533 model compiled to WebAssembly and run in the browser, later corrected to model each digital mode at its real decode threshold (FT8 at −19 dB, not SSB-plus-a-fudge) and fixed at the root for the infamous "vertical line through China" midpoint bug. v26.4 added a live aircraft tracking layer (adsb.lol), a worldwide ATC sectors overlay, and the first big accessibility push — W3C tablist patterns, aria-live announcements, and a non-map text view for screen-reader users, extended in round two the following cycle. v26.5 stood up **OHC Cluster**, our own DX cluster node feeding the hosted site (ending dependence on public DXSpider nodes), alongside N3FJP integration, real-time Kp, and Prometheus metrics. Throughout, the satellite pipeline was hardened end to end — multi-source TLE failover (CelesTrak → AMSAT → SatNOGS), a proper state machine with tests, and the "fletcher" relay for blocked egress IPs. v26.6 capped the era with a **3D globe projection**: a WebGL Earth with true great-circle arcs, shader-computed day/night terminator, and satellites at real orbital altitude — efficient enough to run on a Raspberry Pi.

---

## Current State (v26.10.1 released · v26.11.0 on Staging)

### What's Working Well

- **80+ dashboard modules** — DX Cluster, PSK Reporter, WSJT-X, POTA, SOTA, WWFF, WWBOTA, satellites, APRS, contests, DXpeditions, propagation, solar indices, weather, band activity, MeshCom, logbook, awards, planners, and more
- **3 map projections** — Flat, Azimuthal, and the 3D globe with great-circle arcs and satellites at orbital altitude
- **13 layouts** — Modern, Classic, Dockable (with presets), Compact, Tablet, Clock, Contest, EmComm, EME, Activator, Hunter, Weather, Air Traffic
- **14 themes** plus a custom theme editor
- **Real propagation physics** — ITU-R P.533 (VOACAP-grade) predictions via in-browser WASM, mode-aware decode thresholds, with REST and heuristic fallbacks; measured NCDXF beacon SNR through a KiwiSDR to check the model against reality
- **OHC Cluster** — Our own DX cluster node serving the hosted site: RBN plus human spots, mode-balanced so SSB/CW survive the FT8 flood
- **Rig control** — Click-to-tune across all spot panels, unified Rig Bridge with 20+ plugins (rigs, rotator, digital modes, APRS TNC, Winlink, KiwiSDR beacon monitor, HamAlert, MQTT publish, GPS, sensors, GPIO, brightness), cloud relay for remote operation, rotator auto-track and satellite Doppler tuning
- **Native logbook** — IndexedDB storage, ADIF import/export, log-from-spot, group/Field Day logging, award tracking, worked-before badges, Wavelog/Cloudlog/QRZ push, LoTW pull, N1MM/N3FJP/DXLog ingest
- **EmComm platform** — Full emergency communications dashboard with APRS station tracking (internet + local RF), net operations, point-to-point APRS messaging, resource token aggregation, NWS alerts, FEMA shelters/disasters, Winlink gateway layer, telemetry, event log and after-action reports
- **Shack-display completeness** — whole-dashboard time shift, planners, alarm clock, a full watch-list grammar, a remote-control API with a phone remote, and Raspberry Pi hardware hooks (see the v26.11.0 What's New)
- **Accessibility** — W3C tablist keyboard navigation, aria-live event announcements, a non-map "Map Data" text view, WCAG AA contrast in every theme, spoken alerts
- **Multi-platform** — Browser, PWA/offline, Electron desktop, Raspberry Pi kiosk, Docker/GHCR, Railway, FreeBSD
- **16 languages** — ca, de, en, es, fr, it, ja, ka, ko, ms, nl, pt, ru, sl, th, zh
- **Observability** — Authenticated Prometheus /metrics endpoint, /api/health subsystem snapshot, external watchtower probes for the hosted site, outbound MQTT/Home Assistant state

### Open Issues

The tracker was at zero open issues when v26.10.1 shipped (2026-10-14). File new ones at <https://github.com/accius/openhamclock/issues>.

---

## What's Coming

### Shipped on Staging Toward the Next Release (v26.11.0)

Already built, merged to Staging, and documented in the manual; headed for the next monthly release:

- **Time Shift** — whole-dashboard display time up to ±30 days (terminator, gray line, sun/moon, satellites, VOACAP hour), with keyboard shortcuts and a header badge
- **Opportunities panel** — spots ranked by award need × activity × P.533 reliability
- **KiwiSDR beacon monitor** — Rig Bridge plugin logging real NCDXF/IBP SNR; MEASURED view in the IBP panel; third bar in Prediction Check
- **Contest weekend outlook** — SWPC 27-day outlook pills on the Contests panel plus a Solar Outlook panel
- **Station Benchmark** — your RBN SNR versus neighbours within 300 km, per band, seven-day trend
- **Spoken alerts** — Web Speech API with phonetics, per-feed
- **Outbound MQTT + Home Assistant discovery** — server and Rig Bridge
- **Remote-control API and phone remote** — HamClock-style set commands over SSE, QR-code pairing, Electron screenshot capture
- **Kiosk conveniences** — demo mode, grayscale, rotating titles, PIN lock
- **Satellite automation** — rotator auto-track with flip mode, Doppler tuning, hams.at alerts, TLE age limit, polar sky view
- **Planners** — Grayline, EME mutual windows, satellite mutual visibility
- **Alarm clock** — daily and once-only, contest-start alarms
- **DX cluster power features** — full watch-list grammar (bands, sub-bands, NADXCC/NAPREF/NAGRID/NABAND, portable prefixes; Off/Red/Only/Not), login commands, cluster console, scroll NEW indicator, spot label options, UDP sets DX, IOTA badges and filter
- **Weather and hazards** — tropical cyclones (NHC + JTWC), fire weather alerts, NDBC buoys, Windy embed, WEFAX charts
- **Map** — political boundaries with custom colours, nearest-city cursor readout, launch sites, HAB/pico balloons
- **Space weather and sky** — NOAA R/S/G scales, Dst, electron flux, eclipses through 2040, planets, space launches, auto Aurora/D-RAP layer
- **Magnetic bearings** — WMM2025 declination, °M suffix everywhere
- **HamAlert, NetLogger live nets, message of the day**
- **Raspberry Pi hardware via Rig Bridge** — GPS (NMEA/gpsd/fifo), BME280/HTTP sensors, GPIO lines, LTR-329 brightness; Rover mode with grid-change alerts

### Known Gaps in the Staging Work

- The Rig Bridge hardware plugins (GPS, sensors, GPIO, brightness) and the KiwiSDR protocol are unit-tested with mocks only — no real Pi, sensor or Kiwi has been connected yet. Field reports wanted.
- The new marker layers (cyclones, fire weather, buoys, balloons, launch sites, boundaries) render on the flat and azimuthal maps, not on the 3D globe.
- Doppler tuning is downlink-only (Rig Bridge has no split/sub-VFO command yet).
- The VOACAP heatmap layer does not follow the time shift (the server computes it for the real hour); the VOACAP chart does.
- Browser screenshot capture renders map canvases only; full-fidelity capture is Electron-only.
- Prediction Check's spot-count comparison is a weak heuristic; the beacon bar is the honest one. A rework around measured data (beacons, your own RBN spots) is on the list.
- HamAlert has not been verified against a live account; NetLogger check-ins are listed but not mapped.

### On the Horizon

- **Prediction Check rework** — measured-first (beacons, own RBN spots), demote spot counts
- **3D globe painters** for the new marker layers
- **Satellite uplink split tuning** once Rig Bridge gains a sub-VFO command
- **Web Push for every alert feed** (currently space weather only)
- **PSK Reporter SNR in the Station Benchmark**
- **Winlink live-pathways layer** — still blocked on upstream stream credentials
- **Mobile layout polish** for the PWA
- **Hardware field validation** on Raspberry Pi 4/5 and Pi 400 ahead of the 2027-03-14 Pi Day build event

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions. All PRs target the `Staging` branch.

- **Issues**: <https://github.com/accius/openhamclock/issues>
- **Discussions**: GitHub Issues or the Community tab in Settings
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

_Last updated: 2026-10-14_ <!-- markdownlint-disable-line MD036 -->
