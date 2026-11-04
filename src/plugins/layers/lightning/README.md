# ⚡ Lightning layer

**Hook:** `src/plugins/layers/useLightning.js` (layer id `lightning`, category weather, off by default)
**Data:** Blitzortung.org real-time strike stream, through the shared feed in `src/utils/lightningFeed.js`

The layer draws live lightning strikes worldwide on the flat map for the last 30 minutes. It only _shows_ lightning; warning you about lightning near your station is the job of the **lightning guard** (Settings → Alerts → Lightning guard, `src/hooks/useLightningGuard.js`), which uses the same feed and works whether the layer is on or not.

## Where the strikes come from

Blitzortung.org is a community network of receivers; its servers push every located strike over a WebSocket (`wss://ws1/2/7/8.blitzortung.org`, key `111`, messages LZW-compressed JSON `{ time (ns), lat, lon, alt, pol, mds }`).

All browser consumers share **one** socket:

```
Blitzortung ──WebSocket──► utils/lightningFeed.js ──1 s batches──► useLightning (this layer)
                                │                              ├─► Globe3D lightning overlay
                                │                              └─► useLightningGuard (alerts, relay)
                                └─ injectStrike() — simulated strikes for testing
```

- `subscribeStrikes(fn)` opens the socket with the first subscriber and closes it after the last; `fn` receives batches of new strikes once a second. Each subscriber keeps its own history.
- Reconnects after 5 s; after three failures on one server it moves to the next.
- Parsing (`lzwDecode`, `parseStrikeMessage`) and the server list live in the guard core, `src/utils/lightningGuard.js`, because Rig Bridge's headless guard uses the same code (generated copy: `rig-bridge/lib/lightning-guard-logic.js`, `npm run lightning:sync`).
- `injectStrike({ lat, lon })` delivers a synthetic strike (`simulated: true`) to every subscriber. The guard's **Simulate** buttons and the `ohc:inject-lightning` window event use it, so a test strike also appears on this layer.

Strike shape: `{ id, lat, lon, timestamp (ms), intensity (kA), polarity: 'positive'|'negative', altitude, signal }`.

## What the layer shows

- **Strike markers** (⚡) coloured by age: gold < 1 min, orange < 5 min, red < 15 min, dark red < 30 min, brown older. New strikes pulse with a shockwave ring. Click a marker for age, polarity/current and position.
- **Thunder fronts** at zoom 8 and closer: a circle growing at the speed of sound (343 m/s) around each strike younger than two minutes.
- **Statistics panel** (draggable, minimisable): strikes in the last minute, 1–5 minutes, total, average current, positive/negative counts.
- **Nearby panel** (draggable, minimisable): strikes within 30 km of DE, the closest with distance, age and current. The statistics panel border flashes red while a strike within 30 km is less than a minute old. These are visual only — sounds, speech, notifications, Web Push, screen-reader announcements and the antenna relay all come from the lightning guard, with its own radii.

Retention: 30 minutes, at most 500 strikes (100 in Low Memory Mode). The layer also publishes its strikes as the `mapdata:lightning` window event for the **Map Data** text view (at most every 5 s).

The 3D globe draws its own lightning overlay from the same feed (the Leaflet layer hooks do not run in globe mode).

## Limitations

- Blitzortung is a volunteer network: coverage and detection efficiency vary by region, and strikes can arrive late or not at all. It is not an official warning service, and its data is for non-commercial use.
- Distances in the nearby panel are great-circle distances from your DE location; set your station location in Settings → Station.

## Safety

Showing lightning on a map is no protection. Follow official weather warnings, ground and protect your station properly, and disconnect antennas by hand when storms are forecast.
