/**
 * useBenchmark — GET /api/benchmark for this station (callsign + DE
 * location + radius). Polls every 5 min; the server caches per callsign for
 * 10 min, so this is cheap even with many tabs.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { useVisibilityRefresh } from './useVisibilityRefresh';

const POLL_MS = 5 * 60 * 1000;

export const useBenchmark = ({ callsign, lat, lon, radiusKm = 300 } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  const call = (callsign || '').toUpperCase();
  const ready = call && call !== 'N0CALL' && Number.isFinite(lat) && Number.isFinite(lon);

  useEffect(() => {
    if (!ready) {
      setLoading(false);
      setData(null);
      return undefined;
    }
    let alive = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          callsign: call,
          lat: String(lat),
          lon: String(lon),
          radius: String(radiusKm),
        });
        const res = await apiFetch(`/api/benchmark?${params}`, { cache: 'no-store' });
        if (!alive) return;
        if (res?.ok) {
          setData(await res.json());
          setError(null);
        } else if (res) {
          setError(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (alive) setError(err?.message || 'failed');
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    run();
    fetchRef.current = run;
    const t = setInterval(run, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, call, lat, lon, radiusKm]);

  useVisibilityRefresh(() => fetchRef.current?.(), POLL_MS);

  return { data, loading, error, ready };
};

export default useBenchmark;
