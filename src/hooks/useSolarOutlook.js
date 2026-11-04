/**
 * useSolarOutlook — SWPC 27-day outlook (predicted SFI / Ap / max Kp per day)
 * from GET /api/swpc/outlook. One module-level fetch shared by every consumer
 * (Contests panel pills + Solar Outlook panel); refreshed every 6 h.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

const REFRESH_MS = 6 * 60 * 60 * 1000;

const store = {
  data: null,
  loading: true,
  error: null,
  fetchedAt: 0,
  inFlight: null,
  subscribers: new Set(),
  timer: null,
};

const notify = () => {
  const snap = { data: store.data, loading: store.loading, error: store.error };
  store.subscribers.forEach((cb) => cb(snap));
};

const refresh = async () => {
  if (store.inFlight) return store.inFlight;
  store.inFlight = (async () => {
    try {
      const res = await apiFetch('/api/swpc/outlook');
      if (res?.ok) {
        store.data = await res.json();
        store.error = null;
        store.fetchedAt = Date.now();
      } else if (res) {
        store.error = `HTTP ${res.status}`;
      }
    } catch (err) {
      store.error = err?.message || 'fetch failed';
    } finally {
      store.loading = false;
      store.inFlight = null;
      notify();
    }
  })();
  return store.inFlight;
};

const subscribe = (cb) => {
  store.subscribers.add(cb);
  if (!store.timer) {
    if (Date.now() - store.fetchedAt > REFRESH_MS) refresh();
    store.timer = setInterval(refresh, REFRESH_MS);
  }
  cb({ data: store.data, loading: store.loading, error: store.error });
  return () => {
    store.subscribers.delete(cb);
    if (store.subscribers.size === 0 && store.timer) {
      clearInterval(store.timer);
      store.timer = null;
    }
  };
};

export const useSolarOutlook = () => {
  const [snap, setSnap] = useState({ data: store.data, loading: store.loading, error: store.error });
  useEffect(() => subscribe(setSnap), []);
  return { ...snap, days: snap.data?.days || [], issued: snap.data?.issued || null, refresh };
};

export default useSolarOutlook;
