# satconfig.json — Satellite Configuration Guide

This file defines all satellites tracked by OpenHamClock. It controls which satellites appear on the map, their display names, colors, and radio frequencies shown in the popup window.

---

## File Structure

The file is a JSON object. Each satellite is keyed by its **NORAD ID** (as a string). Section header keys beginning with `_SECTION_` are used for organization only and are ignored by the application.

```json
{
  "_SECTION_1": "── High Priority — Popular FM Satellites ──",
  "25544": {
    "norad": 25544,
    "name": "ISS (ZARYA)",
    "color": "#00ffff",
    "priority": 1,
    "mode": "FM/APRS/SSTV",
    "downlink": "145.800 MHz",
    "uplink": "145.990 MHz",
    "tone": "67.0 Hz"
  }
}
```

---

## Fields

### Required

| Field      | Type   | Description                                              |
| ---------- | ------ | -------------------------------------------------------- |
| `norad`    | number | NORAD catalog ID — must match the JSON key exactly       |
| `name`     | string | Display name shown on the map and in the popup           |
| `color`    | string | Hex color for the satellite marker and track             |
| `priority` | number | `1` = high, `2` = medium, `3` = low (used for filtering) |
| `mode`     | string | Operating mode, e.g. `FM`, `Linear`, `HRIT/LRIT`         |

### Optional — Radio Frequencies

Include only the fields that apply to your satellite. Empty or missing fields are automatically hidden in the popup.

| Field           | Description                                   | Example          |
| --------------- | --------------------------------------------- | ---------------- |
| `frequency`     | Primary downlink (weather sats, general use)  | `"1694.100 MHz"` |
| `downlink`      | FM/Linear downlink frequency or range         | `"145.800 MHz"`  |
| `uplink`        | FM/Linear uplink frequency or range           | `"145.990 MHz"`  |
| `tone`          | CTCSS access tone                             | `"67.0 Hz"`      |
| `armTone`       | Arm tone required before access (SO-50 style) | `"74.4 Hz"`      |
| `hrptFrequency` | HRPT downlink for polar weather satellites    | `"1700.000 MHz"` |
| `grbFrequency`  | GRB downlink for GOES satellites              | `"1686.600 MHz"` |
| `sdFrequency`   | SD downlink for legacy GOES satellites        | `"1676.000 MHz"` |

---

## Adding a Satellite

1. Look up the satellite's **NORAD ID** on [Space-Track.org](https://www.space-track.org) or [CelesTrak](https://celestrak.org)
2. Add a new entry using the NORAD ID as the key
3. Include only the frequency fields that apply
4. Place it under the appropriate `_SECTION_` for organization

```json
"99999": {
  "norad": 99999,
  "name": "MY-SAT-1",
  "color": "#ff9900",
  "priority": 1,
  "mode": "FM",
  "downlink": "436.500 MHz",
  "uplink": "145.900 MHz",
  "tone": "67.0 Hz"
}
```

> **Important:** The NORAD ID in the JSON key and the `norad` field MUST MATCH EXACTLY.

---

## Removing a Satellite

Delete the entire entry for that NORAD ID. If the satellite's section becomes empty, the `_SECTION_` header can be left in place for future use or removed as well.

---

## Sections

Sections are purely cosmetic — they help organize the file and have no effect on the application. The current sections are:

| Section      | Contents                         |
| ------------ | -------------------------------- |
| `_SECTION_1` | High priority FM satellites      |
| `_SECTION_2` | Geostationary weather satellites |
| `_SECTION_3` | Polar weather satellites         |
| `_SECTION_4` | Linear transponder satellites    |
| `_SECTION_5` | CAS & XW constellations          |
| `_SECTION_6` | Specialized digipeaters          |
| `_SECTION_7` | Reserved for new satellites      |

---

## Verifying NORAD IDs

Always verify NORAD IDs before adding a satellite. Common sources:

- [Space-Track.org](https://www.space-track.org) — authoritative source (free account required)
- [CelesTrak](https://celestrak.org) — no account required
- [AMSAT Satellite Status](https://www.amsat.org/status/) — for amateur satellites

> **Note:** Some satellites share a launch vehicle with debris objects that have similar NORAD IDs. Always confirm the ID maps to the actual satellite, not a rocket body or debris fragment.
