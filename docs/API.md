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

## Public read endpoints

These are the endpoints third-party tools may reasonably consume. They are all
`GET`, cache-backed on the server (your request usually costs nothing
upstream), and their response shapes change rarely — breaking changes will be
called out in release notes.

| Endpoint               | What it returns                                                                                                   | Server cache |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| `/api/pota/spots`      | Current POTA activation spots                                                                                     | ~1 min       |
| `/api/sota/spots`      | Current SOTA activation spots                                                                                     | ~1 min       |
| `/api/wwff/spots`      | Current WWFF activation spots                                                                                     | ~1 min       |
| `/api/canparks/spots`  | Current CanParks (Canadian parks) activations                                                                     | ~1 min       |
| `/api/solar-indices`   | SFI, sunspot number, A/K indices, X-ray flux                                                                      | ~5 min       |
| `/api/solar-cycle`     | Solar cycle history/prediction series                                                                             | hours        |
| `/api/propagation`     | Point-to-point HF path prediction. Query: `deLat`, `deLon`, `dxLat`, `dxLon`, optional `mode`, `power`, `antenna` | ~10 min      |
| `/api/band-openings`   | Detected band openings from live spot analysis                                                                    | ~1 min       |
| `/api/satellites/data` | Tracked amateur satellite orbital elements (OMM)                                                                  | ~1 h         |
| `/api/ionosonde`       | Live ionosonde soundings (foF2/MUF from GIRO via KC2G)                                                            | ~15 min      |
| `/api/contests`        | Contest calendar (WA7BNM iCal, RSS fallback). Returns `{ contests, source, fetchedAt }`                           | ~30 min      |
| `/api/health`          | Instance health/uptime probe                                                                                      | none         |

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
stable: additive changes only within a major version.

---

_See also: [MANUAL.md](MANUAL.md) for the map layer UI, [PLUGINS.md](PLUGINS.md)
for extending the app itself, and the repo README for `API_WRITE_KEY` /
`CORS_ORIGINS` configuration._
