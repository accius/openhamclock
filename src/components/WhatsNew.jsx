/**
 * WhatsNew Component
 * Shows a changelog modal on first load of a new version.
 * Stores the last-seen version in localStorage to avoid re-showing.
 */
import { useState, useEffect } from 'react';

// ─── Announcement Banner ────────────────────────────────────
// Set to null to hide. Shown at the top of the What's New modal.
const ANNOUNCEMENT = {
  emoji: '🎪',
  text: 'OpenHamClock will be at Dayton Hamvention 2026! Come visit us in the Flea Market area — Booth #9518. Say hi, see a live demo, and grab some stickers!',
  color: '#ff6b35',
  bg: 'rgba(255, 107, 53, 0.10)',
  border: 'rgba(255, 107, 53, 0.30)',
};

// ─── Changelog ──────────────────────────────────────────────
// Add new versions at the TOP of this array.
// Each entry: { version, date, heading, features: [...] }
const CHANGELOG = [
  {
    version: '15.7.2',
    date: '2026-03-16',
    heading:
      'Bug fix release — resolves a crash when using WSJT-X and broken DX Cluster path lookups introduced in v15.7.1. Also makes Meshtastic MQTT connections per-user instead of shared globally.',
    features: [
      {
        icon: '🐛',
        title: 'Bug Fix — WSJT-X Crash & DX Cluster Paths',
        desc: 'Fixed a missing variable (CALLSIGN_CACHE_TTL) that caused a fatal server crash when WSJT-X sent decoded spots, and broke DX Cluster great circle path lookups. Both are now resolved.',
      },
      {
        icon: '📡',
        title: 'Meshtastic MQTT — Per-User Sessions',
        desc: 'MQTT broker connections are now per-user instead of shared globally. Each browser gets its own independent MQTT session with separate broker settings, topic filters, and credentials. Proxy and direct modes remain shared.',
      },
    ],
  },
  {
    version: '15.7.1',
    date: '2026-03-15',
    heading:
      'Major UI/UX overhaul with collapsible sidebar navigation, Meshtastic integration (beta), solar wind monitoring, NWS weather alerts, enhanced satellite tracking, custom fonts, and a full codebase refactor for contributor-friendly development.',
    features: [
      {
        icon: '🎨',
        title: 'UI/UX Overhaul — Sidebar Navigation',
        desc: 'The settings and controls have moved from the top bar to a new side menu on the left. The sidebar can be pinned open, collapsed to a slim icon bar with verbose hover tooltips, or hidden entirely as a hamburger menu. All buttons, toggles, and panel visibility controls are now organized in the sidebar, keeping the header clean and focused on data.',
      },
      {
        icon: '🔤',
        title: 'Custom Fonts & Header Sizing',
        desc: 'You can now change the font used throughout the interface and adjust the size of header bar information (callsign, clocks, solar indices) independently. Scale the header up for big-screen shack displays or down for compact tablet setups.',
      },
      {
        icon: '🎨',
        title: 'Enhanced Custom Theme',
        desc: 'The custom theme editor now provides more granular control over accent colors, backgrounds, borders, and text colors. Better descriptions and a more intuitive color picker layout make it easier to build your own look.',
      },
      {
        icon: '📡',
        title: 'Meshtastic Integration (Beta)',
        desc: 'New beta module for Meshtastic mesh networking. Connect to your Meshtastic node to see mesh network nodes on the map, exchange messages, and monitor network health. This is an early preview — feedback welcome.',
      },
      {
        icon: '🛰️',
        title: 'Enhanced Satellite Tracking',
        desc: 'Satellite panel now shows more detailed orbital information including visibility windows, pass predictions, and improved tracking accuracy. Better filtering and selection controls for managing your satellite watchlist.',
      },
      {
        icon: '🌬️',
        title: 'Solar Wind Speed',
        desc: 'Solar wind speed (from N0NBH/HamQSL) is now displayed in the header bar, Classic layout, and the Solar Indices panel. Color-coded: green (<400 km/s quiet), yellow (400-500 moderate), amber (500-700 elevated), red (>700 storm). High solar wind speed can disturb HF propagation even when other indices look favorable.',
      },
      {
        icon: '⛈️',
        title: 'NWS Weather Alerts',
        desc: 'Active weather watches, warnings, and advisories from the National Weather Service now appear in the DE and DX weather panels for US locations. Covers tornado, hurricane, severe thunderstorm, flood, winter storm, heat, wind, freeze, and fog alerts. Sorted by severity, color-coded, with countdown to expiry. Alerts update every 5 minutes.',
      },
      {
        icon: '🌍',
        title: 'Translated Weather Forecast Days',
        desc: 'Weather forecast day names (Monday, Tuesday, etc.) are now translated in all supported languages instead of showing the browser locale abbreviation. Includes full translations for German, Spanish, French, Italian, Japanese, and Korean, with English fallback for other languages.',
      },
      {
        icon: '🏗️',
        title: 'Codebase Refactor for Contributors',
        desc: 'The monolithic codebase has been broken into manageable, well-organized modules — routes, hooks, components, layouts, and utilities are now in their own files with clear boundaries. This makes it much easier for contributors to find, understand, and modify specific features without navigating a single massive file.',
      },
    ],
  },
  {
    version: '15.6.5',
    date: '2026-03-09',
    heading:
      'Major security hardening release — CORS lockdown, SSRF elimination, rate-limit bypass fixes, and XSS prevention. Plus LMSAL solar image fallback, lightning unit preferences, DXCC entity selector, rig-bridge multicast, and Raspberry Pi setup improvements.',
    features: [
      {
        icon: '🔒',
        title: 'Security Hardening — CORS & API Protection',
        desc: 'Replaced wildcard CORS policy with an explicit origin allowlist. Previously, any website you visited could silently access your API, read your callsign/coordinates, and (without API_WRITE_KEY) control your rotator or restart the server. Now only localhost and openhamclock.com/app origins are allowed by default. Add custom origins via CORS_ORIGINS in .env. Rotator and QRZ credential endpoints now require API_WRITE_KEY authentication. Server prints a startup warning when API_WRITE_KEY is not set.',
      },
      {
        icon: '🛡️',
        title: 'Security Hardening — SSRF Elimination',
        desc: 'Custom DX cluster connections are now fully protected against Server-Side Request Forgery. The server resolves DNS to an IPv4 address, validates it against private/reserved ranges, and connects to the validated IP directly — preventing DNS rebinding (TOCTOU) attacks. IPv6 resolution removed entirely to eliminate representation bypass attacks (e.g. ::ffff:7f00:1 mapping to 127.0.0.1). Telnet command injection prevented via control character stripping on callsign inputs.',
      },
      {
        icon: '🔐',
        title: 'Security Hardening — Rate Limiting & XSS',
        desc: 'Trust proxy is now auto-detected (enabled on Railway, disabled on Pi/local) to prevent rate-limit bypass via spoofed X-Forwarded-For headers. SSE connections have a per-IP limit (default 10) to prevent resource exhaustion. Health endpoint session details gated behind authentication. DOM XSS fixes applied to N3FJP logged QSO colors and APRS Newsfeed userscript. ReDoS vulnerability fixed in IP anonymization. Dockerfile now runs as non-root user.',
      },
      {
        icon: '📻',
        title: 'Rig-Bridge Security',
        desc: 'Rig-Bridge gets the same security treatment: CORS restricted to explicit origins (no more wildcard), HTTP server binds to localhost by default (set bindAddress to 0.0.0.0 for LAN access), serial port paths validated against OS-specific allowlists, and WSJT-X relay URL validated to prevent SSRF to internal services.',
      },
      {
        icon: '☀️',
        title: 'LMSAL Solar Image Fallback',
        desc: 'Solar imagery now has three-source failover: NASA SDO → LMSAL Sun Today (Lockheed Martin) → Helioviewer. When NASA Goddard infrastructure is down (increasingly common during budget disruptions), the Lockheed mirror provides independent coverage for all four AIA channels. HMI continuum skips LMSAL (not available) and falls through to Helioviewer.',
      },
      {
        icon: '⚡',
        title: 'Lightning Distance Units',
        desc: 'Lightning proximity panel now respects your km/miles unit preference. Closest strike distance, strike list, and radius labels all display in your chosen unit instead of always showing both.',
      },
      {
        icon: '🌍',
        title: 'DXCC Entity Selector',
        desc: 'New DXCC entity picker button next to the DX grid display in Modern and Dockable layouts. Browse or search the full DXCC entity list to quickly set a DX target without knowing the grid square.',
      },
      {
        icon: '📰',
        title: 'DX News Text Scale',
        desc: 'DX News ticker now has A-/A+ buttons to adjust font size (0.7x to 2.0x). Setting persists across sessions. Useful for readability on large displays or compact layouts.',
      },
      {
        icon: '📡',
        title: 'Rig-Bridge Multicast',
        desc: 'WSJT-X relay in rig-bridge now supports UDP multicast, allowing multiple applications (GridTracker, JTAlert, OpenHamClock) to receive WSJT-X packets simultaneously. Enable via the setup UI checkbox or multicast settings in rig-bridge-config.json.',
      },
      {
        icon: '🔧',
        title: 'Rig-Bridge Simulated Radio',
        desc: 'New mock radio plugin for testing rig-bridge without hardware. Simulates a radio drifting through several bands. Enable with radio.type = "mock" in config or select Simulated Radio in the setup UI.',
      },
      {
        icon: '🥧',
        title: 'Raspberry Pi Setup Improvements',
        desc: 'Pi setup script now handles 32-bit ARM (armhf) directly from nodejs.org since NodeSource dropped support for Node 20+. npm install uses --ignore-scripts to avoid electron-winstaller failures on ARM. Dev dependencies pruned after build, freeing ~500MB on SD cards.',
      },
      {
        icon: '🔒',
        title: 'Layout Lock in Border Panel',
        desc: 'Layout lock toggle moved to a dedicated border tab on the left edge of the Dockable layout. Always accessible, never accidentally closeable (enableClose: false). Keeps the header clean while maintaining one-click access.',
      },
      {
        icon: '🔗',
        title: 'DX Cluster Connection Reliability',
        desc: 'Custom DX cluster telnet sessions now use TCP keepalive and automatic stale-connection detection (reconnects after 5 minutes of silence). Callsign SSID (-56) appended automatically when missing.',
      },
    ],
  },
  {
    version: '15.6.4',
    date: '2026-03-04',
    heading:
      'Tornado warnings layer, keyboard shortcuts, TCI/SDR support, Band Health in Modern Layout, auto-rotating panels, PSK grid mode, WSJT-X DX targeting, and a massive satellite & rig-bridge overhaul.',
    features: [
      {
        icon: '🌪️',
        title: 'Tornado Warnings Map Layer',
        desc: 'Real-time NWS tornado watches, warnings, and emergencies rendered as color-coded GeoJSON polygons on the map. Severity levels: Tornado Emergency (magenta), Tornado Warning (red), Tornado Watch (yellow), Severe Thunderstorm Warning (orange). Auto-refreshes every 2 minutes and appears automatically when active warnings exist. Built for SKYWARN and ARES operators.',
      },
      {
        icon: '⌨️',
        title: 'Keyboard Shortcuts',
        desc: 'Press ? to open a keyboard shortcuts panel. Every map layer gets a single-key toggle (G=Grayline, S=Satellites, W=WX Radar, etc). Shortcuts are pinned — adding new layers never reshuffles existing keys. Modifier keys (Ctrl, Alt, Cmd) pass through to the browser so Ctrl+Shift+R still hard-refreshes.',
      },
      {
        icon: '📶',
        title: 'Band Health in Modern Layout',
        desc: 'The propagation panel now cycles through four views: VOACAP Chart → VOACAP Bars → Band Conditions → Band Health. Band Health (previously dockable-only) shows real-time HF band usability based on DX cluster spot activity with mode filtering and configurable time windows.',
      },
      {
        icon: '🔄',
        title: 'Auto-Rotating Panels',
        desc: 'Solar and Propagation panels can now auto-rotate through their views on a configurable timer (5–60 seconds). Click the ▶ button in the panel header to start, ⏸ to stop, and pick your interval from the dropdown. In Dockable Layout, any tabset with 2+ tabs gets the same rotate controls in the toolbar. All settings persist across refresh.',
      },
      {
        icon: '📡',
        title: 'TCI Protocol — SDR Rig Control',
        desc: 'rig-listener v1.1.0 adds TCI (Transceiver Control Interface) support for WebSocket-based SDR applications: Thetis/HL2, ANAN, SunSDR, and ExpertSDR. Unlike serial CAT, TCI pushes state in real-time — no polling. Quick-start with --tci flag or configure host/port/TRX/VFO in the setup wizard.',
      },
      {
        icon: '🛰️',
        title: 'PSK Reporter Grid Mode',
        desc: 'Filter PSK Reporter spots by Maidenhead grid square instead of callsign. Useful for monitoring activity in your region or a target grid for contests. Select Call vs Grid mode in the PSK Reporter Source tab — the server subscribes to MQTT topics for the selected grid prefix.',
      },
      {
        icon: '🎯',
        title: 'WSJT-X DX Target Auto-Set',
        desc: 'When you select a callsign in WSJT-X, OpenHamClock automatically resolves it to coordinates and sets the DX target on the map — same as clicking a spot. Uses a 4-step location cascade: WSJT-X grid → grid cache → callsign lookup cache → prefix estimation. Also auto-clears stale decodes on band changes.',
      },
      {
        icon: '📻',
        title: 'WSPR Decode Display',
        desc: 'WSPR decodes now appear in the WSJT-X panel in a dedicated sub-tab showing callsign, grid, SNR, drift, and power. Spots are enriched with lat/lon for map clicks. The hasDataFlowing indicator now accounts for WSPR activity.',
      },
      {
        icon: '🗺️',
        title: 'DX Grid Square Input',
        desc: 'Click the DX grid display in Modern or Classic layout to manually type a Maidenhead locator (e.g. JN58sm). Press Enter to set the DX target. The input validates the grid format and resolves to coordinates instantly.',
      },
      {
        icon: '🔧',
        title: 'Rig-Bridge Plugin Architecture',
        desc: 'Complete refactor of rig-bridge from a monolithic 1500-line file into a modular core/plugins architecture. Plugins for flrig, rigctld, mock, WSJT-X relay, and USB serial protocols (Icom CI-V, Kenwood, Yaesu) are now independently loadable. Config-driven via rig-bridge-config.json.',
      },
      {
        icon: '👁️',
        title: 'DE/DX Markers Toggle',
        desc: 'Toggle DE and DX station markers on/off from Map Layers settings. Useful when you want a cleaner map view or are using the azimuthal projection where markers can obscure the polar regions.',
      },
      {
        icon: '🛰️',
        title: 'Satellite List Overhaul',
        desc: 'Removed 11 dead/decayed/non-ham satellites (AO-92, PO-101, AO-27, RS-15, etc.) and added 4 new active ones (AO-123, SO-124, SO-125, QMR-KWT-2). Fixed TEVEL constellation NORAD IDs per AMSAT bulletin. ISS consolidated to single entry. TLE parser now filters to curated NORAD IDs only — no more clutter from 100+ dead cubesats.',
      },
      {
        icon: '🛰️',
        title: 'TLE Gap-Fill: CelesTrak + SatNOGS',
        desc: "Satellites missing from CelesTrak's bulk group files are now individually fetched by NORAD catalog number, with SatNOGS as a fallback. Batched in groups of 5 with rate limiting. New /api/satellites/debug endpoint shows exactly which sats resolved and which are still missing.",
      },
      {
        icon: '🐳',
        title: 'Docker Deployment',
        desc: 'New comprehensive DOCKER.md with production-ready docker-compose.yml. Includes env var configuration, N1MM UDP port mapping, health checks, and Railway deployment notes.',
      },
      {
        icon: '🖥️',
        title: 'Raspberry Pi Trixie & Wayland',
        desc: 'setup-pi.sh now supports Raspberry Pi OS Trixie (Debian 13) which defaults to Wayland/labwc instead of X11. Chromium launches with --ozone-platform=wayland automatically. X11 tools (xset, unclutter) are skipped on Wayland systems.',
      },
      {
        icon: '🐧',
        title: 'Linux/macOS systemd Service',
        desc: 'setup-linux.sh now creates a proper systemd unit file for auto-start on boot. Includes service management instructions and platform-specific notes for macOS (where systemd is not available).',
      },
      {
        icon: '📏',
        title: 'Independent Unit Settings',
        desc: 'Distance, temperature, and barometric pressure units can now be set independently instead of a single imperial/metric toggle. Want miles but Celsius? Now you can.',
      },
      {
        icon: '🔧',
        title: 'Drag-to-Reposition Simplified',
        desc: 'Map legend panels no longer require Ctrl+drag to reposition — just drag the title bar directly. Double-click the title to reset to default position.',
      },
      {
        icon: '📊',
        title: 'DXpedition Panel: 20 Results',
        desc: 'DXpedition panel now shows up to 20 upcoming/active DXpeditions, up from 4. The server already returned 50 — the client was just truncating too aggressively.',
      },
      {
        icon: '🔍',
        title: 'DX Cluster Filter Tolerance',
        desc: 'Widened the digital mode frequency matching tolerance from ±3 kHz to ±5 kHz. Edge frequency spots like 24.911 MHz for 12m FT8 (dial 24.915) were being missed with the tighter window.',
      },
      {
        icon: '🕐',
        title: 'Contest Panel Hour Fix',
        desc: 'Contest countdown now always shows hours — "0H 39m left" instead of just "39m left" when under an hour remains. Consistent formatting across all languages.',
      },
    ],
  },
  {
    version: '15.6.3',
    date: '2026-02-24',
    heading:
      'Propagation heatmap overhaul, draggable legend fix, activate filters, custom themes, and a stack of stability fixes.',
    features: [
      {
        icon: '🗺️',
        title: 'VOACAP Heatmap Overhaul',
        desc: 'Complete rewrite of the propagation heatmap renderer. Switched from SVG to a canvas renderer eliminating grid seams. Day/night transitions now use smooth cosine curves instead of hard cutoffs — no more vertical line at the solar terminator. Full map coverage with opacity-scaled coloring: poor areas show a subtle tint instead of disappearing. Default resolution increased from 10° to 5° for smoother gradients.',
      },
      {
        icon: '🔧',
        title: 'Draggable Legends Fixed — No More Lost Panels',
        desc: 'Fixed #600 — dragging a map legend off-screen made it permanently disappear with no way to recover. All 7 layer legends (MUF, GrayLine, Lightning, N3FJP, RBN, VOACAP, WSPR) now share a single makeDraggable utility with viewport clamping, resize tracking, and double-click to reset position.',
      },
      {
        icon: '🔍',
        title: 'Activate Spot Filters',
        desc: 'POTA, SOTA, WWFF, and WWBOTA panels now have a filter button to narrow spots by band, grid square, and mode. Filters persist in localStorage and show an active filter count badge. Spot data is also enriched with computed grid squares and band labels.',
      },
      {
        icon: '📡',
        title: 'PSK Reporter Path Lines Toggle',
        desc: 'New toggle button in the PSK Reporter panel header to show/hide the path lines on the map independently from spot markers. Useful when you want to see spots without visual clutter from hundreds of crossing lines.',
      },
      {
        icon: '🎨',
        title: 'Custom Theme Editor',
        desc: 'Full theme customization system — pick colors for every UI element (backgrounds, borders, accents, map ocean) with a live color picker. Your custom theme saves to localStorage and persists across sessions.',
      },
      {
        icon: '🕐',
        title: 'DX Local Time Display',
        desc: "The DX info card now shows the approximate solar local time at the DX station's location. Click to toggle between UTC and local time. Available in Modern and Dockable layouts.",
      },
      {
        icon: '☀️',
        title: 'Sunspot Number Fixed',
        desc: 'SSN was displaying as zero because NOAA monthly data returns null for recent months (smoothing not yet complete). Now walks backward through the last 12 months to find the most recent valid value, with fallback to SWPC daily data.',
      },
      {
        icon: '🔄',
        title: 'RPi Update Script Fixed',
        desc: 'Fixed #594 — the update button showed success but the version never changed on Raspberry Pi. Root causes: missing git safe.directory config, silent error suppression, and no version verification. Script now reports real errors and confirms the version actually changed.',
      },
      {
        icon: '🖼️',
        title: 'Custom Image Panel',
        desc: 'New dockable panel for displaying a custom image — useful for station photos, QSL cards, or reference charts in your dashboard layout.',
      },
      {
        icon: '🇦🇩',
        title: 'Catalan Language',
        desc: 'New Catalan (Català) translation at full coverage. OpenHamClock now supports 14 languages.',
      },
    ],
  },
  {
    version: '15.6.2',
    date: '2026-02-22',
    heading: 'Surprise! Sunday Updates',
    features: [
      {
        icon: '🌡️',
        title: 'Unified Weather Units',
        desc: 'Weather displays now follow the global Settings unit choice (metric/imperial) everywhere — no more separate °F/°C toggle button inside each weather panel. Pressure reads correctly per system: hPa for metric, inHg for imperial. One setting, consistent behavior across all layouts.',
      },
      {
        icon: '🔀',
        title: 'Staging Branch Merge Cleanup',
        desc: 'Resolved merge conflicts across DockableApp and WorldMap bringing all Staging features cleanly into the codebase: WWBOTA spots & labels, DX weather overlays, night darkness slider, and the map legend toggle. Zero conflict markers, zero duplicate functions.',
      },
      {
        icon: '🗺️',
        title: 'WWFF Legend Badge Fix',
        desc: 'The WWFF entry in the map legend was rendering taller than POTA/SOTA/WWBOTA because the ▼ symbol and text could wrap to two lines. Fixed with a non-breaking space to match all other legend badges.',
      },
    ],
  },
  {
    version: '15.6.1',
    date: '2026-02-25',
    heading:
      'Major propagation model fix, gray line rendering improvements, 8m & 4m band support, antivirus compatibility, and UI polish.',
    features: [
      {
        icon: '📡',
        title: 'VOACAP Propagation Model Overhaul',
        desc: 'Fixed a critical bug where 160m and 80m bands showed incorrectly high reliability on long daytime paths (reported by W3AAX). Root cause: the MUF and LUF calculations used UTC hour instead of local solar time at the path midpoint, and D-layer absorption was far too weak for multi-hop paths. LUF now properly accounts for hop count (+50% absorption per additional hop), uses correct local solar time for day/night transitions, and applies realistic daytime penalties to low bands (160m essentially dead, 80m heavily absorbed). Transatlantic paths now correctly show 160m/80m open at night and closed during the day.',
      },
      {
        icon: '🌅',
        title: 'Gray Line Twilight Zone Rendering Fixed',
        desc: "Fixed gaps in the twilight zone dashed lines where segments would disappear mid-curve (reported by Trev). The old Newton-Raphson iterative solver failed to converge at certain longitudes near the curve's polar tips. Replaced with a direct analytical solution using half-angle substitution — a simple quadratic equation that always produces an exact answer with zero gaps.",
      },
      {
        icon: '💾',
        title: 'Gray Line Settings Now Persist',
        desc: 'Fixed Issue #564 — Gray Line settings (Show Twilight Zones, Enhanced DX Zone, Twilight Opacity) were lost on browser restart because they were hardcoded defaults with no localStorage persistence. All three settings now save automatically and restore on reload. Checkboxes and slider sync with the loaded state when the control panel mounts.',
      },
      {
        icon: '📻',
        title: '8m & 4m Band Support',
        desc: 'Added the 8m (40–42 MHz) and 4m (70–70.5 MHz) bands across the entire stack — popular in Europe and increasingly active worldwide. New bands appear in the map legend, band filter bars (DX Cluster, PSK Reporter, RBN, WSPR), band health tiles, and all spot/path coloring. Server-side frequency detection updated for DX Cluster, RBN, PSK Reporter, and WSJT-X.',
      },
      {
        icon: '🛡️',
        title: 'Bitdefender False Positive Mitigation',
        desc: "Addressed Issue #356 — Bitdefender was flagging openhamclock.com URLs as malicious. Added a Permissions-Policy security header and an RFC 9116 security.txt endpoint declaring the site's legitimacy. Removed redundant cache-buster timestamps (_t=Date.now()) from four API hooks that made every polling request a unique URL — a pattern that heuristic antivirus scanners flag as command-and-control beaconing.",
      },
      {
        icon: '🌡️',
        title: 'Weather Data Fixed for Local Installs',
        desc: "Fixed Issue #555 — local/self-hosted installs showed stale weather data (19°F off) while openhamclock.com was correct. The Open-Meteo API fetch was missing cache: 'no-store', allowing the browser to serve hours-old cached responses on localhost. Added diagnostic logging so users can verify coordinates and temperatures in DevTools.",
      },
      {
        icon: '📍',
        title: 'DE/DX Markers Always Visible',
        desc: 'Fixed APRS station markers rendering on top of the DE (home) and DX icons, hiding them from view. DE marker now has zIndexOffset 20000 and DX has 19000, ensuring they always render above APRS, DX Cluster, and other spot layers.',
      },
      {
        icon: '❤️',
        title: 'Unified Support Button & Merch Store',
        desc: 'Consolidated the separate PayPal and Buy Me a Coffee buttons into a single "Support Us" button that opens a modal with three options: Buy Me a Coffee, PayPal donation, and a link to the new OpenHamClock merch store.',
      },
      {
        icon: '🔖',
        title: "Version Number Opens What's New",
        desc: "The version number displayed next to your callsign in the header is now clickable — tap it to re-open this What's New popup anytime and review the latest release notes.",
      },
    ],
  },
  {
    version: '15.5.10',
    date: '2026-02-20',
    heading:
      "Server stability, smarter failovers, ultrawide layout support, and two new languages. Also — we're moving to weekly Tuesday releases!",
    notice:
      '📅 Starting now, OpenHamClock updates will ship on Tuesday nights (EST) only. One release per week means more testing, fewer surprises, and better stability for everyone.',
    features: [
      {
        icon: '🔇',
        title: 'Log Flooding Fix — 115K Dropped Messages Resolved',
        desc: 'The Railway server was generating 60-100+ log lines/second, overwhelming the log pipeline and dropping 115,000 messages in 30 minutes. Root cause: six hot-path loggers (RBN spots, callsign lookups, WSPR heatmap, PSK-MQTT SSE connects) were writing directly to console on every request instead of going through the log level system. All moved behind logDebug/logInfo/logErrorOnce. Added a global token-bucket rate limiter (burst 20, refill 10/sec) as a safety net — excess logs are silently dropped with a 60-second summary.',
      },
      {
        icon: '🛰️',
        title: 'TLE Multi-Source Failover',
        desc: 'Satellite TLE data was failing because CelesTrak rate-limited our server IP. TLEs now automatically failover across three sources: CelesTrak → CelesTrak legacy → AMSAT. If a source returns 429/403 it immediately tries the next. Cache extended from 6 to 12 hours, with stale data served up to 48 hours while retrying. 30-minute negative cache prevents hammering when all sources are down. Self-hosters can reorder sources via TLE_SOURCES env var.',
      },
      {
        icon: '🌙',
        title: 'Moon Image & RBN Negative Caching',
        desc: "When NASA's Dial-A-Moon API or QRZ callsign lookups were down, every client request triggered a fresh retry — hundreds per minute. Both now cache failures: Moon Image backs off 5 minutes, RBN callsign lookups cache failures for 10 minutes with automatic expiry. Stale Moon images are served during outages instead of returning errors.",
      },
      {
        icon: '🖥️',
        title: 'Ultrawide Monitor Layout',
        desc: 'Sidebars now scale proportionally with viewport width using CSS clamp() instead of fixed pixel widths. On a 2560px ultrawide, sidebars grow to ~460px + 500px (was capped at 320 + 340px), using the extra space instead of giving the map an absurdly wide center column. Panel height caps removed so DXpeditions, POTA, and Contests panels flex to fill available space.',
      },
      {
        icon: '📱',
        title: 'Mobile Single-Module Scroll',
        desc: 'Mobile layout (<768px) rebuilt for true vertical scrolling. Each panel gets its own full-width card: Map (60vh) → DE/DX → Cluster → PSK Reporter → Solar → Propagation → DXpeditions → POTA → Contests. Scroll-snap for smooth momentum scrolling. No more cramped side-by-side panels on small screens.',
      },
      {
        icon: '🇷🇺',
        title: 'Russian & Georgian Translations',
        desc: 'Two new languages: Русский (Russian) and ქართული (Georgian), both at 100% coverage (379 keys). OpenHamClock now supports 13 languages total. Language selector entries added to all existing translation files.',
      },
      {
        icon: '🔧',
        title: 'Header Vertical Centering Fixed',
        desc: 'The header bar text (callsign, clocks, solar stats, buttons) was misaligned vertically after layout changes. Fixed with consistent alignItems, lineHeight normalization on large text spans, and switching the grid row from fixed 55px to auto sizing.',
      },
    ],
  },
  {
    version: '15.5.9',
    date: '2026-02-20',
    heading: 'APRS tracking, wildfire & flood maps, full internationalization, and a stack of quality-of-life fixes.',
    features: [
      {
        icon: '📡',
        title: 'APRS-IS Live Tracking with Watchlist Groups',
        desc: 'Full APRS integration via a server-side APRS-IS connection (rotate.aprs2.net). Stations are parsed in real-time and rendered on the map with position, course, speed, altitude, and symbol. A watchlist system lets you tag callsigns into named groups — perfect for EmComm nets, ARES/RACES events, or tracking a group of friends during Field Day. Filter the panel by group, see all members on the map, and click any station for full details.',
      },
      {
        icon: '🔥',
        title: 'Wildfire Map Layer',
        desc: 'New map layer showing active wildfires worldwide, sourced from NASA EONET satellite detection data. Fire events are plotted as markers with size and color indicating severity. Data refreshes automatically and layers can be toggled in the Map Layers tab under Natural Hazards.',
      },
      {
        icon: '🌊',
        title: 'Floods & Storms Map Layer',
        desc: 'New map layer showing active floods and severe storms worldwide via NASA EONET. Storm events display with category, coordinates, and timestamps. Both the wildfire and flood layers are grouped under the new Natural Hazards category in Settings.',
      },
      {
        icon: '📻',
        title: 'PSKReporter TX/RX Split View',
        desc: 'The PSKReporter panel now separates spots into "Being Heard" (stations receiving your signal) and "Hearing" (stations you are receiving) with dedicated tabs showing counts for each direction. This replaces the old combined view and makes it immediately clear which direction the propagation path goes.',
      },
      {
        icon: '📂',
        title: 'Map Layers — Categorized & Sorted',
        desc: 'The Map Layers tab in Settings now groups layers by category with clear emoji headers: 📡 Propagation, 📻 Amateur Radio, 🌤️ Weather, ☀️ Space Weather, ⚠️ Natural Hazards, 🪨 Geology, and 🗺️ Map Overlays. Within each category, layers are sorted alphabetically. No more hunting through an unsorted flat list.',
      },
      {
        icon: '🌍',
        title: '100% Translation Coverage — All 10 Languages',
        desc: 'Every string in the dashboard is now fully translated across all 10 supported languages: German, Spanish, French, Italian, Japanese, Korean, Malay, Dutch, Portuguese, and Slovenian. Previously coverage ranged from 45% (Korean) to 61% (German) — 292 missing keys total. All weather conditions, wind compass directions, plugin layers, propagation views, PSKReporter/WSJT-X panels, station settings, satellite controls, and contest labels are now properly localized.',
      },
      {
        icon: '🐛',
        title: 'WSJT-X & PSK Reporter Duplicate Spots Fixed',
        desc: 'Fixed #396 — WSJT-X decodes and QSOs appeared duplicated in the panel. Decode IDs were timestamp-based, so the same message with a 1ms time difference bypassed dedup. IDs are now content-based (time + freq + message). QSO logging checks for duplicate call + frequency + mode within 60 seconds. PSK Reporter MQTT spot ingestion now deduplicates by sender + receiver + band + frequency before buffering. Client-side merge in both hooks uses content-based matching as a final safety net.',
      },
      {
        icon: '🪟',
        title: 'Windows Update Mechanism Fixed',
        desc: 'The in-app update button now works correctly on Windows deployments. Git operations use proper path resolution and the server restart sequence handles Windows process semantics.',
      },
      {
        icon: '🕐',
        title: 'DX Cluster Time Display Cleanup',
        desc: 'DX cluster spot timestamps now display as relative time ("5m ago") with the original UTC time in parentheses, replacing the inconsistent raw timestamp formats from different cluster sources.',
      },
    ],
  },
  {
    version: '15.5.8',
    date: '2026-02-19',
    heading: 'Memory leak fixes, live Moon imagery, and a major stability patch.',
    features: [
      {
        icon: '🧠',
        title: 'Memory Leak Fixes — Three Unbounded Caches Plugged',
        desc: 'Identified and fixed three server-side caches that grew without limit, pushing RSS to 384 MB+. The propagation heatmap cache now purges stale entries every 10 minutes with a 200-entry hard cap. Custom DX cluster sessions are reaped after 15 minutes of inactivity (clearing TCP sockets, timers, and spot buffers). DX spot path caches are cleaned every 5 minutes with a 100-key cap. Memory logging now tracks all three cache sizes for easier monitoring.',
      },
      {
        icon: '🌙',
        title: 'Live NASA Moon Imagery',
        desc: "The Solar panel's lunar phase display now shows real NASA Dial-A-Moon imagery instead of a static SVG. A server-side proxy fetches the current 730×730 JPG render from NASA's GSFC visualization studio with a 1-hour cache, so the Moon always matches the actual phase and libration — no more guessing from a cartoon circle.",
      },
      {
        icon: '🗺️',
        title: 'Map Legend & Band Colors Restored',
        desc: 'The clickable band color legend on the world map was accidentally removed in a bad merge. Fully restored — you can see which color maps to which band at a glance, and click any band chip to customize its color. Also restored: rotator bearing line, satellite tracks, and My Spots markers on the map.',
      },
      {
        icon: '🔧',
        title: 'Merge Conflict Cleanup',
        desc: 'Fixed a cascade of merge artifacts from a stale-branch PR: duplicate zoom buttons in panel headers (A− A− A+ → A− A+), triplicated switch/case blocks in the panel factory, duplicate variable declarations in the Solar panel, and a broken server-side cache check that crashed Node on startup. All source files now pass automated syntax and brace-balance checks.',
      },
    ],
  },
  {
    version: '15.5.7',
    date: '2026-02-19',
    heading: 'Small change, big quality-of-life improvement.',
    features: [
      {
        icon: '💾',
        title: 'Settings Export Filenames Now Include Time',
        desc: 'Exported settings and profile files now include the time in the filename (e.g. hamclock-current-2026-02-19-143022.json), not just the date. Multiple exports on the same day no longer silently overwrite each other — great for keeping a proper rollback history as you update. Applies to both the "Export Current State" button and named profile exports.',
      },
    ],
  },
  {
    version: '15.5.6',
    date: '2026-02-19',
    heading: 'Smarter satellites, cleaner maps, and icons that just work on Linux.',
    features: [
      {
        icon: '🛰️',
        title: 'Satellite Info Window — Minimize Button',
        desc: 'The floating satellite data window now has a ▼ minimize button in its title bar. Collapse it to a slim header when you want to see the footprints on the map without the info panel in the way. Click ▲ to restore. State survives the 5-second data refresh cycle without flickering.',
      },
      {
        icon: '🗺️',
        title: 'Draggable Panel Disappear Bug Fixed',
        desc: 'Map layer panels (Gray Line, RBN, Lightning, MUF Map, N3FJP Logged QSOs) were vanishing when you tried to Ctrl+drag them after switching layouts. Root cause: document-level mousemove/mouseup listeners were never cleaned up on layout change, so stale handlers fired during the next drag and teleported the panel off-screen. Fixed with AbortController — each new makeDraggable() call cancels the previous listener set before registering new ones.',
      },
      {
        icon: '📻',
        title: 'Rig Control — CW Mode Auto-Switching',
        desc: 'Clicking a spot in a CW segment of the band plan no longer forces the radio into SSB. The band plan JSON now correctly labels CW segments as CW and data segments as DATA. A rewritten mapModeToRig() passes CW/CW-R through unchanged, maps digital modes (FT8, FT4, JS8, WSPR…) to DATA-USB or DATA-LSB based on band convention, and resolves generic SSB to the correct sideband. New "Auto-set mode" toggle in Rig Control settings for operators who prefer manual mode control.',
      },
      {
        icon: '🔌',
        title: 'Rig Listener — FT-DX10 & Windows Serial Fix',
        desc: "Fixed two Rig Listener bugs: (1) FT-DX10 (and other radios using CP210x USB-serial adapters on Windows) weren't receiving data because DTR was left LOW. The listener now asserts DTR HIGH after opening the port with a 300ms stabilisation delay and hupcl:false to prevent DTR drop on reconnect. (2) Windows systems with Node.js pre-installed would fail to find npm during the bat-file setup because the system Node path wasn't being resolved correctly — fixed with \u2018where node\u2019 / \u2018where npm\u2019 full-path resolution.",
      },
      {
        icon: '📍',
        title: 'Portable Callsign Location Fix',
        desc: "Portable and mobile callsigns (e.g. PJ2/W9WI, DL/W1ABC, 5Z4/OZ6ABL) now resolve to the correct DXCC entity on the map. Previously, the operating prefix was being stripped and the home callsign's country was used instead. A new extractOperatingPrefix() function identifies which part of a compound callsign carries the DXCC information and uses that for location lookups, while still using the base callsign for QRZ lookups.",
      },
      {
        icon: '😊',
        title: 'Emoji Icons on Linux — CSS Font Stack & Docs',
        desc: "Added a proper emoji font-family stack to main.css so the browser finds whatever color emoji font is available (Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, Twemoji). The Raspberry Pi setup script now installs fonts-noto-color-emoji automatically. New FAQ entry in README.md explains the one-line fix for manual installs and clarifies it's needed on the browser machine, not the server.",
      },
      {
        icon: '✅',
        title: 'CI Formatting Fixed',
        desc: 'The GitHub Actions format check was failing because new code used double-quoted strings while the project uses single quotes (per .prettierrc). Converted all affected files to single quotes so the format:check job passes clean.',
      },
    ],
  },
  {
    version: '15.5.5',
    date: '2026-02-18',
    heading: 'Map reliability, contributor tooling, and cleaner error messages.',
    features: [
      {
        icon: '🗺️',
        title: 'Leaflet Load Reliability Fix',
        desc: "Fixed a race condition where the world map could silently fail to initialize if Leaflet's vendor script hadn't finished loading by the time the map component mounted — most likely on slower connections or after a failed vendor-download. The map now polls for up to 5 seconds and retries automatically instead of giving up on first mount.",
      },
      {
        icon: '🛠️',
        title: 'Actionable Leaflet Error',
        desc: 'If Leaflet genuinely fails to load after 5 seconds (missing vendor file, 404, network error), the console now shows a clear message with the exact fix: run bash scripts/vendor-download.sh. No more cryptic "Leaflet not loaded" with no context.',
      },
      {
        icon: '🤝',
        title: 'Contributor Self-Assign',
        desc: "Any GitHub user can now self-assign issues without needing write access. Comment /assign on any open issue and the bot will claim it for you instantly and react with 👍. Makes it easy to signal you're working on something without waiting for a maintainer.",
      },
      {
        icon: '📋',
        title: 'Updated Contributing Guide',
        desc: 'CONTRIBUTING.md now includes a dedicated "Claiming a Bug or Issue" section explaining the /assign workflow, sitting right where new contributors naturally look — between feature requests and code submission instructions.',
      },
    ],
  },
  {
    version: '15.5.4',
    date: '2026-02-18',
    heading: 'Squashing bugs, plugging leaks, and keeping your spots fresh.',
    features: [
      {
        icon: '📡',
        title: 'Stale Spots Fix',
        desc: 'Fixed a bug where WWFF spots could show data hours old due to a cache validation error. All three spot sources (POTA, SOTA, WWFF) now enforce a 60-minute age filter and a 10-minute stale cache limit — no more chasing ghosts.',
      },
      {
        icon: '🧠',
        title: 'Memory Leak Fixes',
        desc: 'Plugged several server-side memory leaks: RBN API response cache now auto-cleans, callsign and IP tracking caps tightened, and cache structures that grew unbounded over 24 hours are now properly pruned.',
      },
      {
        icon: '🔇',
        title: 'QRZ Login Spam Eliminated',
        desc: 'QRZ credential failures now properly respect the 1-hour cooldown. Previously, any user testing credentials in Settings would reset the timer for everyone, hammering QRZ with bad logins all day.',
      },
      {
        icon: '🛡️',
        title: 'Cleaner Error Handling',
        desc: 'Added proper Express error middleware to catch body-parser errors gracefully. No more stack traces in logs from clients disconnecting mid-request or sending oversized payloads.',
      },
      {
        icon: '🎨',
        title: 'Prettier for Contributors',
        desc: 'Standardized code formatting with Prettier, pre-commit hooks via Husky, and CI enforcement. No more quote style debates in pull requests — formatting is now automatic.',
      },
      {
        icon: '📻',
        title: 'Rig Control Options Restored',
        desc: 'The rig-bridge (flrig/rigctld) and rig-control (daemon mode) directories are back for power users who need more customization than the one-click Rig Listener provides.',
      },
      {
        icon: '🔎',
        title: 'DX Cluster Mode Filter Fixed',
        desc: "Filtering by SSB, FT8, or CW no longer hides everything. Mode detection now infers from frequency when the spot comment doesn't mention a mode — which is most spots. 14.074? That's FT8. 14.250? SSB. It just works now.",
      },
      {
        icon: '📡',
        title: 'RBN Skimmer Locations Fixed',
        desc: "Fixed a bug where RBN skimmer callsigns could show at wrong locations on the map. Enrichment is now sequential with cross-validation — if a lookup returns a location >5000 km from the callsign's expected country, it falls back to prefix estimation.",
      },
    ],
  },
  {
    version: '15.5.3',
    date: '2026-02-17',
    heading: 'Satellites got smarter, SOTA got richer, and tuning just works.',
    features: [
      {
        icon: '🛰️',
        title: 'Satellite Tracker Overhaul',
        desc: 'Completely redesigned satellite layer with a floating data window, blinking indicators for visible passes, pinned satellite tracking, and GOES-18/19 weather satellites re-enabled.',
      },
      {
        icon: '⛰️',
        title: 'SOTA Summit Details',
        desc: 'SOTA spots now include full summit information — name, altitude, coordinates, and point values — pulled from the official SOTA summits database and refreshed daily.',
      },
      {
        icon: '📻',
        title: 'WSJT-X Rig Tuning Fix',
        desc: 'Clicking a WSJT-X decode now sends the correct dial frequency to your radio instead of the audio offset. FT8/FT4 click-to-tune works properly.',
      },
      {
        icon: '🎯',
        title: 'POTA/WWFF Click-to-Tune',
        desc: 'POTA and WWFF spots now properly trigger rig control when clicked — same one-click tuning that DX cluster spots have always had.',
      },
      {
        icon: '📊',
        title: 'Frequency Display Fix',
        desc: 'POTA, SOTA, and WWFF panels now consistently display frequencies in MHz. No more confusion between kHz and MHz values across different data sources.',
      },
      {
        icon: '🔇',
        title: 'SOTA QRT Filtering',
        desc: 'Operators who have signed off (QRT) are now automatically filtered out of the SOTA spots list — no more chasing stations that are already off the air.',
      },
      {
        icon: '🔍',
        title: 'SEO & Branding',
        desc: 'New favicon, Open Graph social sharing cards, structured data for search engines, and a canonical URL to ensure openhamclock.com is always the top result.',
      },
      {
        icon: '🤝',
        title: 'Community Tab',
        desc: 'New Community tab in Settings with links to GitHub, Facebook Group, and Reddit — plus a contributors wall thanking everyone who has helped build OpenHamClock.',
      },
    ],
  },
  {
    version: '15.5.1',
    date: '2026-02-15',
    heading: 'Better callsign lookups, better propagation maps.',
    features: [
      {
        icon: '🌍',
        title: 'cty.dat DXCC Entity Database',
        desc: 'Callsign → entity identification now uses the full AD1C cty.dat database — the same file every contest logger uses. ~400 DXCC entities, thousands of prefixes, zone overrides, and exact callsign matches. Replaces the old hand-coded 120-entry prefix table.',
      },
      {
        icon: '📡',
        title: 'MUF Layer Restored',
        desc: 'Fixed a regression where the MUF Map layer disappeared from the Map Layers list. The ionosonde-based MUF overlay is back.',
      },
      {
        icon: '🔥',
        title: 'VOACAP Power Levels Fixed',
        desc: 'Changing TX power (e.g. 5W vs 1000W) now produces dramatically different propagation maps, matching real-world behavior. Previously, power barely affected the heatmap colors.',
      },
      {
        icon: '🔎',
        title: 'Smarter DX Cluster Filtering',
        desc: 'Spotter and spot continent/zone filtering is now far more accurate thanks to the cty.dat database. Calls like 3B9WR (Rodriguez Island) and 5B4 (Cyprus) are correctly identified instead of falling through to crude single-character guesses.',
      },
    ],
  },
  {
    version: '15.5.0',
    date: '2026-02-15',
    heading: 'Click a spot. Tune your radio. Just like that.',
    features: [
      {
        icon: '📻',
        title: 'Direct Rig Control',
        desc: 'Click any DX cluster spot, POTA activation, or WSJT-X decode and your radio tunes instantly. Supports Yaesu, Kenwood, Elecraft, and Icom radios — no flrig or rigctld needed.',
      },
      {
        icon: '⬇️',
        title: 'One-Click Rig Listener Download',
        desc: 'Enable Rig Control in Settings and download the Rig Listener for Windows, Mac, or Linux. Double-click to run — it auto-installs everything. No Node.js, no command line, no setup headaches.',
      },
      {
        icon: '🔌',
        title: 'Interactive Setup Wizard',
        desc: 'The Rig Listener detects your USB serial ports, asks your radio brand and model, saves the config, and connects. First run is a 30-second wizard — after that, just double-click to start.',
      },
      {
        icon: '🔄',
        title: 'Live Frequency & Mode Display',
        desc: "Your radio's current frequency and mode are shown in real time on the dashboard. Polls every 500ms over USB so the display always matches your dial.",
      },
      {
        icon: '🌙',
        title: 'Night Darkness Slider',
        desc: 'Adjust how dark the nighttime shading appears on the map. Slide from subtle to dramatic — find the look that works for your setup. Located below the map lock toggle.',
      },
      {
        icon: '👁️',
        title: 'Hosted User Cleanup',
        desc: "Rotator panel and local-only features are now hidden for hosted users — cleaner interface, no confusing controls that don't apply to your setup.",
      },
    ],
  },
  {
    version: '15.4.1',
    date: '2026-02-15',
    heading: "Tonight's a big one — here's what's new:",
    features: [
      {
        icon: '📡',
        title: 'QRZ.com Callsign Lookups',
        desc: 'Precise station locations from QRZ user profiles, geocoded addresses, and grid squares. 3-tier waterfall: QRZ → HamQTH → prefix estimation. Configure credentials in Settings → Profiles.',
      },
      {
        icon: '🎯',
        title: 'Antenna Rotator Panel',
        desc: 'Real-time rotator control and bearing display. Shows current azimuth on the map with an animated bearing line. Shift+click the map to turn your antenna to any point.',
      },
      {
        icon: '🖱️',
        title: 'Mouse Wheel Zoom Sensitivity',
        desc: 'Adjustable scroll-to-zoom speed for the map. Fine-tune it in Settings → Station.',
      },
      {
        icon: '🔒',
        title: 'Map Lock',
        desc: 'Lock the map to prevent accidental panning and zooming — great for touch screens. Toggle with the lock icon below the zoom controls.',
      },
      {
        icon: '🔗',
        title: 'Clickable QRZ Callsigns',
        desc: 'Callsigns across DX Cluster, POTA, SOTA, PSK Reporter, WSJT-X, and map popups are now clickable links to QRZ.com profiles.',
      },
      {
        icon: '🏆',
        title: 'Contest Calendar Links',
        desc: 'Contest names in the Contests panel now link directly to the WA7BNM contest calendar for rules and details.',
      },
      {
        icon: '🌍',
        title: 'World Copy Replication',
        desc: 'All map markers (DE, DX, POTA, SOTA, DX cluster, WSJT-X, labels) now properly replicate across all three world copies — no more disappearing markers when scrolling east/west.',
      },
      {
        icon: '📻',
        title: 'RBN Firehose Fix',
        desc: 'Reverse Beacon Network spots are no longer lost from telnet buffer overflow. All spots for each DX station are now preserved.',
      },
      {
        icon: '📡',
        title: 'VOACAP Power Reactivity',
        desc: 'The propagation heatmap now updates immediately when you change transmit power or mode — no more stale predictions.',
      },
      {
        icon: '🗺️',
        title: 'PSK Reporter Direction Fix',
        desc: 'Map popups now correctly show the remote station callsign instead of your own for both TX and RX spots.',
      },
    ],
  },
];

const LS_KEY = 'openhamclock_lastSeenVersion';

export default function WhatsNew() {
  const [visible, setVisible] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(null);

  useEffect(() => {
    // Fetch the running version from the server
    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const { version } = await res.json();
        if (!version) return;

        setCurrentVersion(version);

        const lastSeen = localStorage.getItem(LS_KEY);
        // Show if never seen, or if the stored version differs from current
        if (!lastSeen || lastSeen !== version) {
          // Only show if we actually have changelog entries for this version
          const hasEntry = CHANGELOG.some((c) => c.version === version);
          if (hasEntry) {
            setVisible(true);
          } else {
            // No changelog entry — just silently update the stored version
            localStorage.setItem(LS_KEY, version);
          }
        }
      } catch {
        // Silently fail — don't block the app
      }
    };

    // Small delay so it doesn't fight with initial render
    const timer = setTimeout(checkVersion, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Allow external components (e.g. version link in Header) to open the modal
  useEffect(() => {
    const onShow = () => setVisible(true);
    window.addEventListener('openhamclock-show-whatsnew', onShow);
    return () => window.removeEventListener('openhamclock-show-whatsnew', onShow);
  }, []);

  const handleDismiss = () => {
    if (currentVersion) {
      localStorage.setItem(LS_KEY, currentVersion);
    }
    setVisible(false);
  };

  if (!visible || !currentVersion) return null;

  const entry = CHANGELOG.find((c) => c.version === currentVersion) || CHANGELOG[0];
  if (!entry) return null;

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 100000,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary, #1a1a2e)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: '12px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          animation: 'whatsNewSlideIn 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 24px 16px',
            borderBottom: '1px solid var(--border-color, #333)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--accent-cyan, #00ffcc)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            OpenHamClock v{entry.version}
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: '700',
              color: 'var(--text-primary, #e0e0e0)',
            }}
          >
            What's New
          </div>
          <div
            style={{
              fontSize: '13px',
              color: 'var(--text-muted, #888)',
              marginTop: '6px',
            }}
          >
            {entry.heading}
          </div>
          {ANNOUNCEMENT && (
            <div
              style={{
                fontSize: '13px',
                fontWeight: '600',
                color: ANNOUNCEMENT.color,
                marginTop: '12px',
                padding: '10px 14px',
                background: ANNOUNCEMENT.bg,
                borderRadius: '8px',
                border: `1px solid ${ANNOUNCEMENT.border}`,
                lineHeight: '1.5',
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: '18px', display: 'block', marginBottom: '4px' }}>{ANNOUNCEMENT.emoji}</span>
              {ANNOUNCEMENT.text}
            </div>
          )}
          {entry.notice && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--accent-amber, #ffb800)',
                marginTop: '10px',
                padding: '8px 12px',
                background: 'rgba(255, 184, 0, 0.08)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 184, 0, 0.2)',
                lineHeight: '1.5',
              }}
            >
              {entry.notice}
            </div>
          )}
        </div>

        {/* Feature list — scrollable */}
        <div
          style={{
            overflowY: 'auto',
            padding: '16px 24px',
            flex: 1,
          }}
        >
          {entry.features.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '10px 0',
                borderBottom: i < entry.features.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <div
                style={{
                  fontSize: '20px',
                  lineHeight: '28px',
                  flexShrink: 0,
                  width: '28px',
                  textAlign: 'center',
                }}
              >
                {f.icon}
              </div>
              <div>
                <div
                  style={{
                    fontWeight: '600',
                    fontSize: '14px',
                    color: 'var(--text-primary, #e0e0e0)',
                    marginBottom: '3px',
                  }}
                >
                  {f.title}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    lineHeight: '1.5',
                    color: 'var(--text-muted, #999)',
                  }}
                >
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-color, #333)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={handleDismiss}
            style={{
              background: 'var(--accent-cyan, #00ffcc)',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 32px',
              fontSize: '14px',
              fontWeight: '700',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.target.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.target.style.opacity = '1')}
          >
            Got it — 73!
          </button>
        </div>
      </div>

      <style>{`
        @keyframes whatsNewSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
