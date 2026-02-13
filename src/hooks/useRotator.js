import { useEffect, useMemo, useRef, useState } from "react";

/**
 * useRotator (V1)
 * - mock mode: smooth rotating azimuth for UI dev
 * - later: poll endpointUrl for real azimuth
 *
 * Return:
 *  azimuth: number | null
 *  source: string
 *  isStale: boolean
 *  ageMs: number
 */
export default function useRotator({
  endpointUrl,
  pollMs = 500,
  staleMs = 3000,
  mock = true,
} = {}) {
  const [azimuth, setAzimuth] = useState(null);
  const [lastGoodAzimuth, setLastGoodAzimuth] = useState(null);
  const [source, setSource] = useState(mock ? "mock" : "rotator");
  const [lastUpdate, setLastUpdate] = useState(0);

  const timerRef = useRef(null);

  // Derived: stale + age
  const ageMs = useMemo(() => {
    if (!lastUpdate) return Number.POSITIVE_INFINITY;
    return Date.now() - lastUpdate;
  }, [lastUpdate]);

  const isStale = useMemo(() => {
    if (!lastUpdate) return true;
    return Date.now() - lastUpdate > staleMs;
  }, [lastUpdate, staleMs]);

  useEffect(() => {
    // cleanup any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mock) {
      setSource("mock");
      // Start at a pleasant number if empty
      setAzimuth((prev) => (prev == null ? 22 : prev));
      setLastGoodAzimuth((prev) => (prev == null ? 22 : prev));
      setLastUpdate(Date.now());

      timerRef.current = setInterval(() => {
        setAzimuth((prev) => {
          const p = prev == null ? 0 : prev;
          // gentle motion + wrap
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

    // Real mode placeholder: polling pattern
    setSource("pstrotator");

    async function poll() {
      if (!endpointUrl) return;

      try {
        const res = await fetch(endpointUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        // Backend returns:
        // { source, live, azimuth, lastSeen, staleMs, error }
        const {
          source: src,
          azimuth,
          lastSeen,
          staleMs: serverStaleMs,
          error,
        } = data || {};

        const a = Number(azimuth);
        if (!Number.isFinite(a)) throw new Error("Invalid azimuth");

        setAzimuth(a);
        setLastGoodAzimuth(a);

        // Use server timestamp if provided (preferred), otherwise fallback
        const ts = Number(lastSeen);
        setLastUpdate(Number.isFinite(ts) && ts > 0 ? ts : Date.now());

        // Prefer server-provided source if present
        if (src) setSource(String(src));
        else setSource("pstrotator_udp");

        // (Optional) If you want: you can log/track live/error later.
        // For now, staleness is derived from lastUpdate + staleMs in this hook.
      } catch {
        // Keep last value; staleness will indicate trouble
      }
    }

    // initial + interval
    poll();
    timerRef.current = setInterval(poll, Math.max(200, pollMs));

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [endpointUrl, pollMs, staleMs, mock]);

  return { azimuth, lastGoodAzimuth, source, isStale, ageMs };
}
