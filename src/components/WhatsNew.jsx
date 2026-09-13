/**
 * WhatsNew Component
 * Shows a changelog modal on first load of a new version.
 * Stores the last-seen version in localStorage to avoid re-showing.
 */
import { useState, useEffect } from 'react';

// ─── Announcement Banner ────────────────────────────────────
// Set to null to hide. Shown at the top of the What's New modal.
const ANNOUNCEMENT = {
  emoji: '🎁',
  text: "Surprise! Two major releases within a week. We shipped the 3D globe, looked at the calendar, and apparently decided sleep is a suggestion — because here's 26.7.0 with a native logbook, group logging for Field Day, a full Contest Mode, offline support, and a time machine for the map. Nobody planned this. It just... happened. Consider it the September drop and its encore playing on the same night. Tips of the hat this cycle: Anthony (@AntDiClementi), chris_debian for the WCAG contrast audit this release implements, Alan Hargreaves (@alanhargreaves), Michael R Wheeley (@MichaelWheeley), and Jörg (DO1HOZ) for the countries-globe report. 73 from K0CJH — see you at the next first Tuesday, probably.",
  color: '#ffd700',
  bg: 'rgba(255, 215, 0, 0.10)',
  border: 'rgba(255, 215, 0, 0.30)',
};

// ─── Changelog ──────────────────────────────────────────────
// Add new versions at the TOP of this array.
// Each entry: { version, date, heading, features: [...] }
// ─── Versioning ─────────────────────────────────────────────
// Starting with v26.1.1 we adopted a year-based versioning scheme:
//   X.Y.Z  →  X = current year, Y = visual/UI changes, Z = backend changes
//
// Historical note: prior version numbers (v1 through v15) got out of sync at
// one point — we simply continued with the existing numbering rather than
// correcting it mid-stream.
// The jump to v26 resets the scheme to something meaningful going forward.

const CHANGELOG = [
  {
    version: '26.7.4',
    date: '2026-09-12',
    heading: 'One-fix hotfix: the VOACAP antenna you pick now stays picked. Thanks to N3DD for the report.',
    features: [
      {
        icon: '📡',
        title: 'FIX: VOACAP Antenna Choice No Longer Reverts to Isotropic',
        desc: "Choose an antenna in the Propagation panel, save anything in Settings later, refresh — and the antenna was back to Isotropic. The Settings save rebuilt the propagation block from only the two fields it edits (mode and power) and silently dropped the antenna, so the next load filled the gap with the default. It now keeps the existing block and overrides just mode and power. As a belt-and-braces measure for self-hosted installs with settings sync, any change still waiting in the 2-second sync debounce is now pushed on page unload, so a refresh straight after a change can no longer let the server's older copy win. If you already lost your antenna this way you will see Isotropic once more after updating; pick it again and it sticks. Reported by N3DD.",
      },
    ],
  },
  {
    version: '26.7.3',
    date: '2026-09-10',
    heading:
      'Third hotfix of the cycle, and the first with a new feature in it. Two more EmComm reports from Michael (@mbrun-plm), plus a request of his that turned into something every layout gets; a QSO-layer ask from Alan McDonald on Facebook; and a Docker fix from @9M2PJU.',
    features: [
      {
        icon: '🎯',
        title: 'Click a Panel Row to Find It on the Map',
        desc: 'Any station, shelter, gateway, or spot listed in a panel can now pull the map to it. In EmComm mode the EmComm Stations, Nearby Winlink Gateways, and Net Roster rows are clickable (roster entries once an APRS position has been heard), pan the map to the target, and drop a short expanding-ring pulse on it so your eye lands on the right dot in a busy view. In the Dockable layout every spot click you already use — DX Cluster, POTA/SOTA/WWFF, PSK Reporter, MeshCom — now pulses the target and pans to it when it is off-screen; if it is already in view the map stays put. APRS panel rows, which looked clickable but did nothing, now behave like every other panel. Flat map only for now; the Azimuthal and 3D globe projections ignore the request. Requested by @mbrun-plm.',
      },
      {
        icon: '🏷️',
        title: 'Callsign Labels on the Logged-QSO Layers',
        desc: 'A dot at the end of a QSO path said nothing about who you worked, while the DX spots beside it carried callsign pills. Both logged-QSO layers — Logged QSOs (API) and Logged QSOs (N3FJP) — now draw the same style pill beside each contact, in the layer\'s colour (a per-QSO colour sent through the REST API carries into its pill), and N3FJP live-entry previews get a trailing "?" so a half-typed call reads as tentative. The pills follow the map\'s existing Show/Hide Calls button, so one control governs spot and QSO labels alike. Asked for by Alan McDonald on Facebook.',
      },
      {
        icon: '⏱️',
        title: 'FIX: EmComm Station Age No Longer Reads "NaNh ago"',
        desc: 'The EmComm Stations list read a precomputed age that only stations from the server feed carry; beacons arriving over RF from the rig-bridge TNC have just a timestamp, so the maths produced NaN. A shared helper now derives minutes-since-heard from the timestamp and only falls back to the server value when there is no timestamp. The Dockable APRS panel uses it too, so its ages now tick live between polls instead of freezing at fetch time. Reported by @mbrun-plm (#1180).',
      },
      {
        icon: '📋',
        title: 'FIX: EmComm Event Log Comes Back After Clear',
        desc: "Clearing the Event Log left it empty until a page refresh. The log records activity by diffing each feed against what it had already seen, and Clear wiped the stored events but not those snapshots — so only a brand-new station or alert could ever log again. Clear now resets the baselines and re-runs the recording pass immediately: the current stations, alerts, roster, shelter and field reports, and this session's received messages re-log right away, the same result a refresh gave you, minus the reload, so the map keeps its hours of RF-heard beacons. Reported by @mbrun-plm (#1181).",
      },
      {
        icon: '🐳',
        title: 'FIX: Self-Hosted Fonts on Alpine Docker Builds',
        desc: 'The vendor-download script extracted Google Fonts URLs with a Perl-regex grep flag that Alpine\'s BusyBox grep does not have, so container builds silently downloaded zero font files and the "self-hosted" image quietly fell back to Google\'s CDN. It now uses a POSIX extended regex that works on Alpine, Debian, and macOS alike. Thanks @9M2PJU (#1179).',
      },
    ],
  },
  {
    version: '26.7.2',
    date: '2026-09-03',
    heading:
      'Another quick hotfix — two EmComm mode bugs from the same sharp pair of eyes (thanks @mbrun-plm), both cases of the EmComm layout ignoring settings the Dockable layout respects.',
    features: [
      {
        icon: '📻',
        title: 'FIX: EmComm APRS Source Filter Now Filters the Map',
        desc: 'The RF Only / Internet Only / All Sources select in the EmComm Stations panel filtered the station list but not the map — the map quietly received the unfiltered feed, so "RF Only" still plotted every internet station. The select now drives both, on top of any watchlist or group filter you have active.',
      },
      {
        icon: '📍',
        title: 'FIX: EmComm Respects the DE/DX Marker Toggle',
        desc: 'The DE/DX map layer toggle worked everywhere except EmComm mode, where the layout hardcoded the markers on. It now tracks the same setting as every other layout.',
      },
      {
        icon: '🖖',
        title: 'FIX: Trek Theme Header Buttons Readable Again',
        desc: 'Buttons and badges in panel headers kept the light colours they wear on dark panels, which vanished against the bright LCARS pill bars. Plain header text now goes black like a proper LCARS bar, and buttons, selects, and inputs sit in black wells — the cutouts real LCARS consoles have — so their own state colours stay visible.',
      },
    ],
  },
  {
    version: '26.7.1',
    date: '2026-09-02',
    heading:
      'Hotfix drop, two days after 26.7.0 — thank you to everyone who kicked the tires on release day and filed sharp reports. Four fixes straight from the issue tracker, plus one small treat for the 3D globe that was too good to sit on.',
    features: [
      {
        icon: '🌐',
        title: 'FIX: Zones No Longer Vanish Near the Antimeridian',
        desc: 'CQ/ITU zone polygons only drew at their canonical longitudes, so a map centred on VK, ZL, or JA showed zones on half the screen and nothing on the other half — the empty half is a wrapped world copy where vector layers never repeat. Zones and their number labels now draw across three world copies, same as the worked-grids layer always has. Reported by VK3GA.',
      },
      {
        icon: '📡',
        title: 'FIX: PSK Reporter Paths on the 3D Globe',
        desc: 'Live Spots drew its dashed band-coloured paths on the flat and azimuthal maps but not the globe, which showed bare RX/TX dots and nothing else — the paths setting never actually reached the globe renderer, and it had no PSK path drawing at all. The globe now draws DE-to-spot great-circle arcs in band colour, TX solid and RX dashed, and the spot dots take band colour to match the flat map (direction still shows in the hover tooltip).',
      },
      {
        icon: '💾',
        title: 'FIX: Self-Host Updates No Longer Run Out of Memory',
        desc: 'The frontend build needs about 1 GB of heap, but Node sizes its default heap from system memory — on a small Pi or container the cap landed near 256 MB and update.sh died mid-build with a raw V8 crash. The setup and update scripts now request the heap they need, and if the machine genuinely has too little memory you get plain instructions (add a swap file, or build elsewhere and copy dist/ over) instead of a stack trace.',
      },
      {
        icon: '🔔',
        title: 'FIX: Hosted Health Stops Crying Wolf',
        desc: 'The satellite relay health probe marked the hosted service degraded on a single transient upstream timeout and then flipped back ten minutes later, paging the uptime monitor twice for every routine blip. It now requires consecutive failures before declaring trouble — a real outage still trips immediately, a lone hiccup gets noted quietly in the health detail instead.',
      },
      {
        icon: '🛰️',
        title: 'NEW: Satellite Footprint Cones on the Globe',
        desc: "Select a satellite on the 3D globe and its footprint is no longer just a ring on the ground — a translucent cone now connects the bird to the edge of what it can hear, green when it's workable from your QTH. The cone's base shares the exact points of the footprint ring, so the two can never drift apart. Another one from Koen ON9PK (@KoenVdH).",
      },
    ],
  },
  {
    version: '26.7.0',
    date: '2026-09-01',
    heading:
      'Yes, another major release, days after the last one. This one turns OpenHamClock from a dashboard you watch into a station you operate: a native logbook with ADIF import/export, group logging so a whole Field Day site shares one live log, a full Contest Mode with real exchanges, awards tracking from your own QSOs, and offline PWA support. The map learned to time-travel — scrub back through 24 hours of DX spots on the flat map or the 3D globe. Sixteen new dockable panels, four focus layouts, ten new themes, an accessibility pass with WCAG AA contrast on every theme, a built-in manual, and about a hundred other things below.',
    features: [
      {
        icon: '📓',
        title: 'NEW: Native Logbook',
        desc: "A real log, no account needed. QSOs live in your browser's IndexedDB (10k+ contacts, survives reloads), with lossless ADIF import/export, dedup on import, and log-from-spot everywhere — the 📓+ on any cluster or activation row opens a pre-filled entry form, and layouts without a Logbook panel get a small pop-up instead. Rig Bridge prefills frequency and mode from your radio. Log Sync pushes contacts to Wavelog/Cloudlog and QRZ Logbook and pulls LoTW confirmations, all with your own per-browser credentials.",
      },
      {
        icon: '👥',
        title: 'NEW: Group Logging (Field Day Mode)',
        desc: "Run several stations against one shared log. One operator presses Group (Contest layout header or Logbook panel), gets an 8-character invite code, and reads it across the tent; everyone else joins with the code and their callsign. From then on every QSO anyone logs syncs automatically into a merged log showing each contact's operator, who's online, and live cross-station DUPE flags — the contest quick-log shows a GRP DUPE badge naming the operator who already worked the call on that band. Merged ADIF export carries the OPERATOR field; other people's QSOs never enter your personal log unless you import them. Works on the hosted site or a laptop hosting an offline Field Day LAN.",
      },
      {
        icon: '🏆',
        title: 'NEW: Contest Mode',
        desc: 'A dedicated layout built around a keyboard-first quick-log strip: type a call, get an instant DUPE/WORKED/NEW verdict plus new-entity and new-band award flags, fill the exchange, Enter logs it. Nine contests ship with real exchange definitions (CQ WW, ARRL DX, Field Day, Sweepstakes, WPX, and friends) — serials auto-increment, cty.dat autofills zones, and everything lands in the logbook with proper ADIF contest fields. A rate meter, session-scoped multiplier tracker, and session log round out the room. The contest calendar also rebuilt on WA7BNM’s structured iCal feed — no more 20-item cap or December date bugs.',
      },
      {
        icon: '⏪',
        title: 'NEW: History Playback — a Time Machine for the Map',
        desc: 'What was 10m doing at 1800Z? The server now records the DX cluster flow into a rolling 24-hour ring, and a new History Playback layer gives the map a transport control: a timeline slider, a 5–60 minute window, and play/pause at up to 15 minutes per second. Spot paths draw as band-colored great circles, fading as they age out of the window. Works on the flat map and the 3D globe, and both scrub the same shared timeline — pause on one, switch projections, and you’re still parked at the same moment.',
      },
      {
        icon: '🏅',
        title: 'NEW: Awards + Worked-Before Everywhere',
        desc: "DXCC, WAZ, WAS, and VUCC tracked straight from your logbook via a client-side country table — zero API calls. Spots light up with NEW ENTITY (ATNO) and NEW BAND badges, cluster and activation rows show worked-before/DUPE flags from your own log plus N3FJP/N1MM live sessions, and a Worked Grids map layer shades every square you've logged across flat, azimuthal, and globe projections.",
      },
      {
        icon: '📴',
        title: 'NEW: Offline PWA',
        desc: 'Install OpenHamClock to your phone or desktop (Add to Home Screen) and it launches like a native app. A hand-rolled service worker keeps a versioned offline shell with your last-known data, shows an update toast when a new version ships, and stays out of the way otherwise (?nosw escape hatch included).',
      },
      {
        icon: '🧩',
        title: 'Sixteen New Dockable Panels',
        desc: 'Satellite Passes, AMSAT Status, Sun & Moon, Space Weather Trends, Space Weather Alerts, My Signal (RBN), WSPR My Spots, POTA Activator self-spotting, Repeaters (hearham.com directory), Meteor Showers, World Clocks, Stopwatch/Countdown, Frequency Memories, Net Schedule, Callsign Lookup, DX News reader, Solar Cycle chart, Log Stats, Aircraft Nearby, and a Custom Image panel. OK, that’s twenty.',
      },
      {
        icon: '🌍',
        title: '3D Globe Glow-Up',
        desc: "The week-old globe already leveled up: real 3D satellite models (a genuine NASA ISS model, procedural archetypes for the rest), real polar imagery with clean caps on every basemap, Leaflet-grade detail tiles streamed for wherever you're looking, a real moon at its true position showing tonight's actual phase, and overlay parity — radar, lightning, earthquakes, wildfires, aurora, zones, grids, and more all paint on the sphere. The Countries style now renders its filled countries on the globe too (Antarctica included, after a fight with the Mercator projection we won on points).",
      },
      {
        icon: '🎨',
        title: 'Ten New Themes + WCAG AA Contrast Everywhere',
        desc: "Matrix (with the digital rain), 8-Bit (NES dialog chrome, pixel font), Steampunk (brass nameplates, rivets, and a gaslight glow), Midnight, Ember, a Star Trek LCARS theme, and four season themes — Winter, Spring, Summer, and Fall — with snow, blossom petals, fireflies, and tumbling leaves drifting over the interface. The seasons hide easter eggs that only appear on the right days of the year; that's all we're saying — though Trek fans may want to keep an eye on the 3D globe. Alongside the fun: a serious accessibility pass — every theme's text and accent colors now clear WCAG AA contrast, enforced by an automated guard test so an invisible color can never ship again. Retro's palette got real fixes (its cyan was literally identical to its background), keyboard focus rings now show on every control, and band colors auto-darken for text on light panels.",
      },
      {
        icon: '🎯',
        title: 'Four Focus Layouts + Layout Presets',
        desc: 'Single-purpose layouts that configure the whole screen on entry: Activator (POTA self-spotting + your RBN signal), Hunter (activations + worked-before), Weather (hazard layers, no ham clutter), and Air Traffic. Plus named dockable layout presets you can rotate through as scenes, saved profiles that rotate as scenes too, a Ctrl+K command palette, and a full icon redesign replacing chrome emoji with a crisp line-icon system.',
      },
      {
        icon: '🎧',
        title: 'Click-to-Listen on Everything',
        desc: 'The 🎧 on DX cluster rows, every activation row (POTA/SOTA/WWFF/WWBOTA/CANParks), and callsign popups opens a web SDR already tuned to the spot — nearest live KiwiSDR with a free slot, right frequency, right demodulator. Hear the pileup before you commit.',
      },
      {
        icon: '🔔',
        title: 'Alerts That Find You',
        desc: 'Four alert feeds — watchlist hits, contest starts, satellite passes, and band openings (a new detection engine watching RBN + cluster flow) — with per-feed bells, browser notifications, and true Web Push for severe space weather that reaches you even with the browser closed (self-hosted, needs VAPID keys). Lightning proximity alerts wired in too.',
      },
      {
        icon: '🚨',
        title: 'EmComm: Event Log + After Action Reports',
        desc: 'An event log records net check-ins and check-outs, APRS messages, new NWS alerts, shelters, and first-heard EmComm stations automatically, exporting as CSV or a print-ready After Action Report with operator callsign and operation date range. APRS telemetry dashboards and RF-heard shelter merging round it out.',
      },
      {
        icon: '🍁',
        title: 'NEW: CANParks + More Integrations',
        desc: 'CANParks (canparks.ca) joins as a fifth activations program with POTA cross-reference chips. Also: an open REST API so any logger can push QSOs onto your map, a community panel plugin system (drop a .jsx in plugins/local/), a weather source picker (Open-Meteo default or OpenWeatherMap with your key), per-rig mode overrides in Rig Bridge (CW→CW-R, DATA→DIG — thanks Alan), a band plan overlay on the rig frequency display with license-class privilege dimming, one-click full backup/restore with profile share codes, and a 10W QRP preset.',
      },
      {
        icon: '❓',
        title: 'A Real Manual, Built In',
        desc: 'A complete user manual now ships inside the app — Settings → Help renders it with a searchable table of contents, and every panel, layer, and settings tab grew a ? that deep-links to its section. Works offline. The docs got a full overhaul to match: quickstart guide, refreshed contributor docs, and a README cut from 1,500 lines to 290.',
      },
      {
        icon: '🩺',
        title: 'Fixes & Hardening',
        desc: "Satellite pipeline release-day resilience (a boot-time hiccup no longer costs a two-hour recovery window, and health checks now see through a live-but-failing relay), RBN checks local spot caches before QRZ so portable operators map at their operating location (thanks Alan), the DX-World news feed survived a Cloudflare tarpit, Windows checkouts no longer break the manual's tests (thanks Michael), the 8-bit theme fits its own menus, and the contest calendar, callsign popups, aircraft overlay, and about forty other things got straightened out along the way.",
      },
    ],
  },
  {
    version: '26.6.0',
    date: '2026-09-01',
    heading:
      "September monthly drop, and it's a big one: OpenHamClock has a 3D globe. A third projection joins Flat and Azimuthal — a true three-dimensional Earth with great-circle arcs, a live day/night terminator, and satellites orbiting at real altitude, engineered carefully enough to run on a Raspberry Pi. Elsewhere: CARTO abruptly started watermarking the Dark and Streets basemaps mid-cycle, so both moved to Esri sources that need no key (with an opt-in path back). The 630m crowd gets WSPR and RBN support, PSK Reporter gains a Band Activity view, EME operators get moon pointing data, Yaesu rigs now band-switch properly when you click a spot, and the DX cluster pipeline got a deep rework so SSB and CW spots survive the FT8 flood. Plus FreeBSD support, per-user callbook credentials on shared instances, and a server hardening pass for the hosted site.",
    features: [
      {
        icon: '🌍',
        title: 'NEW: 3D Globe Projection',
        desc: "The projection toggle is now Flat · Azimuthal · 3D. The globe renders with WebGL: true great-circle arcs (no antimeridian tricks needed — they're actual arcs in space), a day/night terminator computed in a shader from the real subsolar point, and your DX cluster spots, POTA/WWFF/SOTA/WWBOTA activations, PSKReporter, and WSJT-X traffic all carried over. Satellites render natively at orbital altitude with their ground tracks and footprint rings, complete with the telemetry window and pass-prediction modal. It auto-rotates until you grab it, follows your QTH, respects the night-darkness slider (shared with the flat map), and — after a dedicated performance pass — renders only when something actually changes, so a motionless globe costs a Pi almost nothing. The three.js engine loads only when you first click 3D, so nobody else pays the download. Built by Koen (ON9PK) across three review rounds, from first pitch to polished feature in under two weeks.",
      },
      {
        icon: '🗺️',
        title: 'Dark & Streets Basemaps Moved to Esri (CARTO Now Requires a Key)',
        desc: "On August 26 CARTO began stamping 'API KEY REQUIRED' watermarks across their free raster tiles — the source behind our default Dark style and Streets — and their raster service is headed for retirement entirely. Both styles now default to Esri equivalents (World Dark Gray for Dark, World Street Map for Streets) that need no key and load reliably. The now-redundant Dark (Esri) and Political entries were folded in, and saved configurations migrate automatically. Prefer the original CARTO look? They hand out free keys good for 5M tiles/month at carto.com/basemaps/apikey — paste yours into Settings → Integrations → CARTO Basemap Key and Dark and Streets switch back, localized labels included. The key stays in your browser only: it is never synced to the server or shared with other users of the instance. Thanks AF1E for the same-day bug report.",
      },
      {
        icon: '📻',
        title: 'NEW: 630m WSPR + RBN Support (Opt-In)',
        desc: "The 472 kHz crowd is no longer invisible. Enable 630m in the WSPR filter panel and the band appears across WSPR heatmaps, RBN spots, band filters, and the activity heatmap, with its own band color and per-band path rendering. It's opt-in and off by default so the HF-only majority sees no change, the 630m data source gets its own failure isolation so an outage there can't stall regular WSPR, and the stats panel notes when the 630m feed is running behind real time. Thanks Anthony (AntDiClementi) for a patient, well-tested build.",
      },
      {
        icon: '📊',
        title: 'NEW: PSK Reporter Band Activity',
        desc: 'A new Band Activity overlay and dockable panel summarize what PSK Reporter is hearing per band at a glance — which bands are alive right now, without counting dots on the map yourself. Thanks Laura (lbatalha). FT2 also joined the mode filtering options across the app.',
      },
      {
        icon: '🌙',
        title: 'NEW: EME Moon Pointing',
        desc: 'Moonbounce operators get real pointing data computed from your DE grid: lunar azimuth and elevation, rise and set times, and current Earth-Moon distance — the numbers you need to know whether the moon window is open before you swing the array.',
      },
      {
        icon: '🎛️',
        title: 'Yaesu Rigs: Real Band Changes on Spot Clicks',
        desc: "Clicking a spot on a new band used to move a Yaesu's VFO without telling the radio the band changed — so band-specific settings like ATU memories, antenna selection, and gain stayed configured for the old band. Rig Bridge now issues the proper band-select command first, preserves your operating mode across the change (the radio's stored band mode no longer clobbers a CW-to-CW or FT8-to-FT8 hop), resolves generic SSB to the correct sideband for the target frequency, and leaves out-of-band frequencies like WWV alone. Built and verified on-air by Koen (ON9PK).",
      },
      {
        icon: '🌐',
        title: 'DX Cluster Pipeline — SSB and CW Survive the FT8 Flood',
        desc: 'The OHC Cluster node introduced last release got a deep rework of what flows through it. Spot volume is now balanced across modes at every stage of the pipeline, so a wall of FT8 can no longer push every SSB and CW spot out of the panel. The node also ingests POTA, SOTA, WWFF, Parks n Peaks, and DX Summit human spots alongside RBN, collapses re-spots of the same station into one row, filters busted calls at the store, holds a full hour of history, and enriches locations for entire batches instead of the first hundred. Direct DX Spider connections switched to persistent sessions instead of poll-and-disconnect churn, and stale self-hosted installs that hammer retired nodes now get parked with a polite nudge to update.',
      },
      {
        icon: '🔑',
        title: 'Per-User Callbook Credentials on Shared Instances',
        desc: 'On multi-user installs (including the hosted site), QRZ and HamQTH logins are now per-user instead of shared instance-wide — your XML subscription is yours. Credential storage keys are derived with scrypt so one user’s callbook login is never visible to another.',
      },
      {
        icon: '🖥️',
        title: 'FreeBSD Support + One Setup Script',
        desc: "The setup script now natively supports FreeBSD — proper pkg install guidance, BSD-compatible sed, and a graceful rc.d note instead of assuming systemd — and was renamed to setup.sh to reflect that it long ago outgrew 'Linux'. The old setup-linux.sh URL keeps working through a compatibility shim, so every install one-liner in old forum posts and videos still functions. Malay translations also got a refresh. Thanks 9M2PJU for all of it, and Michael Wheeley for the Thai and German updates.",
      },
      {
        icon: '🩺',
        title: 'Hosted-Site Hardening — Stampedes, Death Spirals, and 429s',
        desc: 'A production incident cycle turned into a resilience pass: hot upstream data paths are now stampede-proof (one fetch per expiring cache entry, not one per waiting user), the solar imagery fetch can no longer enter a thundering-herd death spiral, and a rate-limited presence heartbeat no longer freezes every other API call the app makes. The news ticker stopped letting future-dated NG3K entries monopolize rotation, the DXpedition calendar now shows real operating callsigns with correct years and modes, and cty.dat fetches retry with exponential backoff (thanks 9M2PJU). RBN callsign lookups got proper URL encoding — thanks Alan Hargreaves.',
      },
      {
        icon: '🛰️',
        title: 'Satellite Pipeline Cleanups',
        desc: 'The AMSAT fallback no longer duplicates satellites in the cache, backup TLE sources (AMSAT, SatNOGS) can be individually disabled via .env flags for self-hosters who want a single source of truth (thanks Michael Wheeley), TLE responses carry explicit edge-cache TTLs so CDN staleness is bounded, and both satellite telemetry windows — 2D and 3D — now render from one shared derivation so they can never disagree about a pass again (thanks Koen).',
      },
      {
        icon: '🔧',
        title: 'Assorted Fixes',
        desc: "The Propagation panel's P.533 WASM engine no longer refuses to start on plain-HTTP self-hosted installs. The band legend stays visible when DX spots are hidden. The satellite info panel minimizes to a compact icon. Activity layer colors (POTA/WWFF/SOTA/WWBOTA) are now identical across all three projections, sourced from one shared palette. And Docker deployments no longer collide on a hardcoded container name.",
      },
    ],
  },
  {
    version: '26.5.0',
    date: '2026-07-08',
    heading:
      "July monthly drop. Two headline accuracy fixes came straight from user emails this cycle: FT8 and the other digital modes finally get honest VOACAP predictions (the engine now runs at each mode's real decode threshold instead of faking it after the fact), and the Kp index now tracks NOAA's 1-minute estimated product instead of lagging up to 3 hours behind real geomagnetic conditions. Headline additions: full N3FJP integration configured right from Settings (with the logged-QSO 0,0 bug fixed), a callsign info popup with station details and local time anywhere a call appears, our own DX cluster node (OHC Cluster) now serving the hosted site, Simplified Chinese joins the language picker, and a map style rotator for shack displays. Self-hosters get a big one too: local builds now actually ship the P.533 WASM engine, so the Propagation panel runs the real model instead of being stuck on the EST heuristic. Plus round two of the accessibility push, a hardened satellite data pipeline, a Windows install/update overhaul, and Prometheus metrics for the ops-minded.",
    features: [
      {
        icon: '📡',
        title: 'HOTFIX: FT8 / Digital Mode VOACAP Predictions Were Way Off',
        desc: "Jason (W3AAX) emailed exactly the right diagnosis: switching the Propagation panel to FT8 produced drastically restricted coverage regardless of power, while SSB looked accurate. Root cause confirmed — every prediction ran the P.533 engine at the SSB listening threshold, then tried to bolt the FT8 advantage on afterwards as a post-hoc dB bump on the reliability number. That bump could never reopen a band the engine had scored 0% for SSB, which is precisely where FT8 shines. The engine (browser WASM and the REST service both) now runs at each mode's actual decode threshold — FT8 at -19 dB, FT4 -15, WSPR -26, JT65 -23, CW +5, relative to the same 3 kHz reference — so the physics happens inside the model. Verified against real paths: Atlanta→Tokyo at noon on 15m goes from 0% (SSB) to 67% (FT8), matching on-air reality. SSB predictions are bit-identical to before.",
      },
      {
        icon: '📻',
        title: 'NEW: N3FJP Integration — Configure from Settings, 0,0 Bug Fixed',
        desc: "If you log with N3FJP, the integration is now fully built in. The bridge script ships with OpenHamClock and the server manages it for you — enter your N3FJP host and port in Settings → Integrations, hit test, and QSOs and live entry previews flow onto the map. The long-standing bug where logged QSOs landed at 0,0 (or at N3FJP's New-England placeholder coordinates when it hadn't resolved a real location) is fixed: placeholder coordinates are intercepted and the real grid lookup runs instead, and an active preview line is reused for the logged QSO so the map doesn't stutter. The configuration endpoint honors the server's write-auth key on shared instances. Built by Ben (KC1UEK) across several patient review rounds — thanks Ben.",
      },
      {
        icon: '📊',
        title: 'Real-Time Kp Index',
        desc: "Manuel (EA7JRS) wrote in that the propagation console values didn't reflect current conditions — and he was right. The displayed Kp came from NOAA's observed 3-hourly product, so it only moved every 3 hours no matter how often the panel refreshed. Current Kp now comes from NOAA's 1-minute estimated planetary K-index, with the 3-hourly product still driving the history bars and forecast. During fast-moving geomagnetic events the console now reacts in minutes, not hours.",
      },
      {
        icon: '🔍',
        title: 'NEW: Callsign Info Popup',
        desc: "Click a callsign in the DX Cluster panel or map popups and you now get an inline station card — name, QTH with grid and local time at the DX end, country, and a one-click jump to your configured callbook — instead of bouncing straight out to a browser tab. Lookups run through HamQTH's authenticated API with local caching so repeat lookups are instant, and DXCC data moved to the JSON endpoints. The DX target section also gained a callsign lookup input (issue #1036): type a call, get its location as your DX target. Thanks Laura (lbatalha) and Jörg (ceotjoe).",
      },
      {
        icon: '🌐',
        title: 'NEW: OHC Cluster — Our Own DX Cluster Node',
        desc: 'OpenHamClock now runs its own DX cluster node, and the hosted site is connected to it. This ends our dependence on the goodwill of public DXSpider nodes for the shared instance — which had produced several rounds of reconnect-storm and login-hammering incidents when upstream nodes went sideways. Custom cluster logins in Settings are now fully independent of the OHC node, custom sessions are hardened against reconnect storms and invalid-login loops, and permanently dead nodes get parked instead of being retried forever. Self-hosters can keep using any node they like.',
      },
      {
        icon: '🌏',
        title: 'NEW: Simplified Chinese (简体中文)',
        desc: 'Simplified Chinese is now selectable in the language picker, joining the 15 existing languages. The translation file had been contributed earlier but was never wired into the language registry — it now is, covering the full UI. 谢谢 Anthony (AntDiClementi) for the contribution.',
      },
      {
        icon: '🗺️',
        title: 'NEW: Map Style Rotation + Earthquake Magnitude Filter',
        desc: 'Two map additions. A new rotation control cycles your base map through a set of styles you pick, on your chosen interval (default 60s) — nice for wall-mounted shack displays that get boring on one basemap; your selection and interval persist. And the Earthquakes layer gained a magnitude selector so you can hide the magnitude-2 noise and only plot the quakes you care about. Thanks Anthony (AnthonyOHC) and Michael Wheeley. Azimuthal projection tiles also render noticeably sharper this cycle.',
      },
      {
        icon: '📋',
        title: 'DX Cluster Panel — Send Spots, Contest + DXpedition Filters',
        desc: 'You can now spot a station directly from the DX Cluster panel — no separate telnet session needed. Filtering gained two new tools: a contest filter, and a one-click "Show only DXpeditions" toggle that cross-references the DXpedition calendar so you only see the ATNOs. Panel button styling was also aligned with the rest of the app and a couple of filter color bugs fixed.',
      },
      {
        icon: '♿',
        title: 'Accessibility — Round Two',
        desc: 'The Map Data text view introduced last cycle is now localized into all 16 languages and expanded with v2 sections for lightning, aircraft, aurora, and Winlink gateways. New aria-live announcements cover DX spot arrivals, lightning proximity alerts, satellite rise/set events, band conditions changes, DE weather alerts, and rig connect/disconnect/mode changes — a screen-reader user now hears the shack come alive without touching the map. A WCAG 2.1 AA compliance pass cleaned up contrast and semantics app-wide, and icon-only buttons got their hover tooltips back alongside the aria-labels. Thanks chrisdebian and w9fyi for carrying this one.',
      },
      {
        icon: '🛰️',
        title: 'Satellite Data Pipeline — Hardened End to End',
        desc: 'Continuing from June\'s fallback work: the satellite data path got a full refactor around a proper TLE state machine with unit tests, a new lightweight HTTP relay service ("fletcher") for deployments whose egress IPs CelesTrak blocks, the OMM cache extended from 12 to 24 hours to match NORAD\'s actual release cadence, SatNOGS transmitter metadata added for the birds that have it, and a bug fixed where the AMSAT fallback could duplicate satellites in the cache. New .env flags (AMSAT_TLE_ENABLED / SATNOGS_TLE_ENABLED) let you disable individual backup sources if you need to. Also fixed: the satellite window minimize button crash. Thanks Michael Wheeley for the sustained push here.',
      },
      {
        icon: '🪟',
        title: 'Windows Install + Update Overhaul',
        desc: 'Windows self-hosting got real attention. update.bat is replaced by a proper update.ps1, the setup scripts parse cleanly on stock PowerShell 5.1 (here-strings and non-ASCII characters removed), the README documents a one-line iwr install, and the launcher creation is fixed. If a previous Windows install failed partway for you, this cycle is worth a retry. Thanks Jörg (ceotjoe).',
      },
      {
        icon: '⚡',
        title: 'Propagation WASM — Self-Hosters Get the Real Engine',
        desc: "If your self-hosted Propagation panel always showed the EST badge, this was why: local builds didn't include the P.533 WASM bundle at all, so the panel silently fell back to the heuristic forever. Builds now ship the engine. Related polish: the panel waits for WASM instead of flashing EST numbers first, the console states the reason plainly when WASM genuinely can't load, the WASM downloader is now a cross-platform Node script with checksum verification that skips the multi-megabyte download entirely when files are already current, and your antenna selection persists across restarts (a config deep-merge bug was resetting it). Thanks Michael Wheeley for the checksum work.",
      },
      {
        icon: '📈',
        title: 'Observability — Prometheus Metrics + External Watchtower',
        desc: "For the ops-minded self-hoster: the server now exposes an authenticated Prometheus /metrics endpoint with automatic route monitoring, careful cardinality limits, and README documentation. The hosted infrastructure gained an external Cloudflare Worker watchtower that probes all OHC services from outside, posts up/down flips to Discord with a log tail attached, and debounces flapping. /api/health grew a subsystem snapshot for exactly this kind of monitoring and is now exempt from rate limiting so uptime monitors don't get 429s. Thanks Laura (lbatalha) — the most prolific contributor this cycle.",
      },
      {
        icon: '🔒',
        title: 'Security + Dependency Updates',
        desc: 'A critical vitest advisory (GHSA-5xrq-8626-4rwp) closed by upgrading to vitest 4, the qs null-entry DoS vulnerability patched, and all six outstanding Dependabot alerts resolved via a lockfile refresh. The new metrics endpoint requires authentication out of the box, and unknown API routes are bucketed to keep metrics cardinality bounded. Thanks chrisdebian and Michael Wheeley.',
      },
      {
        icon: '🐛',
        title: 'Grab Bag Fixes',
        desc: "The band legend no longer disappears when DX Spots are hidden. Floating windows stop drifting when snapped (and stop drifting in Firefox, full stop) — thanks Jörg. The WSPR tab no longer stays selected after it's hidden. APRS endpoints aren't polled when nothing is using APRS. Contest listings replace a dead source and gained links to each contest's page. setup-pi detects Wayland vs X11 kiosk session type at install time (#1026) — fixes black-screen kiosks on Raspberry Pi OS Trixie. PSK Reporter style fixes, visitor stats are correct behind Cloudflare, and grid-square popups in the DX Cluster panel carry proper location data.",
      },
    ],
  },
  {
    version: '26.4.1',
    date: '2026-06-02',
    heading:
      'June monthly drop, and a big one — plus a same-day hotfix at the bottom. Headline additions: a live aircraft tracking layer powered by adsb.lol, a worldwide ATC sector overlay with around 1,000 FIRs, accurate DX-target local time using real IANA timezones (with a graceful solar-time fallback when offline), and a non-map text-list panel for screen-reader and low-vision users covering DX, satellites, and POTA/SOTA/WWFF/WWBOTA activations. The long-running VOACAP propagation accuracy issue — the "vertical line through China/Russia" that several users reported — is finally fixed at the root: the antimeridian patch in the midpoint code was making adjacent cells disagree by 178° of midLon, replaced now with a proper great-circle midpoint. On the reliability side: SmartSDR PTT/MOX is detected for the first time, the Cloud Relay auth retry storm is contained, the DX Cluster proxy stays connected through quiet bands, and satellite math only runs for the birds you actually have selected. Plus a substantial accessibility push — every tab strip now follows the W3C tablist pattern with arrow-key navigation, spot lists are announced as tables, status changes go through aria-live regions, and there\'s a non-map alternative view of the map data. The same-day v26.4.1 hotfix restored the AMSAT and SatNOGS satellite fallback sources that v26.4.0 inadvertently dropped — see the last item below.',
    features: [
      {
        icon: '✈️',
        title: 'NEW: Live Aircraft Tracking Layer',
        desc: 'A new map layer plots civilian aircraft worldwide from adsb.lol — free, no auth, no quota, global coverage in one shot. Heading-rotated SVG plane icons with a 30-second server-side cache shared across all users, viewport-filtered on the client (400 marker cap, 80 in low-memory mode), and rich popups showing aircraft type, full description, operator, registration, altitude (ft) and speed (kn). Originally launched on OpenSky Network but their 400/day anonymous quota was unworkable on Railway shared egress, so we swapped to adsb.lol for the production layer. Toggle from the layer panel.',
      },
      {
        icon: '🛩️',
        title: 'NEW: ATC Sectors Layer',
        desc: 'Shortcut key z, default off, opacity 0.45. Lazily fetches the VATSPY-data community boundaries (about 1,000 FIRs worldwide) plus VATSpy.dat metadata for name lookup, cached server-side for 7 days and shared across all users. Popup shows the FIR name, primary Center frequency where curated (US ARTCCs, Canadian ACCs, major EU + AP centers all included inline as easy PR drop-ins), plus a LiveATC.net deep link for the full per-facility list. The sector nearest your DE location is highlighted in orange. Great for matching what you hear on HF to who has the airspace right now.',
      },
      {
        icon: '🕒',
        title: 'NEW: Accurate DX Target Local Time',
        desc: "The DX panel's local time was previously approximated from longitude (UTC ± lon/15), which gets things like Manila or Perth visibly wrong because their civil timezones don't line up with their meridian. There's now a real IANA timezone lookup via a new /api/geo-time endpoint backed by the geo-tz 1970-data product, so the DX clock displays civil time correctly worldwide. If the server is unreachable the panel falls back to the old solar approximation and shows a small ⚠ marker next to the timezone so you know you're looking at fallback data. The toggle between UTC and local is now a real button (keyboard-focusable and screen-reader friendly). Thanks Laura (lbatalha) and Michael Wheeley for the catch.",
      },
      {
        icon: '👁️‍🗨️',
        title: 'NEW: Non-Map Text View Panel',
        desc: 'A first-pass alternative view of the map data, intended for screen-reader and low-vision users who can\'t make sense of the visual map. Lists DX spots, satellites currently overhead (filtered to those above the horizon, sorted by elevation), and combined POTA/SOTA/WWFF/WWBOTA activations as real tables with proper semantic markup. Bearing and distance are computed against your station, and numeric cells are expanded into English for screen readers ("bearing 320 degrees NW, 10,750 km", "next pass in 12 minutes"). Available from the panel picker in the Dockable layout as "Map Data (text view)". Aircraft, lightning, aurora, and Winlink gateway integration is on the roadmap as v2 — let us know if cadence or wording can be improved.',
      },
      {
        icon: '📡',
        title: 'NEW: N3FJP Live Entry Previews',
        desc: "If you log with N3FJP, OpenHamClock now plots the call you're currently typing in the entry window as a live preview marker on the map — dashed arc, larger marker, in your chosen preview color — without waiting for you to hit Log. The DX crosshair follows the previewed call so you can confirm the bearing and distance before committing the QSO. Previews self-expire after 5 minutes if you walk away. New Preview color picker in Settings → Integrations. Built from a working prototype by Ben (KC1UEK) — thanks Ben.",
      },
      {
        icon: '♿',
        title: 'Accessibility — Big Push This Cycle',
        desc: 'Every tab strip in the app (Settings, MeshCom, POTA/SOTA, DX/Activate/PSK filters, PSK Reporter) now follows the W3C ARIA tablist pattern with arrow / Home / End keyboard navigation and a roving tab-index so Tab key skips inactive tabs. Spot lists in DX Cluster, Activate, and PSK Reporter are announced as proper tables with column headers and expanded English labels for frequency, age, mode and SNR cells. Status changes (NWS weather alerts, lightning proximity, WSJT-X connection state) go through aria-live regions. A global :focus-visible outline makes keyboard focus obvious. ContestPanel and DX-local-time clickable spans were converted to real buttons. First pass — explicitly calling for screen-reader testers in the umbrella issue.',
      },
      {
        icon: '📋',
        title: 'DX Cluster — Mode Column + Sort Selector',
        desc: 'The DX Cluster panel now shows the Mode column the README has long promised. Mode is pulled from the spot comment when a recognized keyword is present (FT8, CW, SSB, RTTY, PSK and friends), otherwise inferred from frequency against band-plan sub-bands plus FT8/FT4 digital-mode islands; inferred values render italic and muted with a tooltip explaining the source. The Activate and DX Cluster panels also gained a Time / Freq / Call sort selector in the header so you can re-order without leaving the panel. A small "de" pill collapses the column grid by hiding the spotter to double spot density when you want it tighter.',
      },
      {
        icon: '📊',
        title: 'X-Ray Flux History + Selectable PSK Retention',
        desc: 'The X-Ray Flux panel has a new 6 / 12 / 24 / 48 hour history selector and the peak rating recalculates per window. The PSK Reporter panel header gained a 2 / 5 / 10 / 15 minute retention dropdown — useful for pseudo-beacon use cases where you want a shorter window than the previous 15-minute default. Both choices persist to localStorage. PSK retention changes signal across the app so the panel list and the map dots stay in sync. Thanks K3JZD and HoserRob.',
      },
      {
        icon: '🔍',
        title: 'Settings — Callsign Lookup Picker',
        desc: 'Station Settings now has a Callsign Lookup dropdown letting you pick QRZ.com, HamQTH, or QRZCQ as the destination when you click a callsign anywhere in OpenHamClock. Both callsign-click paths (callsign links and the QRZ toggle in the header) route through it. Default remains QRZ.com. Thanks Laura (lbatalha).',
      },
      {
        icon: '🛰️',
        title: 'Satellites — Performance + Hide-UI Fix',
        desc: "Position, orbit, and footprint math now only runs for the satellites you've actually selected in Settings (the common case), not the full tracked list — meaningful CPU savings on Raspberry Pi and lower-end devices. The minimized satellite info dialog now actually expands back out cleanly. The satellite status box now respects the Hide UI toggle (the box is appended to the map container, not the Leaflet control container, so it was being missed by the original UI-hide rule). Plus the latest OMM data-product refresh with active ham birds (AO-123, SO-125, QMR-KWT-2) and current weather satellites.",
      },
      {
        icon: '🐛',
        title: 'HOTFIX: VOACAP Propagation Accuracy (the real root cause)',
        desc: "Several users reported a perfectly straight vertical line through China and Russia where adjacent cells suddenly disagreed on propagation. After multiple cosmetic rounds (alpha taper, 3×3 spatial blur — both kept as defensive smoothing), the actual bug turned out to be in the server's midpoint code: midLon was computed as a longitude average with a sloppy antimeridian patch that, for a DE in the Americas, flipped at exactly lon=106 for every latitude and produced a 178° midLon jump between adjacent cells — which fed wildly different solar zenith and ionospheric inputs into MUF/LUF on either side of an arbitrary geographic line. Replaced with a proper great-circle midpoint (continuous everywhere, short-path automatically). Affects /api/propagation, /api/propagation/heatmap, /api/propagation/mufmap. Separately, the azimuthal projection now subdivides each propagation cell into a 20-vertex polygon so rectangles in lat/lon actually curve correctly on the disc instead of rendering blocky and distorted near the antipode.",
      },
      {
        icon: '🐛',
        title: 'DX Cluster — Proxy Reliability + HamQTH Fallback',
        desc: 'Two fixes after an 18-hour proxy log triage: (1) the DXSpider proxy used to disconnect during quiet overnight bands because its 60-second socket timeout was shorter than the upstream keepalive — increased the timeout to 5 minutes, tightened keepalive to 60 seconds, and we now destroy zombie sockets so the activity watchdog can actually own failover. Auth detection was also missing because the DXSpider login prompt has no trailing newline; we now mark the session authenticated on the first spot received. (2) The /api/dxcluster/paths endpoint had one AbortController shared between the proxy fetch and the HamQTH fallback fetch, so when the proxy hung to its timeout the fallback ran with an already-aborted signal and rejected instantly. Each upstream now gets its own controller.',
      },
      {
        icon: '🐛',
        title: 'Rig-Bridge Cloud Relay — Auth Storm + SmartSDR PTT',
        desc: 'Two rig-bridge fixes. The Cloud Relay client now permanently halts its push timer, long-poll loop, and immediate-push timer on a 401/403 instead of retrying 1-2 times per second forever, with a clear user-facing instruction to re-run Connect Cloud Relay and restart rig-bridge. The corresponding server warnings are rate-limited to once per 5 minutes per session ID prefix, and the rate-limit map is now pruned on the existing 5-minute cleanup pass so it can\'t grow unbounded. Separately, the SmartSDR plugin now subscribes to "radio all" to receive the interlock state object, which is where the FlexRadio API actually reports live transmit state — so MOX/PTT is detected for the first time and the On Air indicator switches RX → TX when you key up. Thanks Jörg (ceotjoe) and k0otc.',
      },
      {
        icon: '🐳',
        title: 'Docker / GHCR + Security Bumps',
        desc: 'Docker workflows split into three per-image workflows (openhamclock, dxspider-proxy, iturhfprop-service) so the two microservices now publish their own GHCR images — users no longer have to clone-and-build the helpers, they can pull ghcr.io/accius/openhamclock/dxspider-proxy and /iturhfprop-service directly. Container docs centralized in docs/DOCKER.md with the new pull URLs. Thanks Laura (lbatalha). Dependabot security alerts cleaned up in the same window: axios 1.15→1.16 (prototype pollution / MITM / proxy bypass), ws 8.19→8.21 (uninitialized memory disclosure), express 4.22.1→4.22.2 + qs + body-parser (DoS via null entries in comma-format arrays), and tmp 0.2.5→0.2.7 (path traversal in dev tooling).',
      },
      {
        icon: '🛰️',
        title: 'v26.4.1 HOTFIX: Restore AMSAT + SatNOGS Satellite Fallback Sources',
        desc: 'The v26.4.0 OMM rewrite consolidated to CelesTrak and Space-Track only, dropping the AMSAT and SatNOGS feeds that v26.3.3 used. When the hosted production server deployed on 2026-06-02, its Railway egress IPs were silently dropped at the TCP level by CelesTrak (the same intermittent block that has hit cloud hosts before) and with no alternate sources, zero satellites resolved for hosted users. Self-hosted installs were unaffected because their home or LAN IPs reach CelesTrak fine. The v26.4.1 hotfix ships a new server-side TLE-to-OMM converter (server/utils/tle-to-omm.js) that lets the OMM resolver consume the AMSAT nasabare.txt bulk feed plus per-NORAD SatNOGS DB lookups, wired in as state-machine fallback stages that activate when CelesTrak times out or is unreachable. AMSAT covers the 23 amateur sats; SatNOGS picks up the remaining 17 (weather plus active). Self-hosted installs benefit too — the resolver now has three independent upstreams instead of one.',
      },
    ],
  },
  {
    version: '26.3.3',
    date: '2026-05-12',
    heading:
      'Mid-week follow-up release before Hamvention. Headline addition: a new Band Activity heatmap dockable panel. Also new: a user-selectable monospace font in Settings, and a one-click clear-all button in the PSK Reporter panel. On the fix side: a TV-standby workaround so scheduled-sleep installs stay awake on HDMI, a correction to N1MM UDP spot-line direction, localized "VISIBLE" badge text in the satellite prediction table, and a substantial overhaul of the satellite TLE resolver that was occasionally stranding ISS and a handful of other birds in the cache for hours at a time.',
    features: [
      {
        icon: '📊',
        title: 'NEW: Band Activity Heatmap Panel',
        desc: "A new dockable panel modeled on DX-Heat's Band Activity matrix. It plots a continent×band grid with gaussian-blurred SVG heatmap blobs over the last 15, 30, or 60 minutes of DX-cluster spots, so you can see where the bands are alive at a glance. The 'Your continent' picker defaults to whichever continent your callsign belongs to (looked up against the DXCC table) and your override is persisted to localStorage. Open it from the panel picker in any layout — it's not in the default layout yet, but you can drag it in wherever it makes sense.",
      },
      {
        icon: '🔤',
        title: 'NEW: Customizable Monospace Font',
        desc: 'Settings → Display now lets you pick the monospace font used across the app — JetBrains Mono (the default, dotted 0), Fira Code (slashed 0), or IBM Plex Mono (slashed 0, slightly wider). One CSS variable drives every monospace surface in the project. Self-hosted users: rerun vendor-download.sh once after this update to fetch the Fira Code and IBM Plex Mono font files, otherwise the new picker falls back to whatever system monospace your browser chooses.',
      },
      {
        icon: '🧹',
        title: 'PSK Reporter — One-Click Clear All Spots',
        desc: "The PSK Reporter panel header now has a small trash-can button that wipes all TX and RX spots from local state. Useful when you change bands or rigs and don't want stale dots cluttering the map. Translated into all 16 languages.",
      },
      {
        icon: '📺',
        title: 'Display Schedule — TV-Standby Workaround',
        desc: "If you use the Display Schedule feature to schedule the screen to sleep at night, some TVs latched into standby when the OS dropped the HDMI signal and wouldn't come back when the schedule ended. There's now a 'Keep display signal active during sleep' checkbox (default on, in Settings → Display Schedule) that holds the wake lock through the whole sleep window. The TV stays awake but you only see the black overlay you'd see anyway — the signal never drops, so the TV never goes to standby. Opt out if you actually do want the monitor to power down.",
      },
      {
        icon: '🛰️',
        title: 'Satellite TLE Resolver — Reliability Fix',
        desc: "Some users intermittently saw ISS, SO-50, AO-91, and a handful of weather geo satellites disappear from the satellite layer for hours at a time. Root cause: when CelesTrak rate-limited us, the resolver poisoned its 12-hour cache with a partial result. The resolver now uses gentler parallelism, won't overwrite a healthy cache with a materially worse one, deduplicates concurrent refresh attempts, and serves the existing cache immediately while refreshing in the background — so a slow upstream fetch can't translate into a blank satellite layer for end users. Reported by Alan.",
      },
      {
        icon: '🐛',
        title: 'DX Cluster — N1MM UDP Spot Lines Were Pointing the Wrong Way',
        desc: "If you were receiving spot announcements from N1MM via UDP, the great-circle line was drawing DX → your station instead of DX → the spotter (who actually heard the DX). An April change had added a fallback that filled in your own grid square when the spotter's grid wasn't present, which was wrong for any spot that wasn't a self-spot. The fallback is now restricted to self-spots only, so non-self spots draw from DX to the real spotter as expected. Reported by VK3GA.",
      },
      {
        icon: '🌍',
        title: 'Satellite Layer — Localized "VISIBLE" Badge',
        desc: 'The satellite prediction table\'s green "VISIBLE" badge that lights up during a pass was hardcoded in English. It now reads from the language table along with the rest of the satellite UI, with new translations added across all 16 languages. Thanks Michael Wheeley.',
      },
      {
        icon: '📱',
        title: "What's New — OK Button Reachable on Mobile",
        desc: "The What's New modal on iOS Safari and some Android browsers had the OK button sitting just below the visible area with no way to scroll to it. Switched the height units from vh to svh (small viewport height, which excludes the browser toolbar) and enabled iOS momentum scrolling inside the modal. The OK button is now always reachable. Thanks Jörg (DO1HOZ).",
      },
      {
        icon: '📐',
        title: 'Grid Square Display Fix',
        desc: 'A small regression where the grid-square display was being passed a bare lat/lon pair instead of a location object — the field would render blank in certain layouts. Now passes the proper object so Maidenhead computes correctly. Thanks Jörg (DO1HOZ).',
      },
      {
        icon: '🔧',
        title: 'Rotator — Configuration Cleanup',
        desc: "Two dead environment variables (ROTATOR_HOST and ROTATOR_PORT) that were exported but never read by the rotator code have been removed. ROTATOR_PROVIDER now validates against the supported set ({none, pstrotator_udp}) and warns + disables on unknown values instead of silently doing nothing — so a typo like 'pstrotator_http' tells you, instead of leaving you wondering why your rotator isn't responding. The hardcoded 192.168.1.43 fallback in the PSTRotator host config has also been removed; if PSTROTATOR_HOST isn't set, the integration warns and disables rather than trying to reach a random LAN IP.",
      },
      {
        icon: '🌐',
        title: 'Translation Files — CI Sort Gate',
        desc: "The 16 language JSON files in src/lang/ are now checked in CI for consistent key ordering using VSCode's native sort. New npm scripts lang:sort (auto-fix) and lang:check (verify) are available for contributors before submitting language changes. Prevents the kind of merge churn that used to happen when two contributors' editors disagreed on sort order. Thanks Michael Wheeley.",
      },
    ],
  },
  {
    version: '26.3.2',
    date: '2026-05-10',
    heading:
      'Surprise pre-Hamvention drop. Headline hotfix: VOACAP no longer double-counts TX power and antenna gain — at high power the WASM swap was flooding the chart green. Headline feature: brand-new MeshCom LoRa mesh integration. Also bundled: a Pi update reliability fix, a project-wide Maidenhead grid helper consolidation, an audited satellite tracking list, plus the full set of 26.3.0 and 26.3.1 features and security work that never reached production as standalone releases.',
    features: [
      {
        icon: '🛰️',
        title: 'NEW: MeshCom LoRa Mesh Integration',
        desc: "OpenHamClock now talks to MeshCom, the LoRa-based VHF/UHF mesh network popular in Europe. Set up the new MeshCom plugin in rig-bridge and OHC will plot every node it hears on the map, list them in a tab with whatever weather or telemetry they're broadcasting, and let you read and reply to chat traffic right from the panel. Click any message to pop up reply buttons (broadcast, group, or direct), or type any callsign or group name into the To field — known nodes auto-suggest as you go. Works whether your rig-bridge talks straight to your browser or routes through Cloud Relay. Translated into all 16 languages. Big thanks to Jörg (DO1HOZ) for building this.",
      },
      {
        icon: '🐛',
        title: 'HOTFIX: VOACAP Was Going All Green at High Power',
        desc: "At higher transmit powers the Propagation panel was lighting every band green — the WASM prediction looked broken. The cause: your TX power and antenna gain were being counted twice (once inside the prediction engine, then again on top of its result). Now they're only counted once, so 1,000 W and 100 W produce the realistic difference you'd expect, and bands above the MUF stop pretending to be open. The dB margin shown next to each band still reflects your real power and antenna advantage — only the math behind the colors changed.",
      },
      {
        icon: '🐛',
        title: 'Propagation Panel — First-Load Crash Fix',
        desc: "Fixed a brief red error that could appear in the Propagation panel during the first few seconds after page load if your timezone hadn't resolved yet. The panel now waits patiently and renders normally once your location settles in.",
      },
      {
        icon: '🥧',
        title: 'Smoother update.sh on Pi and Self-Hosted Installs',
        desc: "The update.sh script now does a fully clean Node-modules reinstall on each update instead of layering new packages on top of old ones. That fixes a few reported cases where a fresh dependency added in a recent release didn't actually land on disk after running update.sh, leading to a 'Cannot find module' error on next start. Thanks Jörg (DO1HOZ).",
      },
      {
        icon: '🛰️',
        title: 'Tracked Satellite List Audited',
        desc: 'Re-curated the satellite list. Removed dead birds (AO-92 reentered Feb 2024, AO-27, RS-15, FO-99, GOES-13 deactivated, plus several decayed CAS / XW satellites and the science-only UVSQ-SAT and MeznSat). Added the new active ham birds AO-123 (ASRTU-1), SO-125 (HADES-ICM), and QMR-KWT-2, plus several active weather satellites (NOAA-20/21, EWS-G1/G2, GK-2A, ELEKTRO-L2/3, HIMAWARI-9). TEVEL constellation NORAD IDs corrected per AMSAT bulletin and ISS consolidated into a single entry. Thanks Michael Wheeley.',
      },
      {
        icon: '🧹',
        title: 'Lightning Panel — Console Typo Fix',
        desc: 'Tiny console-log spelling typo in the Lightning code corrected (#963 — thanks Michael Wheeley).',
      },
      {
        icon: '📐',
        title: 'Behind the Scenes — Grid Locator Cleanup (closes #951)',
        desc: 'There were several copies of Maidenhead-to-lat/lon code scattered across the project. Everything now uses one shared module that handles every grid precision (DM, DM12, DM12kv, all the way to DM12kv99) and a new bounding-box helper that plugin authors can use to draw grid overlays. The third-party @hamset/maidenhead-locator package has been retired. Thanks Michael Wheeley.',
      },
      {
        icon: '🔒',
        title: 'Cloud Relay — Credential Overhaul (26.3.1)',
        desc: "Cloud Relay (the optional setting that lets your home rig-bridge be reached from a remote browser) got a security overhaul. Each rig-bridge now gets its own random one-time token instead of using your shared relay key, and that token survives server restarts and deploys so you don't have to keep re-pairing. Added protections against spoofed hosts and a fix for a TLS-enabled rig-bridge that was crashing on incoming commands. Heads-up: existing Cloud Relay users will need to re-run 'Connect Cloud Relay' in Settings → Rig Bridge once after this update to generate a fresh token.",
      },
      {
        icon: '🔒',
        title: 'Public-Site Security Tightening (26.3.1)',
        desc: "Three fixes from a May audit. The Active Users map layer now ties each callsign to its source IP and rate-limits updates to once a minute, so nobody can casually spoof another op's pin. The internal health endpoint stopped exposing internal counters and visitor history to anyone who asked — only basic status and uptime are visible without auth. And the Dial-A-Moon image loader now confirms the URL is on nasa.gov before following it, closing a redirect-chasing vulnerability.",
      },
      {
        icon: '♻️',
        title: 'Server-Side Memory Leaks Closed (26.3.1)',
        desc: 'Several server-side caches (NWS alerts, FEMA shelters, disaster declarations, MUF map, error-log dedupe) used to grow forever — invisible on a home Pi but a slow drag on openhamclock.com over weeks of uptime. Each cache now has a hard size cap and periodic cleanup.',
      },
      {
        icon: '🧹',
        title: 'Cleaner Browser Console (26.3.1)',
        desc: "Routine status messages from the various map layers and feeds (lightning, WSPR, RBN, weather, spots, etc.) moved to debug-level logging. If you didn't have DevTools open you'll never notice — but anyone who did look saw far more noise than signal before. The verbose lines are still available behind the Debug filter, or by adding ?log=debug to the URL.",
      },
      {
        icon: '📡',
        title: 'VOACAP-Grade Propagation Predictions (26.3.0)',
        desc: 'The Propagation panel now runs the actual ITU-R P.533 model — the same engine VOACAP itself uses — directly inside your browser. A small badge in the panel header tells you which engine produced the current view: WASM (the new in-browser P.533), REST (a server-side fallback), or EST (our older fast estimator). Predictions match VOACAP closely on long daylight paths where the older estimator was over-optimistic — for example, US to Kuwait on 80 m at midday is now correctly shown as closed.',
      },
      {
        icon: '🛰️',
        title: 'Winlink Gateway Map Layer (26.3.0)',
        desc: "A new map layer plots 4,800+ Winlink gateways worldwide, color-coded by mode (Pactor, VARA-FM, VARA-HF, etc.). Filter by band, service, or mode in a draggable filter panel; press 'k' to toggle. The EmComm layout adds a 'Nearby Winlink Gateways' panel and rings the closest 25 gateways on the EmComm map.",
      },
      {
        icon: '🛰️',
        title: 'Satellite Next-Pass and Ending Countdown (26.3.0)',
        desc: "The satellite info window now shows a 'Next Pass:' countdown when a satellite is below your minimum elevation, and an 'Ending:' countdown when one is currently overhead — so you know how long the window stays open. Computed for the next 7 days and refreshed hourly. Also fixed a small off-by-one that was returning one extra pass.",
      },
      {
        icon: '📰',
        title: 'DX News from Three Sources (26.3.0)',
        desc: 'The DX News ticker now combines DXNews.com, DX-World, and NG3K into a single 24-hour feed with duplicates removed. The source label rotates so you can tell where each item came from, and clicking opens the article. Stray contest-reminder noise that was leaking into NG3K titles is now cleaned out.',
      },
      {
        icon: '⚡',
        title: 'Custom TX Power in the Propagation Panel (26.3.0)',
        desc: "The Propagation panel's VOACAP view now has a 'Custom…' power option that pops up a 0.1–2,000 W input field, so you can model anything from QRP to legal limit without being stuck with the four preset buttons.",
      },
      {
        icon: '🌅',
        title: 'Local Sunrise/Sunset in the Propagation Panel (26.3.0)',
        desc: 'The day/night badge in the Propagation panel now uses your actual local sunrise and sunset times instead of a fixed UTC 6 AM–6 PM window. Times are shown in your local timezone with a label (UTC for the DX side). Polar night and midnight sun are handled too.',
      },
      {
        icon: '⛅',
        title: 'Faster Weather Load (26.3.0)',
        desc: 'Weather data now appears within a couple of seconds of changing your location instead of waiting 30 seconds for a settle delay. First fetch fires immediately when you set DE or your first DX target. If Open-Meteo rate-limits us, retries are tighter and the error message points to the optional API-key escape hatch.',
      },
      {
        icon: '🛰️',
        title: 'Satellite TLE Failover Hardening (26.3.0)',
        desc: "When CelesTrak rate-limits us (which has happened more than once), the per-satellite SatNOGS / CelesTrak-CATNR fallback now runs without an arbitrary cap when the main fetch comes back empty — exactly when the safety net needs to fire hardest. Empty TLE responses also send a no-cache header so a CDN miss doesn't pin failure for an hour.",
      },
      {
        icon: '🔒',
        title: 'Security and Dependency Updates (26.3.0)',
        desc: 'rig-bridge moved off the deprecated vercel/pkg packager (which had an unfixable security advisory) to the maintained @yao-pkg/pkg fork; build targets bumped from Node 18 to Node 20. The main project picked up Vite 6 and Vitest 3, closing the rest of the open advisories.',
      },
      {
        icon: '🐛',
        title: 'Other Bug Fixes (26.3.0)',
        desc: "DX Favorites dropdown no longer clips off-screen near the edges. Duplicate version label removed from the expanded left sidebar. The MUF readout in the Propagation panel reappears after the engine swap (the previous parser was missing it). NG3K news titles no longer contain stray 'Check here for pericontest' text. ITURHFProp service stopped flooding the server log with noise.",
      },
    ],
  },
  {
    version: '26.3.1',
    date: '2026-05-04',
    heading:
      'Server-side security and resource hardening from the May audit — Cloud Relay credential overhaul, presence-spoof protection, /api/health lockdown, Dial-A-Moon SSRF guard, and four cache memory leaks closed. Plus extended grid-locator utilities and a quieter browser console.',
    features: [
      {
        icon: '🔒',
        title: 'Rig Bridge Cloud Relay — Credential Overhaul',
        desc: 'Cloud Relay credentials are no longer the raw RIG_BRIDGE_RELAY_KEY — each rig-bridge instance now gets a 256-bit per-session token persisted to data/relay-tokens.json so it survives server restarts and deploys without re-pairing. The /api/rig-bridge/status endpoint now validates the host (preventing SSRF) and connects to the resolved IP to defeat DNS-rebinding. Long-poll connections capped at 10 per IP. Installer-script URL injection closed with new URL() validation. Cloud-relay plugin bumped to v2.1.3 with TLS-aware loopback and proper error handlers so a TLS-enabled rig-bridge no longer crashes when commands arrive. Heads-up: existing Cloud Relay users will need to re-run Connect Cloud Relay in Settings → Rig Bridge once after this update to generate fresh credentials.',
      },
      {
        icon: '🔒',
        title: 'API Surface Hardening',
        desc: "/api/presence now binds each callsign to its source IP and rate-limits to 1 update per minute — anyone spoofing a POST with someone else's callsign now gets locked out and the prior pin is removed. /api/health stops leaking endpoint counts, byte totals, MQTT broker state, in-flight upstream counters, and visitor history to unauthenticated requests; only basic status, version, and uptime remain visible without auth. The Dial-A-Moon image fetch now validates that the upstream-supplied URL parses as https://*.nasa.gov before following it, closing the SSRF vector noted in the audit.",
      },
      {
        icon: '♻️',
        title: 'Server Cache Memory Leaks Closed',
        desc: 'The error-deduplication map (errorLogState), the EmComm caches (NWS alerts, FEMA open shelters, disaster declarations), and the MUF map cache all now have periodic purges and hard size caps (200 entries each, with TTL-based eviction). Previous behavior left them growing unbounded over weeks of uptime — invisible on small self-hosted instances, but a real slow bleed on the public site over time.',
      },
      {
        icon: '📐',
        title: 'Extended Maidenhead Grid Utilities',
        desc: 'src/utils/geo.js now fully supports the Maidenhead standard at all four sizes — field (DM), square (DM12), subsquare (DM12kv), and extended-square (DM12kv99) — plus a new maidenheadToBoundingBox() helper for plugin authors who want to draw grid overlays at any precision. Backed by a new geo.test.js with 169 cases covering both hemispheres. The legacy parseGridSquare and calculateGridSquare entry points still work as thin wrappers, so existing plugins keep working unchanged.',
      },
      {
        icon: '🧹',
        title: 'Cleaner Browser Console',
        desc: 'Routine per-event log lines across the client (lightning, WSPR, RBN, weather, wake-lock, version-check, POTA/SOTA/WWFF/WWBOTA spots, earthquake markers, plugin loader, layer states, etc.) moved from console.log to console.debug, with one-shot lifecycle messages going to console.info. Open DevTools at the default level and you now see signal instead of noise — verbose tracing is still available by toggling the Debug filter, or by appending ?log=debug to the URL.',
      },
    ],
  },
  {
    version: '26.3.0',
    date: '2026-05-05',
    heading:
      'VOACAP-grade propagation predictions in your browser, Winlink gateway map layer, satellite next-pass countdown, multi-source DX news ticker, custom TX power, faster weather load, and a wave of bug fixes and security updates.',
    features: [
      {
        icon: '📡',
        title: 'VOACAP-Grade Propagation Predictions (P.533)',
        desc: 'The Propagation panel now runs the real ITU-R P.533 model directly in your browser using a WebAssembly build of ITURHFProp v14.3 — the same engine VOACAP uses. A small badge in the panel header shows which engine produced the prediction: WASM (full P.533), REST (proppy fallback), or EST (heuristic). Predictions match VOACAP closely on the long-haul daylight paths where the old heuristic over-predicted (e.g. US→Kuwait 80m midday now correctly closed).',
      },
      {
        icon: '🛰️',
        title: 'Winlink Gateway Map Layer',
        desc: 'A new map layer plugin shows 4,800+ Winlink gateways worldwide, color-coded by mode family. Draggable filter panel for band, service, and mode; press "k" to toggle. The EmComm layout adds a "Nearby Winlink Gateways" panel and rings the closest 25 gateways on the EmComm map. All powered by a server-side cache so the map renders instantly without hammering Winlink.',
      },
      {
        icon: '🛰️',
        title: 'Satellite Next Pass and Ending Countdown',
        desc: 'When a satellite is below your minimum elevation, the info window now shows a "Next Pass:" countdown to its next visible window. When a satellite is currently visible, an "Ending:" countdown shows how much time you have before it drops below minimum elevation. Computed for the next 7 days and refreshed hourly. Also fixes an off-by-one in the orbit prediction that returned one extra pass.',
      },
      {
        icon: '📰',
        title: 'DX News from Three Sources',
        desc: 'The DX News ticker now aggregates DXNews.com, DX-World RSS, and NG3K into a single 24-hour feed with callsign-based deduplication. The source label rotates to show where each item came from and links to the source homepage; clicking an item opens its article. NG3K contest-reminder noise that was leaking into entry titles is now cleaned out.',
      },
      {
        icon: '⚡',
        title: 'Custom TX Power in the Propagation Panel',
        desc: 'The Propagation panel\'s VOACAP view now offers a "Custom…" power option that reveals an inline 0.1–2000 W input, so you can model anything from QRP to legal-limit and beyond without the four preset buttons. The Settings panel keeps the quick-pick buttons and shows a read-only hint when a custom value is in use.',
      },
      {
        icon: '🌅',
        title: 'Local Sunrise/Sunset in Propagation Panel',
        desc: 'The day/night badge in the Propagation panel now uses your actual local sunrise and sunset instead of a fixed UTC 06:00–18:00 window. Sunrise/sunset times display in your local timezone with a label (UTC for DX). Polar night and midnight sun are handled gracefully.',
      },
      {
        icon: '⛅',
        title: 'Faster Weather Load',
        desc: 'Weather data now appears within a couple of seconds of changing your location instead of waiting 30 seconds for a settle window. First fetch fires immediately on initial DE / first DX target. When Open-Meteo rate-limits, retries use a tighter backoff and the error UI now shows a "Get higher limits ↗" hint pointing to the optional API key escape hatch.',
      },
      {
        icon: '🛰️',
        title: 'Satellite TLE Failover Hardening',
        desc: "When CelesTrak's egress IP is rate-limited (which has happened repeatedly), the per-satellite SatNOGS and CelesTrak-CATNR fallback now runs without an arbitrary cap when the primary group fetch returns nothing — exactly when the safety net needs to fire hardest. Empty TLE responses now also send Cache-Control: no-store so a CDN miss doesn't pin failure for an hour.",
      },
      {
        icon: '🔒',
        title: 'Security and Dependencies',
        desc: 'rig-bridge migrated off the deprecated vercel/pkg (which had an unfixable LPE CVE) to the actively-maintained @yao-pkg/pkg fork; build targets bumped from Node 18 to Node 20. Root project picked up Vite 5→6.4 and Vitest 2→3.2, closing the remaining root CVEs. Postcss, path-to-regexp, and picomatch alerts cleared via npm audit fix.',
      },
      {
        icon: '🐛',
        title: 'Bug Fixes',
        desc: 'DXFavorites dropdown no longer clips off-screen near viewport edges. Duplicate version label removed from the expanded left sidebar. MUF column is now read by name from ITURHFProp output instead of a fragile regex, restoring the MUF readout after the WASM swap. NG3K news ticker descriptions no longer contain stray "Check here for pericontest" text. ITURHFProp log noise on Staging silenced after one informational line.',
      },
    ],
  },
  {
    version: '26.2.1',
    date: '2026-04-06',
    heading:
      'Rig Bridge with 22 plugins, EmComm full platform, debug logging, privacy controls, lightning alerts, satellite enhancements, RBN spotter mode, propagation and solar index fixes, and deprecation of Rig Listener / Rig Daemon / WSJTX-Relay.',
    features: [
      {
        icon: '📻',
        title: 'Rig Bridge — Centralized Hardware Hub (Beta)',
        desc: 'Rig Bridge is now the single system for all external hardware and digital mode integration. 22 plugins: 8 radio (Yaesu, Kenwood, Icom USB + rigctld, flrig, TCI, SmartSDR, RTL-TCP), 4 digital mode (WSJT-X, MSHV, JTDX, JS8Call — all bidirectional), APRS TNC (KISS/Direwolf), Winlink gateway, rotator (rotctld), and mock. Plugin Manager UI at localhost:5555 lets you enable/disable and configure plugins without editing JSON. Dedicated Rig Bridge tab in OHC Settings. HTTPS/TLS support with self-signed certificate. Note: Rig Bridge is currently in beta — please report issues on GitHub.',
      },
      {
        icon: '🎵',
        title: 'Bidirectional Digital Mode Control (Beta)',
        desc: 'WSJT-X, MSHV, JTDX, and JS8Call plugins are fully bidirectional — OHC can send replies to decoded stations, halt TX, set free text, and highlight callsigns in the decode window. Shared protocol library with WSJTXWriter serializer. Each app runs on its own UDP port so they can operate simultaneously.',
      },
      {
        icon: '🚨',
        title: 'EmComm — Full Bidirectional Operations Platform',
        desc: 'The EmComm layout is no longer display-only. Local APRS via Direwolf/hardware TNC (KISS protocol), 30+ APRS symbol icons, RF/Internet source selector. Net check-in/check-out via APRS messages, operator status board with live roster. Click-to-message with 67-char limit and RF send. Message logging with CSV/ICS-213 export. APRS telemetry parsing (T# frames with PARM/UNIT/EQNS calibration). All works over RF alone — no internet required.',
      },
      {
        icon: '📡',
        title: 'RBN Spotter Mode — What Does a Skimmer Hear?',
        desc: 'The RBN overlay now supports a second query mode: "What does a skimmer hear?" Enter a skimmer callsign (e.g. KD2OGR) to see all stations it\'s receiving, with markers at DX locations and paths from the skimmer. Toggle between "Who hears me?" and spotter mode via the Mode dropdown in the RBN panel.',
      },
      {
        icon: '🛰️',
        title: 'Satellite Tracking Enhancements',
        desc: 'Range, range rate, and doppler factor calculations for visible satellites with US/metric unit support. Updated to satellite.js v6.0.0 for corrected doppler factor.',
      },
      {
        icon: '🔇',
        title: 'Debug Logging System',
        desc: 'Console output is now controlled via the ?log= query parameter (none, error, warn, info, debug, all). Defaults to warn so important issues are always visible. Silences noisy third-party library output in production.',
      },
      {
        icon: '🔒',
        title: 'Privacy Controls',
        desc: 'Added presence opt-out toggle and privacy notice. Removed IP collection, GeoIP lookups, and country tracking from health check.',
      },
      {
        icon: '⚡',
        title: 'Lightning Proximity Alerts',
        desc: 'Lightning strike proximity alerts are now integrated into the audio alerts system.',
      },
      {
        icon: '🗺️',
        title: 'APRS Map Improvements',
        desc: 'APRS symbol sprites on map markers, distance column and hover tooltip in panel, callsign SSID stripping. APRS clicks no longer move DX location. APRS panel now works with local RF only — no APRS_ENABLED flag needed.',
      },
      {
        icon: '🖥️',
        title: 'DigitalModes & Winlink Dockable Panels',
        desc: 'DigitalModes and Winlink are now available as dockable panels in the Dockable layout.',
      },
      {
        icon: '⚠️',
        title: 'Deprecation: Rig Listener, Rig Daemon & WSJTX-Relay',
        desc: 'Rig Listener, Rig Daemon, and WSJTX-Relay are now deprecated and will be removed in a future release. Rig Bridge replaces all three with a single unified system. Existing users should migrate to Rig Bridge via Settings → Rig Bridge. Download installers are available for Windows, Mac, and Linux.',
      },
      {
        icon: '📊',
        title: 'Propagation & Solar Index Fixes',
        desc: 'Fixed propagation bars/chart mismatch when 24h ITURHFProp fetch failed. Panel footer now shows SFI/K from separate NOAA fetch instead of N0NBH. Fixed NOAA K-index API format change causing Kp=0, broken K-index array parser, stale band conditions badge, and f107_cm_flux.json sort order. Kp forecast no longer includes 60+ past observations.',
      },
      {
        icon: '🗺️',
        title: 'Locale-Aware Map Labels',
        desc: "Map labels on CARTO and Google tile layers now match your OHC language setting instead of following the browser's Accept-Language header.",
      },
      {
        icon: '🔧',
        title: 'Rig Bridge CORS Fix — Click-to-Tune Works Again (Beta)',
        desc: 'Fixed click-to-tune and PTT failures (issues #707 and #834). The rig-bridge CORS whitelist was missing common OHC ports. CORS rejections are now logged to the rig-bridge console.',
      },
      {
        icon: '📻',
        title: 'WSJT-X — Spaces in Client IDs',
        desc: 'WSJT-X client IDs with spaces are now accepted.',
      },
      {
        icon: '🐛',
        title: 'Additional Bug Fixes',
        desc: 'Spot comments display correctly with grid locator in WorldMap popups for POTA, SOTA, WWFF, and WWBOTA. Improved QRT detection. Refined contest QSO DX auto-targeting. Unique visitor stats across all trackable requests. Stale band-conditions badge localized in all 16 languages.',
      },
    ],
  },
  {
    version: '26.1.3',
    date: '2026-03-23',
    heading:
      'EmComm layout with APRS resource tracking, redesigned Classic layout, new versioning scheme, SDR integration, DX cluster text filter, RBN spotter filter, DX favorites, mutual reception indicator, UDP spot listener, WSJT-X multicast, swappable header clocks, Classic VOACAP heatmap, and bug fixes.',
    features: [
      {
        icon: '🚨',
        title: 'EmComm Layout — Emergency Communications Dashboard',
        desc: 'New dedicated layout for ARES/RACES and emergency communications. Full-screen map with range rings, NWS weather alerts, FEMA disaster declarations, nearby shelters with capacity bars, and filtered APRS stations showing only emergency symbols (EOC, Shelter, ARES, Skywarn, Red Cross). Designed for served agency operations and SKYWARN nets.',
      },
      {
        icon: '📦',
        title: 'APRS Resource Tokens — Structured Emergency Data',
        desc: 'EmComm APRS stations can now encode structured resource data in their beacon comments using bracket notation (e.g. [Beds 30/100][Water -50][Power OK]). OpenHamClock parses these into visual resource cards with progress bars, need indicators, and a summary dashboard aggregating data across all stations. Supports capacity, quantity, need, status, and critical alert token types.',
      },
      {
        icon: '🏛️',
        title: 'Classic Layout — Redesigned',
        desc: 'The Classic layout has been refreshed with a cleaner look while keeping the spirit of the original HamClock by WB0OEW. Improved spacing, updated color palette, and better readability on dedicated displays and Raspberry Pi kiosk setups.',
      },
      {
        icon: '👥',
        title: 'Active Users Map Layer',
        desc: 'See other OpenHamClock operators on the map in real time. Every configured user automatically reports their presence — enable the Active Users layer in Map Layers to see who else is online. Your own callsign shows in green, others in purple. Found under the new Community category in Settings.',
      },
      {
        icon: '🔔',
        title: 'Audio Alerts for New Spots',
        desc: 'Get audible notifications when new items appear in POTA, SOTA, WWFF, WWBOTA, DX Cluster, DXpeditions, or Contests. Each feed gets its own configurable tone from 9 Web Audio presets (Ping, Chirp, Two-Tone, etc.). All off by default — enable per feed in Settings → Alerts tab. Includes master volume control and a preview button to hear each tone.',
      },
      {
        icon: '📻',
        title: 'SDR Integration — FlexRadio SmartSDR & RTL-SDR',
        desc: 'Rig-bridge now supports FlexRadio 6000/8000 series via native SmartSDR TCP API (port 4992) and cheap RTL-SDR dongles via rtl_tcp. No rigctld or Windows-only software needed.',
      },
      {
        icon: '🔍',
        title: 'DX Cluster — Comment Text Filter',
        desc: 'New "Text" tab in DX Cluster filters lets you search spot comments for contest and event keywords like TEST, SSS, SKCC. Multiple keywords use OR logic — great for finding short-duration events quickly.',
      },
      {
        icon: '📡',
        title: 'RBN — Filter by Spotter',
        desc: 'The RBN panel now has a spotter filter field. Enter one or more skimmer callsigns (e.g. NU4F, W3LPL) to see only spots from nearby stations — useful for monitoring local propagation.',
      },
      {
        icon: '⭐',
        title: 'DX Favorites',
        desc: 'Save up to 10 DX target grid squares as favorites for quick switching. Star button next to the grid input lets you add, rename, and recall saved locations with a single click. Syncs across devices.',
      },
      {
        icon: '🎯',
        title: 'DX Target Panel Toggle',
        desc: 'You can now independently show or hide the DX target info panel (grid, bearing, sun times) via Settings → Layers, separate from the DE/DX map markers.',
      },
      {
        icon: '🎨',
        title: 'Activation Panel — Shape & Color Icons',
        desc: 'POTA, WWFF, SOTA, and WWBOTA tabs and panel headers now show their actual map marker shape and color (▲ ▼ ◆ ■) instead of generic icons. Removed from the band legend to reduce clutter.',
      },
      {
        icon: '🛰️',
        title: 'Satellite — PO-101 Restored',
        desc: 'PO-101 (DIWATA-2B) has been restored to the satellite list — it is still active with FM downlink on 145.900 MHz.',
      },
      {
        icon: '🐛',
        title: 'Bug Fixes',
        desc: 'Fixed SOTA labels toggle crash (default value on wrong prop), DX cluster filter badge count not reflecting exclude filters, and activation panel border divider crash when using filtered data.',
      },
      {
        icon: '🗺️',
        title: 'Azimuthal Projection — All Map Styles',
        desc: 'Azimuthal projection now supports all tile map styles (satellite, terrain, dark, streets, etc.) — projection is a separate toggle from style.',
      },
      {
        icon: '🔄',
        title: 'Swap Header Clocks',
        desc: 'New toggle in Settings → Display to show Local Time before UTC in the header. Useful for operators who primarily reference local time.',
      },
      {
        icon: '★',
        title: 'Mutual Reception Indicator',
        desc: 'PSK Reporter spots now show a gold star when a station hears you AND you hear them on the same band — indicating a QSO is likely possible. Gold ring on map markers too. Toggle on/off in Settings → Display.',
      },
      {
        icon: '📻',
        title: 'UDP Spot Listener',
        desc: 'DX Cluster now supports UDP as a native data source. Receive spots from local network apps like MacLoggerDX without internet telnet access. Supports JSON, XML, ADIF, and delimited text formats. Configure in Settings → Station.',
      },
      {
        icon: '📊',
        title: 'Classic Layout — VOACAP Heatmap',
        desc: 'The Classic layout auto-rotating center pane now includes a compact VOACAP propagation heatmap showing 24-hour band reliability predictions alongside the existing SSN/SFI and propagation views.',
      },
      {
        icon: '🖥️',
        title: 'Classic Layout — UI Improvements',
        desc: 'Layer toggle buttons (DX, POTA, SOTA, etc.) moved from top-right to bottom-right of the map to avoid overlapping other controls. Band legend enlarged for better readability.',
      },
      {
        icon: '🎨',
        title: 'Activation Panel Consolidation',
        desc: 'POTA, SOTA, WWFF, and WWBOTA panels now share a unified map marker definition system, reducing code duplication and ensuring consistent styling across all activation types.',
      },
      {
        icon: '📡',
        title: 'WSJT-X Relay — Multicast Support',
        desc: 'The WSJT-X relay now supports UDP multicast, allowing multiple applications (WSJT-X, GridTracker, JTAlert, etc.) to receive the same UDP stream without port conflicts. Configure a multicast address in Settings → Station, and the relay download scripts include it automatically. Note: multicast support in the standalone relay is an interim solution — the longer-term plan is to consolidate relay functionality into rig-bridge.',
      },
      {
        icon: '🐛',
        title: 'Bug Fix — Update Preflight Error',
        desc: 'Fixed the "Update preflight failed" error that appeared for all users when clicking the update button. The server-side pre-check now provides a clearer error message when git is not available in the deployment environment.',
      },
      {
        icon: '🐛',
        title: 'Bug Fix — Edge Browser Cache Issue',
        desc: 'Fixed a crash in Microsoft Edge when switching to azimuthal projection. Leaflet icon creation was happening at module load time before the library was ready, causing a fatal error on browsers with aggressive caching. Azimuthal map now also has its own error boundary — if it fails, it falls back to flat projection instead of crashing the entire dashboard.',
      },
      {
        icon: '🐛',
        title: 'Bug Fix — Plugin Layer Crash (getPane)',
        desc: 'Fixed a "getPane().appendChild" crash that could occur when switching projections or opening settings. Each map plugin layer is now wrapped in its own error boundary, so a single broken layer never takes down the whole dashboard. Added map-alive validation to prevent layers from attaching to destroyed or stale Leaflet instances.',
      },
      {
        icon: '🗺️',
        title: 'Bug Fix — Streets & Terrain Tile Providers',
        desc: 'Streets map style switched from OpenStreetMap tile servers (blocked for violating tile usage policy) to CARTO Voyager. Terrain switched from OpenTopoMap to Esri World Physical Map. Both now load reliably without access errors.',
      },
      {
        icon: '🐛',
        title: 'Bug Fix — Azimuthal Tiles on Retina/HiDPI Displays',
        desc: 'Fixed the azimuthal projection tile imagery appearing as a small globe in the top-left corner on Mac Retina and other HiDPI displays. The tile image was bypassing the canvas DPR scaling transform — now renders at the correct size and position.',
      },
    ],
  },
  {
    version: '15.7.3',
    date: '2026-03-17',
    heading:
      'Bug fix release — resolves black screen on startup, WSJT-X crash, broken DX Cluster paths, and a complete rewrite of the gray line overlay that was rendering incorrectly near equinoxes.',
    features: [
      {
        icon: '🐛',
        title: 'Bug Fix — Black Screen on Startup',
        desc: 'Fixed a missing module import (path) in config-routes and a crypto.randomUUID call that failed over plain HTTP connections. Both caused the server or frontend to crash on load, resulting in a black screen.',
      },
      {
        icon: '🐛',
        title: 'Bug Fix — WSJT-X Crash & DX Cluster Paths',
        desc: 'Fixed a missing variable (CALLSIGN_CACHE_TTL) that caused a fatal server crash when WSJT-X sent decoded spots, and broke DX Cluster great circle path lookups.',
      },
      {
        icon: '🌅',
        title: 'Gray Line Overlay — Complete Rewrite',
        desc: 'The gray line layer has been rewritten from scratch. Fixed the night polygon filling the wrong side of the map, the terminator line disappearing near equinoxes (85° latitude cap was discarding most points), and the enhanced DX zone polygon stretching across the globe instead of forming a band around the terminator.',
      },
      {
        icon: '📡',
        title: 'Meshtastic MQTT — Per-User Sessions',
        desc: 'MQTT broker connections are now per-user instead of shared globally. Each browser gets its own independent MQTT session with separate broker settings, topic filters, and credentials.',
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

export default function WhatsNew({ showWhatsNew }) {
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
          if (hasEntry && showWhatsNew) {
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
        className="whats-new-modal"
        style={{
          background: 'var(--bg-secondary, #1a1a2e)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: '12px',
          maxWidth: '560px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          animation: 'whatsNewSlideIn 0.3s ease-out',
        }}
      >
        {/* Body — one big scrollable region: header + announcement + features */}
        <div
          style={{
            overflowY: 'auto',
            flex: 1,
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        >
          <div
            style={{
              padding: '24px 24px 16px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontFamily: 'var(--font-mono)',
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
                  textAlign: 'left',
                  whiteSpace: 'pre-line',
                }}
              >
                <span style={{ fontSize: '18px', display: 'block', marginBottom: '4px', textAlign: 'center' }}>
                  {ANNOUNCEMENT.emoji}
                </span>
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

          {/* Feature list */}
          <div style={{ padding: '0 24px 16px' }}>
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
              fontFamily: 'var(--font-mono)',
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
        .whats-new-modal {
          max-height: 85vh;
          max-height: calc(100svh - 40px);
        }
      `}</style>
    </div>
  );
}
