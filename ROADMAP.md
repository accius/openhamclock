# OpenHamClock Roadmap

> Amateur Radio Dashboard — A modern web-based HamClock alternative
> Created by K0CJH | Current version: v26.2.1 | License: MIT

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

---

## Current State (v26.2.1)

### What's Working Well

- **30+ dashboard modules** — DX Cluster, PSK Reporter, WSJT-X, POTA, SOTA, WWFF, WWBOTA, satellites, APRS, contests, DXpeditions, propagation, solar indices, weather, and more
- **6 layouts** — Modern, Classic, Tablet, Compact, Dockable, EmComm
- **5 themes** — Dark, Light, Legacy, Retro, Custom
- **Rig control** — Click-to-tune across all spot panels, unified rig-bridge with 22 plugins, cloud relay for remote operation
- **EmComm platform** — Full emergency communications dashboard with APRS station tracking (internet + local RF), net operations, point-to-point APRS messaging, resource token aggregation, NWS alerts, FEMA shelters/disasters, and telemetry parsing
- **Multi-platform** — Browser, Electron desktop, Raspberry Pi kiosk, Docker, Railway
- **16 languages** — ca, de, en, es, fr, it, ja, ka, ko, ms, nl, pt, ru, sl, th, zh
- **Real-time data** — PSK Reporter via server-side MQTT proxy, WSJT-X via UDP, APRS-IS, DX cluster telnet

### Open Issues

| #    | Type    | Description                                                                       |
| ---- | ------- | --------------------------------------------------------------------------------- |
| #797 | Feature | Button to disable/enable hamlib rig control                                       |
| #790 | Feature | Mutual reception indicator for FT8 (implemented, pending release)                 |
| #453 | Feature | Rig config persistence across updates + auto-launch                               |
| #297 | Feature | Winlink gateway layer — plugin built, waiting on API key from Winlink team (W3QA) |

---

## What's Coming

### Rig Control Improvements

- Hamlib enable/disable toggle without restarting (#797)
- Rig config persistence across updates (#453)
- Rig bridge auto-launch option on startup

### EmComm & APRS Expansion

- Winlink gateway map layer — plugin built, waiting on API key (#297)
- Winlink Pat client integration for RF messaging (works now without API key)
- APRS telemetry visualization (sensor dashboards, resource trend charts)
- Event log export (CSV/PDF) for After Action Reviews

### DX Cluster & Spots

- Enhanced spot deduplication across sources
- Cross-source spot correlation (DX Cluster + PSK Reporter + RBN)
- Improved frequency-based mode inference

### On the Horizon

- **Logbook integration** — ADIF import/export, QSO logging directly from spots
- **Contest mode** — Dedicated layout optimized for contest operation with rate meters and multiplier tracking
- **Band plan overlay** — Visual band plan segments on frequency displays
- **Offline mode** — Service worker for basic functionality without internet
- **Mobile app** — React Native or PWA for dedicated mobile experience
- **Plugin system** — Community-contributed map layers and data panels

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions. All PRs target the `Staging` branch.

- **Issues**: <https://github.com/accius/openhamclock/issues>
- **Discussions**: GitHub Issues or the Community tab in Settings
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

_Last updated: 2026-03-26_ <!-- markdownlint-disable-line MD036 -->
