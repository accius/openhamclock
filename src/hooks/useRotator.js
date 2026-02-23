import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useRotator (V2)
 * - Polls endpointUrl for rotator status
 * - If server reports source === 'none', pauses polling briefly (but does NOT disable forever)
 * - mock mode: smooth rotating azimuth for UI dev
 *
 * Return:
 *  azimuth: number | null
 *  lastGoodAzimuth: number | null
 *  source: string
 *  isStale: boolean
 *  ageMs: number
 *  available: boolean  — whether a rotator is configured server-side
 *  status: 'connected' | 'connecting' | 'disconnected'
 *  lastError: string | null
 *  reconnect: () => void  — clears any temporary disable and forces an immediate poll
 */
export default function useRotator({ endpointUrl, pollMs = 2000, staleMs = 5000, mock = false } = {}) {
  const [azimuth, setAzimuth] = useState(null);
  const [lastGoodAzimuth, setLastGoodAzimuth] = useState(null);
  const [source, setSource] = useState(mock ? 'mock' : 'unknown');
  const [lastUpdate, setLastUpdate] = useState(0);
  const [available, setAvailable] = useState(false);
  const [live, setLive] = useState(false);
  const [lastError, setLastError] = useState(null);

  const timerRef = useRef(null);
  const noneUntilRef = useRef(0); // when server says source==='none', pause polling until this time
  const pollRef = useRef(null);

  const ageMs = useMemo(() => {
    if (!lastUpdate) return Number.POSITIVE_INFINITY;
    return Date.now() - lastUpdate;
  }, [lastUpdate]);

  const isStale = useMemo(() => {
    if (!lastUpdate) return true;
    return Date.now() - lastUpdate > staleMs;
  }, [lastUpdate, staleMs]);

  const status = useMemo(() => {
    if (!endpointUrl && !mock) return 'disconnected';

    if (mock) return 'connected';

    // Explicit provider-down state
    if (live === false) return 'disconnected';

    // If we’ve never successfully connected yet
    if (!lastUpdate) return 'connecting';

    if (isStale) return 'disconnected';

    return 'connected';
  }, [endpointUrl, mock, live, lastUpdate, isStale]);

  const reconnect = useCallback(() => {
    noneUntilRef.current = 0;
    setLastError(null);
    pollRef.current?.();
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mock) {
      setSource('mock');
      setAvailable(true);
      setAzimuth((prev) => (prev == null ? 22 : prev));
      setLastGoodAzimuth((prev) => (prev == null ? 22 : prev));
      setLastUpdate(Date.now());

      timerRef.current = setInterval(() => {
        setAzimuth((prev) => {
          const p = prev == null ? 0 : prev;
          const next = (p + 3) % 360;
          setLastGoodAzimuth(next);
          return next;
        });
        setLastUpdate(Date.now());
      }, 350);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }

    // Real mode
    if (!endpointUrl) return;

    async function poll() {
      if (noneUntilRef.current && Date.now() < noneUntilRef.current) return;

      try {
        const res = await fetch(endpointUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (typeof data?.live === 'boolean') setLive(data.live);
        if (data?.source === 'none') {
          setSource('none');
          setAvailable(false);
          setLastError(null);

          setLastUpdate(0);
          setAzimuth(null);
          setLastGoodAzimuth(null);

          noneUntilRef.current = Date.now() + 30_000;
          return;
        }

        if (data?.live === false) {
          // Provider configured, but not currently connected/running
          setAvailable(true); // provider exists
          setSource(String(data?.source ?? 'unknown'));
          setLastError(data?.error ? String(data.error) : null);

          // Mark as disconnected immediately
          setLastUpdate(0);
          setAzimuth(null);
          setLastGoodAzimuth(null);

          // Retry soon (no need to wait 30s here)
          noneUntilRef.current = Date.now() + 2000;
          return;
        }

        setAvailable(true);

        const a = Number(data?.azimuth);
        if (Number.isFinite(a)) {
          setAzimuth(a);
          setLastGoodAzimuth(a);
        }

        const ts = Number(data?.lastSeen);
        if (Number.isFinite(ts) && ts > 0) {
          setLastUpdate(ts);
        }

        if (data?.source) setSource(String(data.source));

        setLastError(null);
      } catch {
        setLastError('Unable to reach rotator service');
      }
    }

    // Expose poll for reconnect()
    pollRef.current = poll;

    // Initial poll
    poll();

    // Poll at a reasonable interval (default 2s, minimum 1s)
    timerRef.current = setInterval(poll, Math.max(1000, pollMs));

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      pollRef.current = null;
    };
  }, [endpointUrl, pollMs, staleMs, mock]);

  return { azimuth, lastGoodAzimuth, source, isStale, ageMs, available, live, status, lastError, reconnect };
}
