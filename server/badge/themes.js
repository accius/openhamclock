/**
 * Badge colorways.
 *
 * OpenHamClock themes are read from src/styles/themes.css (the same
 * palettes the UI applies via data-theme) so a badge can match the app.
 * Named color themes (red, blue, …) are dark-background + accent pairs;
 * `red` is the near-black / #e10600 brand lockup. The default is `dark`,
 * the app's default theme.
 */

const fs = require('fs');
const path = require('path');
const { mixHex, ensureTextContrast } = require('./color');

const DEFAULT_THEME = 'dark';

const OHC_LABELS = {
  dark: 'Dark',
  light: 'Light',
  legacy: 'Legacy',
  retro: 'Retro',
  matrix: 'Matrix',
  eightbit: '8-Bit',
  steampunk: 'Steampunk',
  trek: 'Trek',
  midnight: 'Midnight',
  ember: 'Ember',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
};

const OHC_ORDER = Object.keys(OHC_LABELS);

const ALIASES = {
  '8bit': 'eightbit',
  '8-bit': 'eightbit',
  grey: 'neutral',
  gray: 'neutral',
  'neutral-dark': 'neutral',
  paper: 'neutral-light',
};

/** Used when themes.css cannot be read (packaging miss). Matches the Dark theme. */
const DARK_FALLBACK = {
  'bg-primary': '#0a0e14',
  'bg-secondary': '#111820',
  'bg-tertiary': '#1a2332',
  'text-primary': '#f0f4f8',
  'text-muted': '#8899aa',
  'accent-amber': '#ffb432',
  'accent-green': '#00ff88',
  'accent-red': '#ff4466',
};

/**
 * Primary color themes. Backgrounds stay dark (except Neutral Light) and
 * accents are bright enough to read at badge size.
 */
const COLOR_THEMES = [
  {
    id: 'red',
    label: 'Red',
    description: 'OpenHamClock brand — near-black, white text, red accents',
    background: '#0c0d10',
    surface: '#17181d',
    text: '#ffffff',
    muted: '#a3a8b0',
    accent: '#ff1f1f',
    accentBar: '#e10600',
    border: '#3a2224',
    good: '#3dd68c',
    fair: '#f5c542',
    poor: '#ff5c5c',
  },
  {
    id: 'blue',
    label: 'Blue',
    description: 'Midnight navy with a bright blue accent',
    background: '#070d18',
    surface: '#10192b',
    text: '#f4f7ff',
    muted: '#9aabc4',
    accent: '#6aa6ff',
    accentBar: '#2f6fed',
    border: '#1c3358',
    good: '#3dd68c',
    fair: '#f5c542',
    poor: '#ff6b7a',
  },
  {
    id: 'green',
    label: 'Green',
    description: 'Deep green-black with a signal-green accent',
    background: '#07110c',
    surface: '#102018',
    text: '#f3fff7',
    muted: '#9bb5a6',
    accent: '#3dd68c',
    accentBar: '#12a35a',
    border: '#1a3d2c',
    good: '#7dffa8',
    fair: '#f5c542',
    poor: '#ff6b6b',
  },
  {
    id: 'yellow',
    label: 'Yellow',
    description: 'Warm black with a high-visibility yellow accent',
    background: '#121006',
    surface: '#1e1a0c',
    text: '#fffaf0',
    muted: '#c4b89a',
    accent: '#ffd15a',
    accentBar: '#e0a800',
    border: '#3d3414',
    good: '#3dd68c',
    fair: '#ffe08a',
    poor: '#ff6b6b',
  },
  {
    id: 'orange',
    label: 'Orange',
    description: 'Dark brown-black with an amber-orange accent',
    background: '#140e08',
    surface: '#24180f',
    text: '#fff6ef',
    muted: '#cbb3a2',
    accent: '#ff9a3c',
    accentBar: '#e86a00',
    border: '#3d2814',
    good: '#3dd68c',
    fair: '#ffd15a',
    poor: '#ff5c5c',
  },
  {
    id: 'purple',
    label: 'Purple',
    description: 'Deep violet with a bright purple accent',
    background: '#100818',
    surface: '#1c102c',
    text: '#f8f4ff',
    muted: '#b7a8c9',
    accent: '#c084fc',
    accentBar: '#8b3dff',
    border: '#342050',
    good: '#3dd68c',
    fair: '#f5c542',
    poor: '#ff6b8a',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    description: 'Dark grey, white text, silver accent',
    background: '#141416',
    surface: '#1e1e22',
    text: '#f4f5f7',
    muted: '#a1a6ae',
    accent: '#d5d8de',
    accentBar: '#8b909a',
    border: '#2e3036',
    good: '#3dd68c',
    fair: '#f5c542',
    poor: '#ff6b6b',
  },
  {
    id: 'neutral-light',
    label: 'Neutral Light',
    description: 'Light grey background with dark text',
    background: '#f3f4f6',
    surface: '#ffffff',
    text: '#1a1d22',
    muted: '#5c6370',
    accent: '#1f2933',
    accentBar: '#3a4250',
    border: '#d0d4dc',
    good: '#0d7a45',
    fair: '#8a5a00',
    poor: '#c4232c',
  },
];

function themesCssPath() {
  return path.join(__dirname, '..', '..', 'src', 'styles', 'themes.css');
}

/** `[data-theme='name'] { --var: value }` — same shape as src/utils/contrast.js. */
function parseThemePalettes(cssText) {
  const palettes = {};
  const blockRe = /\[data-theme=['"]([\w-]+)['"]\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(cssText)) !== null) {
    const vars = palettes[m[1]] || (palettes[m[1]] = {});
    const varRe = /--([\w-]+)\s*:\s*([^;]+);/g;
    let v;
    while ((v = varRe.exec(m[2])) !== null) vars[v[1]] = v[2].trim();
  }
  return palettes;
}

function loadCssPalettes() {
  try {
    return parseThemePalettes(fs.readFileSync(themesCssPath(), 'utf8'));
  } catch {
    return { dark: { ...DARK_FALLBACK } };
  }
}

function hexOnly(value) {
  const m = String(value || '')
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  return `#${hex.toLowerCase()}`;
}

function withContrast(base) {
  const bg = base.background;
  return {
    ...base,
    text: ensureTextContrast(base.text, bg, 4.5),
    muted: ensureTextContrast(base.muted, bg, 4.5),
    // Large wordmark: 3:1 keeps the theme hue instead of washing it out.
    accent: ensureTextContrast(base.accent, bg, 3),
    good: ensureTextContrast(base.good, bg, 3),
    fair: ensureTextContrast(base.fair, bg, 3),
    poor: ensureTextContrast(base.poor, bg, 3),
  };
}

function paletteFromVars(id, vars) {
  const background = hexOnly(vars['bg-primary']);
  if (!background) return null;
  const text = hexOnly(vars['text-primary']) || '#f0f4f8';
  const muted = hexOnly(vars['text-muted']) || text;
  const accent = hexOnly(vars['accent-amber']) || text;
  const good = hexOnly(vars['accent-green']) || '#00ff88';
  const poor = hexOnly(vars['accent-red']) || '#ff4466';
  const surface = hexOnly(vars['bg-tertiary']) || hexOnly(vars['bg-secondary']) || mixHex(background, text, 0.08);
  const border = hexOnly(vars['border-color']) || mixHex(background, accent, 0.4);
  const label = OHC_LABELS[id] || id;
  return withContrast({
    id,
    label,
    group: 'openhamclock',
    description: `Matches the ${label} theme in OpenHamClock`,
    background,
    surface,
    text,
    muted,
    accent,
    accentBar: accent,
    border,
    good,
    fair: accent,
    poor,
  });
}

let cachedMap = null;

function themeMap() {
  if (cachedMap) return cachedMap;
  const map = {};
  const css = loadCssPalettes();
  const ids = [...OHC_ORDER];
  for (const id of Object.keys(css)) if (!ids.includes(id)) ids.push(id);
  for (const id of ids) {
    const vars = css[id] || (id === 'dark' ? DARK_FALLBACK : null);
    if (!vars) continue;
    const palette = paletteFromVars(id, vars);
    if (palette) map[id] = palette;
  }
  if (!map.dark) map.dark = paletteFromVars('dark', DARK_FALLBACK);
  for (const theme of COLOR_THEMES) map[theme.id] = withContrast({ ...theme, group: 'color' });
  cachedMap = map;
  return map;
}

function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

function resolveBadgeTheme(name) {
  const map = themeMap();
  const key = ALIASES[normalizeName(name)] || normalizeName(name);
  return map[key] || map[DEFAULT_THEME];
}

function listBadgeThemes() {
  const map = themeMap();
  const ohc = [];
  const color = [];
  for (const id of OHC_ORDER) if (map[id]?.group === 'openhamclock') ohc.push(map[id]);
  for (const id of Object.keys(map)) {
    if (map[id].group === 'openhamclock' && !OHC_ORDER.includes(id)) ohc.push(map[id]);
  }
  for (const theme of COLOR_THEMES) if (map[theme.id]) color.push(map[theme.id]);
  return [...ohc, ...color];
}

function publicTheme(theme) {
  return {
    id: theme.id,
    label: theme.label,
    group: theme.group,
    description: theme.description,
    background: theme.background,
    accent: theme.accent,
    text: theme.text,
  };
}

module.exports = {
  DEFAULT_THEME,
  resolveBadgeTheme,
  listBadgeThemes,
  publicTheme,
  parseThemePalettes,
  themesCssPath,
};
