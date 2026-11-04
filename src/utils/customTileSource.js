/**
 * Operator-supplied tile source ("My tile server") for offline area packs.
 *
 * An operator can point OpenHamClock at their own tile server — a
 * TileServer GL / mbtiles server on the shack Pi or LAN, a club server, or
 * a commercial account whose terms allow offline storage — and save areas
 * from it like the built-in offline basemaps. The operator ticks a box
 * confirming the source permits it; we still refuse a few well-known public
 * servers whose terms forbid bulk/offline download.
 *
 * Stored per browser (localStorage); MAP_STYLES picks it up at load as the
 * `custom` style, so a change needs a reload to reach the map dropdown.
 */
import { tileUrlPrefixes } from './swPolicy.js';

export const CUSTOM_TILE_SOURCE_KEY = 'openhamclock_customTileSource';
export const CUSTOM_STYLE_ID = 'custom';

/** Public tile servers whose terms forbid saving areas offline. */
const FORBIDDEN_HOST_PATTERNS = [
  /(^|\.)tile\.openstreetmap\.org$/i, // OSMF tile policy: offline use not permitted
  /(^|\.)openstreetmap\.(org|fr|de)$/i,
  /(^|\.)arcgisonline\.com$/i, // Esri: offline needs Esri's export workflow + account
  /(^|\.)arcgis\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)cartocdn\.com$/i,
  /(^|\.)opentopomap\.org$/i, // free use only while no mass downloads
  /(^|\.)geo\.admin\.ch$/i, // swisstopo: bulk goes through its download service
  /(^|\.)thunderforest\.com$/i,
  /(^|\.)stadiamaps\.com$/i,
  /(^|\.)mapbox\.com$/i,
];

/**
 * Validate a source. Returns { ok: true, source } with a normalized copy,
 * or { ok: false, error } where error is one of:
 * 'url', 'placeholders', 'forbidden', 'confirm'.
 */
export function validateCustomTileSource(input) {
  const url = String(input?.url || '').trim();
  let parsed;
  try {
    parsed = new URL(url.replace(/\{[^}]+\}/g, '0'));
  } catch {
    return { ok: false, error: 'url' };
  }
  const subdomains = String(input?.subdomains || 'abc').replace(/[^a-z0-9]/gi, '') || 'abc';
  if (!/^https?:$/.test(parsed.protocol) || tileUrlPrefixes(url, subdomains).length === 0) {
    return { ok: false, error: 'url' };
  }
  if (!/\{ *z *\}/.test(url) || !/\{ *x *\}/.test(url) || !/\{ *y *\}/.test(url)) {
    return { ok: false, error: 'placeholders' };
  }
  if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) return { ok: false, error: 'forbidden' };
  if (input?.confirmed !== true) return { ok: false, error: 'confirm' };
  const maxZoom = Math.round(Number(input?.maxZoom));
  return {
    ok: true,
    source: {
      name:
        String(input?.name || '')
          .trim()
          .slice(0, 40) || 'My tile server',
      url,
      attribution: String(input?.attribution || '')
        .trim()
        .slice(0, 200),
      maxZoom: Number.isFinite(maxZoom) ? Math.min(20, Math.max(1, maxZoom)) : 18,
      subdomains,
      confirmed: true,
    },
  };
}

export function readCustomTileSource() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_TILE_SOURCE_KEY) || 'null');
    const v = raw ? validateCustomTileSource(raw) : null;
    return v?.ok ? v.source : null;
  } catch {
    return null;
  }
}

export function writeCustomTileSource(source) {
  try {
    if (source) localStorage.setItem(CUSTOM_TILE_SOURCE_KEY, JSON.stringify(source));
    else localStorage.removeItem(CUSTOM_TILE_SOURCE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** MAP_STYLES entry for a validated source. */
export function customSourceToStyle(source) {
  if (!source) return null;
  return {
    name: source.name,
    url: source.url,
    subdomains: source.subdomains,
    attribution: escapeAttribution(source.attribution || source.name),
    offlinePack: true,
    offlineMaxZoom: source.maxZoom,
    maxNativeZoom: source.maxZoom,
    userSupplied: true,
    regional: true,
  };
}

/** Escape a plain-text attribution for Leaflet's HTML attribution control. */
export function escapeAttribution(text) {
  return String(text || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
