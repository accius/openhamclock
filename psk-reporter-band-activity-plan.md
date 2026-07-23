# Implementation Plan: PSKReporter Band Activity Map Overlay

## Goal

A compact map overlay panel showing spot counts per HF band from PSKReporter, using the same time window as the PSKReporter panel.

## Files to create / modify

| #   | Action | Path                                               |
| --- | ------ | -------------------------------------------------- |
| 1   | Create | `src/plugins/layers/usePSKReporterBandActivity.js` |
| 2   | Edit   | `src/plugins/layerRegistry.js` — import + register |
| 3   | Edit   | `server/routes/pskreporter.js` — add API endpoint  |

---

## 1. Backend: `/api/pskreporter/band-activity` endpoint

**File**: `server/routes/pskreporter.js` (append inside the `module.exports` function)

```js
app.get('/api/pskreporter/band-activity', (req, res) => {
  const minutes = parseInt(req.query.minutes) || 15;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const counts = {};

  for (const [, spots] of pskMqtt.recentSpots) {
    for (const spot of spots) {
      if (spot.timestamp < cutoff) continue;
      const band = spot.band;
      if (!band || band === 'Unknown') continue;
      counts[band] = (counts[band] || 0) + 1;
    }
  }

  const bands = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  res.json({ bands, minutes, timestamp: new Date().toISOString() });
});
```

- No cache needed — `pskMqtt.recentSpots` is in-memory, iteration is fast for <500 entries
- Respects user's `minutes` parameter (comes from `ohc_psk_age`)

---

## 2. Frontend: Layer plugin

**File**: `src/plugins/layers/usePSKReporterBandActivity.js`

**Metadata:**

```js
export const metadata = {
  id: 'psk-band-activity',
  name: 'PSK Reporter Band Activity',
  description: 'Spot counts per HF band',
  icon: '📡',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.85,
  version: '1.0.0',
};
```

**Data flow:**

- On mount + when enabled: read `localStorage.getItem('ohc_psk_age')` (default 15)
- Listen for `ohc-psk-age-changed` on `window` → recalculate when time window changes
- Fetch `GET /api/pskreporter/band-activity?minutes=${pskAge}` every 60s (120s in low-memory mode)

**State:**

```js
const [bandCounts, setBandCounts] = useState([]); // [[band, count], ...]
const [pskAge, setPskAge] = useState(15);
```

**Panel rendering** (single L.Control, topright):

Compact horizontal bar chart:

```
┌───────────────────────────────┐
│ 📡 PSK Reporter Band Activity  ▶ │
├───────────────────────────────┤
│  20m  [████████░░░░]  142    │
│  40m  [██████░░░░░░]  98     │
│  15m  [████░░░░░░░░]  73     │
│  10m  [███░░░░░░░░░]  51     │
│  80m  [██░░░░░░░░░░]  34     │
│  30m  [█░░░░░░░░░░░]  12     │
│  17m  [█░░░░░░░░░░░]   8     │
│  60m  [░░░░░░░░░░░░]   2     │
├───────────────────────────────┤
│  Total: 420 · Last 15 min    │
└───────────────────────────────┘
```

**Design details:**

- Band bar width = `(count / maxCount) * 100%` — scales to the most active band
- Band colors from `DEFAULT_BAND_COLORS` (consistent with other overlays)
- Only show bands with `count > 0`
- Sort descending by count
- Mono font, `min-width: 180px`, same panel styling as all existing overlays
- Draggable + minimizable via `makeDraggable()` + `addMinimizeToggle()`
- No map markers — stats-only panel

**Events:**

```js
window.addEventListener('ohc-psk-age-changed', () => {
  try {
    setPskAge(parseInt(localStorage.getItem('ohc_psk_age')) || 15);
  } catch {}
});
```

**Fetch cycle:**

```js
// On mount + when enabled
fetch(`/api/pskreporter/band-activity?minutes=${pskAge}`)
  .then((r) => r.json())
  .then((data) => setBandCounts(data.bands || []));

// Poll every 60s (120s low-memory)
setInterval(fetch, 60000);
```

---

## 3. Registration

**File**: `src/plugins/layerRegistry.js`

```js
// Add import near the top
import * as PSKReporterBandActivityPlugin from './layers/usePSKReporterBandActivity.js';

// Add to layerPlugins array (alphabetical-ish placement under 'propagation' category)
PSKReporterBandActivityPlugin,

// Optional: add to PINNED_SHORTCUTS (pick an unused letter)
'psk-band-activity': 'b',  // or whatever letter is available
```

---

## Summary of all changes

| Change                                      | Lines of code  |
| ------------------------------------------- | -------------- |
| New file `usePSKReporterBandActivity.js`    | ~120 lines     |
| Edit `layerRegistry.js` (import + register) | 2 lines        |
| Edit `pskreporter.js` (API endpoint)        | ~15 lines      |
| **Total**                                   | **~140 lines** |

No CSS changes needed — reuses existing `.panel-wrapper`, `floating-panel-header`, etc. from `main.css`.
