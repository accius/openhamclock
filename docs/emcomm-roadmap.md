# EmComm Layout — Feature Roadmap

> Emergency Communications Dashboard for ARES/RACES, SKYWARN, and Served Agency Operations

## Overview

The EmComm layout provides a dedicated emergency communications dashboard for amateur radio operators supporting public safety events and disaster response. The roadmap is divided into phases, building from the current display-only dashboard toward a full bidirectional EmComm operations platform.

**Design Principle:** Local-first. Each station runs OpenHamClock locally. Internet may be unavailable during emergencies — all core EmComm functions must work over RF alone.

---

## Phase 1 — Display Dashboard ✅ (Shipped v26.1.1)

The current EmComm layout provides situational awareness on a single screen.

- [x] Full-screen map with range rings
- [x] NWS weather alerts overlay
- [x] FEMA disaster declarations
- [x] Nearby shelters with capacity bars
- [x] Filtered APRS stations (EOC, Shelter, ARES, Skywarn, Red Cross symbols)
- [x] Resource tokens in APRS beacon comments (`[Beds 30/100]`, `[Water -50]`, `[Power OK]`)
- [x] Resource summary dashboard aggregating data across all stations
- [x] Tornado/severe weather warning polygons

---

## Phase 2 — Local APRS Integration

**Goal:** Connect to a local radio for bidirectional APRS without internet dependency.

### 2.1 Local APRS Daemon (Critical Path)

The foundation for all subsequent phases. A rig-bridge plugin or standalone daemon that connects to an APRS-capable radio via:

- **Direwolf** (software TNC) — most common setup
- **Hardware TNC** (Mobilinkd, TNC-X, KPC-3+) via serial/USB KISS
- **AGWPE/AGWPRO** protocol (Windows TNCs)
- **RTL-SDR** receive-only (for monitoring without TX)

The daemon provides:

- APRS packet decode (position, message, telemetry, objects, weather)
- Local packet feed to OHC (replaces or supplements `rotate.aprs2.net`)
- TX capability for outbound APRS messages (when radio supports it)
- Configurable via Settings → Station → APRS Local Feed

**Configuration example:**

```
APRS_LOCAL_HOST=localhost
APRS_LOCAL_PORT=8001
APRS_LOCAL_PROTOCOL=kiss  # or agwpe, direwolf
```

### 2.2 Fixed Station vs Mobile User Icons

APRS already encodes station type in the symbol table and SSID:

| Symbol          | Type       | Icon              |
| --------------- | ---------- | ----------------- |
| `E0` / `/E`     | EOC        | 🏛️ Building       |
| `/#`            | Digi       | 📡 Antenna        |
| `/r` or SSID -9 | Car/Mobile | 🚗 Vehicle        |
| `\[`            | Person     | 🧑 Walking person |
| `/s`            | Shelter    | 🏠 House          |
| SSID -7         | HT/Walkie  | 📻 Radio          |

- Parse the APRS symbol table byte pair to determine station type
- Display appropriate icon on the map (currently all APRS stations use the same marker)
- Filter controls: show/hide by station type (fixed, mobile, digi, weather)

### 2.3 Settings: Local APRS Source Selection

Add a configuration option to choose APRS data source:

- **Internet only** (current behavior — `rotate.aprs2.net` via APRS-IS)
- **Local only** (RF via local daemon — no internet required)
- **Both** (merge local RF and internet feeds, deduplicate by callsign+timestamp)

---

## Phase 3 — Net Operations

**Goal:** Structured EmComm net check-in/check-out and operator tracking.

### 3.1 Net Check-in via APRS Message

Modeled after APRSThursday's ANSRVR system:

**Check in:**

```
APRS Message to: EMCOMM
Body: CQ NETNAME <your status message>
```

**Check out:**

```
APRS Message to: EMCOMM
Body: U NETNAME
```

- OHC acts as the net controller display — shows who is checked in, their location, status
- Net roster panel with check-in time, last heard, status message
- Visual indicators: green (active/recent), yellow (stale >10 min), red (checked out)
- Net controller can see all operators on the map with their status

### 3.2 Operator Status Board

A dedicated panel (or section of the EmComm sidebar) showing:

| Callsign | Status   | Location   | Last Heard | Resources     |
| -------- | -------- | ---------- | ---------- | ------------- |
| W1ABC    | Deployed | Shelter A  | 2 min ago  | [Beds 30/100] |
| K2DEF    | Mobile   | Field      | 45 sec ago | —             |
| N3GHI    | EOC      | County EOC | 1 min ago  | [Power OK]    |

- Sortable by last heard, distance, status
- Click to center map on operator
- Click to send APRS message (Phase 4)

---

## Phase 4 — Messaging

**Goal:** Send and receive APRS messages directly from the EmComm dashboard.

### 4.1 Click-to-Message from Map

- Click on any APRS station on the map → message compose popup
- Pre-filled TO: field with the station's callsign
- Message input with character counter (APRS max: 67 chars)
- Send via local APRS daemon (requires TX capability)
- Delivery confirmation (APRS ack/rej)

### 4.2 Message Thread View

- Threaded conversation view per callsign
- Incoming and outgoing messages with timestamps
- Unread message indicator on map markers
- Audio alert on incoming message (configurable)

### 4.3 Group Messaging

- Broadcast to all net participants: `CQ NETNAME <message>`
- Messages appear in a shared net log visible to all operators

---

## Phase 5 — Logging & Documentation

**Goal:** Complete audit trail for After Action Reviews (AAR).

### 5.1 Message Log

- All APRS messages (sent/received) stored with timestamps
- Searchable by callsign, date range, keywords
- Real-time log view in a panel

### 5.2 Event Log Export

- Download formats: CSV, PDF, plain text
- Includes: all messages, operator check-in/out times, resource status changes
- Filter by date range, net name, callsign
- PDF includes map snapshot at time of export

### 5.3 Resource History

- Track resource token changes over time (e.g., shelter bed count decreasing)
- Timeline/chart view showing resource trends during an event

---

## Phase 6 — Telemetry & Sensors (Future)

**Goal:** Live environmental data from field-deployed sensors.

### 6.1 APRS Telemetry Parsing

APRS already defines telemetry frames (T# packets). Parse and display:

- Ambient temperature
- Battery voltage
- Signal strength (for RF coverage mapping)
- Custom analog/digital channels

### 6.2 Custom Sensor Integration

- Support for IoT sensors that transmit via APRS (Arduino + radio modules)
- Example use cases:
  - Firefighter O2 tank remaining (from SCBA telemetry)
  - Flood water level sensors
  - Weather station data (wind, rain, pressure)
  - Generator fuel level at shelters

### 6.3 Custom Token Request Protocol

Allow field stations to query the current token definitions:

```
APRS Message to: EMCOMM
Body: TOKENS?
```

Response with the current active token list so stations can format their beacons correctly.

---

## Architecture Notes

### Local-First Design

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

### Key Technical Decisions

1. **APRS daemon as rig-bridge plugin** — reuses existing plugin architecture, same config model, same lifecycle management
2. **KISS protocol preferred** — universal TNC protocol, works with Direwolf, hardware TNCs, and most radio interfaces
3. **Message store** — SQLite for persistence across restarts; falls back to in-memory for Pi/embedded setups
4. **Symbol table parsing** — use the standard APRS symbol table (primary + alternate) for icon mapping

---

## Contributing

This roadmap is a living document. Feature requests and discussion welcome in [GitHub Issues](https://github.com/accius/openhamclock/issues) with the `emcomm` label.

Phase 2.1 (Local APRS Daemon) is the critical path — all other features depend on it. If you have experience with Direwolf, KISS protocol, or APRS packet parsing, your contribution would be especially valuable.
