/**
 * Embed snippets for the solar badge. Field order matches
 * server/badge/solarBadge.js — unknown names are dropped, and an empty
 * selection falls back to the defaults.
 */

export const BADGE_ALT = 'OpenHamClock live solar conditions';
export const BADGE_SITE = 'https://openhamclock.com';

export const DEFAULT_BADGE_FIELDS = ['sfi', 'ssn', 'kp', 'a', 'xray', 'bands', 'updated', 'trend'];
const FIELD_IDS = [...DEFAULT_BADGE_FIELDS.slice(0, 4), 'k', ...DEFAULT_BADGE_FIELDS.slice(4)];

export function canonicalFields(raw, fallback = DEFAULT_BADGE_FIELDS) {
  const text = Array.isArray(raw) ? raw.join(',') : raw;
  if (text == null || !String(text).trim() || String(text).trim().toLowerCase() === 'all') return fallback.slice();
  const wanted = new Set();
  for (const part of String(text).split(',')) {
    const id = part.trim().toLowerCase();
    if (FIELD_IDS.includes(id)) wanted.add(id);
  }
  if (wanted.size === 0) return fallback.slice();
  return FIELD_IDS.filter((id) => wanted.has(id));
}

export function buildBadgeQuery({ kind, theme, fields, variant, sun, moon, wl, defaults }) {
  const defTheme = defaults?.default || 'dark';
  const defVariant = defaults?.defaultVariant || 'full';
  const defFields = defaults?.defaultFields || DEFAULT_BADGE_FIELDS;
  const defWl = defaults?.defaultWavelength || '0193';
  const params = new URLSearchParams();
  if (theme && theme !== defTheme) params.set('theme', theme);
  if (variant && variant !== defVariant) params.set('variant', variant);
  if ((kind === 'sun' || sun) && wl && wl !== defWl) params.set('wl', wl);
  if (!kind || kind === 'conditions') {
    const chosen = canonicalFields(Array.isArray(fields) ? fields.join(',') : fields, defFields);
    if (chosen.join(',') !== defFields.join(',')) params.set('fields', chosen.join(','));
    if (sun === 'left' || sun === 'right') params.set('sun', sun);
    if (moon === 'left' || moon === 'right') params.set('moon', moon);
  }
  return params.toString();
}

export function badgePath(kind) {
  if (kind === 'sun') return '/api/badge/sun.png';
  if (kind === 'moon') return '/api/badge/moon.png';
  return '/api/badge/solar.png';
}

export function badgeImageUrl(origin, query, kind) {
  const base = `${String(origin || BADGE_SITE).replace(/\/$/, '')}${badgePath(kind)}`;
  return query ? `${base}?${query}` : base;
}

/** Public embed host. Local and LAN previews still copy the hosted URL. */
export function snippetOrigin(hostname, pageOrigin) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  if (local || host === 'www.openhamclock.com' || host === 'openhamclock.app' || host === 'www.openhamclock.app') {
    return BADGE_SITE;
  }
  if (host === 'openhamclock.com') return BADGE_SITE;
  return pageOrigin || BADGE_SITE;
}

export function badgeAlt(kind) {
  if (kind === 'sun') return 'OpenHamClock live sun';
  if (kind === 'moon') return 'OpenHamClock live moon';
  return BADGE_ALT;
}

export function badgeSnippets(imageUrl, kind) {
  const alt = badgeAlt(kind);
  const src = imageUrl.replace(/&/g, '&amp;');
  return {
    qrz: `<a href="${BADGE_SITE}"><img src="${src}" alt="${alt}"></a>`,
    html: `<img src="${src}" alt="${alt}">`,
    markdown: `[![${alt}](${imageUrl})](${BADGE_SITE})`,
    bbcode: `[url=${BADGE_SITE}][img]${imageUrl}[/img][/url]`,
  };
}
