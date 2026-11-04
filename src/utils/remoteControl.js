/**
 * Remote-control helpers (pure) — the browser half of /api/control.
 *
 * Each display has a stable `controlId` (localStorage) that names its SSE
 * channel; the phone remote and `curl` address it with `?target=<id>`.
 * Next to it lives a `controlSecret` — the pairing key: the display
 * registers it with the server (which keeps only a hash) and anyone who
 * presents it may command this one display, even on a server whose global
 * API_WRITE_KEY they do not have. The QR code / phone URL carries it.
 * buildStateReport() packs what the remote needs to render its buttons
 * (tracked satellites, map layers, current layout…) and
 * stateFingerprint() lets the hook post only when something changed.
 */

export const CONTROL_ID_KEY = 'openhamclock_controlId';
export const CONTROL_SECRET_KEY = 'openhamclock_controlSecret';
export const REPORT_INTERVAL_MS = 30_000;
export const REPORT_DEBOUNCE_MS = 1_000;
export const CONTROL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Keep in sync with server/utils/controlAuth.js CONTROL_SECRET_RE.
export const CONTROL_SECRET_RE = /^[A-Za-z0-9_-]{24,128}$/;

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function randomString(alphabet, length) {
  let out = '';
  try {
    const arr = new Uint8Array(length);
    (globalThis.crypto || window.crypto).getRandomValues(arr);
    for (const b of arr) out += alphabet[b % alphabet.length];
  } catch {
    for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

const randomId = () => 'ohc-' + randomString(ID_ALPHABET, 12);
// 64-symbol alphabet × 32 chars = 192 bits.
const randomSecret = () => randomString(SECRET_ALPHABET, 32);

function readOrCreate(key, re, make) {
  let v = null;
  try {
    v = localStorage.getItem(key);
  } catch {
    /* private mode */
  }
  if (!v || !re.test(v)) {
    v = make();
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  }
  return v;
}

/** Stable per-browser display id; created on first use. */
export function getControlId() {
  return readOrCreate(CONTROL_ID_KEY, CONTROL_ID_RE, randomId);
}

/** This display's pairing secret; created on first use (never leaves the browser except to the server). */
export function getControlSecret() {
  return readOrCreate(CONTROL_SECRET_KEY, CONTROL_SECRET_RE, randomSecret);
}

/** Fired on window after rotateControlId() so the live hook re-subscribes under the new pair. */
export const CONTROL_ID_CHANGED_EVENT = 'ohc:control-id-changed';

/** Generate a fresh id AND secret (Settings → "New id") — old QR codes stop working. */
export function rotateControlId() {
  try {
    localStorage.removeItem(CONTROL_ID_KEY);
    localStorage.removeItem(CONTROL_SECRET_KEY);
  } catch {
    /* ignore */
  }
  getControlSecret();
  const id = getControlId();
  try {
    window.dispatchEvent(new CustomEvent(CONTROL_ID_CHANGED_EVENT, { detail: { controlId: id } }));
  } catch {
    /* no window (tests) */
  }
  return id;
}

/**
 * Remote control is on by default for local installs and off on the hosted
 * site; `config.remoteControl.enabled` (true/false) overrides, null = auto.
 */
export function isRemoteEnabled(config, isLocalInstall) {
  const v = config?.remoteControl?.enabled;
  if (v === true || v === false) return v;
  return !!isLocalInstall;
}

/** Phone-remote URL; `key` is normally this display's pairing secret (the page moves it out of the address bar). */
export function buildRemoteUrl(origin, controlId, key = '') {
  const base = String(origin || '').replace(/\/$/, '');
  let url = `${base}/remote?target=${encodeURIComponent(controlId)}`;
  if (key) url += `&key=${encodeURIComponent(key)}`;
  return url;
}

/** Query string the display appends to its own endpoints (stream / report / capture). */
export function displayQuery(controlId, secret) {
  let q = `target=${encodeURIComponent(controlId)}`;
  if (secret) q += `&secret=${encodeURIComponent(secret)}`;
  return q;
}

/** { projection, basemap } from the WorldMap's persisted settings. */
export function readMapSettings() {
  try {
    const raw = localStorage.getItem('openhamclock_mapSettings');
    const s = raw ? JSON.parse(raw) : {};
    const projection = s.isAzimuthal ? 'azimuthal' : s.mapProjection || 'mercator';
    return { projection, basemap: s.mapStyle || 'dark' };
  } catch {
    return { projection: 'mercator', basemap: 'dark' };
  }
}

/** Read the rig-bridge cloud relay session this browser is using, if any. */
export function readRigRelaySession() {
  try {
    return localStorage.getItem('ohc-relay-session') || null;
  } catch {
    return null;
  }
}

/** Panel ids currently docked in the active dockable layout model (flexlayout JSON). */
export function panelsFromLayoutJson(json) {
  const ids = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'tab' && typeof n.component === 'string' && !ids.includes(n.component)) ids.push(n.component);
    for (const child of n.children || []) walk(child);
  };
  walk(json?.layout);
  for (const b of json?.borders || []) walk(b);
  return ids;
}

/**
 * Pack the state the server/remote should know about.
 * All inputs optional; the result mirrors server/utils/controlCommands.js
 * sanitizeStateReport().
 */
export function buildStateReport({
  config = {},
  dxLocation = null,
  dxCallsign = null,
  layers = [],
  panels = [],
  satellites = [],
  mapSettings = null,
  flags = {},
  rigRelaySession = null,
} = {}) {
  const ms = mapSettings || { projection: null, basemap: null };
  return {
    callsign: config.callsign || null,
    de: {
      lat: config.location?.lat ?? null,
      lon: config.location?.lon ?? null,
      grid: config.locator || null,
    },
    dx: dxLocation ? { lat: dxLocation.lat ?? null, lon: dxLocation.lon ?? null, grid: null } : null,
    dxCallsign: dxCallsign || null,
    layout: config.layout || null,
    theme: config.theme || null,
    projection: ms.projection,
    basemap: ms.basemap,
    timeOffsetMs: Number.isFinite(flags.timeOffsetMs) ? flags.timeOffsetMs : 0,
    title: typeof config.callsignTitles === 'string' ? config.callsignTitles : null,
    kioskLocked: flags.kioskLocked === true,
    demoMode: flags.demoMode === true,
    rigRelaySession: rigRelaySession || null,
    version: config.version || null,
    panels: Array.isArray(panels) ? panels.slice(0, 60) : [],
    satellites: Array.isArray(satellites) ? satellites.slice(0, 60) : [],
    layers: Array.isArray(layers)
      ? layers.slice(0, 80).map((l) => ({ id: l.id, name: l.name || l.id, enabled: !!l.enabled }))
      : [],
  };
}

/** Cheap change detector — the fields a remote cares about, in a stable order. */
export function stateFingerprint(state) {
  if (!state) return '';
  return JSON.stringify([
    state.callsign,
    state.de,
    state.dx,
    state.dxCallsign,
    state.layout,
    state.theme,
    state.projection,
    state.basemap,
    state.timeOffsetMs,
    state.title,
    state.kioskLocked,
    state.demoMode,
    state.rigRelaySession,
    state.panels,
    state.satellites,
    (state.layers || []).map((l) => `${l.id}:${l.enabled ? 1 : 0}`),
  ]);
}

/**
 * Resolve the `/dx` command's target: explicit lat/lon win, otherwise look
 * the callsign up (lookup → {lat, lon} | null).
 */
export async function resolveDxTarget(params, lookup) {
  if (params.lat != null && params.lon != null) {
    return { lat: params.lat, lon: params.lon, callsign: params.call || null, grid: params.grid || null };
  }
  if (!params.call || typeof lookup !== 'function') return null;
  const r = await lookup(params.call);
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  return { lat: r.lat, lon: r.lon, callsign: params.call, grid: r.grid || null };
}
