/**
 * useNetLoggerNets — live nets from NetLogger via the server proxy.
 *
 *   GET /api/netlogger/nets       every 60 s while enabled (server caches 60 s)
 *   GET /api/netlogger/checkins   on demand per expanded net (cached per net)
 *
 * Returns the net list plus a loadCheckins(net) helper that resolves to the
 * check-in list and caches it for 60 s in the hook.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';

const POLL_MS = 60_000;
const CHECKIN_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 12_000;

export function useNetLoggerNets({ enabled = true } = {}) {
  const [nets, setNets] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const checkinCache = useRef(new Map()); // key → { data, ts }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      setLoading((l) => l || fetchedAt == null);
      try {
        const res = await apiFetch('/api/netlogger/nets', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const body = res?.ok ? await res.json() : null;
        if (cancelled) return;
        if (body && Array.isArray(body.nets)) {
          setNets(body.nets);
          setFetchedAt(body.fetchedAt || new Date().toISOString());
          setError(null);
        } else {
          setError('NetLogger unavailable');
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'NetLogger unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const loadCheckins = useCallback(async (net, { force = false } = {}) => {
    if (!net?.server || !net?.name) return null;
    const key = `${net.server}|${net.name}`;
    const cached = checkinCache.current.get(key);
    if (!force && cached && Date.now() - cached.ts < CHECKIN_TTL_MS) return cached.data;
    const url = `/api/netlogger/checkins?server=${encodeURIComponent(net.server)}&net=${encodeURIComponent(net.name)}`;
    const res = await apiFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
    const data = await res.json();
    checkinCache.current.set(key, { data, ts: Date.now() });
    if (checkinCache.current.size > 40) {
      const oldest = [...checkinCache.current.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) checkinCache.current.delete(oldest[0]);
    }
    return data;
  }, []);

  return { nets, fetchedAt, loading, error, loadCheckins };
}

export default useNetLoggerNets;
