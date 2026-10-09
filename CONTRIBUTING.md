# Contributing to OpenHamClock

Thank you for helping build OpenHamClock! Whether you're fixing a bug, adding a feature, improving docs, or translating — every contribution matters.

**New here?** Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full codebase map.

## Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/openhamclock.git
cd openhamclock
npm ci
bash scripts/vendor-download.sh   # Leaflet + fonts into public/vendor (gitignored)
git checkout Staging

# 2. Start the backend (Terminal 1)
node server.js
# → Server running on http://localhost:3001

# 3. Start the frontend dev server (Terminal 2)
npm run dev
# → App running on http://localhost:3000 (proxies API to :3001)
```

Open `http://localhost:3000` — you should see the full dashboard with live data.

> If the flat map stays empty under `npm run dev`, the vendor step was skipped. The backend on :3001 quietly redirects missing `/vendor` files to a CDN, but the dev server on :3000 has no such fallback, so Leaflet never loads.

### Docker Alternative

```bash
docker compose up
# → App running on http://localhost:3000
```

## Project Structure

```text
src/
├── components/     # React UI panels (DXClusterPanel, SolarPanel, LogbookPanel, etc.)
├── hooks/          # Data fetching hooks (useDXCluster, usePOTASpots, etc.)
├── plugins/layers/ # Built-in map layer plugins (satellites, VOACAP, RBN, etc.)
├── plugins/local/  # Your custom layer plugins — auto-discovered, gitignored
├── layouts/        # Page layouts (Modern, Classic, EmComm)
├── DockableApp.jsx # Dockable layout — panel catalog and docking logic
├── contexts/       # React contexts (RigContext)
├── services/       # Client-side stores (logbookStore — IndexedDB logbook)
├── utils/          # Pure utility functions (callsign, geo, filters, awards)
├── pwa/            # Service worker registration (offline mode)
├── lang/           # i18n translation files (one JSON per language)
└── styles/         # CSS files

server.js           # Express entry point — mounts routes, SSE, UDP listeners
server/routes/      # API route modules (dxcluster, satellites, propagation, ...)
server/config.js    # Env var → runtime config loader
public/             # Static assets, PWA manifest, service worker (sw.js)
rig-bridge/         # Local rig control bridge with its plugin system
dxspider-proxy/     # DX Spider telnet proxy microservice
ohc-cluster/        # OpenHamClock's own DX cluster node
iturhfprop-service/ # ITU-R P.533 propagation microservice
wasm-build/         # P.533 → WebAssembly build for client-side propagation
```

Full architecture details: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/accius/openhamclock/issues) first
2. Open a new issue using the **Bug Report** template
3. Include: browser, screen size, console errors, steps to reproduce

### Requesting Features

1. Open an issue using the **Feature Request** template
2. Describe the use case — _why_ is this useful for operators?
3. Mockups and screenshots are welcome

### Claiming a Bug or Issue

See an issue you want to fix? Claim it so others know it's being worked on:

1. Find an issue you'd like to work on
2. Leave a comment containing exactly:

   ```text
   /assign
   ```

3. The bot will assign the issue to you and react with 👍

No write access required — any GitHub user can self-assign. Once assigned, feel free to ask questions in the issue thread before diving in. If you claimed something and it's no longer on your radar, just leave a comment so someone else can pick it up.

### Closing an Issue

Fixed the bug or confirmed a resolution? Close the issue directly:

1. Leave a comment containing exactly:

   ```text
   /close
   ```

2. The bot will close the issue and react with 🚀

### Submitting Code

1. **Fork** the repo and create a branch from `Staging`
2. **Make your changes** — keep commits focused and descriptive
3. **Test** across themes (dark, light, retro at minimum) and at different screen sizes
4. **Update the docs** — see [Documentation](#documentation) below
5. **Open a PR** against `Staging` with a clear description of what changed and why

> **⚠️ Important:** All pull requests should target the **`Staging`** branch, not `main`. The `Staging` branch is always the most up-to-date version of the codebase. `Staging` is merged into `main` on the monthly release cycle (first Tuesday of the month).

#### Branch Naming

Branch off `Staging` and use a descriptive prefix:

```text
feature/my-new-panel
fix/pota-frequency-display
docs/update-readme
```

## Code Formatting

We use **Prettier** to enforce consistent formatting across the codebase. This eliminates quote style, indentation, and whitespace noise from PRs so code review can focus on logic.

**It happens automatically:** After you run `npm ci`, a git pre-commit hook (via Husky + lint-staged) will auto-format any staged files before each commit. You don't need to think about it.

**Manual commands:**

```bash
# Format everything
npm run format

# Check without writing (what CI runs)
npm run format:check
```

**Our style** (`.prettierrc`): single quotes, semicolons, 2-space indent, 120-char line width, trailing commas.

**CI will fail** if unformatted code is pushed. If you see a CI failure on the `format` check, just run `npm run format` and commit the result.

**IDE setup (optional but recommended):** Install the Prettier extension for your editor and enable "Format on Save." The `.prettierrc` and `.editorconfig` files will be picked up automatically.

## Code Guidelines

### Components

Each panel is a self-contained React component in `src/components/`.

```jsx
// src/components/MyPanel.jsx
export const MyPanel = ({ data, loading, onSpotClick }) => {
  if (loading) return <div>Loading...</div>;
  if (!data?.length) return <div>No data</div>;

  return (
    <div style={{ color: 'var(--text-primary)' }}>
      {data.map((item) => (
        <div key={item.id} onClick={() => onSpotClick?.(item)}>
          {item.callsign} — {item.freq}
        </div>
      ))}
    </div>
  );
};
```

### Hooks

Each data source has a dedicated hook in `src/hooks/`.

```jsx
// src/hooks/useMyData.js
export const useMyData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/mydata');
        if (res.ok) setData(await res.json());
      } catch (err) {
        console.error('[MyData]', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};
```

### API Routes (server/routes/)

All external APIs are proxied through the Express backend with caching. Routes live in modules under `server/routes/`; each cache needs a TTL and a size cap:

```js
let myCache = { data: null, timestamp: 0 };
const MY_TTL = 5 * 60 * 1000;

app.get('/api/mydata', async (req, res) => {
  const now = Date.now();
  if (myCache.data && now - myCache.timestamp < MY_TTL) {
    return res.json(myCache.data);
  }
  const data = await fetch('https://api.example.com/data').then((r) => r.json());
  myCache = { data, timestamp: now };
  res.json(data);
});
```

### Utilities

Pure functions go in `src/utils/` — no API calls, no DOM access — and should ship with colocated tests:

```js
// src/utils/myMath.js
export const calculateSomething = (input1, input2) => {
  // Pure calculation
  return result;
};
```

### Map Layer Plugins

Create `src/plugins/layers/useMyLayer.js` (or `src/plugins/local/useMyLayer.js` for a personal plugin that survives git updates — the `local/` directory is gitignored and auto-discovered):

```js
export const metadata = {
  id: 'my-layer',
  name: 'My Layer',
  description: 'What this layer shows',
  icon: '🗺️',
  category: 'overlay',
  defaultEnabled: false,
  defaultOpacity: 0.6,
};

export const useLayer = ({ map, enabled, config }) => {
  useEffect(() => {
    if (!map || !enabled) return;
    // Add your Leaflet layers here
    return () => {
      /* cleanup */
    };
  }, [map, enabled]);
};
```

Local plugins in `src/plugins/local/` need no registration at all — Vite's glob import picks them up. Built-in plugins in `src/plugins/layers/` are imported in `src/plugins/layerRegistry.js` (add one import + one array entry, and optionally a pinned keyboard shortcut). See `src/plugins/OpenHamClock-Plugin-Guide.md` for the full plugin API.

### Panel Plugins

Custom dockable panels work the same way: drop a `.jsx` file into `src/plugins/local/panels/` exporting `metadata` (`{ id, name, icon }`) and a `Panel` component. Panels receive a stable v1 props contract of `{ config, t }` only, appear under **Plugins** in the "+" panel picker, and are wrapped in an ErrorBoundary so a broken plugin can't crash the app. See [docs/PLUGINS.md](docs/PLUGINS.md) for the full guide to both plugin types, including a working example panel.

### Theming

Five themes: `dark`, `light`, `legacy`, `retro`, and `custom` (user-editable). **Never hardcode colors** — always use CSS variables:

```jsx
// ✅ Good
<div style={{ color: 'var(--accent-cyan)', background: 'var(--bg-panel)' }}>

// ❌ Bad
<div style={{ color: '#00ddff', background: '#1a1a2e' }}>
```

Key variables: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-panel`, `--border-color`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-amber`, `--accent-green`, `--accent-red`, `--accent-cyan`

## Translations

The UI ships in 16 languages (see `src/lang/`). To improve one or add a new language:

1. Every language file is a flat JSON of `"dotted.key": "value"` pairs. Copy `src/lang/en.json` for a new language, or edit the existing file.
2. Keys must stay **alphabetically sorted** — CI enforces this. Fix ordering automatically with:

   ```bash
   npm run lang:sort    # sorts keys in place
   npm run lang:check   # what CI runs
   ```

3. Register a new language in `src/lang/i18n.js` and submit a PR.

Untranslated keys fall back to English, so partial translations are welcome — every string helps.

## Testing

Unit tests use Vitest and are colocated with the code they cover (`foo.js` → `foo.test.js`). See **[TESTING.md](TESTING.md)** for the full guide.

```bash
npm test             # watch mode
npm run test:run     # single run (what CI does)
```

PRs that touch filtering, parsing, geo math, or other pure utilities should add or update the colocated tests.

## Documentation

**Every PR that adds or changes a user-facing feature must update [docs/MANUAL.md](docs/MANUAL.md)** — the user manual is part of the feature, not an afterthought. If your change affects installation or first-run setup, update [docs/QUICKSTART.md](docs/QUICKSTART.md) too. Reviewers and triage will check for this before merging.

A short paragraph in the right section is enough: what the feature is, where to find it, and any configuration it needs. Match the surrounding tone.

## Pre-PR Checklist

- [ ] App loads without console errors
- [ ] Works in **Dark**, **Light**, and **Retro** themes
- [ ] Responsive at different screen sizes
- [ ] If touching server code: memory-safe (caches have TTLs and size caps)
- [ ] If adding an API route: includes caching and error handling
- [ ] If adding a panel: registered in `DockableApp.jsx` panel definitions (and other layouts where it applies)
- [ ] `docs/MANUAL.md` updated for user-facing changes
- [ ] Existing features still work

```bash
# Run tests
npm run test:run

# Check formatting (CI will fail without this)
npm run format:check

# Check translation key ordering (CI will fail without this)
npm run lang:check
```

## Important Notes

- **The backend handles 2,000+ concurrent connections** on the hosted site — be mindful of memory. Every cache needs a TTL and a size cap.
- **Use `npm ci`, not `npm install`**, when working from a clean checkout — it installs exactly what's in the committed `package-lock.json`, keeping local dev, CI, and production deterministic. The lockfile stays in git.
- **Don't commit** `.bak`, `.backup`, `.old`, test scripts, or other debug files. They're in `.gitignore`.
- **Frequencies**: POTA/SOTA use MHz, some APIs return kHz. Always normalize display to MHz.
- **Rig control**: The `tuneTo()` function in `RigContext` handles all unit conversion. Pass the raw spot object.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

All contributors are listed in the **Community** tab inside the app (Settings → Community) and linked to their GitHub profiles. When your PR is merged, we'll add you to the contributors wall. Thank you for helping build OpenHamClock — 73!
