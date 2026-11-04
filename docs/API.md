# OpenHamClock REST API

OpenHamClock's server exposes a small HTTP API. Most of it exists to feed the
app's own UI, but two groups of endpoints are intentionally open for third
parties:

1. **The QSO layer write API** — lets _any_ logging application push logged
   QSOs onto the user's map (issue [#1015](https://github.com/accius/openhamclock/issues/1015)).
   You don't need N3FJP, N1MM, or WSJT-X — anything that can send an HTTP POST
   can plot contacts.
2. **A read surface** of stable, cache-backed data endpoints that other tools
   may consume.

Everything else under `/api/*` is an **internal implementation detail** — see
[What is NOT a stable contract](#what-is-not-a-stable-contract).

- [QSO Layer API (write)](#qso-layer-api-write)
- [IBP beacon measurements](#ibp-beacon-measurements)
- [Remote control API](#remote-control-api)
- [Shared incident API](#shared-incident-api)
- [Public read endpoints](#public-read-endpoints)
- [Authentication](#authentication)
- [Rate limits & courtesy](#rate-limits--courtesy)
- [CORS](#cors)
- [What is NOT a stable contract](#what-is-not-a-stable-contract)

All endpoints speak JSON. Examples below assume a self-hosted instance at
`http://localhost:3000`.

---

## QSO Layer API (write)

Push logged QSOs to OpenHamClock; they render on the map via the
**Logged QSOs (API)** layer (Settings → Map Layers, off by default, available
on self-hosted installs). Storage is in-memory on your own instance: capped at
500 QSOs (`QSO_LAYER_MAX_QSOS`), pruned after 24 hours
(`QSO_LAYER_RETENTION_MINUTES`), and cleared on server restart — this is a live
map layer, not a logbook.

### `POST /api/qso-layer`

Accepts a single QSO object, a bare array, or `{ "qsos": [...] }`.
Batches are capped at **100 QSOs per request**.

| Field       | Type             | Required | Notes                                                                                         |
| ----------- | ---------------- | -------- | --------------------------------------------------------------------------------------------- |
| `call`      | string           | yes      | Callsign of the worked station (portable `/` suffixes OK); drawn as a label beside the marker |
| `grid`      | string           | \*       | Maidenhead locator, 2/4/6/8 chars (e.g. `FN42`)                                               |
| `lat`,`lon` | number           | \*       | Decimal degrees; takes precedence over `grid` when both sent                                  |
| `freq`      | number           | no       | Frequency in **MHz** (`freq_khz` also accepted)                                               |
| `band`      | string           | no       | e.g. `20m`; derived from `freq` when omitted                                                  |
| `mode`      | string           | no       | e.g. `SSB`, `CW`, `FT8`                                                                       |
| `timestamp` | string \| number | no       | ISO 8601 or epoch **ms**; defaults to server "now"                                            |
| `label`     | string           | no       | Free text shown in the marker popup (max 120 chars)                                           |
| `color`     | string           | no       | CSS color for this QSO's marker/path (`#rrggbb` or named)                                     |

\* At least one of `grid` or `lat`+`lon` is required — a QSO that can't be
placed on the map is rejected. Unknown fields are silently dropped.

```bash
# Single QSO by grid
curl -X POST http://localhost:3000/api/qso-layer \
  -H 'Content-Type: application/json' \
  -d '{"call":"EA8BFK","grid":"IL18","band":"20m","mode":"SSB","freq":14.230}'

# Batch, with per-QSO color and label
curl -X POST http://localhost:3000/api/qso-layer \
  -H 'Content-Type: application/json' \
  -d '{"qsos":[
        {"call":"VK3ABC","lat":-37.8,"lon":144.9,"mode":"FT8","freq":14.074},
        {"call":"JA1XYZ","grid":"PM95","mode":"CW","color":"#ff8800","label":"POTA JP-0014"}
      ]}'
```

Response:

```json
{ "ok": true, "accepted": 2, "rejected": 0, "stored": 2 }
```

Invalid entries are reported per-index in `errors` while valid entries in the
same batch are still accepted. A batch with zero valid QSOs returns `400`.

Re-sending an identical QSO (same `call` + `timestamp` + `freq`) replaces the
stored copy instead of duplicating it, so retry loops in loggers are safe.

### `GET /api/qso-layer`

Returns the stored QSOs (this is what the map layer polls):

```json
{
  "ok": true,
  "retention_minutes": 1440,
  "max_qsos": 500,
  "qsos": [
    {
      "call": "EA8BFK",
      "lat": 28.5,
      "lon": -17.0,
      "grid": "IL18",
      "freq": 14.23,
      "band": "20m",
      "mode": "SSB",
      "ts_utc": "2026-08-28T12:00:00.000Z",
      "source": "api"
    }
  ]
}
```

### `DELETE /api/qso-layer`

Clears all stored QSOs (e.g. when your logger starts a new session).
Same auth as POST.

```bash
curl -X DELETE http://localhost:3000/api/qso-layer
```

---

## IBP beacon measurements

SNR of the 18 NCDXF/IARU International Beacon Project beacons as measured by
a listening station — normally the Rig Bridge **KiwiSDR Beacon Monitor**
plugin, but any tool that can measure a beacon may post here. Storage is
in-memory and bounded: 72 hours, 20 000 measurements per station, 50
stations (least recently updated evicted first). Nothing is persisted across
server restarts.

### `POST /api/ibp/measurements`

Gated like the other write endpoints (`Authorization: Bearer <API_WRITE_KEY>`
when the instance has one; 20 requests/min per IP). At most 500
measurements per request; the beacon monitor posts once per 3-minute cycle.

```json
{
  "station": { "callsign": "KE8PLM", "grid": "EN82", "lat": 42.1, "lon": -83.5 },
  "kiwi": { "id": "kiwi.example.org:8073", "name": "Home Kiwi" },
  "measurements": [
    {
      "beacon": "4U1UN",
      "band": "20m",
      "t": 1760443200000,
      "snrDb": 14.2,
      "levelDbm": -86.1,
      "noiseDbm": -100.3,
      "n": 183
    }
  ]
}
```

| Field                                    | Meaning                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `station.callsign`                       | Listening station id (uppercased). Optional when `kiwi.id` is given — then the id is `KIWI:<kiwi.id>` |
| `measurements[].beacon`                  | One of the 18 IBP callsigns (`4U1UN` … `YV5B`)                                                        |
| `measurements[].band`                    | `20m`, `17m`, `15m`, `12m` or `10m`                                                                   |
| `measurements[].t`                       | Slot start, Unix ms (rounded to 10 s; must be within the last 72 h)                                   |
| `measurements[].snrDb`                   | Signal above the per-band noise floor, dB                                                             |
| `levelDbm`, `noiseDbm`, `medianDbm`, `n` | Optional diagnostics (S-meter level, noise floor, median, sample count)                               |

Response: `{ "ok": true, "accepted": 1, "rejected": 0, "station": "KE8PLM" }`.
Re-sending a batch after a failed request is safe — the same (beacon, band,
slot) replaces rather than duplicates.

### `GET /api/ibp/measurements?station=<id>&band=20m&hours=24`

Measurements for one station, oldest first. `hours` ≤ 72 (default 24);
`since=<ms>` overrides it; `band` filters. Unknown stations return
`{ "station": "…", "measurements": [], "known": false }`.

### `GET /api/ibp/stations`

Stations that have posted recently, with callsign, grid, Kiwi id/name, count
and last-update time.

```bash
curl -s 'http://localhost:3000/api/ibp/measurements?station=KE8PLM&hours=6' | jq '.measurements | length'
```

The Rig Bridge also serves its own copy without the server:
`GET http://localhost:5555/api/beacon-monitor/measurements?hours=24` and
`GET http://localhost:5555/api/beacon-monitor/status`.

## Remote control API

Commands for the running display — set DE/DX, switch
layout or theme, toggle map layers, pick a satellite, shift the clock, drive
the stopwatch, point the rotator, grab a screenshot. A phone-sized touch
remote that uses nothing but these endpoints ships at **`/remote`** (the QR
code in Settings → Station opens it).

**How it works.** Each browser showing OpenHamClock picks a stable display id
(`controlId`, shown in Settings → Station → Remote control) and, while
remote control is enabled there, listens on an SSE channel
(`GET /api/control/stream?target=<id>`) and reports its state
(`POST /api/control/report`) every 30 s and on change. A command you POST is
validated, queued for the target display (up to 20 commands, 60 s, while it
is offline) and applied through the app's own setters. Remote control is on
by default on self-hosted/LAN installs and off on the hosted site.

- Every command is `POST /api/control/<command>` with a JSON body.
- `?target=<controlId>` picks the display. Without it the command goes to
  **every connected display on this server** — handy on a Pi with one screen.
  Where `OHC_HOSTED` is set (openhamclock.com), or `CONTROL_REQUIRE_TARGET=true`,
  a target is mandatory.
- Rate limit: 20 command requests/min per IP (`writeLimiter`).
- Responses: `{ ok, command, targets, live, queued }` — `live` is how many
  displays received it immediately, `queued` whether it waits for a reconnect.
  `404 No display connected` means nobody is listening (broadcast mode only).

### Authentication: pairing key or admin key

Two keys open a display, and either one is sent the same way —
`Authorization: Bearer <key>`, an `X-Control-Secret: <key>` header, or
`?key=<key>` (handy for the screenshot URL):

| Key                             | Where it comes from                                                                                                                                                                                                                                                                                                                           | Opens                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pairing key** (per display)   | Generated by the display next to its id (`localStorage` `openhamclock_controlSecret`, 32 url-safe chars) and embedded in the phone-remote URL / QR code in Settings → Station (`/remote?target=<id>&key=<pairing key>`). The display registers it with its first `report`/`stream`; the server keeps only a SHA-256 hash and never echoes it. | Everything that names that display: `POST /api/control/<command>?target=<id>`, `GET /api/control/state?target=<id>`, `GET /api/control/capture.png?target=<id>`. Not broadcast, not `/displays`, not `rotator`.     |
| **Admin key** (`API_WRITE_KEY`) | The server's global write key, as for every other write endpoint.                                                                                                                                                                                                                                                                             | Everything, for any display, including broadcast (no target), `/displays` and `rotator`. When the server sets no `API_WRITE_KEY` it is open, as elsewhere: broadcast and targeted commands then need no key at all. |

So on a server that sets `API_WRITE_KEY` (openhamclock.com) a user drives
**their own** display with the key from **their own** QR code and never sees
the site key; `401` = no key sent, `403` = key not accepted (wrong key, or the
display has not paired yet because it has not reported). The first display to
report a given id with a secret claims it; a different secret for the same id
is refused with `403` (the display shows "Id in use" — **New id** in Settings
regenerates id and key). Once paired, the display's own channel —
`GET /api/control/stream?target=&secret=`, `POST /api/control/report`
(`{target, secret, state}`) and the `capture` upload (`X-Control-Secret`) —
must present the same secret, so nobody else can listen to its command
stream or forge its state. Comparisons are constant-time; the secret is never
written to logs or returned by `/state` (`sanitizeStateReport` copies only
known fields and the secret travels beside `state`, never inside it).

`GET /api/control` reports `pairing: true` so clients know a display's own key
is accepted; `GET /api/control/state?target=` answers with `paired` and
`auth: "open" | "master" | "pairing"` (how you were let in).

| Command (`POST /api/control/…`) | Body                                                                                                                                         | HamClock equivalent | Effect on the display                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `de`                            | `{grid}` or `{lat, lon}`, optional `call`                                                                                                    | `set_newde`         | Moves DE (Settings → Station location, locator derived) and optionally the callsign                                                                                                                    |
| `dx`                            | `{grid}` or `{lat, lon}` or `{call}`                                                                                                         | `set_newdx`         | Sets the DX marker; a bare `call` is looked up (callbook/prefix)                                                                                                                                       |
| `layout`                        | `{layout}` — `modern classic tablet compact dockable emcomm contest eme clock activator hunter weather airtraffic`, or `dockable#<presetId>` | —                   | Switches the layout (and named dockable preset)                                                                                                                                                        |
| `theme`                         | `{theme}` — `dark light legacy retro matrix eightbit steampunk trek midnight ember winter spring summer fall custom`                         | —                   | Switches the theme                                                                                                                                                                                     |
| `panels`                        | `{add:[ids], remove:[ids], focus:id}`                                                                                                        | `set_pane`          | Dockable layout: add/focus or close panels by id (ids as in `src/panelDefs.js`, e.g. `dx-cluster`)                                                                                                     |
| `mapview`                       | `{projection, basemap, layers:{id:bool}, night:bool, grid:bool}`                                                                             | `set_mapview`       | Projection `mercator\|azimuthal\|globe3d`; basemap id (`dark streets satellite MODIS terrain topo …`); layer toggles (ids from Settings → Map Layers, e.g. `grayline`); night shading; Maidenhead grid |
| `satellite`                     | `{name}` or `{name:"none"}`                                                                                                                  | `set_satname`       | Selects a tracked satellite on the map (`none` clears)                                                                                                                                                 |
| `time`                          | `{time:"now"}`, `{offsetMs}` or `{iso}`                                                                                                      | `set_time`          | Clock offset for the display (dispatched as `ohc:set-time`)                                                                                                                                            |
| `title`                         | `{text, fg?, bg?}` — up to six titles separated by `;`, `text:null` clears                                                                   | `set_title`         | Session-only text (and colours) in the callsign box, rotating every 10 s                                                                                                                               |
| `alarm`                         | `{kind:"once"\|"daily"\|"off", time:"HH:MM", utc:bool, armed:bool}`                                                                          | `set_alarm`         | Dispatched as `ohc:set-alarm` for the alarm feature                                                                                                                                                    |
| `stopwatch`                     | `{action:"reset"\|"run"\|"stop"\|"lap"\|"countdown", minutes?}`                                                                              | `set_stopwatch`     | Drives the Stopwatch panel                                                                                                                                                                             |
| `rotator`                       | `{az}` / `{el}` / `{stop:true}`                                                                                                              | `set_rotator`       | Forwarded to the server's rotator (`ROTOR_PROVIDER`); 503 when none is configured                                                                                                                      |
| `touch`                         | `{x, y}`                                                                                                                                     | `set_touch`         | Synthesises a click at viewport coordinates (optional, for automation)                                                                                                                                 |
| `capture`                       | —                                                                                                                                            | `get_capture.bmp`   | Asks the display to upload a fresh frame (see below)                                                                                                                                                   |

Read-backs:

| Endpoint                                             | Returns                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/control`                                   | `{commands, requireTarget, writeKeyRequired, displays}`                                                                                                                                                                     |
| `GET /api/control/state?target=<id>`                 | `{target, connected, lastReport, state}` — the display's last report: callsign, DE/DX, layout, theme, projection, basemap, time offset, titles, docked panels, tracked satellites, map layers with on/off, kiosk/demo flags |
| `GET /api/control/state` (no target, local only)     | `{displays: {<id>: {connected, lastReport, state}}}`                                                                                                                                                                        |
| `GET /api/control/displays` (local only)             | `{displays:[{id, connected, lastReport, callsign, layout}]}`                                                                                                                                                                |
| `GET /api/control/capture.png?target=<id>&wait=5000` | The display's latest PNG frame. Sends a `capture` command first and waits up to `wait` ms (max 15 s) for a fresh upload; falls back to the last stored frame (`X-Frame-Stale: true`); `404`/`504` when none                 |

```bash
# All examples: self-hosted at http://localhost:3000, one display → no target needed.
# Add  -H "Authorization: Bearer $API_WRITE_KEY"  when the server sets a key,
# and  ?target=ohc-xxxxxxxxxxxx  to address one display (required on the hosted site).

# With the display's own pairing key (copy it from the phone-remote URL in
# Settings → Station: the value after &key=). Works on any server, including
# ones with API_WRITE_KEY set — no admin key needed for your own display.
T=ohc-xxxxxxxxxxxx; PAIR=the32charPairingKeyFromTheQrCode_
curl -X POST "https://openhamclock.com/api/control/dx?target=$T" \
  -H "Authorization: Bearer $PAIR" -H 'Content-Type: application/json' -d '{"call":"JA1ABC"}'
curl -X POST "https://openhamclock.com/api/control/layout?target=$T" \
  -H "X-Control-Secret: $PAIR" -H 'Content-Type: application/json' -d '{"layout":"contest"}'
curl "https://openhamclock.com/api/control/state?target=$T" -H "Authorization: Bearer $PAIR" | jq .state.layout
curl -o shack.png "https://openhamclock.com/api/control/capture.png?target=$T&key=$PAIR"

# DX by grid / by callsign; DE by coordinates
curl -X POST localhost:3000/api/control/dx -H 'Content-Type: application/json' -d '{"grid":"PM95"}'
curl -X POST localhost:3000/api/control/dx -H 'Content-Type: application/json' -d '{"call":"JA1ABC"}'
curl -X POST localhost:3000/api/control/de -H 'Content-Type: application/json' -d '{"lat":40.015,"lon":-105.27}'

# Layout, theme, panels (dockable)
curl -X POST localhost:3000/api/control/layout -H 'Content-Type: application/json' -d '{"layout":"contest"}'
curl -X POST localhost:3000/api/control/theme  -H 'Content-Type: application/json' -d '{"theme":"retro"}'
curl -X POST localhost:3000/api/control/panels -H 'Content-Type: application/json' \
  -d '{"add":["sat-passes"],"remove":["contests"],"focus":"dx-cluster"}'

# Map: 3D globe, dark basemap, gray line on, grid off, night shading off
curl -X POST localhost:3000/api/control/mapview -H 'Content-Type: application/json' \
  -d '{"projection":"globe3d","basemap":"dark","layers":{"grayline":true},"grid":false,"night":false}'

# Satellite, time, title, alarm, stopwatch
curl -X POST localhost:3000/api/control/satellite -H 'Content-Type: application/json' -d '{"name":"ISS (ZARYA)"}'
curl -X POST localhost:3000/api/control/time      -H 'Content-Type: application/json' -d '{"iso":"2026-12-25T18:00:00Z"}'
curl -X POST localhost:3000/api/control/time      -H 'Content-Type: application/json' -d '{"time":"now"}'
curl -X POST localhost:3000/api/control/title     -H 'Content-Type: application/json' -d '{"text":"Field Day;W1AW","fg":"#000","bg":"#ffb000"}'
curl -X POST localhost:3000/api/control/alarm     -H 'Content-Type: application/json' -d '{"kind":"daily","time":"06:30","utc":true}'
curl -X POST localhost:3000/api/control/stopwatch -H 'Content-Type: application/json' -d '{"action":"countdown","minutes":10}'

# Rotator (needs ROTATOR_PROVIDER on this server)
curl -X POST localhost:3000/api/control/rotator -H 'Content-Type: application/json' -d '{"az":245}'

# What is the display showing? / screenshot
curl "localhost:3000/api/control/state?target=ohc-xxxxxxxxxxxx" | jq .state.layout
curl -o shack.png "localhost:3000/api/control/capture.png?target=ohc-xxxxxxxxxxxx"
```

**Screenshot limitations.** Inside the desktop (Electron) app the frame is a
pixel-perfect `webContents.capturePage()`. In a plain browser there is no
DOM-to-image API without a dependency, so the display composites what it can
— background, the 3D globe / azimuthal / chart canvases and, when the browser
permits, the map tiles; text panels are not rendered. Use the Electron app or
a desktop screenshot tool when you need the full picture.

Environment: `CONTROL_REQUIRE_TARGET` (default: true when `OHC_HOSTED` is
set), `CONTROL_MAX_DISPLAYS` (50 local / 2000 hosted), `MAX_SSE_PER_IP` (10).
Everything is in memory: a server restart forgets reports, queues and frames.

---

## Shared incident API

The EmComm layout's **Incident** panel uses these endpoints to share one
operating picture between operators and sites: a net roster, an event log,
field and shelter reports, an incident board (name, IC, net frequency,
notes), and shared working documents (ICS form drafts, the running voice net
and its history). Anything that can make an HTTP request can join in. For
example, a script can post check-ins from a voice net logger, or a dashboard
can show the live roster.

**Keys and roles.** `POST /api/incident` returns an `id` (8 characters) and
two keys of 16 characters, each shown only once. The server stores only a
salted SHA-256 of each key and checks both in constant time.

- **`joinKey`** admits an **operator**. An operator can read, append roster
  entries, events and reports, check stations out, and save the shared
  documents.
- **`adminKey`** admits an **admin**, normally the creator. An admin can do
  everything an operator can, and also:
  - edit and delete events and reports (`/admin`),
  - change or clear the board (operator board writes are ignored and listed
    in `denied`),
  - replace the join key (`/rotate`),
  - read the current join key: admin replies to join, read and the stream
    snapshot include `joinKey`, so any device holding the admin key can hand
    out invites.

The join key is never stored in plaintext. Besides its hash, the server keeps
a copy sealed with AES-256-GCM under a key derived (HKDF-SHA256) from the
admin key. Only a request that presents the admin key can open it.

A key travels only as an `X-Incident-Key: <key>` header or as `key` in a JSON
body. It is never accepted in a URL, so proxy logs never see it. The live
stream, which cannot send headers, uses a one-time ticket instead.

Ids and keys use `A–Z 2–9` without `I L O 0 1`. Case, spaces and dashes are
ignored. A wrong key returns `403`. An unknown id returns `404` on a
self-hosted server, and the same `403` as a wrong key when `OHC_HOSTED` is
set, so ids cannot be probed. These keys are separate from `API_WRITE_KEY`.

**Records and merging.** Every record has a stable id, so sending the same
thing twice (a retry, a reconnect, two browsers seeing the same event) changes
nothing:

| Collection | Key                  | Fields                                                                                                                                             | Merge rule                                                                                                            |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `roster`   | `call`               | `netName, status, checkinTime, lastHeard, lat, lon, tokens[], source, site, checkedOut, updatedAt`                                                 | Newest `updatedAt` wins. A check-out is `checkedOut: true`, never a delete, so late joiners see it                    |
| `events`   | `id` (+ `dedupeKey`) | `ts, type, callsign, summary, details, site, dedupeKey, ref, msgNo` · `type` is one of the Event Log types or `incident_note`; `rev` after an edit | First write wins. A second event with the same `type` + `dedupeKey` is ignored. An admin edit replaces (higher `rev`) |
| `reports`  | `id`                 | `kind` (`field` \| `shelter`), `callsign, formType, text, lat, lon, timestamp, tokens[], extra{}, site`; `rev` after an edit                       | First write wins; an admin edit replaces                                                                              |
| `docs`     | `id`                 | `ics-drafts`, `net-running`, `net-history` → `{ id, data, docRev, receivedAt, updatedAt, by }`; `data` up to 256 KB (64 KB hosted)                 | The last one the server receives wins (server `docRev`); `413` when too large                                         |
| `board`    | —                    | `name, ic, netFreq, notes, updatedAt`                                                                                                              | Newest `updatedAt` wins; admin only                                                                                   |

A deleted event or report leaves a tombstone, `{kind, id, seq, deleted: true}`.
Tombstones travel in `deleted[]`, and a deleted id cannot be added again,
even after a server restart (tombstones are saved with the incident).

**Message numbers.** Each station numbers its own message traffic, so two
sites can both have a message 12. Events keep their own `msgNo` together with
their `site`. The app shows another site's number as `SITE:12`. In an ICS
309, a station numbers only its own traffic, and other sites' rows keep their
`SITE:n` label.

**The running net (`net-running`).** The document is Net Control's own
serialised net state plus `tag` (`rev:updatedAt`), `parentTag` (the state it
was made from) and `origin` (`{site, call}`). When two sites change the net
at the same moment, each site reconciles the other's state through their
common ancestor, using Net Control's `rebaseCheck`:

- If the two changes touched different station lines and different net
  fields, both changes are kept. The merged state is published with the
  other site's state as its parent. Its stations are listed newest check-in
  first, then by callsign, so every site holds the same net at once.
- If the same station line or field was changed at both sites, both sites
  keep the change the server received later. Each accepted net state's
  `docRev` is its server sequence; a site compares the remote state's
  `docRev` with its own state's (from the sync response `docRevs` or the
  echo). A state the server has not recorded yet will arrive later. Clocks
  don't matter. Commit time, then tag, decides only for states without a
  server sequence.
  - The earlier site takes the later version. Net Control shows which call
    changed, and at which site. The earlier site's own version is kept in
    the browser (`openhamclock_netControlConflicts`) and shown as a
    "your change" chip with **Apply mine**.
  - The later site keeps its own version and publishes it again on top of
    the other, with `overrode: {tag, calls, fields}`. The site whose change
    lost then shows the chip, even if this is the first copy of the later
    state it receives.
- A state a site has already handled is ignored if it arrives again with
  the same tag and content.

**Document order.** The server orders documents by when it receives them,
never by client clocks. Each accepted copy gets `docRev` (rising per
document) and `receivedAt`; a copy identical to the stored one is ignored.
Clients compare `docRev`. The client's own `updatedAt` is kept only for
display, so a site whose clock is wrong can still save.

**Conditional writes.** A document sent with `baseRev` (the `docRev` it was
made from) is a conditional write. The app sends `baseRev` for the ICS form
drafts.

- If someone has saved a newer revision since, the server refuses the write
  rather than let an old copy, such as a draft flushed after hours offline,
  replace newer edits. The response is `409`, with
  `conflicts: [{id, baseRev, current}]`.
- The rest of the batch is applied.
- `docRevs` gives each accepted document's new revision.
- To put the refused copy back anyway, send it again with
  `baseRev: current.docRev`.
- A write without `baseRev` is applied unconditionally. The running net
  (`net-running`) is sent that way, because it reconciles through its own
  merge.
- Net history (`net-history`) is conditional too. A refused history write
  happens when two sites close a net at once. It is not shown to anyone: the
  client merges the two lists by net id against the copy it was based on and
  sends the merge on top. Merging keeps the other site's nets, adds its own,
  and keeps its own deletions.

**Withdrawals.** A `net_withdrawn` event names the entry it withdraws in
`ref`. Clients hide withdrawn entries from the merged log, so a withdrawal
logged at one site applies at every site.

Each accepted change increments the incident's `seq` and stamps the record
with it. `GET ?since=<seq>` and the stream return only what changed after a
cursor. When a cursor is older than the oldest tombstone the server still
holds (for example after a server restart), the reply is the full state with
`full: true`, and the client replaces what it has. Records sent with a `site`
keep it; otherwise the request's `site` is stamped on them.

| Endpoint                               | Body / query                                                                                         | Returns                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/incident`                    | —                                                                                                    | `{hosted, listing, requireCallsign, limits}`                                                                                                                                  |
| `POST /api/incident`                   | `{name?, ic?, netFreq?, notes?, clientId?, call}`                                                    | `{ok, id, joinKey, adminKey, role, incident}`. `incident` is the full state (below)                                                                                           |
| `POST /api/incident/:id/join`          | key + `{clientId?, call?}`                                                                           | `{ok, id, role, joinKey?, incident}`. `role` is `admin` or `operator`, depending on the key; `joinKey` for an admin                                                           |
| `POST /api/incident/:id/leave`         | key + `{clientId}`                                                                                   | `{ok, participants}`                                                                                                                                                          |
| `GET /api/incident/:id`                | key + `?since=<seq>&clientId=`                                                                       | `{id, seq, since, full, role, board, participants, counts, roster[], events[], reports[], docs[], deleted[]}`. Only what changed after `since`                                |
| `POST /api/incident/:id/sync`          | key + `{clientId?, call?, site?, roster?[], events?[], reports?[], docs?[], board?}` (≤200 per list) | `{ok, seq, accepted:{roster, events, reports, docs, board}, docRevs, denied[]}`. Counts of records that actually changed. `409` with `conflicts[]` when a `baseRev` was stale |
| `POST /api/incident/:id/admin`         | admin key + `{edit?: {events?[], reports?[]}, delete?: {events?[], reports?[], board?}}`             | `{ok, seq, edited:{events, reports}, deleted, board}`. An edit is `{id, …fields}` and keeps `id`, `kind`/`type` and `site`. `delete.board: true` clears the board             |
| `POST /api/incident/:id/rotate`        | admin key                                                                                            | `{ok, joinKey, keyGen, disconnected}`. The old join key stops working at once                                                                                                 |
| `POST /api/incident/:id/ticket`        | key + `{clientId?}`                                                                                  | `{ok, ticket, expiresIn: 60, role}`. A one-time stream ticket                                                                                                                 |
| `GET /api/incident/:id/stream`         | `?ticket=&clientId=&since=` (or `Last-Event-ID`)                                                     | Server-sent events (below)                                                                                                                                                    |
| `GET /api/incident/list` (self-hosted) | `API_WRITE_KEY` when set                                                                             | `{incidents:[{id, name, createdAt, lastActivity, participants, counts}]}`. Never keys. `403` when `OHC_HOSTED` is set                                                         |

**Stream.**

1. Get a ticket with `POST /:id/ticket` (key in the header). A ticket works
   once, for 60 s. It is bound to the incident, to the `clientId` you send,
   and to the current join key.
2. Open `GET /:id/stream?ticket=<ticket>&clientId=<same id>`.
3. Every reconnect needs a fresh ticket; do not let `EventSource` retry the
   same URL.

The stream first sends `event: snapshot` (the full state, or the changes since
`since` / `Last-Event-ID`, plus your `role`, and for an admin the current
`joinKey`). After that it sends:

- `event: change` (`{seq, roster[], events[], reports[], docs[], board, deleted[]}`)
  whenever anything changes.
- `event: presence` (`{participants}`) when the number of connected stations
  changes.
- `event: rekeyed` after a join-key rotation. An operator stream gets
  `{keyGen}` and is closed. An admin stream gets `{keyGen, joinKey}` and stays
  open.
- `event: expired` if the incident expires while you are listening.

`snapshot` and `change` carry `id: <seq>`. A comment line keeps the
connection alive every 25 s. A station counts as connected while it holds a
stream, or for 150 s after it last synced or read with a `clientId`.

```bash
B=http://localhost:3000/api/incident

# Create (keep both keys — they are not shown again). The hosted site needs your callsign.
curl -s -X POST $B -H 'Content-Type: application/json' \
  -d '{"name":"River flood","ic":"K0CJH","netFreq":"146.520","call":"K0CJH"}' | jq '{id, joinKey, adminKey}'
ID=SG4U6D2M; KEY=JKMNPQRSTUVWXYZ2; ADMIN=ABCDEFGHJKMNPQRS

# Join, read everything, read only what changed after seq 12
curl -s -X POST $B/$ID/join -H 'Content-Type: application/json' -H "X-Incident-Key: $KEY" -d '{"call":"W1AW"}' | jq .role
curl -s $B/$ID -H "X-Incident-Key: $KEY" | jq '.roster[].call'
curl -s "$B/$ID?since=12" -H "X-Incident-Key: $KEY" | jq '.events[] | [.type, .callsign, .summary]'

# A voice check-in, a log entry and a field report from a script at "EOC North"
curl -s -X POST $B/$ID/sync -H 'Content-Type: application/json' -H "X-Incident-Key: $KEY" -d '{
  "site": "EOC North",
  "roster":  [{"call":"KD0ABC","netName":"ARES","status":"At shelter [Beds 30/100]","source":"manual","updatedAt":1792106419000}],
  "events":  [{"id":"logger-0001","type":"net_checkin","callsign":"KD0ABC","summary":"Checked into ARES","dedupeKey":"KD0ABC-1792106419000","msgNo":14}],
  "reports": [{"id":"fsr-17","kind":"field","callsign":"KD0ABC","formType":"Field Situation Report","text":"Bridge out on Rt 9","lat":39.1,"lon":-94.6}]
}'

# Check the operator out
curl -s -X POST $B/$ID/sync -H 'Content-Type: application/json' -H "X-Incident-Key: $KEY" \
  -d '{"roster":[{"call":"KD0ABC","status":"Checked out","checkedOut":true,"updatedAt":1792110000000}]}'

# Follow live changes: a ticket first, then the stream (the key never goes in the URL)
T=$(curl -s -X POST $B/$ID/ticket -H 'Content-Type: application/json' -H "X-Incident-Key: $KEY" \
  -d '{"clientId":"script-1"}' | jq -r .ticket)
curl -N "$B/$ID/stream?ticket=$T&clientId=script-1"

# Admin: update the board, correct one entry, delete another, issue a new join key
curl -s -X POST $B/$ID/sync -H 'Content-Type: application/json' -H "X-Incident-Key: $ADMIN" \
  -d '{"board":{"name":"River flood","ic":"K0CJH","netFreq":"146.520","notes":"Shelter open at the high school","updatedAt":1792110100000}}'
curl -s -X POST $B/$ID/admin -H 'Content-Type: application/json' -H "X-Incident-Key: $ADMIN" \
  -d '{"edit":{"events":[{"id":"logger-0001","summary":"Checked into ARES (relay)"}]},"delete":{"reports":["fsr-17"]}}'
curl -s -X POST $B/$ID/rotate -H "X-Incident-Key: $ADMIN" | jq .joinKey

# Leave
curl -s -X POST $B/$ID/leave -H 'Content-Type: application/json' -H "X-Incident-Key: $KEY" -d '{"clientId":"script-1"}'
```

**Limits.**

| Limit                                      | Self-hosted | `OHC_HOSTED`                         |
| ------------------------------------------ | ----------- | ------------------------------------ |
| Incidents on the server                    | 500         | 50                                   |
| Roster entries per incident                | 300         | 100                                  |
| Events per incident                        | 2000        | 500                                  |
| Reports per incident                       | 500         | 200                                  |
| Tracked participants per incident          | 100         | 50                                   |
| Size of one shared document                | 256 KB      | 64 KB                                |
| Streams per incident                       | 50          | 25                                   |
| Streams per IP (`INCIDENT_MAX_SSE_PER_IP`) | 20          | 20                                   |
| Creates per IP per hour                    | 20          | 3                                    |
| Creates per hour, whole server             | no limit    | 30                                   |
| Creator callsign                           | optional    | required, real-looking (no `N0CALL`) |
| Open incidents per creator callsign        | 20          | 2                                    |

When a collection is full, the oldest records are dropped, and checked-out
operators leave the roster first.

Incidents with nobody connected are evicted sooner as the server fills up:

| Server full | An unattended incident is evicted after |
| ----------- | --------------------------------------- |
| under 50 %  | 7 days idle                             |
| 50–80 %     | 24 hours idle                           |
| 80–100 %    | 1 hour idle                             |
| full        | 10 minutes idle                         |

An incident someone is connected to is never evicted. If the server is full
and nothing can be evicted, create returns `503`.

Rate limits: create, join and rotate share `writeLimiter` (20/min per IP).
Sync, admin, ticket and leave allow 240/min per IP, because several browsers
at one site often share an address.

**Persistence.** Incidents are written to `data/incidents.json` (override with
`INCIDENT_FILE`; same location rules as the group-log file) a couple of
seconds after each change, atomically, and reloaded at start-up. The file
holds:

- both key hashes and the sealed join key,
- the documents and edit revisions,
- the tombstones (up to 1000 per incident).

Because the tombstones are saved, a deleted record stays deleted after a
restart, and a client that was up to date before the restart still gets a
delta rather than a full snapshot. Presence and tickets are not saved.
Incidents idle for 7 days expire, together with their tombstones.

**Net roster addresses.** A `CQ NETNAME status` / `U NETNAME` message to
any addressee is a net check-in or check-out, and each `GET /api/aprs/net`
roster entry carries `alias`, the address it was sent to (`EMCOMM`, `W8ROC`
…). The roster holds one entry per address and callsign (at most 500), so
a station can be in two groups' nets at once; each browser shows only the
addresses it is set to. `POST /api/aprs/net/checkin` takes an optional
`alias` (default `EMCOMM`; 1–9 letters, digits or `-`, otherwise 400).
`POST /api/aprs/net/checkout` with `alias` removes that one entry, without
it every entry for the callsign; it answers `{ ok, removed }`.

**Net roster boot id.** `GET /api/aprs/net` returns `bootId` (new on every
server start) and `generation` (bumped on every roster change). A browser
mirroring its server's roster into an incident uses them to tell two cases
apart:

- When the server restarts, its roster comes back empty and the empty roster
  is ignored.
- When the roster really empties on the same boot, every station is checked
  out in the incident.

---

## Public read endpoints

These are the endpoints third-party tools may reasonably consume. They are all
`GET`, cache-backed on the server (your request usually costs nothing
upstream), and their response shapes change rarely — breaking changes will be
called out in release notes.

| Endpoint                       | What it returns                                                                                                                                                                                                                                                                | Server cache       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `/api/pota/spots`              | Current POTA activation spots                                                                                                                                                                                                                                                  | ~1 min             |
| `/api/sota/spots`              | Current SOTA activation spots                                                                                                                                                                                                                                                  | ~1 min             |
| `/api/wwff/spots`              | Current WWFF activation spots                                                                                                                                                                                                                                                  | ~1 min             |
| `/api/solar-indices`           | SFI, sunspot number, A/K indices, X-ray flux                                                                                                                                                                                                                                   | ~5 min             |
| `/api/solar-cycle`             | Solar cycle history/prediction series                                                                                                                                                                                                                                          | hours              |
| `/api/propagation`             | Point-to-point HF path prediction. Query: `deLat`, `deLon`, `dxLat`, `dxLon`, optional `mode`, `power`, `antenna`                                                                                                                                                              | ~10 min            |
| `/api/band-openings`           | Detected band openings from live spot analysis                                                                                                                                                                                                                                 | ~1 min             |
| `/api/satellites/data`         | Tracked amateur satellite orbital elements (OMM), with SatNOGS `transmitters` per satellite                                                                                                                                                                                    | ~1 h               |
| `/api/hams-at/alerts/upcoming` | Upcoming alerted passes from hams.at: `{ alerts, fetchedAt, keyed, stale }`. Optional `X-HamsAt-Key` header forwards your personal key (cached 5 min under its hash, never stored; up to 100 keys; `HAMS_AT_KEYED_PROXY=false` disables keyed requests)                        | 5 min              |
| `/api/ionosonde`               | Live ionosonde soundings (foF2/MUF from GIRO via KC2G)                                                                                                                                                                                                                         | ~15 min            |
| `/api/contests`                | Contest calendar (WA7BNM iCal, RSS fallback). Returns `{ contests, source, fetchedAt }`                                                                                                                                                                                        | ~30 min            |
| `/api/swpc/outlook`            | NOAA SWPC 27-day outlook: `{ issued, days: [{ date, sfi, ap, kp }], fetchedAt }`                                                                                                                                                                                               | 6 h                |
| `/api/benchmark`               | Station benchmark vs neighbours from RBN. Query: `callsign`, `lat`, `lon`, optional `radius` (km, default 300)                                                                                                                                                                 | 10 min/call        |
| `/api/mqtt/status`             | Outbound MQTT publisher state `{ enabled, connected, prefix, lastPublish }` (no credentials)                                                                                                                                                                                   | none               |
| `/api/swpc/scales`             | NOAA R/S/G space weather scales, today + 3-day forecast. Returns `{ scales: { "-1","0".."3" }, fetchedAt }` (raw NOAA shape)                                                                                                                                                   | ~5 min             |
| `/api/swpc/dst`                | Kyoto real-time Dst index (SWPC mirror fallback). Returns `{ current: { t, dst }, series: [{ t, dst }] (72 h hourly), source, updatedAt, fetchedAt }`                                                                                                                          | ~10 min            |
| `/api/swpc/trends`             | 24 h solar wind / IMF / GOES proton (≥10 MeV) and electron (≥2 MeV) series in 10-minute bins. Returns `{ wind, mag, protons, electrons, latest, fetchedAt }`                                                                                                                   | ~10 min            |
| `/api/swpc/activity`           | Peak OVATION aurora probability and D-RAP maximum affected frequency. Returns `{ aurora: { max, lat, lon, forecastTime }, drap: { maxFreq, validAt }, fetchedAt }`                                                                                                             | ~5 min             |
| `/api/space-launches`          | Upcoming orbital launches (Launch Library 2, slimmed). Returns `{ launches: [{ id, name, net, status, provider, rocket, mission, pad, location, lat, lon, … }], count, fetchedAt, stale? }`                                                                                    | ~30 min            |
| `/api/tropical/storms`         | Active tropical cyclones worldwide (NHC + JTWC) with forecast track, forecast points and cone. Returns `{ storms, fetchedAt, sources }`                                                                                                                                        | ~10 min            |
| `/api/fire-weather/alerts`     | NWS Red Flag Warnings and Fire Weather Watches with resolved fire-zone polygons and centroids. Returns `{ alerts, fetchedAt, zonesPending }`                                                                                                                                   | ~5 min             |
| `/api/ndbc/latest`             | NDBC latest observations. Query: `lat`, `lon`, optional `limit` (nearest stations with `km`/`bearing`) or `all=1` for every station                                                                                                                                            | ~15 min            |
| `/api/wefax/catalog`           | Radiofax station/chart catalogue (stations, frequencies, USB dial frequencies, chart ids and titles)                                                                                                                                                                           | static             |
| `/api/wefax/chart/:id`         | The radiofax chart GIF for a catalogue id (e.g. `PYAA12`), proxied from tgftp.nws.noaa.gov; unknown ids are 404                                                                                                                                                                | ~30 min            |
| `/api/netlogger/nets`          | Nets being logged on NetLogger right now: `{ nets: [{ server, name, freq (MHz), mode, band, ncs, started, checkins }], servers, fetchedAt }`                                                                                                                                   | 60 s               |
| `/api/netlogger/checkins`      | Check-ins for one net. Query: `server`, `net` (from `/nets`). Returns `{ server, net, count, checkins: [{ serial, call, name, state, city, county, country, grid, status, remarks }] }` — postal addresses are stripped                                                        | 60 s per net       |
| `/api/balloons`                | Amateur HAB / pico balloons from SondeHub Amateur, last 6 h, ≤ 500 payloads: `{ balloons: [{ call, lat, lon, alt (m), speedKmh, ascentRate, lastHeard, frequency, modulation, aprs, uploader, trail: [[lat, lon, alt, epochMs]…] }], count, fetchedAt }`                       | 2 min              |
| `/api/balloons/listeners`      | SondeHub Amateur receiving stations, last 6 h: `{ listeners: [{ call, lat, lon, alt, lastSeen, radio, antenna, mobile }], count }`                                                                                                                                             | 5 min              |
| `/api/hamalert/alerts`         | Self-hosted only, dormant unless `HAMALERT_USER`/`HAMALERT_PASS` are set: `{ enabled, connected, alerts: [{ call, freq (MHz string), freqKhz, mode, source, comment, time, timestamp }], status }`; `?since=<epoch ms>` for increments. `{ enabled: false }` when unconfigured | live (ring of 200) |
| `/api/motd`                    | Message of the day: `{ text, id, links: [{ label, url }], source: 'env' \| 'admin' \| null }` — `text` is `''` when there is none                                                                                                                                              | 60 s               |
| `/api/health`                  | Instance health/uptime probe                                                                                                                                                                                                                                                   | none               |

`/api/benchmark` returns `{ call, radiusKm, windowDays, neighbours, mySpots, bands: [{ band, diffDb, medianDiffDb, samples, neighbourSamples, bestDiffDb, days: [{ day, diffDb, samples }] }], explanation, source: 'rbn', pskreporter: false, generatedAt }` — `diffDb` is the callsign's mean SNR minus the median of the stations within `radiusKm` heard by the same skimmer on the same band in the same UTC hour, over the last 7 days.

### Outbound MQTT (optional, self-hosted)

With `MQTT_PUBLISH_URL` set (plus optional `MQTT_PUBLISH_USER`, `MQTT_PUBLISH_PASS`, `MQTT_PUBLISH_PREFIX`, default prefix `openhamclock`) the server publishes retained JSON to:

| Topic                    | Payload                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `<prefix>/spaceweather`  | `{ sfi, ssn, kp, a_index, xray_class, bz, solar_wind_speed, proton_flux, geomag_field, signal_noise, scales: { R, S, G }, updated_at }` |
| `<prefix>/alerts/swpc`   | `{ count, max_level, alerts: [{ product_id, serial, title, scale, level, issued }], updated_at }`                                       |
| `<prefix>/band-openings` | `{ warming, count, bands, openings: [{ band, from, to, state, factor, spots }], zone_openings: [...], updated_at }`                     |
| `<prefix>/status`        | `{ state: 'online' \| 'offline', version, uptime_s, health, subsystems, updated_at }` — also the LWT/availability topic                 |

Each topic is published at most once per minute and only when its content changed. `MQTT_PUBLISH_HA_DISCOVERY=true` adds retained Home Assistant discovery configs at `homeassistant/sensor/openhamclock_<id>/config`. The Rig Bridge's own MQTT plugin publishes `<prefix>/rig`, `<prefix>/rotator` and `<prefix>/bridge/status` — see `rig-bridge/README.md`.

```bash
curl -s http://localhost:3000/api/solar-indices | jq .
curl -s 'http://localhost:3000/api/propagation?deLat=39.0&deLon=-94.5&dxLat=51.5&dxLon=-0.1&mode=FT8&power=100' | jq .
```

Most of this data originates from public upstream services (NOAA SWPC, POTA,
SOTA, AMSAT, GIRO, etc.). OpenHamClock caches it so _one_ instance makes _one_
upstream request — please keep it that way by pointing your tools at your own
self-hosted instance rather than scraping someone else's, and by respecting
the cache durations above (polling faster than the cache refreshes just burns
your own rate limit).

---

### `POST /api/satellites/refresh`

Marks every tracked satellite's element set stale so the server re-fetches on
its next cycle (CelesTrak / AMSAT / SatNOGS / Space-Track as configured).
Requires the write key when `API_WRITE_KEY` is set, and is accepted at most
once per 10 minutes per server — a second call inside that window returns
`429` with `retryAfterSec`.

```bash
curl -s -X POST http://localhost:3000/api/satellites/refresh
# {"ok":true,"satellites":67,"note":"refresh queued; new elements arrive on the next fetch cycle"}
```

## Cluster console (self-hosted only)

The Cluster Console panel is a window onto the persistent telnet session the
DX Cluster panel keeps open to a **Custom Telnet Server** source. These
endpoints never open a connection of their own; the session must already
exist (opened by `/api/dxcluster/paths?source=custom&…`). On a hosted
instance (`OHC_HOSTED=1`) both return `400`.

### `GET /api/dxcluster/console`

Query: `host`, `port` (default `DX_CLUSTER_PORT`), `callsign` (ignored when
`DX_CLUSTER_CALLSIGN` is set — the server-side login callsign always wins),
`since` (last `seq` you have; omit for the whole 500-line ring buffer).
The session is looked up by `host:port:loginCallsign`, so a browser only
ever sees the session it would itself have opened.

```json
{
  "exists": true,
  "connected": true,
  "authenticated": true,
  "parked": false,
  "node": { "host": "dxc.example.net", "port": 7300 },
  "loginCallsign": "K0CJH",
  "seq": 1234,
  "lines": [{ "seq": 1233, "t": 1760000000000, "dir": "rx", "text": "DX de W1AW:  14025.0 ..." }]
}
```

`dir` is `rx` for text from the node and `tx` for commands OpenHamClock typed
(login, `sh/dx 25`, `set/dx`, login commands, console sends). Poll every 2 s
with `since=<seq>`; a `seq` lower than the one you hold means the server
restarted — start over.

### `POST /api/dxcluster/console/send`

Body: `{ "host", "port", "callsign", "command" }`. Gated like the other
write endpoints (`API_WRITE_KEY`, see below, plus the shared write rate
limiter) and additionally limited to **one command per second per session**
(`429`). `command` must be a single line of printable ASCII, at most 120
characters, and not a session-ending command (`bye`, `quit`, `exit`,
`logout`); anything else is `400`. `409` when the session does not exist or
is not logged in yet. Returns `{ "ok": true, "seq": <seq of the echoed line> }`.

Login commands (sent once after each login) travel on the existing
`/api/dxcluster/paths` request as `cmds`, a JSON array of up to 10 strings
validated by the same rules.

## Message of the day

A one-line notice every browser on the instance shows as a dismissible top
bar (bare URLs become links; dismissals are remembered per message `id`, so a
changed message re-appears).

- `GET /api/motd` → `{ text, id, links, source, updatedAt }` (see the table above).
- `POST /api/admin/motd` — set or clear the admin message. Body
  `{ "text": "Server restart at 0200z, see https://example.org/status", "links": [{ "label": "Status", "url": "https://example.org/status" }] }`.
  `text` is capped at 1000 characters; `links` is optional (http/https only,
  five max) and is merged with URLs found in the text. An empty `text` clears
  the admin message, after which the `MOTD` environment variable (if set)
  applies again. The admin message persists in `motd.json` (`MOTD_FILE`, or
  the usual `/data` → `./data` → `/tmp` waterfall) across restarts.

```bash
curl -X POST -H "Authorization: Bearer $API_WRITE_KEY" -H 'Content-Type: application/json' \
  -d '{"text":"Club net tonight 0100z on 7.272 — https://example.org/net"}' \
  http://localhost:3000/api/admin/motd
curl -X POST -H "Authorization: Bearer $API_WRITE_KEY" -H 'Content-Type: application/json' \
  -d '{"text":""}' http://localhost:3000/api/admin/motd   # clear
```

The write endpoint uses the same `API_WRITE_KEY` bearer auth and write rate
limit as the other admin endpoints (next section).

---

## Authentication

Write endpoints (`POST`/`DELETE /api/qso-layer`, like the other ingest
endpoints) are gated by the instance's `API_WRITE_KEY` environment variable:

- **`API_WRITE_KEY` unset** (the default on local installs): writes are open.
  Fine on a LAN; don't expose such an instance to the internet.
- **`API_WRITE_KEY` set**: every write must present the key, either as a
  Bearer token or a `key` query parameter:

```bash
curl -X POST http://localhost:3000/api/qso-layer \
  -H "Authorization: Bearer $API_WRITE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"call":"K1ABC","grid":"FN42"}'

# or: curl -X POST "http://localhost:3000/api/qso-layer?key=$API_WRITE_KEY" ...
```

Read endpoints require no authentication.

---

## Rate limits & courtesy

- General API traffic: **1800 requests/min per IP**.
- Write endpoints: **20 requests/min per IP** — use batching
  (up to 100 QSOs per POST) instead of one request per QSO.
- Exceeding a limit returns `429` with a JSON error body.

The hosted instances (openhamclock.com / openhamclock.app) are a shared
community resource. Third-party integrations should target the user's **own
self-hosted instance**; the QSO layer is `localOnly` for exactly that reason —
on the hosted site there is no per-visitor server store to write into.

---

## CORS

Self-hosted instances control their own CORS policy. By default only
localhost and the official openhamclock.com/.app origins are allowed; add your
web app's origin with the `CORS_ORIGINS` environment variable
(comma-separated). Non-browser clients (loggers, scripts, curl) are unaffected
by CORS. Note the default CORS policy only allows `GET`/`POST` cross-origin —
call `DELETE /api/qso-layer` same-origin or from a non-browser client.

---

## What is NOT a stable contract

Everything not listed above — including but not limited to `/api/dxcluster/*`,
`/api/wsjtx/*`, `/api/n3fjp/*`, `/api/n1mm/*`, `/api/rig-bridge/*`,
`/api/admin/*`, `/api/config*`, `/api/callsign/*`, `/api/aprs/*`, the
propagation heatmap/MUF-map endpoints, and any SSE/stream endpoints — exists
for OpenHamClock's own UI. Shapes, paths, and semantics change between
releases without notice. If you build on them, pin your OpenHamClock version.

The QSO-layer ingest contract above (field names, batch envelope, auth) **is**
stable: additive changes only within a major version. The remote-control
command names and bodies are stable in the same sense; the shape of the
`state` report is informational and may grow between releases.

---

_See also: [MANUAL.md](MANUAL.md) for the map layer UI, [PLUGINS.md](PLUGINS.md)
for extending the app itself, and the repo README for `API_WRITE_KEY` /
`CORS_ORIGINS` configuration._
