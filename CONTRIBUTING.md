# Contributing to OpenHamClock

Thank you for helping build OpenHamClock! Whether you're fixing a bug, adding a feature, improving docs, or translating — every contribution matters.

**New here?** Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full codebase map.

## Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/openhamclock.git
cd openhamclock

# 2. Install dependencies
npm install

# 3. Start the backend (Terminal 1)
node server.js
# → Server running on http://localhost:3001

# 4. Start the frontend dev server (Terminal 2)
npm run dev
# → App running on http://localhost:3000 (proxies API to :3001)
```

Open `http://localhost:3000` — you should see the full dashboard with live data.

### Docker Alternative

```bash
docker compose up
# → App running on http://localhost:3001
```

## Project Structure

```
src/
├── components/     # React UI panels (DXClusterPanel, SolarPanel, etc.)
├── hooks/          # Data fetching hooks (useDXCluster, usePOTASpots, etc.)
├── plugins/layers/ # Map layer plugins (satellites, VOACAP, RBN, etc.)
├── layouts/        # Page layouts (Modern, Classic, Dockable)
├── contexts/       # React contexts (RigContext)
├── utils/          # Pure utility functions (callsign, geo, filters)
├── lang/           # i18n translation files
└── styles/         # CSS files

server.js           # Express backend — all API routes, SSE, data proxying
public/             # Static assets, favicon, PWA manifest
rig-listener/       # Standalone USB rig control bridge
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
   ```
   /assign
   ```
3. The bot will assign the issue to you and react with 👍

No write access required — any GitHub user can self-assign. Once assigned, feel free to ask questions in the issue thread before diving in. If you claimed something and it's no longer on your radar, just leave a comment so someone else can pick it up.

### Submitting Code

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** — keep commits focused and descriptive
3. **Test** across all three themes (dark, light, retro) and at different screen sizes
4. **Open a PR** against `main` with a clear description of what changed and why

#### Branch Naming

```
feature/my-new-panel
fix/pota-frequency-display
docs/update-readme
```

## Code Formatting

We use **Prettier** to enforce consistent formatting across the codebase. This eliminates quote style, indentation, and whitespace noise from PRs so code review can focus on logic.

**It happens automatically:** If you run `npm install`, a git pre-commit hook (via Husky + lint-staged) will auto-format any staged files before each commit. You don't need to think about it.

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

### API Routes (server.js)

All external APIs are proxied through `server.js` with caching:

```jsx
// Good utility
export const calculateSomething = (input1, input2) => {
  // Pure calculation, no API calls or DOM access
  return result;
};
```

## 🧰 Code Style & Dependency Consistency

This repository uses shared formatting and dependency lock conventions so contributions remain consistent across editors, operating systems, and CI.

### `.editorconfig`

- Defines editor-level basics (for example indentation, line endings, and final newline).
- Helps avoid "editor drift" where different IDE defaults create noisy formatting diffs.
- Most editors apply it automatically.

### `.prettierrc`

- Defines one shared Prettier style for the project.
- Reduces style discussions in PRs and keeps reviews focused on behavior and correctness.
- If your editor has Prettier integration, format-on-save will follow the repo rules.

### `package-lock.json` is tracked

- The lockfile is intentionally committed and must stay in Git.
- This ensures everyone (local dev, CI, and production) resolves the exact same dependency graph.
- Avoids "works on my machine" issues caused by floating transitive dependency updates.

### Use `npm ci` for installs

- Preferred install command is `npm ci` (not `npm install`) when working from a clean checkout.
- `npm ci` installs exactly what is in `package-lock.json`, which makes builds deterministic.
- Typical workflow:

```bash
npm ci
npm run dev
```

## 🎨 CSS & Theming

Use CSS variables for all colors:

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

### Map Layer Plugins

Create `src/plugins/layers/useMyLayer.js`:

```js
export const meta = {
  name: 'my-layer',
  label: 'My Layer',
  description: 'What this layer shows',
  defaultEnabled: false,
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

The layer registry auto-discovers plugins — no manual registration needed. See `src/plugins/OpenHamClock-Plugin-Guide.md` for the full plugin API.

### Theming

Three themes: `dark`, `light`, `retro`. **Never hardcode colors** — always use CSS variables:

```jsx
// ✅ Good
<div style={{ color: 'var(--accent-cyan)', background: 'var(--bg-panel)' }}>

// ❌ Bad
<div style={{ color: '#00ddff', background: '#1a1a2e' }}>
```

Key variables: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-panel`, `--border-color`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-amber`, `--accent-green`, `--accent-red`, `--accent-cyan`

## Testing Checklist

Before submitting a PR, verify:

- [ ] App loads without console errors
- [ ] Works in **Dark**, **Light**, and **Retro** themes
- [ ] Responsive at different screen sizes
- [ ] If touching `server.js`: memory-safe (caches have TTLs and size caps)
- [ ] If adding an API route: includes caching and error handling
- [ ] If adding a panel: wired into all three layouts (Modern, Classic, Dockable)
- [ ] Existing features still work

```bash
# Run tests
npm test

# Check formatting (CI will fail without this)
npm run format:check

# Auto-fix formatting
npm run format
```

## Important Notes

- **`server.js` handles 2,000+ concurrent connections** — be mindful of memory. Every cache needs a TTL and a size cap.
- **`src/` is what production runs** — the built React app from Vite. `public/index-monolithic.html` is a legacy fallback.
- **Don't commit** `.bak`, `.backup`, `.old`, `tle_backup.txt`, test scripts, or other debug files. They're in `.gitignore`.
- **Frequencies**: POTA/SOTA use MHz, some APIs return kHz. Always normalize display to MHz.
- **Rig control**: The `tuneTo()` function in `RigContext` handles all unit conversion. Pass the raw spot object.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

All contributors are listed in the **Community** tab inside the app (Settings → Community) and linked to their GitHub profiles. When your PR is merged, we'll add you to the contributors wall. Thank you for helping build OpenHamClock — 73!
