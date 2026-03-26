# EmComm Layout — Feature Guide

> Emergency Communications Dashboard for ARES/RACES, SKYWARN, and Served Agency Operations

## Overview

The EmComm layout provides a dedicated emergency communications dashboard for amateur radio operators supporting public safety events and disaster response. All six development phases have shipped — the layout includes real-time APRS station tracking with RF source support, net operations management, point-to-point APRS messaging, resource token aggregation, NWS alerts, FEMA shelter/disaster data, and APRS telemetry parsing.

**Design Principle:** Local-first. Each station runs OpenHamClock locally. Internet may be unavailable during emergencies — all core EmComm functions work over RF alone when paired with a local TNC via rig-bridge.

---

## Enabling EmComm Mode

1. Open **Settings** (click the gear icon or your callsign in the header)
2. Select **Emergency Communications** from the Layout dropdown
3. Click **Save** — the page reloads with the EmComm layout

**Requirements:**

- **Station location** — Latitude/longitude must be set (needed for alerts, shelters, distance calculations)
- **APRS** — Set `APRS_ENABLED=true` in your `.env` for APRS-IS internet feed (zero-config)
- **Local APRS (RF)** — Optional. Requires rig-bridge with the APRS TNC plugin connected to Direwolf or a hardware TNC
- **NWS/FEMA data** — Zero-config, public APIs, no keys needed

---

## Layout Overview

The EmComm layout replaces standard sidebar panels with emergency-focused data. The left side (~70%) is an interactive map; the right side (~30%) contains stacked information panels.

### Map Features

- **Range rings** at 50, 100, and 200 km from your station
- **NWS alert polygons** color-coded by severity (Extreme=red, Severe=orange, Moderate=gold, Minor=yellow)
- **Shelter markers** with capacity popups (green=OPEN, red=CLOSED, orange=FULL)
- **EmComm APRS station markers** (cyan) for emergency-related stations with resource token popups
- **APRS source toggle** — filter by All Sources, RF Only (local TNC), or Internet Only

### Sidebar Panels

| Panel                     | Description                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Resource Summary**      | Aggregated dashboard showing totals across all APRS stations reporting resource tokens. Capacity bars with color coding (red >90%, orange >70%). |
| **NWS Alerts**            | Active weather watches, warnings, and advisories from the National Weather Service, color-coded by severity with countdown to expiry.            |
| **Disaster Declarations** | Recent FEMA disaster declarations for your state (last 30 days), auto-resolved from your coordinates via reverse geocoding.                      |
| **Nearby Shelters**       | Open shelters within 200 km, sorted by distance, with capacity bars, wheelchair (♿) and pet-friendly (🐾) indicators. Click to pan map.         |
| **EmComm Stations**       | APRS stations using emergency symbols, with resource token pills and RF source badges when heard locally.                                        |
| **Net Roster**            | Live net operations with operator check-ins, status messages, resource tokens, and point-to-point messaging.                                     |

---

## APRS Integration

### Data Sources

The EmComm layout can receive APRS data from two sources simultaneously:

1. **APRS-IS (Internet)** — Read-only connection to `rotate.aprs2.net`. Enabled via `APRS_ENABLED=true` in `.env`. No API key needed.
2. **Local TNC (RF)** — Via rig-bridge's APRS TNC plugin. Connects to Direwolf (software TNC) or a hardware TNC (Mobilinkd, TNC-X, KPC-3+) using KISS protocol over TCP or serial. Stations heard over RF are tagged with a green "RF" badge.

The **APRS Source Selector** in the EmComm sidebar lets you filter the display:

- **All Sources** — Shows both internet and RF stations (default)
- **RF Only** — Shows only stations heard by your local TNC
- **Internet Only** — Shows only APRS-IS stations

### Emergency Symbol Filtering

The EmComm layout filters APRS stations to show only emergency-relevant symbols:

| Symbol Code | Type      | Icon |
| ----------- | --------- | ---- |
| `/o` / `Eo` | EOC       | 🏛️   |
| `\z` / `So` | Shelter   | 🏥   |
| `\!`        | Emergency | 🚨   |
| `/+`        | Red Cross | ✚    |
| `\a`        | ARES      | 📡   |
| `\y`        | Skywarn   | 🌪️   |

Each station card shows: callsign with icon, RF badge (if heard locally), distance from your station, last-heard time, resource tokens (if present), and cleaned comment text.

### APRS Resource Tokens

Operators at shelters or EOCs can encode structured resource data in their APRS beacon comments using bracket notation. OpenHamClock parses these tokens and displays them as color-coded pills on station cards, and aggregates them into the Resource Summary panel.

**Token format** (within the 67-character APRS comment field):

| Token            | Meaning                    | Example         |
| ---------------- | -------------------------- | --------------- |
| `[Key Value]`    | Quantity                   | `[Staff 5]`     |
| `[Key Curr/Max]` | Capacity (current/maximum) | `[Beds 30/100]` |
| `[Key -Value]`   | Resource NEEDED (deficit)  | `[Water -50]`   |
| `[Key OK]`       | Status nominal             | `[Power OK]`    |
| `[Key !]`        | Critical alert             | `[Food !]`      |

**Built-in token keys:** `Beds`, `Water`, `Food`, `Power`, `Fuel`, `Med`, `Staff`, `Evac`, `Comms`, `Gen`. The parser accepts any key — unknown keys display with a generic icon.

**Example beacon comment:** `[Beds 30/100][Power OK][Water -50] Shelter Alpha` (47 chars)

### APRS Telemetry

The EmComm layout parses APRS telemetry frames (T# packets) with support for PARM, UNIT, and EQNS metadata. This enables field-deployed sensors to report:

- Battery voltage
- Ambient temperature
- Signal strength
- Custom analog/digital channels

Telemetry data is available via `GET /api/aprs/telemetry`.

---

## Net Operations

The EmComm layout includes a built-in net operations system for managing check-ins during emergency activations.

### Checking In via APRS

Operators check in to a net by sending an APRS message:

**Check in:**

```
TO: EMCOMM
Body: CQ NETNAME <your status message>
```

**Check out:**

```
TO: EMCOMM
Body: U NETNAME
```

Example: Sending `CQ HOTG Deployed to Shelter Alpha` to EMCOMM checks you in to the HOTG net with the status "Deployed to Shelter Alpha".

### Manual Check-in

For operators without APRS TX capability, the server provides a REST endpoint:

```
POST /api/aprs/net/checkin
Body: { "callsign": "W1ABC", "netName": "HOTG", "status": "At EOC" }
```

### Net Roster Panel

The roster shows all checked-in operators with:

- Callsign and net name
- Last-heard time (green if recent, orange if >10 minutes stale)
- Status message
- Resource tokens from their APRS beacon
- **MSG button** — click to compose a point-to-point APRS message to that operator

---

## APRS Messaging

The EmComm layout supports sending and receiving point-to-point APRS messages.

### Sending Messages

1. Click the **MSG** button on any net roster entry or APRS station
2. A compose panel appears with the callsign pre-filled
3. Type your message (67-character APRS limit, enforced by character counter)
4. Click Send — the message is transmitted via your local TNC

**Requirement:** Sending messages requires a local APRS TNC connected via rig-bridge with TX capability.

### Receiving Messages

Incoming APRS messages addressed to your callsign appear in the message stream. The system also detects:

- **Shelter reports** — Messages containing shelter-related keywords are flagged
- **Net commands** — CQ/check-in and U/check-out messages are automatically routed to the net roster
- **Bulletins** — APRS bulletin messages (BLN) are displayed in the feed

### Message Endpoint

```
POST /api/aprs/message
Body: { "to": "W1ABC", "message": "Need water at Shelter B" }
```

---

## NWS Weather Alerts

- **Source:** `api.weather.gov` (public, no API key)
- **Polling:** Every 3 minutes
- **Coverage:** Based on your station coordinates
- **Display:** Expandable alert cards with severity coloring, headline, description, instructions, and time-to-expiry countdown
- **Map:** Alert areas rendered as colored polygon overlays

---

## FEMA Shelters

- **Source:** `gis.fema.gov` ArcGIS (public, no API key)
- **Polling:** Every 5 minutes
- **Radius:** 200 km from your station (configurable)
- **Display:** Sorted by distance, with status badges (OPEN/CLOSED/FULL), capacity bars (current/max evacuees), wheelchair accessibility (♿), and pet-friendly (🐾) indicators
- **Interaction:** Click any shelter to pan the map to its location

---

## FEMA Disaster Declarations

- **Source:** `fema.gov` open API (public, no API key)
- **Polling:** Every 15 minutes
- **Coverage:** Your state (auto-resolved from coordinates via Nominatim reverse geocoding)
- **Time range:** Last 30 days
- **Display:** Declaration title, incident type icon, declaration type (Major Disaster / Emergency)

---

## Winlink Gateway Integration

> **Status:** Plugin built. Waiting on API key approval from Winlink team (W3QA). See [issue #297](https://github.com/accius/openhamclock/issues/297).

The rig-bridge includes a Winlink gateway plugin (`rig-bridge/plugins/winlink-gateway.js`) that provides:

- **Gateway discovery** — Find nearby Winlink RMS gateways by grid square, range, and transport mode (HF/VHF/UHF)
- **Pat client integration** — Interface with the [Pat](https://getpat.io) Winlink client for inbox/outbox management and message composition
- **Message sending** — Compose and send Winlink emails over RF via Pat

**What's waiting:** The gateway discovery feature requires an API key from `api.winlink.org` to query the RMS gateway database. The key has been requested. Pat client integration (local messaging) works independently without the API key.

**Endpoints (available when plugin is enabled):**

| Endpoint                      | Method | Description                             |
| ----------------------------- | ------ | --------------------------------------- |
| `/winlink/gateways`           | GET    | List nearby gateways (requires API key) |
| `/winlink/gateways/:callsign` | GET    | Single gateway details                  |
| `/winlink/inbox`              | GET    | Pat inbox messages                      |
| `/winlink/outbox`             | GET    | Pat outbox messages                     |
| `/winlink/compose`            | POST   | Send message via Pat                    |
| `/winlink/connect`            | POST   | Connect to a gateway                    |

**Configuration (in rig-bridge config):**

```json
{
  "winlink": {
    "enabled": false,
    "apiKey": "YOUR_WINLINK_API_KEY",
    "refreshInterval": 3600,
    "pat": {
      "enabled": false,
      "host": "127.0.0.1",
      "port": 8080
    }
  }
}
```

---

## Server Configuration

### Environment Variables

| Variable               | Default            | Description                            |
| ---------------------- | ------------------ | -------------------------------------- |
| `APRS_ENABLED`         | `false`            | Enable APRS-IS internet connection     |
| `APRS_HOST`            | `rotate.aprs2.net` | APRS-IS server                         |
| `APRS_PORT`            | `14580`            | APRS-IS port                           |
| `APRS_FILTER`          | (empty)            | Geographic filter, e.g. `r/40/-75/500` |
| `APRS_MAX_AGE_MINUTES` | `60`               | Purge stations older than this         |

### API Endpoints

| Endpoint                 | Method | Description                             |
| ------------------------ | ------ | --------------------------------------- |
| `/api/aprs/stations`     | GET    | All cached APRS stations                |
| `/api/aprs/messages`     | GET    | APRS messages and bulletins             |
| `/api/aprs/shelters`     | GET    | Extracted shelter reports from messages |
| `/api/aprs/net`          | GET    | Net roster with computed age/staleness  |
| `/api/aprs/net/checkin`  | POST   | Manual net check-in                     |
| `/api/aprs/net/checkout` | POST   | Manual net check-out                    |
| `/api/aprs/message`      | POST   | Send APRS message via TNC               |
| `/api/aprs/local`        | POST   | Inject local TNC packets (cloud relay)  |
| `/api/aprs/telemetry`    | GET    | APRS telemetry data                     |
| `/api/emcomm/alerts`     | GET    | NWS weather alerts for location         |
| `/api/emcomm/shelters`   | GET    | FEMA shelters within radius             |
| `/api/emcomm/disasters`  | GET    | FEMA disaster declarations for state    |

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Radio/TNC  │────▶│  APRS Daemon │────▶│  OpenHamClock   │
│  (Direwolf) │◀────│  (rig-bridge │◀────│  (Node.js)      │
│             │     │   plugin)    │     │                 │
└─────────────┘     └──────────────┘     └─────────────────┘
       ▲                                         │
       │              RF Network                  │ Optional
       ▼                                         ▼
  ┌──────────┐                           ┌──────────────┐
  │  Other   │                           │  APRS-IS     │
  │  Stations│                           │  (Internet)  │
  └──────────┘                           └──────────────┘
```

**Key design decisions:**

1. **APRS daemon as rig-bridge plugin** — Reuses the existing plugin architecture, same config model and lifecycle management
2. **KISS protocol** — Universal TNC protocol, works with Direwolf, hardware TNCs, and most radio interfaces
3. **Dual-source APRS** — Internet (APRS-IS) and local RF can run simultaneously with deduplication
4. **In-memory storage** — Stations, messages, net roster, and telemetry stored in memory with configurable TTLs. No database required.
5. **Zero-config public APIs** — NWS, FEMA, and Nominatim require no API keys or authentication

---

## Development History

All six phases of the EmComm layout have shipped:

| Phase | Feature                                      | Version |
| ----- | -------------------------------------------- | ------- |
| 1     | Display dashboard                            | v26.1.1 |
| 2     | APRS station icons, source selector, RF tags | v26.2.1 |
| 3     | Net operations roster                        | v26.2.1 |
| 4     | APRS messaging                               | v26.2.1 |
| 5     | Logging & documentation                      | v26.2.1 |
| 6     | APRS telemetry parsing                       | v26.2.1 |

---

## Contributing

Feature requests and discussion welcome in [GitHub Issues](https://github.com/accius/openhamclock/issues) with the `emcomm` label.
