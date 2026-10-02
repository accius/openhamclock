# OpenHamClock User Manual

Everything OpenHamClock can do, and how to use it. New here? Do the five-minute setup in the [Quick Start](QUICKSTART.md) first, then come back when you want the details.

Features tagged are already merged and will ship in the next monthly drop — you'll see them on the staging site and in fresh git checkouts before they reach the hosted site. this manual is also built into the app: **Settings → Help** renders it with a searchable contents sidebar, and the small ❓ icons on panels, map layers, and settings tabs jump straight to the relevant section.

## Contents

- [The basics](#the-basics)
- [The map](#the-map)
  - [Projections: flat, azimuthal, 3D globe](#projections-flat-azimuthal-3d-globe)
  - [Basemap styles](#basemap-styles)
  - [Map layers](#map-layers)
  - [DE and DX: markers, click-to-set, favorites](#de-and-dx-markers-click-to-set-favorites)
  - [Map Data text view (accessibility)](#map-data-text-view-accessibility)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Panels](#panels)
  - [Spots and activity](#spots-and-activity)
  - [Propagation and space weather](#propagation-and-space-weather)
  - [Station and rig](#station-and-rig)
  - [Logging](#logging)
  - [EmComm and mesh](#emcomm-and-mesh)
  - [Utility](#utility)
- [DX cluster in depth](#dx-cluster-in-depth)
- [The logbook](#the-logbook)
- [Propagation in depth](#propagation-in-depth)
- [Satellites](#satellites)
- [Rig control and Rig Bridge](#rig-control-and-rig-bridge)
- [WSJT-X and digital modes](#wsjt-x-and-digital-modes)
- [The EmComm layout](#the-emcomm-layout)
- [The EME layout](#the-eme-layout)
- [Alerts and notifications](#alerts-and-notifications)
- [Offline mode (PWA)](#offline-mode-pwa)
- [Layouts, themes, and profiles](#layouts-themes-and-profiles)
- [Languages](#languages)
- [Settings reference](#settings-reference)
- [Hosted site vs self-hosted](#hosted-site-vs-self-hosted)

---

## The basics

OpenHamClock is a browser app. Everything you configure — callsign, layout, filters, theme — is saved in that browser's local storage. That has two practical consequences:

- **Nothing follows you between browsers or devices automatically.** Use **Settings → Profiles → Export** to move a configuration, or enable `SETTINGS_SYNC=true` on a self-hosted single-operator install to keep every device in sync from the server.
- **Clearing site data clears your setup** (and your logbook — see [The logbook](#the-logbook)). Export before you spring-clean your browser.

The header bar shows your callsign (click it to open Settings), the version number (click it to open the What's New release notes), UTC and local clocks (click the local clock to flip 12/24-hour), current weather, and live SFI / K / SSN indices. On self-hosted installs an **UPDATE** button appears when a new version is available.

![The Modern layout: header bar with clocks and solar indices, DE and DX panels, the world map, and the spot panels](images/manual/layout-modern.jpg)

_The Modern layout: header bar with clocks and solar indices, DE and DX panels, the world map, and the spot panels_

Two terms you'll see everywhere, inherited from the original HamClock:

- **DE** — your station ("from" in Morse shorthand).
- **DX** — the target station or location you're interested in working.

---

## The map

The interactive world map is the centerpiece. DX spots, activators, satellites, signal paths, weather, and your own station all live here.

### Projections: flat, azimuthal, 3D globe

A projection toggle on the map switches between three views:

| Projection    | What you get                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flat**      | Classic Mercator map (Leaflet). Best all-rounder; markers replicate across world copies so nothing vanishes at the antimeridian.                                                                                                                                                                                                         |
| **Azimuthal** | Azimuthal-equidistant projection centered on your QTH — the "beam heading" view. A straight line from center is your true antenna bearing.                                                                                                                                                                                               |
| **3D Globe**  | A WebGL globe with true great-circle arcs, a real day/night terminator, and satellites orbiting at actual altitude with ground tracks and footprints. The 3D engine lazy-loads on first use and renders only when something changes, so an idle globe is cheap even on a Pi. No WebGL? The app falls back to the flat map automatically. |

<table>
<tr><td width="33%" valign="top"><img src="images/manual/map-flat.jpg" alt="Flat (Mercator)"><br><sub>Flat (Mercator)</sub></td><td width="33%" valign="top"><img src="images/manual/map-azimuthal.jpg" alt="Azimuthal — centred on your QTH"><br><sub>Azimuthal — centred on your QTH</sub></td><td width="33%" valign="top"><img src="images/manual/map-globe.jpg" alt="3D globe with satellites at true altitude"><br><sub>3D globe with satellites at true altitude</sub></td></tr>
</table>

All spot traffic (DX cluster, POTA/SOTA/WWFF/WWBOTA, PSKReporter, WSJT-X) and map overlays render in all three projections. On the globe, zooming in on a satellite swaps its dot for a 3D model — the ISS uses NASA's actual station model; other birds get procedural models matched to their type. The globe's overlay coverage now includes the weather and hazard layers: NEXRAD radar, live lightning, earthquakes, wildfires, floods/severe storms, tornado warnings, live aircraft, and ATC sectors all paint onto the 3D globe (joining aurora, D-RAP, zones, Maidenhead, and worked grids). The **moon** also appears in the 3D scene — at its real position over the Earth, showing its actual current phase via NASA's Dial-A-Moon imagery, refreshed hourly. Size and distance are compressed so it's visible (a to-scale moon would be a sub-pixel dot thirty Earth-widths away); the Earth occludes it correctly as it sets. Both are skipped in Low Memory Mode.

### Basemap styles

Pick the base tiles from the style dropdown on the map: **Dark** (default), **Satellite** (with real polar imagery on the globe), **Modis Truecolor** (NASA GIBS), **Terrain**, **Streets**, **Topo**, **Ocean**, **Hybrid**, **Gray**, **Nat Geo**, and **Countries**.

Two notes:

- **CARTO key (optional).** Dark and Streets default to Esri tiles that need no key. If you liked the original CARTO look (with localized labels), grab a free key at carto.com/basemaps/apikey (5M tiles/month) and paste it in **Settings → Integrations → CARTO Basemap Key**. The key is stored only in your browser and never synced or shared.
- **Map style rotation.** For wall displays, the basemap can cycle automatically through styles you pick, on an interval you set (default 60 s). This works in every projection, including the 3D globe, where each switch rebuilds the globe texture; Modis Truecolor is 2D-only and is skipped while the globe is up.

Other map controls: zoom, a **map lock** (prevents accidental pan/zoom on touch screens), a **night darkness** slider that sets how dark the night side is shaded, and a **hide UI** eye toggle that clears all on-map controls for a clean wall display — on the flat map and the 3D globe alike, leaving just the eye button to bring them back.

### Map layers

Around 29 overlay layers can be toggled from **Settings → Map Layers** (grouped by category, each with an opacity slider) or with the single-key [keyboard shortcuts](#keyboard-shortcuts). All layers except Satellite Tracks default to off.

![Settings → Map Layers: every overlay grouped by category, each with an opacity slider](images/manual/settings-map-layers.jpg)

_Settings → Map Layers: every overlay grouped by category, each with an opacity slider_

**Propagation**

| Layer                  | What it shows                                                                  | Key |
| ---------------------- | ------------------------------------------------------------------------------ | --- |
| Gray Line              | Day/night terminator with twilight zones and an enhanced-DX zone               | G   |
| VOACAP Propagation Map | Color-coded HF propagation predictions from your station to the world          | V   |
| MUF Map                | Estimated Maximum Usable Frequency from your station, from live ionosonde data | M   |
| DE/DX Great Circle     | Short-path and long-path great circle between DE and DX                        | D   |
| Reverse Beacon Network | Live RBN spots — "who hears me?" or flip it to "what does this skimmer hear?"  | R   |
| WSPR                   | WSPR propagation paths and signal reports (opt-in)                             | P   |
| IBP Beacons            | NCDXF/IARU International Beacon Project — live deterministic schedule          | —   |
| PSKR Band Activity     | Spot counts per HF band from PSKReporter                                       | B   |

**Amateur radio**

| Layer            | What it shows                                                       | Key |
| ---------------- | ------------------------------------------------------------------- | --- |
| Contest QSOs     | Recent QSOs from contest loggers (N1MM/DXLog) as band-colored arcs  | Q   |
| Meshtastic Nodes | Mesh network nodes from your Meshtastic device                      | —   |
| Worked Grids     | Shades Maidenhead squares you've worked, straight from your logbook | —   |

**Weather / space weather / hazards / geology**

| Layer               | What it shows                                                         | Key |
| ------------------- | --------------------------------------------------------------------- | --- |
| Weather Radar       | NEXRAD precipitation radar (North America)                            | W   |
| Global Clouds (OWM) | Real-time cloud cover (self-hosted only; needs an OpenWeatherMap key) | O   |
| Lightning Activity  | Live lightning strikes worldwide, last 30 minutes                     | L   |
| Aurora Forecast     | NOAA OVATION aurora probability (30-minute forecast)                  | A   |
| D-RAP Absorption    | NOAA D-region absorption prediction — where HF is being eaten         | J   |
| Tornado Warnings    | Active NWS tornado watches/warnings/emergencies (US)                  | T   |
| Wildfires           | Active wildfires worldwide (NASA EONET)                               | F   |
| Floods & Storms     | Active floods and severe storms worldwide (NASA EONET)                | I   |
| Earthquakes         | USGS quakes, M2.5+ in the last 24 hours, with a magnitude filter      | E   |

**Overlays and more**

| Layer               | What it shows                                                                                                                                                                                                                                                                     | Key |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Satellite Tracks    | Real-time satellite positions with tracks and footprints (on by default)                                                                                                                                                                                                          | S   |
| Maidenhead Grid     | Locator grid — fields at low zoom, squares when zoomed in                                                                                                                                                                                                                         | H   |
| CQ / ITU Zones      | Zone boundaries with zone numbers                                                                                                                                                                                                                                                 | Y   |
| City Lights         | NASA VIIRS nighttime city lights                                                                                                                                                                                                                                                  | C   |
| Winlink Gateways    | 4,800+ RMS gateways colored by mode (Pactor, VARA, ARDOP, Packet) with filters                                                                                                                                                                                                    | K   |
| Aircraft            | Live civilian aircraft (adsb.lol), with an optional track-prediction lead time                                                                                                                                                                                                    | X   |
| ATC Sectors         | FIR/ARTCC boundaries with primary frequencies and LiveATC links                                                                                                                                                                                                                   | Z   |
| Active Users        | Other OpenHamClock operators, live (opt out in Settings → Station)                                                                                                                                                                                                                | U   |
| Logged QSOs (N3FJP) | Recently logged QSOs and live entry previews from the N3FJP bridge (self-hosted); each contact gets a callsign pill in the layer colour (previews with a trailing ?) that follows the map's Show/Hide Calls button                                                                | N   |
| Logged QSOs (API)   | QSOs pushed by any external logger via the open REST API (self-hosted) — see [API.md](API.md); callsign pills as above, per-QSO colours carry into the pill                                                                                                                       | —   |
| History Playback    | Scrub through the last 24h of DX spots — timeline slider, 5–60 min window, play/pause with speeds up to 15 min/s, paths colored by band. Works on the flat map and the 3D globe, sharing one timeline. History records from server start; the control shows how far back it goes. | —   |

**Write your own layer or panel:** drop a plugin file into `src/plugins/local/` (map layers) or `src/plugins/local/panels/` (dockable panels) and it's auto-discovered — no registration, and it survives updates. See [PLUGINS.md](PLUGINS.md).

### DE and DX: markers, click-to-set, favorites

- **Your station (DE)** is marked at your configured location. The DE panel shows grid, coordinates, sunrise/sunset, and local weather.
- **Click anywhere on the map** to set the DX target there. The DX panel updates with bearing, distance, grid, sun times, and (optionally) weather; the propagation panels recalculate for the new path.
- **Click any spot** (cluster, POTA, PSK, WSJT-X…) to set that station as the DX target. The map drops a short expanding-ring **pulse** on the target so your eye finds it in a busy view, and pans to it if it is off-screen (if it is already in view the map stays put). APRS panel rows and, in the EmComm layout, station, gateway, and roster rows work the same way. Flat map only for now — the Azimuthal and 3D views ignore the pan.
- **Type a locator:** click the DX grid display and enter a grid like `JN58sm`.
- **DX Favorites:** star up to 10 DX grids for one-click recall — great for regular skeds.
- **DXCC entity picker:** browse/search the full DXCC list next to the DX grid display.
- If you have a rotator connected, **Shift+click the map** to turn the antenna to that bearing.

![The DE and DX panels: grid, coordinates, sun times, weather, and the DX bearing and distance](images/manual/panel-de-location.jpg)

_The DE and DX panels: grid, coordinates, sun times, weather, and the DX bearing and distance_

### Map Data text view (accessibility)

The **Map Data (text view)** panel renders the map's content as structured, screen-reader-friendly text: DX spots, satellites currently above your horizon, ground activations, lightning, aurora, aircraft, and Winlink gateways. Tab strips throughout the app follow the ARIA tablist pattern (arrow-key navigation), and live announcements fire for new DX spots and lightning. Add the panel from the dockable layout's panel picker.

---

## Keyboard shortcuts

Press **`?`** anywhere to open the shortcuts panel. Shortcuts are ignored while typing in a text field, while a modal is open, or when Ctrl/Alt/Cmd is held. Layer keys are pinned — adding new layers never reshuffles them.

![The shortcuts panel (press ? anywhere)](images/manual/keyboard-shortcuts.jpg)

_The shortcuts panel (press ? anywhere)_

![The command palette (Ctrl/Cmd+K): jump to any panel, layout, layer, or setting by name](images/manual/command-palette.jpg)

_The command palette (Ctrl/Cmd+K): jump to any panel, layout, layer, or setting by name_

**Command palette.** Press **Ctrl+K** (⌘K on Mac) for a fuzzy-searchable list of most things you can do: toggle map layers, switch layouts (named dockable presets included, as "Dockable — _name_"), open Settings on a specific tab, jump to a manual topic, toggle fullscreen, open What's New — and, in the Dockable layout, open or focus any panel. Arrow keys select, Enter runs, Esc closes.

| Key | Action                                   |
| --- | ---------------------------------------- |
| `?` | Toggle the keyboard shortcuts help panel |
| `/` | Toggle DE and DX markers                 |
| Esc | Close the open modal                     |
| A   | Aurora Forecast                          |
| B   | PSKR Band Activity                       |
| C   | City Lights (Night)                      |
| D   | DE/DX Great Circle                       |
| E   | Earthquakes                              |
| F   | Wildfires                                |
| G   | Gray Line                                |
| H   | Maidenhead Grid                          |
| I   | Floods & Storms                          |
| J   | D-RAP Absorption                         |
| K   | Winlink Gateways                         |
| L   | Lightning Activity                       |
| M   | MUF Map                                  |
| N   | Logged QSOs (N3FJP)                      |
| O   | Global Clouds (OWM)                      |
| P   | WSPR                                     |
| Q   | Contest QSOs                             |
| R   | Reverse Beacon Network                   |
| S   | Satellite Tracks                         |
| T   | Tornado Warnings                         |
| U   | Active Users                             |
| V   | VOACAP Propagation Map                   |
| W   | Weather Radar                            |
| X   | Aircraft                                 |
| Y   | CQ / ITU Zones                           |
| Z   | ATC Sectors                              |

The alphabet is fully spoken for, so a few newer layers (Meshtastic Nodes, IBP Beacons, Worked Grids) have no key — toggle those from Settings → Map Layers.

Mouse extras: **Shift+click** the map turns a connected rotator; holding **Ctrl** in Settings → Map Layers reveals per-layer "reset popups" buttons if a draggable legend ever gets lost off-screen.

---

## Panels

In the **Dockable** layout, every panel below can be added from the **+** panel picker — a category-grouped, multi-column grid that scrolls — then dragged, tabbed, split, and resized however you like (a lock toggle freezes the arrangement). Other layouts include a curated subset.

![The Dockable layout: panels as draggable, tabbable, resizable tiles](images/manual/layout-dockable.jpg)

_The Dockable layout: panels as draggable, tabbable, resizable tiles_

### Spots and activity

![The DX Cluster panel: band-coloured spots with age, mode, and the tune / listen / log buttons](images/manual/panel-dx-cluster.jpg)

_The DX Cluster panel: band-coloured spots with age, mode, and the tune / listen / log buttons_

- **DX Cluster** — live spots with band coloring, filtering, worked/dupe badges, click-to-tune, click-to-listen, and log-from-spot. Detailed below in [DX cluster in depth](#dx-cluster-in-depth).
- **PSK Reporter** — who hears you (**TX** tab) and who you hear (**RX** tab) on digital modes, live via a server-side MQTT proxy with HTTP fallback. Filter by band, mode, retention window (2–15 min), callsign or grid. A gold star ★ marks _mutual_ reception — you hear them and they hear you on the same band, so a QSO is likely. A trash-can button clears all spots.
- **POTA / SOTA / WWFF / WWBOTA** — currently active Parks, Summits, Flora & Fauna, and Bunkers on the Air activators, each with its own marker shape and color on the map (▲ green, ◆ orange, ▼ light green, ■ light purple). QRT and expired spots are filtered automatically. Band/mode/grid filters per panel; SOTA spots include summit name, altitude, and points.
- **DXpeditions** — active and upcoming DXpeditions (NG3K data) with real operating callsigns, dates, and modes.
- **Contests** — the WA7BNM contest calendar with countdowns and links; active contests highlighted.
- **DX News ticker** — headlines merged from DXNews.com, DX-World, and NG3K, deduplicated over 24 hours, with adjustable text size and scroll speed (« » buttons, 0.5×–2.5×).
- **DX News** — the same merged three-source feed as the ticker, but as a full reader panel: newest-first list with source badges and relative ages, expandable summaries with a link to the original article, per-source filter chips, and a read/unread dot that remembers what you've already seen (stored locally, capped at 200 items).
- **POTA Activator** — self-spotting for park activations. Enter the park reference (verified live against the POTA park directory, so you see the park name before you post), frequency in kHz, and mode; the spot posts to pota.app under your callsign. POTA's response is shown verbatim, and a 30-second cooldown prevents accidental double-spots. Re-spot after a QSY to stay on the hunters' active list.

### Propagation and space weather

![The Solar panel cycling through live imagery, indices, X-ray flux, and the moon](images/manual/panel-solar.jpg)

_The Solar panel cycling through live imagery, indices, X-ray flux, and the moon_

- **Propagation (VOACAP Chart / Bars)** — per-band reliability between DE and DX, as a 24-hour chart or as bars for right now. Detailed below in [Propagation in depth](#propagation-in-depth).
- **Sked Planner** — best times to work the current DX target over the next 48 hours: a band × hour grid colored by the same P.533 predictions the VOACAP panel computes (same mode/power/antenna settings — changing them here changes them everywhere), annotated with UTC plus both stations' local hours and sunrise/sunset markers, with the top three contact windows called out ("Best: 20m 02:00–05:00z"). Day 2 tiles the 24-hour monthly-median prediction honestly — HF predictions repeat diurnally, so it's labeled as a repeat, not a fresh forecast.
- **Ionosondes** — live foF2 and MUF(3000) measured by real GIRO digisondes (via prop.kc2g.com), sorted by distance from your QTH. The nearest station gets a "your local ionosphere" summary: foF2 translated into an NVIS usability hint and MUF(3000) into the highest band worth trying for DX. Measurements, not models — the ground truth the VOACAP predictions try to approximate.
- **Prediction Check** — per HF band, what the P.533 engine predicts right now (DE to a representative point on each continent, best continent kept) against what's actually being spotted (DX cluster + PSKReporter spots involving your continent in the last 15 minutes), with an agrees / better / worse verdict chip per band. Deliberately heuristic — spot counts measure operator activity, not path reliability — and the panel's footnote says so.
- **Band Conditions** — N0NBH's band-by-band day/night condition ratings, VHF aurora/E-skip status, and geomagnetic summary.
- **Band Health** — a "what's actually happening" view computed from live DX cluster spot activity per band, with a mode breakdown. Not a model — observed reality.
- **Band Activity (Continent)** — a DX-Heat-style continent × band heatmap of cluster spots over the last 15/30/60 minutes.
- **Band Activity (PSKR)** — spot counts per HF band from PSKReporter.
- **IBP Beacons** — which NCDXF/IARU beacon is transmitting on each of the five beacon bands _right now_ (the schedule is deterministic — no network needed), with countdowns and bearings, plus a listening-log timeline showing which beacons RBN skimmers heard in each 3-minute cycle.
- **Solar (all views, or individual panels)** — cycles through: live solar imagery (SDO with LMSAL and Helioviewer fallbacks), solar indices with 30-day history, GOES X-ray flux (6/12/24/48-hour windows with flare classification), and lunar phase with real NASA Dial-A-Moon imagery plus EME moon pointing data (azimuth/elevation, rise/set, distance).
- **Solar Cycle** — the big picture: monthly observed sunspot numbers (thin line) and the official smoothed SSN (bold line) since 2015, overlaid on NOAA SWPC's cycle-25 predicted range band, with a "you are here" marker on the latest observation and current SSN/SFI readouts. One glance answers "are we past the peak?".
- **Space Wx Alerts** — recent NOAA SWPC alerts, watches, and warnings with R/S/G severity chips.
- **Space Wx Trends** — where conditions are _heading_: 24-hour sparklines of solar wind speed, IMF Bz, and GOES ≥10 MeV proton flux from NOAA's real-time feeds. Southward (negative) Bz turns amber then red — sustained south Bz plus rising wind speed is the classic prelude to a geomagnetic storm, hours before the K-index shows it.
- **Meteor Showers** — annual showers for meteor-scatter operators, sorted by proximity to peak, with ZHR and live radiant elevation from your QTH.
- **Sun & Moon** — sunrise/sunset (UTC) and current twilight state, moonrise/moonset (local), and live moon azimuth/elevation for both DE and the DX target, plus the current phase. Greyline chasers get both ends of the path at a glance; EME operators get pointing without opening the lunar panel.
- **My Signal (RBN)** — who is hearing _you_: live Reverse Beacon Network skimmer reports of your callsign from the last 30 minutes, grouped by band with SNR and CW speed. Call CQ on CW/RTTY/FT modes and watch your signal land — the honest antenna-comparison tool.
- **WSPR My Spots** — where your WSPR beacons were received in the last 24 hours (via the [wspr.live](https://wspr.live) archive): per-band counts, unique receivers, best DX, and the full reception list with SNR and distance. The milliwatt companion to the RBN panel.

### Station and rig

- **DE Location / DX Target** — station info panels: grid, coordinates, sun times, weather (collapsible), and for DX: bearing and distance (handy for aiming a beam).
- **Analog Clock** — a classic clock face with date, sunrise, and sunset. Also available in the Classic layout via `CLASSIC_ANALOG_CLOCK=true`.
- **Ambient Weather** — your own AmbientWeather.net station's live data (appears only when `VITE_AMBIENT_*` keys are configured).
- **Rig Control** — current frequency and mode from your radio via Rig Bridge, with a band plan overlay on the frequency display and PTT status. Set your US license class in Settings → Station and the band plan bar hatches out the ranges outside your privileges (Technician/General/Amateur Extra, per the FCC Part 97 / ARRL band chart); leave it on Other for no restriction display.
- **Frequencies** — your own named channel list: calling frequencies, repeaters, club nets, whatever you keep going back to. Each entry has a name, frequency, optional mode and notes, and a band chip; with rig control enabled, clicking a row tunes the radio (same click-to-tune path as spots). A "From rig" button grabs the current frequency and mode from a connected rig, and up/down buttons reorder the list. Synced, profiled, and backed up with the rest of your settings.
- **Nets** — a recurring net schedule you define: name, day (or daily), start time in UTC, optional frequency/mode/duration/notes. The list sorts by next occurrence with a live countdown ("in 2h 14m"), highlights nets that are **ON NOW**, shows each start in your local time, and click-to-tunes when a frequency is set. All the occurrence math is done in UTC, so daylight-saving shifts never move your net.
- **On Air** — a big red ON AIR light driven by your rig's PTT. Point a webcam at it, or don't — it looks great either way.
- **ID Timer** — 10-minute countdown that beeps and pops a reminder to identify; dismissing restarts it.
- **Rotator** — compass rose, live bearing, and controls for a PSTRotator-compatible rotator (self-hosted only).
- **Custom Image** — displays any image you drop in (station photo, QSL card, reference chart).

### Logging

- **Logbook** — the native in-browser logbook. Detailed below in [The logbook](#the-logbook).
- **Awards** — DXCC, WAZ, WAS, and VUCC progress computed live from the logbook, with per-band detail views. The same tracking feeds the red **NEW** / **BAND** needed flags on spots — see [Worked-before badges](#worked-before-badges).
- **Log Stats** — analytics over the native logbook: a GitHub-style QSOs-per-day heatmap for the trailing 12 months, per-band and per-mode breakdowns, and headline tiles (total QSOs, unique calls, unique grids, best DX distance with the callsign, busiest day, first/latest QSO). Everything updates live as you log or import.
- **Contest QSOs** — N1MM+/DXLog contacts arrive by UDP and plot as band-colored arcs (see [docs/N1MM-SETUP.md](N1MM-SETUP.md)).
- **N3FJP** — logged QSOs and live entry previews from N3FJP loggers appear on the map; configure host/port in Settings → Integrations (self-hosted).
- **Any other logger** — the open REST API accepts QSOs by HTTP POST from anything that can send one, plotting them on the Logged QSOs (API) layer (self-hosted; see [docs/API.md](API.md)).

### EmComm and mesh

- **APRS** — live APRS-IS stations (plus RF-heard stations via a local TNC), with symbol icons, watchlist groups, and messaging.
- **APRS Telemetry** — per-station sensor dashboards with trend sparklines, built from APRS telemetry frames.
- **Meshtastic** — nodes, messages, and network health from a Meshtastic device (direct, MQTT, or server proxy connection).
- **MeshCom** — nodes, messages, and weather/telemetry from a MeshCom LoRa mesh via the rig-bridge UDP plugin.
- **Winlink** — gateway discovery plus a Pat client inbox/outbox and compose, via the rig-bridge Winlink plugin.
- **Digital Modes** — status and control for WSJT-X, JTDX, MSHV, and JS8Call connected through Rig Bridge (halt TX, send free text).

The full EmComm _layout_ is described in [The EmComm layout](#the-emcomm-layout).

### Utility

- **World Map / Map Data (text view)** — the map itself, and its accessible text twin.
- **Callsign Lookup** — a standalone callbook search box. Type a callsign and get the full card: name, grid, country, coordinates, and distance/bearing from your QTH, via the same lookup path (and QRZ/HamQTH credentials) the callsign popups use. A **Set as DX** button points the DX target at the station, and your last 10 searches stay one click away.
- **World Clocks** — a configurable list of timezone clocks for net schedules and DX skeds, with day-offset markers (+1d/−1d) when a zone is across the date line from you. Add any IANA timezone; the list syncs with your other settings.
- **Stopwatch** — a shack stopwatch and countdown timer. Both survive layout switches and reloads (state is stored as absolute timestamps), and the countdown sounds a tone and flashes when it hits zero. Quick presets for 5/10/15/60 minutes.
- **Repeaters** — the nearest repeaters to your DE location from the open [hearham.com](https://hearham.com) directory: frequency, offset, tone, mode, distance, and bearing, at a selectable radius. Set DE to wherever you're traveling and the list follows.
- **Aircraft Nearby** — live aircraft within a selectable radius of your DE location (ADS-B via adsb.lol), nearest first: flight, aircraft type, operator, altitude (flight levels above 18,000 ft), speed, heading, distance, and bearing. The list half of the Air Traffic layout, where it appears by default alongside the aircraft map overlay.
- **Keyboard Shortcuts** — the `?` help, dockable as a permanent panel if you like.

---

## DX cluster in depth

### Sources

On the **hosted site**, spots come from the **OpenHamClock Cluster** — our own cluster node. It aggregates RBN CW/RTTY/FT skimmer spots (collapsed so 40 skimmers hearing one CQ produce one spot), human spots from HamQTH and DX Summit, POTA/SOTA/WWFF/Parks n Peaks activator spots, and spots submitted by OpenHamClock users, all deduplicated across sources. No public DXSpider nodes are scraped. The node also speaks classic telnet on port 7300 if you want to point another program at it.

**Self-hosted installs** choose a source in Settings → Station:

| Source               | What it is                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| DX Spider Proxy ⭐   | Our proxy's persistent telnet feed over HTTP — the recommended default                                                  |
| HamQTH Cluster       | HamQTH's CSV feed — plain HTTP, works everywhere                                                                        |
| DXWatch              | DXWatch cluster feed                                                                                                    |
| Auto                 | Tries sources in order and uses the first that responds                                                                 |
| Custom Telnet Server | Your own cluster node (host/port); logs in with your callsign. Self-hosted only — cloud platforms block outbound telnet |
| UDP Spots            | Listen for UDP spot packets from local apps (e.g. MacLoggerDX); JSON, XML, ADIF, or text                                |

Cluster logins use your callsign with SSID `-56` (`-57` for a second instance; the original HamClock uses `-55`, so they coexist). Spots stay in the list for `SPOT_RETENTION_MINUTES` (default 30).

### Filters

![The DX spot filter dialog: band, mode, continent, and more](images/manual/dx-filters.jpg)

_The DX spot filter dialog: band, mode, continent, and more_

The funnel icon opens the DX Filter Manager. Filters combine with AND:

- **Zones** — continent, CQ zone (1–40), ITU zone (1–90)
- **Bands** — 160m through 70cm, including 60m, 11m, and opt-in 630m/8m/4m support where data exists
- **Modes** — CW, SSB, FT8, FT4, RTTY, PSK, and friends; mode comes from the spot comment when present, otherwise inferred from frequency against the band plan
- **Text** — search spot comments for keywords (TEST, SKCC, POTA…) with OR logic
- **Watchlist / Exclude** — always-show and never-show callsign lists
- **Contest / DXpeditions** — a contest filter and a one-click "show only DXpeditions" toggle cross-referenced against the DXpedition list

All filter state persists in your browser.

### What you can do with a spot

- **Click** it — sets the station as your DX target and highlights the path on the map.
- **Tune** — with click-to-tune enabled and Rig Bridge running, your radio jumps to the frequency and the right mode (Yaesu rigs even get a proper band-select so antenna/ATU memories follow).
- **🎧 Listen** — no radio handy? The listen button opens a web SDR _already tuned_ to the spot. OpenHamClock picks the nearest live KiwiSDR with a free slot whose coverage includes the frequency, falling back to a curated list of long-running receivers, and finally to the KiwiSDR directory. Available on DX cluster rows, activation rows (POTA/SOTA/WWFF/WWBOTA), and callsign popups.
- **📓+ Log it** — opens the Logbook's new-QSO form prefilled from the spot. In layouts without a Logbook panel, the same button opens a small Log QSO pop-up instead, so log-from-spot works everywhere (the Contest layout keeps its own quick-log strip).
- **Callsign popup** — click a callsign anywhere for a station card: name, QTH with the DX end's local time, country, and a jump to your preferred callbook (QRZ.com, HamQTH, or QRZCQ — pick in Settings → Station). When the station has been spotted recently, the card also shows a one-line spot history — "Heard 14x today: 20m(8) 15m(4) 40m(2)" — straight from the server's in-memory cluster cache.
- **Send a spot** — spot a station yourself directly from the panel header; it goes out through the OHC cluster.

### Worked-before badges

Spots are cross-referenced against your QSOs (native logbook + N3FJP + N1MM feeds):

- **DUPE** — you've worked this call on this band and mode. Contesters, skip it.
- **WORKED** — the call is in your log, but not on this band+mode. Still worth a QSO.
- **NEW** — this spot's DXCC entity isn't in your logbook at all — an ATNO, flagged in red by the same live award tracking behind the Awards panel.
- **BAND** — the entity is in your log, but not on this band. A new band slot.
- No badge — the call isn't in your log, but it's nothing you're missing either.

Portable prefixes are normalized (`5Z4/OZ6ABL` matches `OZ6ABL`) and phone/digital submodes are collapsed sensibly (USB/LSB → SSB, PSK31/63 → PSK).

---

## The logbook

The Logbook panel is a native, no-account-needed log.

**Where your QSOs live — read this bit.** The log is stored in **your browser's IndexedDB**, on your machine. It comfortably handles 10k+ contacts and survives reloads and restarts — but it does **not** sync between browsers, devices, or the hosted site vs. a self-hosted install, and clearing the browser's site data deletes it. **Export ADIF regularly as your backup.** Private/incognito windows fall back to in-memory storage that vanishes when the window closes.

What it does:

- **Log a QSO** with the **+QSO** form — UTC date/time default to now, and frequency/mode prefill from your rig when Rig Bridge is connected.
- **Log from a spot** — the 📓+ button on any DX cluster or activation spot opens the form prefilled with call, frequency, mode, and grid. If the current layout has no Logbook panel, the button opens the same form in a small app-level pop-up instead — save, see the confirmation flash, and carry on (the Contest layout is the one exception: its quick-log strip stays the logging path there).
- **ADIF import** — bring in your existing log (`.adi`/`.adif`); duplicates are detected and skipped.
- **ADIF export** — your whole log as a standard `.adi` file, any time. This is your backup and your bridge to LoTW/QRZ/other loggers.
- **Worked-before everywhere** — the log feeds the DUPE/WORKED badges on spots, and the Awards panel (DXCC/WAZ/WAS/VUCC) and the Worked Grids map layer.
- **Full backup** — one JSON file with every QSO _and_ all your settings, from **Settings → Profiles → Full Backup** (details below). Once your log tops 50 QSOs, the panel shows a small dismissable reminder when your last backup is more than a month old — **Back up now** downloads the file on the spot.

QSO records are ADIF-aligned internally (band, mode, RST, grids, power, plus arbitrary extra ADIF fields), so round-trips through other software are clean.

### Group logging (Field Day)

For contests worked as a group — Field Day, club multi-station efforts — several stations can share one live merged log. Press **Group** in the Logbook panel's toolbar, or **👥 Group** in the Contest layout's header:

- **Start session** creates a shared session and shows an 8-character **invite code**. Read it to the other stations (or copy it into the club chat).
- **Join session** on the other computers with the code and each operator's callsign. Up to 25 operators per session.
- From then on, **every QSO you log syncs automatically** — from the +QSO form, log-from-spot, or the Contest layout quick-log; there is nothing extra to do at logging time. The Group section shows the merged log with each contact's operator, who's currently connected, and a live **DUPE** flag when two stations work the same call on the same band.
- The **Contest layout quick-log** is group-aware too: typing a call another station in the session already worked on the current band+mode shows a **GRP DUPE** badge naming that operator, before you commit the contact.
- **Export** downloads the merged log as ADIF (each contact carries the `OPERATOR` field), and **To my log** copies the merged contacts into your personal logbook (dupes skipped). Other operators' contacts never enter your personal log unless you press it.

The session lives on the server your OpenHamClock talks to (the hosted site, or your own self-hosted install — for a fully offline Field Day site, a laptop running OpenHamClock locally can host the session for the LAN). Anyone with the invite code can join, so treat the code like the tent: share it with your operators, not the whole band. Sessions expire after a week of inactivity; QSOs are capped at 10,000 per session, which comfortably covers a big Field Day.

### Logbook Sync (Wavelog/Cloudlog, QRZ Logbook, LoTW)

**Settings → Integrations → Logbook Sync** connects the native logbook to the loggers you already use. Everything is opt-in and per-user: your API keys and LoTW login are stored **only in this browser** (never on the server, never in backups or profile share codes), and each request carries your own credentials — so this works on the hosted site too, without sharing anything with other users.

- **Wavelog / Cloudlog push** — enter your instance URL, API key, and Station Profile ID (the **Test** button lists your profiles with their IDs). Every QSO you log in OpenHamClock is pushed automatically; failures go into a retry queue (capped at 100) that drains on retry or via **Push all unsynced**. The pending count shows in the card and in the Logbook panel footer.
- **Wavelog pull** — enable **Pull QSOs from Wavelog into this logbook**, use **Test** to select one or more Station Profiles, then **Sync now** for the initial import. After that, OpenHamClock incrementally pulls new QSOs into the native logbook. When the server is configured for Wavelog MQTT events, newly logged QSOs trigger an immediate incremental pull and grid-bearing contacts also appear on the **Logged QSOs (API)** map layer. The saved cursor prevents already-fetched QSOs from being downloaded again.
- **QRZ Logbook push** — uses a **QRZ Logbook API key** (Logbook → Settings on qrz.com; requires an XML subscription). This is _not_ the QRZ username/password used for callsign lookups. Same automatic push + retry queue.
- **LoTW confirmations** — **Sync LoTW confirmations** pulls your confirmed QSLs from Logbook of The World and marks matching local QSOs (call + band + mode + time within ±30 minutes) with a green **LoTW✓** chip. Syncs are incremental (only QSLs since your last sync) and rate-limited to once every 5 minutes — LoTW is slow, be patient with it.

Notes: only QSOs logged in OpenHamClock _while a push integration is enabled_ are queued — importing a 10k-QSO ADIF history won't spam your remote logbook. Editing an already-pushed QSO does not re-push it.

---

## Propagation in depth

### The engines

OpenHamClock runs **real ITU-R P.533-14 predictions** — the same physics as VOACAP-class tools — and it's honest about which engine produced what you're seeing (look for the engine badge in the panel header):

1. **WASM (the good one).** ITURHFProp v14.3 compiled to WebAssembly runs _in your browser_. Coefficient tables (~11 MB per month) download lazily and cache in IndexedDB. This is the steady state on the hosted site and on builds that include the WASM bundle.
2. **REST.** The ITURHFProp microservice, if the WASM engine can't run.
3. **EST (heuristic).** A rough model from SFI/Kp/path geometry, shown only as a last resort and clearly badged.

Digital modes are predicted at their true decode thresholds (FT8 −19 dB, FT4 −15, WSPR −26, JT65 −23, CW +5 vs a 3 kHz reference), so an SSB-dead path can honestly show 67% for FT8. Set your operating mode and TX power in **Settings → Station** (presets 5/25/100/1500 W, or a custom 0.1–2000 W in the panel), plus an antenna profile.

Real-time corrections come from ionosonde data via KC2G/GIRO — measured ionosphere, not just modeled.

### The views

- **VOACAP Chart** — 24-hour per-band reliability for the DE→DX path, with your actual local sunrise/sunset marked.
- **VOACAP Bars** — the same, for right now.
- **VOACAP Propagation Map** (layer, key V) — reliability from your QTH to everywhere, as a world heatmap.
- **MUF Map** (layer, key M) — maximum usable frequency contours from live ionosonde data.
- Panels can **auto-rotate** views on a timer (5–60 s) for kiosk displays.

Data acknowledgement: ionosonde data from prop.kc2g.com originates from the [Global Ionospheric Radio Observatory](https://giro.uml.edu) and its worldwide network of contributing stations.

---

## Satellites

The Satellite Tracks layer (key **S**, on by default) tracks amateur satellites with SGP4 orbital mechanics computed in your browser.

![Settings → Satellites: pick your birds, station altitude, minimum elevation, track duration](images/manual/settings-satellites.jpg)

_Settings → Satellites: pick your birds, station altitude, minimum elevation, track duration_

- **Element sets** are fetched server-side from **CelesTrak**, **AMSAT**, and **SatNOGS** (each individually disableable in `.env`), with **Space-Track** available as the primary source if you add credentials. Multi-source failover means a rate-limited upstream doesn't blank your sky.
- **Pick your birds** in **Settings → Satellites**: search, select, Select All/Clear. Only selected satellites are computed — a real CPU saver on a Pi. Set your **station altitude** and **minimum elevation** (default 5°) for pass math.
- **Track duration** is configurable — the slider draws ±15 to ±120 minutes of orbit (default 45), and footprint circles can be toggled.
- **Click a satellite** for its info window: position, altitude, and when it's visible from your QTH — range, range rate (negative = approaching), and **doppler factor** (multiply your uplink/downlink by it to correct for motion), plus **next-pass countdowns** and a pass-prediction modal. The window minimizes to a compact icon.
- **On the 3D globe**, satellites orbit at true altitude with ground tracks and footprint rings; zooming in swaps dots for 3D models (real ISS model, procedural archetypes for the rest).

The tracked-satellite list is actively audited — dead and decayed birds get removed, new active ones added — so the catalog reflects what's actually usable.

Two dockable panels build on the tracking:

- **Satellite Passes** — one table of every upcoming pass for your tracked birds over the next 24 hours, sorted by AOS: countdown, start/end times, duration, compass path (e.g. SW→NE), and max elevation color-coded by quality. Passes in progress glow green with a LOS countdown. Uses your minimum-elevation setting.
- **AMSAT Status** — the community-reported AMSAT status board: which birds have been **Heard**, are **Telemetry Only**, or **Not Heard**, with report counts and recency. Passes tell you when the bird is up; this tells you whether the transponder is worth pointing at.

---

## Rig control and Rig Bridge

**Rig Bridge** is a small helper program that runs on the computer near your radio and translates between OpenHamClock and your hardware. Once it's running: click a spot, your radio tunes.

- **What needs it:** anything that touches hardware — rig CAT control, PTT/On-Air, APRS via a local TNC, rotator, MeshCom UDP, Winlink/Pat. The browser can't open serial ports; the bridge can.
- **What doesn't:** everything else in OpenHamClock works without it, hosted or self-hosted.

**Setup:** Settings → **Rig Bridge** tab → enable, download for your OS (Windows/Mac/Linux — requires Node.js and git), run it, and configure your radio in its local setup UI (default `http://localhost:5555`). Read [rig-bridge/README.md](../rig-bridge/README.md) first — it covers every radio and plugin in detail.

![Settings → Rig Bridge: enable, download for your OS, connect](images/manual/settings-rig-bridge.jpg)

_Settings → Rig Bridge: enable, download for your OS, connect_

**Plugins at a glance:**

- **Radio:** Yaesu, Kenwood, Icom over USB; rigctld, flrig, TCI (Thetis/ExpertSDR), FlexRadio SmartSDR, RTL-TCP (RX-only)
- **Digital modes:** WSJT-X, JTDX, MSHV, JS8Call — bidirectional (reply to a decode, halt TX, set free text)
- **Packet:** APRS TNC (KISS/Direwolf), Winlink (Pat client)
- **Hardware:** Rotator (rotctld)
- **Cloud:** Cloud Relay

**Cloud Relay (alpha):** using the hosted site or a cloud install? The relay connects your local rig-bridge to the server with a per-session token, enabling click-to-tune, PTT status, WSJT-X decodes, and APRS from anywhere. Connect it from Settings → Rig Bridge; the session credential lives only in your browser.

**Click-to-tune behavior:** works from DX cluster, POTA/SOTA/WWFF/WWBOTA, PSK Reporter, and WSJT-X panels. "Auto-set mode" switches CW/SSB/Data from the band plan; Yaesu rigs get true band-select commands so ATU and antenna memories follow. With a US license class set in Settings → Station, tuning outside your privileges still tunes but shows a brief warning toast (e.g. "28.6 MHz SSB is outside Technician privileges").

(The older _Rig Listener_ and _WSJT-X Relay_ standalone tools still exist but are deprecated — Rig Bridge replaces all of them.)

---

## WSJT-X and digital modes

Decodes from WSJT-X, JTDX, or anything speaking the same UDP protocol appear live in the WSJT-X panel and on the map (when grids are known), including a WSPR sub-tab with SNR, drift, and power.

- **Same machine:** WSJT-X → Settings → Reporting → UDP Server → `127.0.0.1:2237`. Done (`WSJTX_ENABLED=true` is the default).
- **Another machine on your LAN:** set `HOST=0.0.0.0` in OpenHamClock's `.env` and point WSJT-X at that machine's IP, port 2237.
- **Multicast:** running several UDP listeners (GridTracker etc.)? Set `WSJTX_MULTICAST_ADDRESS` to match WSJT-X (e.g. `224.0.0.1`) — everyone shares the stream.
- **Cloud/hosted:** UDP can't cross the internet; use the Rig Bridge WSJT-X plugin (or the legacy relay agent with `WSJTX_RELAY_KEY`) to forward decodes over HTTPS, tied to your browser session.

Selecting a callsign in WSJT-X can auto-set your DX target, and clicking a decode tunes the rig to the correct dial frequency. PSKReporter integration is separate and automatic — see the PSK Reporter panel.

---

## The EmComm layout

A purpose-built dashboard for ARES/RACES/SKYWARN and served-agency work (Settings → Display → Layout → **EmComm**). Design principle: **local-first** — with a local TNC, the core functions work over RF alone when the internet is down.

![The EmComm layout: map with range rings and alert polygons, and the operations rail](images/manual/layout-emcomm.jpg)

_The EmComm layout: map with range rings and alert polygons, and the operations rail_

- **Map:** range rings at 50/100/200 km, NWS alert polygons by severity, shelter markers, EmComm APRS stations, and an APRS source toggle (All / RF Only / Internet Only).
- **Panels:** Resource Summary (aggregated resource dashboard), NWS Alerts, FEMA Disaster Declarations, Nearby Shelters (with capacity, ♿ and 🐾 indicators — including shelter reports heard over RF), EmComm Stations, and a live Net Roster.
- **Net operations:** check in by APRS message (`CQ NETNAME <status>` to `EMCOMM`), check out with `U NETNAME`, or use the manual check-in API; the roster tracks status, last-heard, and resources.
- **Messaging:** point-to-point APRS messages (67 chars) from the roster's MSG button, sent via your local TNC.
- **Resource tokens:** structured data in APRS beacon comments — `[Beds 30/100][Power OK][Water -50]` — parsed into capacity bars, need flags, and the aggregate dashboard. Any `[Key Value]` works; built-ins include Beds, Water, Food, Power, Fuel, Med, Staff, Evac, Comms, Gen.
- **Telemetry:** APRS telemetry frames become per-station sensor dashboards with trend sparklines.
- **Winlink:** the gateway map layer and panel, plus Pat client messaging through rig-bridge.
- **Event Log:** significant events — net check-ins/outs, APRS messages sent and received, new NWS alerts, shelter and field reports, first-heard EmComm stations — are recorded automatically in your browser (capped at 2000). Export the log as **CSV** or a print-friendly **After Action Report** (with operator callsign, station location, and operation date range; use your browser's print dialog to save as PDF), or clear it between operations.
- **Field Reports:** Winlink Express at an EOC accumulates a CSV of received forms (Field Situation Reports, Damage Assessments) with embedded geolocation. Point the rig-bridge `winlink-express-csv` plugin at that file and new rows appear in the Field Reports panel and as 📋 map markers — form type, callsign, age, position, and free text. See the [rig-bridge README](https://github.com/accius/openhamclock/blob/main/rig-bridge/README.md#winlink-express-csv-ingest-beta) for setup.

Deep dive: [docs/emcomm-roadmap.md](emcomm-roadmap.md).

---

## The EME layout

A moonbounce operating dashboard (Settings → Display → Layout → **EME**). The map is pinned to the 3D globe (your saved projection for the other layouts is untouched) and framed so Earth and Moon share the view, with the **DE→Moon** and **Moon→DX** legs drawn between them: a leg is solid in its station's colour while that station can see the moon and turns dashed red once the moon drops below its horizon. The moon sits at a compressed distance (true scale is ~60 Earth radii, which would shrink Earth to a dot); the rail shows the real distance. **Frame Earth + Moon** re-centres the view after you have orbited away.

![The EME layout in MOON mode: Earth and Moon framed together with the DE→Moon and Moon→DX legs, moon readouts, sky tracks, mutual windows, and the PSK Reporter EME activity feed](images/manual/layout-eme.jpg)

_The EME layout in MOON mode: Earth and Moon framed together with the DE→Moon and Moon→DX legs, moon readouts, sky tracks, mutual windows, and the PSK Reporter EME activity feed_

The rail:

- **Moon Now** — phase, distance, declination (positive is the northern hemisphere's friend), the two-way path-loss delta against the mean distance (loss goes with distance⁴, so the perigee–apogee cycle is worth about ±2 dB), and an az/el card for each end with the next rise or set.
- **Sky Tracks** — both stations' moon tracks for the next 24 hours on one polar dial (centre = zenith, edge = horizon), with each station's moon marker; hollow markers are below the horizon at their rising azimuth.
- **Mutual Windows** — the next 48 hours of windows where _both_ ends have the moon at or above the selectable minimum elevation, with duration, the peak of the lower elevation, and a countdown to the next one. The header badge turns green while a window is open.
- **DX Target** — type a grid, click the globe, or pick a spot; lock it while you work a station.
- **EME Activity (PSK Reporter)** — every Q65 and JT65 report at 50 MHz and above from PSK Reporter's live feed over the last two hours, sender → receiver with mode, frequency, SNR and grids. Q65 is a VHF+ mode by design and JT65 above 6 m is EME, so this is where digital moonbounce activity actually shows up. Clicking a row sets the sender as the DX target. The server subscribes to the band-wide feed only while an EME layout is asking for it.
- **EME Spots (cluster)** — DX cluster spots on an amateur EME band (6 m and up) whose comment mentions EME, moonbounce, JT65, Q65, or QRA64. Clicking one sets it as the DX target.

### SAT mode: relay through a satellite

The **MOON / SAT** switch in the header swaps the moon for a repeater or transponder satellite. The globe shows only the selected satellite, at its true altitude with its footprint cone, and the legs run **DE→satellite→DX** with the same solid-or-dashed-red rule, judged against your satellite minimum elevation (Settings → Satellites). **Frame satellite** centres the view over its sub-point.

![SAT mode: the relay satellite at true altitude with its footprint cone, DE→satellite→DX legs, live look angles, and mutual passes](images/manual/layout-eme-sat.jpg)

_SAT mode: the relay satellite at true altitude with its footprint cone, DE→satellite→DX legs, live look angles, and mutual passes_

- **Relay Satellites** — your tracked satellites that carry an active repeater or transponder (an uplink _and_ a downlink in the SatNOGS transmitter database), ranked by their next mutual pass with the current DX, with mode and frequencies. Satellites without relay data stay listed, greyed, so you can see what is tracked. Clicking one selects it.
- **Live** — the satellite's position and altitude, azimuth/elevation/range from both ends, and the Doppler-corrected uplink and downlink for _your_ end, updating every second. The header badge turns green with COMMON FOOTPRINT while both stations see it.
- **Mutual Passes** — the next 24 hours of passes where both ends have the satellite at or above the minimum elevation: the common window, its duration and peak common elevation, and each station's own AOS–LOS around it.
- **Sat Spots (cluster)** — satellite contacts in the DX cluster feed: spots on satellite bands whose comment names a bird ("via SO-50", "AO-91 FM") or says SAT. When the comment names one of your tracked satellites, clicking the spot selects that satellite and sets the DX target.
- Each relay candidate also shows its **AMSAT status board** line (Heard / Not Heard / Crew Active, last heard, report count) from the same feed as the AMSAT Status panel.

DX-side Doppler is deliberately not shown — that belongs to the other operator's radio.

## Alerts and notifications

![Settings → Alerts: pick what wakes you and how](images/manual/settings-alerts.jpg)

_Settings → Alerts: pick what wakes you and how_

**Settings → Alerts** plays a tone when new items appear in a feed. Feeds: POTA, SOTA, WWFF, WWBOTA, DX Cluster, Watchlist Hits, DXpeditions, Contests, Contest Starts, Satellite Passes, Band Openings, Lightning Proximity, and Space Weather — all off by default, each with its own tone (nine Web Audio presets — no sound files) and a master volume.

Four event feeds go beyond "new item in a panel":

- **Watchlist Hits** — a spot matching your DX Cluster watchlist (Filters → Watchlist) appeared in the raw cluster feed. Matching happens _before_ your panel filters, so a watched call alerts even when the panel is filtered to something else, and portable calls match their base call (5Z4/OZ6ABL hits a watchlist entry of OZ6ABL). Re-spots of the same call on the same band stay quiet; the same call on a _new_ band alerts again — one alert per band opening.
- **Contest Starts** — strictly opt-in per contest: click the 🔔 next to a contest in the Contests panel to arm a reminder, and you'll get one alert when that contest is within 15 minutes of starting. With no contests armed, the feed stays silent even when enabled.
- **Satellite Passes** — one alert when a tracked satellite's next pass begins within 5 minutes, with the pass's max elevation.
- **Band Openings** — the server watches RBN and cluster spot streams and flags surges against a 3-hour baseline, both per band and continent path and per band and CQ zone of the stations doing the hearing. A **Scope** setting picks what you are told about: **My CQ zone** (default — "20m opening EU→zone 3 (12 spots, 4x baseline)", so a West Coast station is not woken for an East Coast opening), **My continent**, or **Worldwide**. Your zone comes from your callsign; enter it by hand if your call's prefix doesn't match where you actually operate. One alert per opening episode; quiet while the baseline is still warming after a server restart.

Sensible guardrails: no alert storm on page load or when returning to a background tab, a per-feed cooldown, and one tone per batch of new items.

**Browser notifications:** each feed also gets a 🔔 toggle to show an OS-level notification alongside the tone — delivered through the service worker, so they work while the tab is backgrounded. Grant permission with the master button at the top of the Alerts tab.

**Push with the browser closed:** the **Push (Closed Browser) — Space Weather** card in Settings → Alerts subscribes your browser to true Web Push. In this first version it covers one thing, broadcast to everyone subscribed: **severe space weather alerts** — NOAA scale **2 or higher** (G2/S2/R2 and up), the same threshold as the in-app severe-alert feed. A **Send test** button verifies the whole path end-to-end. Notes:

- Works on the hosted site out of the box. Push requires HTTPS and a service worker, so plain-http LAN installs can't use it (same browser rule as offline mode).
- **Self-hosters:** the feature is dormant until you configure VAPID keys — run `npx web-push generate-vapid-keys` once and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact) in your `.env` (see `.env.example`). Without keys, the card simply shows push as unavailable and nothing else changes.
- Per-feed/per-watchlist push (your spots, your callsign) needs server-side evaluation and is planned as a later phase.

---

## Offline mode (PWA)

OpenHamClock is an installable PWA with a real offline mode:

- After one online visit, the app shell and assets are cached. Offline, the app loads and panels show their **last-known data** (API responses are cached network-first). Live streams obviously need a connection.
- When a new version deploys, the fresh worker installs in the background and a small **"Update ready — Reload"** toast appears. Click it and you're on the new version — no more mid-session forced reloads.
- **Limitations:** service workers require a secure context. On the hosted site (HTTPS) and `localhost` everything works; a self-hosted install reached over **plain http on a LAN IP** silently skips offline mode (that's a browser rule, not ours). The Electron app updates via its installer instead.
- **Escape hatch:** load the app with **`?nosw`** in the URL (e.g. `https://openhamclock.com/?nosw`) to unregister the worker and clear its caches — handy if a bad cache ever wedges things. Remove the parameter and reload to re-register.

Separately from the PWA, the app polls the server version and — on the hosted site — reloads automatically when a new release lands.

---

## Layouts, themes, and profiles

### Layouts (Settings → Display)

| Layout          | Best for                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Modern**      | Widescreen monitors — responsive 3-column grid around the map                                                                         |
| **Classic**     | Dedicated displays and Pi kiosks — the original HamClock look, refreshed                                                              |
| **Tablet**      | 7–10" widescreen displays (16:9)                                                                                                      |
| **Compact**     | 4:3 and smaller screens — data-first                                                                                                  |
| **Dockable**    | Power users — every panel draggable, tabbable, resizable; layout lock; reset button                                                   |
| **EmComm**      | Emergency communications operations (beta)                                                                                            |
| **Contest**     | Contest operating — quick-log strip, dupe check, rate meter, session multipliers                                                      |
| **Activator**   | In the field: POTA self-spotting, activations, RBN "am I being heard", nearby repeaters — park/summit map overlays switched on        |
| **Hunter**      | Chasing activators: DX cluster, every activation program, sun & moon — spot overlays and DX paths switched on                         |
| **Weather**     | Radar, lightning, natural-hazard, and aurora overlays on a big map, with terrestrial + space weather panels                           |
| **Air Traffic** | Live aircraft and ATC sector overlays over a dominant map, with the Aircraft Nearby list and world clocks                             |
| **EME**         | Moonbounce and satellite relay on the 3D globe — DE→Moon→DX or DE→satellite→DX legs, mutual windows and passes, activity feeds (beta) |

<table>
<tr><td width="50%" valign="top"><img src="images/manual/layout-modern.jpg" alt="Modern"><br><sub>Modern</sub></td><td width="50%" valign="top"><img src="images/manual/layout-classic.jpg" alt="Classic"><br><sub>Classic</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/layout-tablet.jpg" alt="Tablet"><br><sub>Tablet</sub></td><td width="50%" valign="top"><img src="images/manual/layout-compact.jpg" alt="Compact"><br><sub>Compact</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/layout-dockable.jpg" alt="Dockable"><br><sub>Dockable</sub></td><td width="50%" valign="top"><img src="images/manual/layout-emcomm.jpg" alt="EmComm"><br><sub>EmComm</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/layout-contest.jpg" alt="Contest"><br><sub>Contest</sub></td><td width="50%" valign="top"><img src="images/manual/layout-eme.jpg" alt="EME"><br><sub>EME</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/layout-activator.jpg" alt="Activator"><br><sub>Activator</sub></td><td width="50%" valign="top"><img src="images/manual/layout-hunter.jpg" alt="Hunter"><br><sub>Hunter</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/layout-weather.jpg" alt="Weather"><br><sub>Weather</sub></td><td width="50%" valign="top"><img src="images/manual/layout-airtraffic.jpg" alt="Air Traffic"><br><sub>Air Traffic</sub></td></tr>
</table>

The four focus layouts (Activator/Hunter/Weather/Air Traffic) fully reset the overlays each time you switch into one: the layout's own preset is applied exhaustively, and when you leave, your previous layer setup is restored exactly as it was.

**Named dockable layouts.** The Dockable layout can hold more than one arrangement. In the sidebar's layout controls (next to the lock and reset buttons), **⧉ Duplicate** saves the current arrangement as a named preset — up to 10 — and the dropdown switches between them live. Rename (✎) and delete (✕) manage your presets; the built-in **Default** is your original layout and can't be renamed or deleted. Presets are included in profiles, backups, and settings sync like everything else.

**Scene rotation.** For shack TVs and club-station kiosks: Settings → Display → **Scene Rotation** cycles automatically through layouts you select, at an interval from 30 seconds to 10 minutes. Rotation pauses whenever a dialog is open and whenever someone touches the screen, mouse, or keyboard (it waits for 60 seconds of quiet before rotating again). While rotating, a small dot sits in the bottom-right corner and the new layout's name flashes briefly on each switch. Named dockable presets appear in the rotation list as "Dockable — _name_", so a kiosk can cycle through several dock arrangements; the plain "Dockable" entry keeps whichever preset is currently active. Saved profiles appear as "Profile — _name_" scenes too: rotating into one restores that profile's complete configuration (theme, layers, filters, layout — everything) and reloads the page, while your rotation settings carry over so the cycle keeps going. Because profiles live only in the browser that saved them, a profile scene is silently skipped on any device that doesn't have it.

### Contest mode

A dedicated single-screen layout for contest weekends — no map, maximum information density, and everything one keystroke away.

![The Contest layout: quick-log strip, rate meter, multipliers, and the cluster pane](images/manual/layout-contest.jpg)

_The Contest layout: quick-log strip, rate meter, multipliers, and the cluster pane_

- **Quick-log strip.** A persistent callsign box sits right under the header. As you type, it renders an instant verdict for the current band+mode: **DUPE** (already worked on this band+mode), **WKD** (in the log, but not on this band+mode), or **NEW** — plus a **NEW ENTITY** / **NEW BAND** flag when the call's DXCC entity would be an all-time or band new one. Press **Enter** and the QSO is logged straight into the native logbook with the rig's current frequency and mode (or the manual band/mode picks when no rig is connected), the box clears, and focus stays put for the next call. **Esc** clears without logging. RST defaults follow the mode (59 phone / 599 everything else), and QSOs flow to Wavelog/QRZ push if those integrations are on.
- **Contest picker.** A select in the header chooses the contest, and the quick-log strip grows the right exchange columns for it — labeled, validated, and cty.dat-autofilled where possible: **CQ WW DX** (RST + CQ zone, zone autofilled from the callsign), **CQ WPX** (RST + serial), **ARRL DX** (RST + a smart State/Power field — a state or province maps to ADIF `STATE`, a wattage to `RX_PWR`), **ARRL Field Day** (class + section), **ARRL Sweepstakes** (serial + precedence + check + section), **IARU HF** (RST + ITU zone or HQ society, zone autofilled), **NAQP** (name + state/province), plus **Generic serial** and the default **General DX** (RST only — the original behavior). Contests that need your own sent values (my zone / class / section / precedence-check / name) collect them once in a compact setup row before logging enables; serial contests show your auto-incrementing sent number (recomputed from the session log, so it survives reloads). Every logged QSO carries the full ADIF contest mapping — `CONTEST_ID` (mode-correct, e.g. `CQ-WW-CW` vs `CQ-WW-SSB`), `STX`/`SRX` serials, `STX_STRING`/`SRX_STRING` composites, and the specific fields ADIF defines (`CQZ`, `ITUZ`, `CLASS`, `ARRL_SECT`, `PRECEDENCE`, `CHECK`, `STATE`, `MY_CQ_ZONE`, …) — so the ADIF export drops straight into a log checker. Switching contests mid-session warns first; logged QSOs are never modified.
- **Rate meter.** QSOs in the last 10 and 60 minutes, the extrapolated hourly rate, and a trailing-hour sparkline in 5-minute buckets.
- **Session multipliers.** Click **Start contest** in the header (name optional) to drop a session marker. From then on the multiplier tracker counts the chosen contest's multiplier dimensions worked since that moment, overall and per band — CQ zones **and** DXCC entities for CQ WW, WPX prefixes (standard prefix rule: `K5AB`→K5, `PJ2/W9WI`→PJ2) for WPX, sections for Sweepstakes, states/provinces for NAQP and the DX side of ARRL DX, ITU zones/societies for IARU — using the same cty.dat resolution as the Awards panel. The default General DX pick keeps the original DXCC + zones + states trio. The **score estimate** is QSOs × multipliers — still an estimate, since real contests apply per-QSO point values (Field Day has no mults, so its score is plain QSOs and sections show as info). **Stop** only clears the marker: every QSO stays in the shared logbook.
- **Spot-and-pounce.** The right side is a full-height DX cluster pane — the same worked/dupe/NEW badges from [Worked-before badges](#worked-before-badges) do the heavy lifting — with the PSK Reporter / WSJT-X panel below it. Click a spot to tune the rig **and drop its callsign into the quick-log strip** with the exchange autofilled and the first exchange field focused — work them, type the exchange, Enter. The 📓 log-this-spot buttons feed the strip the same way in this layout.

The session marker syncs and profiles like any other setting, so a mid-contest browser restart (or a second screen on the same instance) picks up where you left off.

### Themes (Settings → Display)

![Settings → Display: layout, theme, fonts, header size, scene rotation](images/manual/settings-display.jpg)

_Settings → Display: layout, theme, fonts, header size, scene rotation_

The interface chrome — panel picker, settings tabs, sidebar, and map control buttons — now uses a stroke-based line-icon set instead of emoji, so icons render identically on every OS and follow your theme colors. Panels added by plugins keep showing their emoji.

**Dark** (default), **Light**, **Legacy** (green CRT terminal), **Retro** (90s Windows), and **Custom** — a full editor for backgrounds, text, borders, map ocean, and every accent color. You can also pick the monospace font used for callsigns and frequencies (JetBrains Mono, Fira Code, IBM Plex Mono — the latter two with slashed zeros). Six more themes join the lineup, and the character themes bring a whole design language, not just a palette: **Matrix** (the movie treatment — live katakana digital rain falling behind translucent glass panels, CRT scanlines, phosphor glow, flickering headers, all-monospace; the rain is skipped in Low Memory Mode and under reduced-motion), **8-Bit** (console graphics — pixel font on headers and buttons, stepped pixel-rounded dialog corners, solid menu-bar headers, buttons that physically press in, pixelated map tiles), **Trek** (LCARS-style bridge console — pure black wells with rounded orange/lavender elbow bars, pill headers and pill buttons, condensed all-caps type), **Steampunk** (brass double-frame panels with corner rivets, engraved serif headers, sepia-aged map tiles), plus two color moods: **Midnight** (deep blue and ice) and **Ember** (tube-amp warmth). All work everywhere the built-in themes do, including the map ocean color and both 2D and 3D projections. Self-hosted installs get the pixel and LCARS fonts after re-running `scripts/vendor-download.sh`; without them the themes fall back to system faces.

<table>
<tr><td width="50%" valign="top"><img src="images/manual/theme-light.jpg" alt="Light"><br><sub>Light</sub></td><td width="50%" valign="top"><img src="images/manual/theme-retro.jpg" alt="Retro"><br><sub>Retro</sub></td></tr>
<tr><td width="50%" valign="top"><img src="images/manual/theme-trek.jpg" alt="Trek (LCARS)"><br><sub>Trek (LCARS)</sub></td><td width="50%" valign="top"><img src="images/manual/theme-midnight.jpg" alt="Midnight"><br><sub>Midnight</sub></td></tr>
</table>

The four **season themes** each bring a palette, a matching map tint, and living weather drawn over the interface: **Winter** (frost-steel blues with drifting snow and frost creeping down panel edges), **Spring** (a light meadow theme with falling blossom petals), **Summer** (sun-washed sand with fireflies wandering after dark colors), and **Fall** (foliage golds and maple reds with tumbling leaves). The animations follow the same rules as the Matrix rain — skipped in Low Memory Mode and under reduced-motion. Each season also hides at least one easter egg that only appears on the right day of the year; we won't spoil the dates, but operators who work Field Day may notice the fireflies acting oddly well-trained.

**Christmas Eve 🎅** — from 24 December 10:00 UTC (midnight in the first time zone) the 3D globe and the flat map show Santa's sleigh and reindeer working westward around the world, one time zone per hour, with a status line naming the city he is over, his next stop, and the presents delivered so far. He is parked at the North Pole before launch and after the run, and gone again on 26 December. To show it to the kids on any other day, open the app with `?santa=1` (or `?santa=2026-12-24T18:00Z` for an exact moment); `?santa=off` switches the simulation off again.

Display extras: header size slider, local-time-first clock swap, mutual-reception star toggle, a **Display Schedule** (sleep/wake times for shack TVs, with an option to keep the HDMI signal alive), **Keep Awake** wake-lock, and **Low Memory Mode** for machines under 8 GB.

### Profiles (Settings → Profiles)

A profile captures _everything_ — callsign, location, theme, layout, dock arrangement, map layers, filters, satellite selection, propagation preferences, units. Save under a name, **Load** to switch (page reloads), **Update** to overwrite, **Export/Import** as JSON to move between devices or operators. Perfect for shared shacks and contest-vs-everyday setups. Profiles can also be selected as **Scene Rotation** scenes (Settings → Display), so a kiosk can cycle through entire saved configurations, not just layouts — renaming a profile keeps it in the rotation.

![Settings → Profiles: save, load, export/import, share codes, and full backup](images/manual/settings-profiles.jpg)

_Settings → Profiles: save, load, export/import, share codes, and full backup_

**Share codes**. Every saved profile also gets a 🔗 **Copy share code** button — the whole profile packed into a single `OHC1:…` string you can paste into an email, a group chat, or a forum post. The receiving side pastes it into **Import from Share Code** on the same tab and gets your layout as a new named profile. Codes are compressed and decoded entirely in the browser; nothing is uploaded anywhere.

**Full Backup**. The answer to "the logbook lives only in this browser": **Export Full Backup** downloads one `ohc-backup-YYYYMMDD-HHMMSS.json` containing every settings key, all saved profiles, _and_ your entire logbook. **Restore from Backup** reads such a file on a new machine (or after a browser wipe): settings are overwritten, QSOs are merged into the existing log with duplicates skipped, and you get a summary of what was restored. Callbook logins (QRZ/HamQTH) and API keys are deliberately **not** included in backup files — they stay private to each browser, so re-enter them after a restore. The tab also shows when this browser last exported a backup.

---

## Languages

The interface ships in **16 languages**: English, Français, Español, Català, Deutsch, Nederlands, Italiano, Português, 日本語, ქართული, 한국어, Melayu, Русский, Slovenščina, ไทย, and 简体中文. Pick yours in Settings → Station. Map tile labels follow your chosen language where the tile provider supports it.

Want to add or improve one? See the [translation guide in CONTRIBUTING.md](../CONTRIBUTING.md#translations) — partial translations are welcome.

---

## Settings reference

A quick map of where things live (⚙ Settings, via the gear or your callsign):

![Settings → Station: callsign, location, units, language, cluster source, propagation defaults](images/manual/settings-station.jpg)

_Settings → Station: callsign, location, units, language, cluster source, propagation defaults_

![Settings → Integrations: basemap key, callbooks, rotator, N3FJP](images/manual/settings-integrations.jpg)

_Settings → Integrations: basemap key, callbooks, rotator, N3FJP_

| Tab                 | What's in it                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📻 **Station**      | Callsign, grid/lat-lon (with "use my location"), timezone, units (distance/temperature/pressure), language, DX cluster source, callbook picker, propagation mode & TX power, performance mode, wake lock & display schedule, Active Users opt-out, legacy rig control |
| 🔌 **Integrations** | CARTO basemap key, QRZ.com and HamQTH callbook credentials, and local-only extras: Rotator, DX Weather popups, N3FJP bridge                                                                                                                                           |
| 🎨 **Display**      | Layout, theme (+ custom theme editor), monospace font, header size, clock order, What's New on startup, mutual-reception star                                                                                                                                         |
| 🗺️ **Map Layers**   | Every overlay layer with enable + opacity, grouped by category; DE/DX markers, DX Target panel, and DX News ticker toggles                                                                                                                                            |
| 🛰️ **Satellites**   | Satellite selection, tracks/footprints, station altitude, minimum elevation, track duration                                                                                                                                                                           |
| 👤 **Profiles**     | Save/load/rename/export/import named profiles; profile share codes and full backup/restore; weather source picker — Open-Meteo (default, keyless) or OpenWeatherMap with your own key; export current state                                                           |
| 🌐 **Community**    | GitHub, Facebook group, Reddit; core maintainers and the contributors wall; the privacy statement (no cookies, no tracking, anonymized stats)                                                                                                                         |
| 🔔 **Alerts**       | Per-feed audio alerts, tones, master volume, browser notifications                                                                                                                                                                                                    |
| 📻 **Rig Bridge**   | Enable/connect, downloads for each OS, API token, click-to-tune and auto-mode, plugin overview, Cloud Relay                                                                                                                                                           |
| ❓ **Help**         | This manual, rendered in-app with a searchable contents sidebar; the ❓ icons throughout the app deep-link here                                                                                                                                                       |

Settings save to your browser; **Save Settings** applies them. Most `.env` variables mirror a Settings option — the browser value wins.

---

## Hosted site vs self-hosted

Both run the same code; the differences come down to hardware access and being a good neighbor on a shared server:

| Capability                                                    | openhamclock.com (hosted)                               | Self-hosted                                  |
| ------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| All panels, layers, propagation, logbook                      | ✅                                                      | ✅                                           |
| DX cluster source                                             | OpenHamClock Cluster (locked)                           | Your choice, including custom telnet and UDP |
| Rig control                                                   | ✅ via Rig Bridge + Cloud Relay                         | ✅ via Rig Bridge directly                   |
| WSJT-X decodes                                                | ✅ via Rig Bridge / relay agent                         | ✅ direct UDP                                |
| Rotator, N3FJP bridge, DX weather popups, Global Clouds layer | ❌ (local-only)                                         | ✅                                           |
| Callbook credentials (QRZ/HamQTH)                             | Per-user, verified then stored **in your browser only** | Server-wide via Settings or `.env`           |
| Settings sync across devices                                  | ❌ (use profile export)                                 | ✅ optional `SETTINGS_SYNC=true`             |
| APRS-IS feed                                                  | Shared server connection                                | Your own connection, your own filter         |

Local-install detection is automatic (localhost, LAN IPs, `.local`/`.lan` hostnames); a self-hosted server can force it with `SERVERLOCAL=true` — useful behind a reverse proxy with a public domain name.

---

_Something missing or wrong? Documentation PRs are welcome — see [CONTRIBUTING.md](../CONTRIBUTING.md#documentation). 73!_
