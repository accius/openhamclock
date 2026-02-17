# OpenHamClock Architecture

A guide to navigating the codebase. Start here if you're new.

## High-Level Overview

OpenHamClock is a full-stack JavaScript application:

- **Frontend**: React 18 (Vite build), Leaflet maps, inline CSS with CSS variables for theming
- **Backend**: Express.js server that proxies 40+ external APIs, manages SSE/WebSocket connections, and serves static files
- **Deployment**: Docker on Railway (production), `npm run dev` for local development

```
┌──────────────────────────────────────────────────────┐
│                    Browser (React)                    │
│  App.jsx → Layout → Panels + WorldMap + Plugins      │
│            ↕ fetch/SSE/MQTT                          │
├──────────────────────────────────────────────────────┤
│                  server.js (Express)                  │
│  /api/* → proxies to POTA, SOTA, QRZ, NOAA, etc.    │
│  SSE → DX cluster spots, PSK Reporter, RBN          │
│  Static → dist/ (built) or public/ (fallback)        │
├──────────────────────────────────────────────────────┤
│              External APIs & Data Sources             │
│  POTA · SOTA · WWFF · QRZ · HamQTH · NOAA · N0NBH  │
│  PSK Reporter MQTT · DX Spider Telnet · RBN Telnet   │
│  CelesTrak TLEs · Ionosonde · VOACAP · WSPR         │
└──────────────────────────────────────────────────────┘
```

## Directory Structure

```
openhamclock-main/
├── index.html              # Vite entry point → builds to dist/index.html
├── server.js               # Express backend (all API routes, SSE, data aggregation)
├── config.js               # Runtime configuration loader
├── package.json            # Dependencies and scripts
├── vite.config.mjs         # Vite build configuration
├── Dockerfile              # Production Docker build (multi-stage)
├── docker-compose.yml      # Local Docker development
├── railway.json            # Railway deployment config
│
├── src/                    # React frontend source
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # Main app — uses ModernLayout or ClassicLayout
│   ├── DockableApp.jsx     # Alternate dockable/windowed layout
│   │
│   ├── components/         # UI panels and widgets
│   │   ├── WorldMap.jsx        # Leaflet map (the big one)
│   │   ├── SettingsPanel.jsx   # Settings modal with tabs
│   │   ├── WhatsNew.jsx        # Version changelog popup
│   │   ├── DXClusterPanel.jsx  # DX spot list
│   │   ├── POTAPanel.jsx       # Parks on the Air
│   │   ├── SOTAPanel.jsx       # Summits on the Air
│   │   ├── WWFFPanel.jsx       # World Wide Flora & Fauna
│   │   ├── SolarPanel.jsx      # Solar flux, K-index, SSN
│   │   ├── PropagationPanel.jsx # HF propagation predictions
│   │   ├── PSKReporterPanel.jsx # PSK Reporter spots
│   │   ├── RigControlPanel.jsx # Rig frequency/mode display
│   │   ├── RotatorPanel.jsx    # Antenna rotator control
│   │   └── ...                 # ~30 more panels
│   │
│   ├── hooks/              # Data fetching and state management
│   │   ├── useDXCluster.js     # DX cluster spots (SSE)
│   │   ├── usePOTASpots.js     # POTA API polling
│   │   ├── useSOTASpots.js     # SOTA API polling
│   │   ├── usePSKReporter.js   # PSK Reporter MQTT
│   │   ├── useSolarIndices.js  # NOAA solar data
│   │   ├── useSatellites.js    # TLE data + orbital calcs
│   │   └── app/                # App-level hooks
│   │       ├── useAppConfig.js     # Config loading/saving
│   │       ├── useMapLayers.js     # Map layer toggle state
│   │       └── useVersionCheck.js  # Version check + update toast
│   │
│   ├── contexts/           # React contexts
│   │   └── RigContext.jsx      # Rig control state + tuneTo()
│   │
│   ├── layouts/            # Page layouts
│   │   ├── ModernLayout.jsx    # Default responsive grid
│   │   ├── ClassicLayout.jsx   # HamClock-inspired layout
│   │   └── DockableLayout.jsx  # Draggable windowed panels
│   │
│   ├── plugins/            # Map layer plugins (hot-pluggable)
│   │   ├── layerRegistry.js    # Plugin discovery and loading
│   │   └── layers/             # One file per map layer
│   │       ├── useSatelliteLayer.js  # Satellite tracking
│   │       ├── useVOACAPHeatmap.js   # Propagation heatmap
│   │       ├── useMUFMap.js          # MUF ionospheric overlay
│   │       ├── useRBN.js             # RBN skimmer markers
│   │       ├── useWSPR.js            # WSPR heatmap
│   │       ├── useEarthquakes.js     # Seismic activity
│   │       ├── useLightning.js       # Lightning strikes
│   │       └── ...
│   │
│   ├── utils/              # Pure utility functions
│   │   ├── callsign.js         # Callsign parsing, DXCC lookup
│   │   ├── ctyLookup.js        # cty.dat database interface
│   │   ├── geo.js              # Grid square, great circle math
│   │   ├── bandPlan.js         # Band/frequency utilities
│   │   └── dxClusterFilters.js # DX spot filtering logic
│   │
│   ├── lang/               # i18n translation files
│   ├── styles/             # CSS files
│   └── store/              # State management (Zustand)
│
├── public/                 # Static assets (copied to dist/ by Vite)
│   ├── index-monolithic.html   # Self-contained fallback (entire app in one file)
│   ├── favicon.ico             # Favicon (multi-resolution)
│   ├── favicon-32x32.png       # PNG favicon
│   ├── manifest.json           # PWA manifest
│   ├── robots.txt              # Search engine directives
│   ├── sitemap.xml             # Sitemap for SEO
│   └── icons/                  # App icons and OG image
│
├── rig-listener/           # Standalone USB rig control bridge
│   ├── rig-listener.js         # Serial port ↔ WebSocket bridge
│   ├── build.js                # Builds standalone executables
│   └── start-rig-listener.*    # Platform launch scripts
│
├── dxspider-proxy/         # DX Spider telnet proxy service
├── iturhfprop-service/     # ITU-R P.533 propagation engine
├── wsjtx-relay/            # WSJT-X UDP → WebSocket relay
├── electron/               # Electron desktop wrapper (experimental)
├── scripts/                # Build and setup scripts
│
├── docs/                   # Documentation
│   └── ARCHITECTURE.md         # This file
│
├── .github/
│   ├── workflows/              # CI/CD
│   │   ├── ci.yml                  # Test + lint
│   │   ├── docker-image.yml        # Docker build
│   │   └── rig-listener-build.yml  # Rig listener executables
│   └── ISSUE_TEMPLATE/         # Bug report and feature request templates
│
├── CONTRIBUTING.md         # How to contribute
├── CHANGELOG.md            # Version history
├── TESTING.md              # Test guide
├── CODE_OF_CONDUCT.md      # Community standards
├── SECURITY.md             # Security policy
└── LICENSE                 # License
```

## Key Patterns

### Data Flow: Hook → Component → Layout

Every data panel follows the same pattern:

```
useXxxSpots.js (hook)     →  XxxPanel.jsx (component)  →  Layout.jsx
  ├── fetch /api/xxx         ├── renders data list          ├── arranges panels
  ├── polling interval       ├── handles click events       └── passes props
  └── returns { data }       └── calls tuneTo() on click
```

### Adding a New Panel

1. Create hook: `src/hooks/useMyFeature.js` — fetch data, return `{ data, loading }`
2. Create component: `src/components/MyFeaturePanel.jsx` — render the data
3. Add API route to `server.js` if you need to proxy an external API
4. Wire it into the layout(s): `ModernLayout.jsx`, `ClassicLayout.jsx`, `DockableApp.jsx`

### Adding a Map Layer Plugin

1. Create `src/plugins/layers/useMyLayer.js` following the plugin interface:
   ```js
   export const meta = { name: 'my-layer', label: 'My Layer', ... };
   export const useLayer = ({ map, enabled, config }) => { ... };
   ```
2. The layer registry auto-discovers it — no manual registration needed
3. See `src/plugins/OpenHamClock-Plugin-Guide.md` for the full API

### Theming

Three themes: `dark`, `light`, `retro`. All colors use CSS custom properties:

```css
var(--bg-primary)      /* Main background */
var(--accent-amber)    /* Primary accent (gold) */
var(--accent-green)    /* Success / active */
var(--accent-cyan)     /* Links / interactive */
var(--text-primary)    /* Main text */
var(--text-muted)      /* Secondary text */
```

Never hardcode colors — always use `var(--xxx)` so all three themes work.

### Server-Side API Proxy Pattern

All external API calls go through `server.js` to avoid CORS issues and add caching:

```js
// 1. Define cache
let myCache = { data: null, timestamp: 0 };
const MY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// 2. Create route
app.get('/api/myfeature', async (req, res) => {
  const now = Date.now();
  if (myCache.data && (now - myCache.timestamp) < MY_CACHE_TTL) {
    return res.json(myCache.data);
  }
  const response = await fetch('https://external-api.com/data');
  const data = await response.json();
  myCache = { data, timestamp: now };
  res.json(data);
});
```

## Monolithic Fallback

`public/index-monolithic.html` is a self-contained copy of the entire frontend in a single HTML file. It exists for environments where `npm run build` isn't available (e.g. Raspberry Pi quick setup). When editing features, **always update the React source in `src/`** — that's what production runs.

## Performance Notes

- **2,000+ concurrent SSE connections** at peak
- **server.js** is a single Node.js process handling everything
- Memory-sensitive: all caches have explicit size caps and TTLs
- The `geoIPCache` Map and `callsignLocationCache` Map have eviction limits
- Stats save interval is 5 minutes (not 60 seconds) to reduce GC pressure
