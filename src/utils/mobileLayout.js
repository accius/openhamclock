/**
 * mobileLayout — pure helpers for the Mobile layout (phone or tablet as the
 * primary display in a go-box or in the field).
 *
 * Everything here is side-effect free and takes its inputs explicitly so it
 * can be unit-tested without a DOM: which panel cards to offer in which
 * order, remembering the last card, deciding when to suggest the layout on a
 * first visit, and turning a scroll position into an active card index.
 */

export const MOBILE_LAYOUT_ID = 'mobile';

/** localStorage keys */
export const MOBILE_CARD_KEY = 'openhamclock_mobileCard';
export const MOBILE_SUGGEST_KEY = 'openhamclock_mobileLayoutSuggested';
export const MOBILE_CARD_PREFS_KEY = 'openhamclock_mobileCardPrefs';
/** Written by App.jsx whenever the layout changes: the layout before this one. */
export const PREVIOUS_LAYOUT_KEY = 'openhamclock_previousLayout';

/** Viewports no wider than this are "phone-sized" for the auto-suggest. */
export const PHONE_MAX_WIDTH = 600;

/**
 * The full card catalogue, in display order. `panelKey` is the key under
 * config.panels that hides the card when `visible === false` (cards without
 * one are always offered). `when` names a context flag that must be truthy
 * for the card to appear at all. `ownHeader` marks panels that already draw
 * their own titled header, so the card adds no second title above it.
 */
export const MOBILE_CARD_DEFS = [
  // Opt-in (card picker): NWS alerts, shelters and the net roster near DE
  { id: 'emcomm', icon: '🚨', optIn: true },
  { id: 'dx-cluster', icon: '📻', panelKey: 'dxCluster', ownHeader: true },
  { id: 'activations', icon: '▲', panelKey: 'pota', ownHeader: true },
  { id: 'propagation', icon: '📡', panelKey: 'propagation', ownHeader: true },
  { id: 'solar', icon: '☀️', panelKey: 'solar', ownHeader: true },
  { id: 'satellites', icon: '🛰️', panelKey: 'satellites' },
  { id: 'logbook', icon: '📓', panelKey: 'logbook', ownHeader: true },
  { id: 'weather', icon: '🌦️', panelKey: 'weather' },
  { id: 'psk', icon: '📶', panelKey: 'pskReporter', ownHeader: true },
  { id: 'aprs', icon: '📍', panelKey: 'aprs', when: 'showAPRS', ownHeader: true },
];

/**
 * Which cards to show, in order, for the current context.
 *
 * @param {object} opts
 * @param {object} [opts.panels]   config.panels — `{ key: { visible } }`
 * @param {boolean} [opts.showAPRS] the APRS map layer is on (APRS card)
 * @param {object} [opts.prefs]    card-picker choices — `{ enabled: { id: bool } }`
 * @returns {{ id: string, icon: string, ownHeader: boolean }[]}
 */
export function buildMobileCards({ panels = {}, showAPRS = false, prefs = null } = {}) {
  const flags = { showAPRS: !!showAPRS };
  const enabled = prefs?.enabled || {};
  return MOBILE_CARD_DEFS.filter((def) => {
    if (def.when && !flags[def.when]) return false;
    if (def.panelKey && panels?.[def.panelKey]?.visible === false) return false;
    // Opt-in cards need a yes; everything else shows unless switched off
    if (def.optIn ? enabled[def.id] !== true : enabled[def.id] === false) return false;
    return true;
  }).map(({ id, icon, ownHeader }) => ({ id, icon, ownHeader: !!ownHeader }));
}

/** Is card `id` switched on in the picker (opt-in cards default off, others on)? */
export function isCardEnabled(prefs, id) {
  const def = MOBILE_CARD_DEFS.find((d) => d.id === id);
  const v = prefs?.enabled?.[id];
  return def?.optIn ? v === true : v !== false;
}

/**
 * Card-picker choices. Nothing saved yet → defaults: every regular card on,
 * the EmComm card on only when the operator arrived from the EmComm layout.
 */
export function readCardPrefs(storage, previousLayout = null) {
  try {
    const raw = storage?.getItem?.(MOBILE_CARD_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && p.enabled && typeof p.enabled === 'object')
        return { enabled: { ...p.enabled } };
    }
  } catch {
    /* fall through to defaults */
  }
  return { enabled: { emcomm: previousLayout === 'emcomm' }, isDefault: true };
}

export function writeCardPrefs(storage, prefs) {
  try {
    storage?.setItem?.(MOBILE_CARD_PREFS_KEY, JSON.stringify({ enabled: prefs?.enabled || {} }));
  } catch {
    /* ignore */
  }
}

/**
 * Toggle one card. Refuses to switch off the last remaining card so the
 * strip can never end up empty. Returns the new prefs object.
 */
export function toggleCardPref(prefs, id, ctx = {}) {
  const next = { enabled: { ...(prefs?.enabled || {}) } };
  next.enabled[id] = !isCardEnabled(prefs, id);
  if (buildMobileCards({ ...ctx, prefs: next }).length === 0) return { enabled: { ...(prefs?.enabled || {}) } };
  return next;
}

const SEVERITY_ORDER = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };

/**
 * Shape EmComm data for the compact summary card: alerts by severity,
 * the nearest shelters (with distance in km when DE is known) and the
 * net roster, newest check-in first. Pure — no fetching.
 */
export function summarizeEmcomm({ alerts = [], shelters = [], roster = [], de = null, maxShelters = 5 } = {}) {
  const sortedAlerts = [...(alerts || [])].sort(
    (a, b) => (SEVERITY_ORDER[a?.severity] ?? 4) - (SEVERITY_ORDER[b?.severity] ?? 4),
  );
  const haveDe = de && de.lat != null && de.lon != null;
  const toRad = (d) => (d * Math.PI) / 180;
  const km = (lat, lon) => {
    const dLat = toRad(lat - de.lat);
    const dLon = toRad(lon - de.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(de.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const withDist = (shelters || []).map((s) => ({
    ...s,
    distanceKm: haveDe && s?.lat != null && s?.lon != null ? km(s.lat, s.lon) : null,
  }));
  withDist.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  const sortedRoster = [...(roster || [])].sort((a, b) => (a?.age ?? Infinity) - (b?.age ?? Infinity));
  return {
    alerts: sortedAlerts,
    worstSeverity: sortedAlerts[0]?.severity || null,
    shelters: withDist.slice(0, maxShelters),
    shelterCount: withDist.length,
    openShelters: withDist.filter((s) => String(s?.status || '').toUpperCase() === 'OPEN').length,
    roster: sortedRoster,
    activeOps: sortedRoster.filter((op) => !op?.stale).length,
  };
}

/**
 * Index of the remembered card inside `cards`, or 0 when nothing (valid) is
 * remembered. Tolerates a missing/broken storage object.
 */
export function readLastCardIndex(storage, cards) {
  let id = null;
  try {
    id = storage?.getItem?.(MOBILE_CARD_KEY) ?? null;
  } catch {
    id = null;
  }
  if (!id || !Array.isArray(cards)) return 0;
  const idx = cards.findIndex((c) => c.id === id);
  return idx >= 0 ? idx : 0;
}

/** Remember `cardId` as the last card. Silently ignores storage failures. */
export function writeLastCard(storage, cardId) {
  try {
    if (cardId) storage?.setItem?.(MOBILE_CARD_KEY, String(cardId));
    else storage?.removeItem?.(MOBILE_CARD_KEY);
  } catch {
    /* private mode / quota — the choice just isn't remembered */
  }
}

/**
 * Which card is centred for a given horizontal scroll offset. Each card is
 * `cardWidth` wide with `gap` between cards; the result is clamped to the
 * card count so an over-scroll bounce never produces an invalid index.
 */
export function cardIndexFromScroll(scrollLeft, cardWidth, gap = 0, count = 1) {
  if (!(count > 0)) return 0;
  const stride = cardWidth + gap;
  if (!(stride > 0)) return 0;
  const idx = Math.round(scrollLeft / stride);
  return Math.min(Math.max(idx, 0), count - 1);
}

/** Scroll offset that centres card `index` (inverse of cardIndexFromScroll). */
export function scrollLeftForCard(index, cardWidth, gap = 0) {
  return Math.max(0, index) * (cardWidth + gap);
}

/** Phone-sized viewport: narrow in its current orientation, or a phone held sideways. */
export function isPhoneViewport(width, height) {
  if (!(width > 0)) return false;
  if (width <= PHONE_MAX_WIDTH) return true;
  // Landscape phone: short side is phone-sized and it is clearly wider than tall
  return height > 0 && height <= 480 && width <= 1000;
}

/**
 * Should we offer the Mobile layout right now?
 *
 * Only on a first visit (no saved config yet), on a phone-sized viewport,
 * when the user has not already picked the Mobile layout, and never twice:
 * once shown — accepted or dismissed — the offer is remembered.
 */
export function shouldSuggestMobileLayout({
  width,
  height,
  layout,
  firstVisit = false,
  alreadySuggested = false,
} = {}) {
  if (!firstVisit || alreadySuggested) return false;
  if (layout === MOBILE_LAYOUT_ID) return false;
  return isPhoneViewport(width, height);
}

/**
 * Has a layout ever been saved? `raw` is the stored openhamclock_config
 * string. A missing key is not enough to detect a first visit: the theme
 * module stores `{ theme, customTheme }` under the same key on first load,
 * so the test is whether a `layout` was ever written.
 */
export function hasSavedLayout(raw) {
  if (!raw) return false;
  try {
    const cfg = JSON.parse(raw);
    return !!(cfg && typeof cfg === 'object' && typeof cfg.layout === 'string' && cfg.layout);
  } catch {
    return false;
  }
}

/** Has the offer already been made on this device? */
export function readSuggestionDone(storage) {
  try {
    return storage?.getItem?.(MOBILE_SUGGEST_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the offer was made (accepted or dismissed). */
export function markSuggestionDone(storage) {
  try {
    storage?.setItem?.(MOBILE_SUGGEST_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** True inside an installed PWA (standalone / fullscreen display mode). */
export function isStandaloneDisplay(win) {
  if (!win) return false;
  try {
    if (win.navigator?.standalone === true) return true; // iOS Safari
    const mm = win.matchMedia;
    if (typeof mm !== 'function') return false;
    return !!(
      mm.call(win, '(display-mode: standalone)')?.matches || mm.call(win, '(display-mode: fullscreen)')?.matches
    );
  } catch {
    return false;
  }
}

/** Landscape when the viewport is wider than it is tall (and not a tiny square). */
export function isLandscape(width, height) {
  return width > 0 && height > 0 && width > height;
}

/**
 * Map height for the portrait arrangement: a usable slice of the viewport
 * that still leaves the card row readable. Clamped between 200 and 420 px.
 */
export function portraitMapHeight(viewportHeight) {
  if (!(viewportHeight > 0)) return 260;
  return Math.round(Math.min(420, Math.max(200, viewportHeight * 0.4)));
}
