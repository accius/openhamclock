/**
 * useBalloons — amateur HAB / pico-balloon telemetry from the server's
 * SondeHub proxy (GET /api/balloons, cached 2 min server-side).
 *
 * Shared by the Balloons panel and the map layer: a module-level store
 * fetches once per interval no matter how many subscribers mount, so a
 * panel plus a layer plus the text view cost one request.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

const POLL_MS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;

const store = {
  balloons: [],
  fetchedAt: null,
  error: null,
  loading: false,
  stale: false,
  listeners: new Set(),
  timer: null,
  subscribers: 0,
};

function notify() {
  for (const fn of store.listeners) {
    try {
      fn();
    } catch {}
  }
}

async function refresh() {
  if (store.loading) return;
  store.loading = true;
  notify();
  try {
    const res = await apiFetch('/api/balloons', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
    const body = await res.json();
    store.balloons = Array.isArray(body?.balloons) ? body.balloons : [];
    store.fetchedAt = body?.fetchedAt || new Date().toISOString();
    store.stale = !!body?.stale;
    store.error = null;
  } catch (err) {
    store.error = err?.message || 'fetch failed';
  } finally {
    store.loading = false;
    notify();
  }
}

function subscribe(fn) {
  store.listeners.add(fn);
  store.subscribers += 1;
  if (store.subscribers === 1) {
    refresh();
    store.timer = setInterval(refresh, POLL_MS);
  } else if (store.fetchedAt == null && !store.loading) {
    refresh();
  }
  return () => {
    store.listeners.delete(fn);
    store.subscribers -= 1;
    if (store.subscribers <= 0) {
      store.subscribers = 0;
      if (store.timer) clearInterval(store.timer);
      store.timer = null;
    }
  };
}

export function useBalloons({ enabled = true } = {}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return subscribe(() => tick((n) => n + 1));
  }, [enabled]);
  return {
    balloons: store.balloons,
    fetchedAt: store.fetchedAt,
    error: store.error,
    loading: store.loading && store.fetchedAt == null,
    stale: store.stale,
    refresh,
  };
}

export default useBalloons;
