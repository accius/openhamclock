/**
 * Shared poller — one fetch loop per URL no matter how many subscribers.
 *
 * A panel and its matching map layer often want the same server endpoint
 * (tropical storms, fire-weather alerts, buoys). Instead of each hook
 * running its own interval, they subscribe here: the first subscriber starts
 * polling, later ones get the cached value immediately, and the loop stops
 * when the last one unsubscribes. Visibility changes trigger a refresh when
 * the data is older than half the interval.
 */
import { apiFetch } from './apiFetch';

const stores = new Map();

function getStore(url, intervalMs) {
  let s = stores.get(url);
  if (!s) {
    s = {
      url,
      intervalMs,
      data: null,
      error: null,
      fetchedAt: 0,
      subscribers: new Set(),
      timer: null,
      inFlight: null,
      fetchImpl: apiFetch,
    };
    stores.set(url, s);
  }
  if (intervalMs < s.intervalMs) s.intervalMs = intervalMs;
  return s;
}

function notify(s) {
  for (const fn of s.subscribers) {
    try {
      fn({ data: s.data, error: s.error, fetchedAt: s.fetchedAt });
    } catch (err) {
      console.error('[sharedFetcher] subscriber error:', err);
    }
  }
}

async function refresh(s) {
  if (s.inFlight) return s.inFlight;
  const fetchImpl = s.fetchImpl;
  s.inFlight = (async () => {
    try {
      const res = await fetchImpl(s.url);
      if (!res) return; // apiFetch backoff — keep what we have
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      s.data = await res.json();
      s.error = null;
      s.fetchedAt = Date.now();
    } catch (err) {
      s.error = err.message || String(err);
    } finally {
      s.inFlight = null;
      notify(s);
    }
  })();
  return s.inFlight;
}

function schedule(s) {
  clearInterval(s.timer);
  s.timer = setInterval(() => refresh(s), s.intervalMs);
}

/**
 * Subscribe to `url`; `onChange({ data, error, fetchedAt })` fires on every
 * refresh (and once immediately if data is already cached). Returns an
 * unsubscribe function.
 */
export function subscribe(url, intervalMs, onChange, { fetchImpl } = {}) {
  const s = getStore(url, intervalMs);
  if (fetchImpl) s.fetchImpl = fetchImpl;
  s.subscribers.add(onChange);
  if (s.data || s.error) onChange({ data: s.data, error: s.error, fetchedAt: s.fetchedAt });
  if (s.subscribers.size === 1) {
    schedule(s);
    refresh(s);
  } else if (Date.now() - s.fetchedAt > s.intervalMs) {
    refresh(s);
  }
  return () => {
    s.subscribers.delete(onChange);
    if (s.subscribers.size === 0) {
      clearInterval(s.timer);
      s.timer = null;
    }
  };
}

/** Force a refresh of `url` if it is stale by more than `minAgeMs`. */
export function refreshIfStale(url, minAgeMs = 0) {
  const s = stores.get(url);
  if (!s || !s.subscribers.size) return;
  if (Date.now() - s.fetchedAt >= minAgeMs) refresh(s);
}

export function peek(url) {
  const s = stores.get(url);
  return s ? { data: s.data, error: s.error, fetchedAt: s.fetchedAt } : null;
}

/** Test helper: drop every store. */
export function _resetSharedFetcher() {
  for (const s of stores.values()) clearInterval(s.timer);
  stores.clear();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const s of stores.values()) {
      if (s.subscribers.size && Date.now() - s.fetchedAt > s.intervalMs / 2) refresh(s);
    }
  });
}
