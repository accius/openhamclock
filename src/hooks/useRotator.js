import { useEffect, useMemo, useRef, useState } from "react";

/**
 * useRotator (V2)
 * - Polls endpointUrl for rotator status
 * - Auto-disables polling if server reports source === 'none'
 * - mock mode: smooth rotating azimuth for UI dev
 *
 * Return:
 *  azimuth: number | null
 *  lastGoodAzimuth: number | null
 *  source: string
 *  isStale: boolean
 *  ageMs: number
 *  available: boolean  — whether a rotator is configured server-side
 */
export default function useRotator({
  endpointUrl,
  pollMs = 2000,
  staleMs = 5000,
  mock = false,
} = {}) {
  const [azimuth, setAzimuth] = useState(null);
  const [lastGoodAzimuth, setLastGoodAzimuth] = useState(null);
  const [source, setSource] = useState(mock ? "mock" : "unknown");
  const [lastUpdate, setLastUpdate] = useState(0);
  const [available, setAvailable] = useState(false);

  const timerRef = useRef(null);
  const disabledRef = useRef(false); // sticky: once server says 'none', stop forever

  const ageMs = useMemo(() => {
    if (!lastUpdate) return Number.POSITIVE_INFINITY;
    return Date.now() - lastUpdate;
  }, [lastUpdate]);

  const isStale = useMemo(() => {
    if (!lastUpdate) return true;
    return Date.now() - lastUpdate > staleMs;
  }, [lastUpdate, staleMs]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mock) {
      setSource("mock");
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
      // Once server told us 'none', stop polling entirely
      if (disabledRef.current) return;

      try {
        const res = await fetch(endpointUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        // If server says rotator provider is 'none', stop all future polling
        if (data?.source === 'none') {
          disabledRef.current = true;
          setSource('none');
          setAvailable(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return;
        }

        setAvailable(true);

        const a = Number(data?.azimuth);
        if (Number.isFinite(a)) {
          setAzimuth(a);
          setLastGoodAzimuth(a);
        }

        const ts = Number(data?.lastSeen);
        setLastUpdate(Number.isFinite(ts) && ts > 0 ? ts : Date.now());

        if (data?.source) setSource(String(data.source));
      } catch {
        // Keep last value; staleness will indicate trouble
      }
    }

    // Initial poll
    poll();
    // Poll at a reasonable interval (default 2s, minimum 1s)
    timerRef.current = setInterval(poll, Math.max(1000, pollMs));

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [endpointUrl, pollMs, staleMs, mock]);

  return { azimuth, lastGoodAzimuth, source, isStale, ageMs, available };
}
