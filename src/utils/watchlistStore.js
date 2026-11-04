/**
 * watchlistStore — persistence for the three HamClock-style watch lists
 * (DX cluster spots, activation spots, logbook rows). One localStorage key,
 * synced to the server like the other openhamclock_* settings, with a tiny
 * subscribe() so every panel and the Settings dialog see one source of truth.
 *
 * On first load the legacy DX-filter watchlist (array of call prefixes +
 * "show only watchlist" flag) is migrated into the DX list as prefix specs
 * and removed from the filter blob, so nothing applies twice.
 */
import { migrateLegacyWatchlist, WATCHLIST_MODES, WATCHLIST_MAX_LENGTH } from './watchlistSpec.js';

export const WATCHLIST_STORAGE_KEY = 'openhamclock_watchlists';
export const WATCHLIST_EVENT = 'openhamclock-watchlists-change';
export const WATCHLIST_KEYS = ['dx', 'activations', 'logbook'];

const EMPTY_LIST = { mode: 'off', text: '' };

const normalizeList = (list) => ({
  mode: WATCHLIST_MODES.includes(list?.mode) ? list.mode : 'off',
  text: String(list?.text || '').slice(0, WATCHLIST_MAX_LENGTH),
});

const normalizeAll = (raw) => {
  const out = {};
  for (const key of WATCHLIST_KEYS) out[key] = normalizeList(raw?.[key]);
  return out;
};

const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const migrateLegacy = () => {
  const raw = safeGet('openhamclock_dxFilters');
  if (!raw) return null;
  let filters;
  try {
    filters = JSON.parse(raw);
  } catch {
    return null;
  }
  const migrated = migrateLegacyWatchlist(filters);
  if (filters && typeof filters === 'object' && ('watchlist' in filters || 'watchlistOnly' in filters)) {
    const { watchlist: _w, watchlistOnly: _o, ...rest } = filters;
    safeSet('openhamclock_dxFilters', JSON.stringify(rest));
  }
  return migrated;
};

const load = () => {
  const raw = safeGet(WATCHLIST_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = normalizeAll(JSON.parse(raw));
      // A stale legacy list left behind by an older build still migrates once.
      const legacy = migrateLegacy();
      if (legacy && parsed.dx.mode === 'off' && !parsed.dx.text) {
        parsed.dx = legacy;
        safeSet(WATCHLIST_STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    } catch {}
  }
  const fresh = normalizeAll({});
  const legacy = migrateLegacy();
  if (legacy) {
    fresh.dx = legacy;
    safeSet(WATCHLIST_STORAGE_KEY, JSON.stringify(fresh));
  }
  return fresh;
};

let state = load();
const subscribers = new Set();

const notify = () => {
  subscribers.forEach((cb) => {
    try {
      cb(state);
    } catch {}
  });
};

/** All three lists: { dx, activations, logbook } each { mode, text }. */
export const getWatchlists = () => state;

/** One list by key ('dx' | 'activations' | 'logbook'). */
export const getWatchlist = (key) => state[key] || EMPTY_LIST;

/** Replace one list and persist. */
export const setWatchlist = (key, list) => {
  if (!WATCHLIST_KEYS.includes(key)) return;
  state = { ...state, [key]: normalizeList(list) };
  safeSet(WATCHLIST_STORAGE_KEY, JSON.stringify(state));
  try {
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT, { detail: state }));
  } catch {}
  notify();
};

/** Subscribe to changes; returns an unsubscribe function. */
export const subscribeWatchlists = (cb) => {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
};

// Another tab (or the server settings sync) rewrote the key — reload.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== WATCHLIST_STORAGE_KEY) return;
    state = load();
    notify();
  });
}

export default { getWatchlists, getWatchlist, setWatchlist, subscribeWatchlists, WATCHLIST_KEYS };
