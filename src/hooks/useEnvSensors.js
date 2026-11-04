/**
 * useEnvSensors — live readings + 24 h history from the Rig Bridge
 * `env-sensors` plugin (BME280/BMP280 over I2C, HTTP JSON sensors).
 *
 * Live:    SSE `env` events → { t, sources: [{ id, name, type, temperature,
 *          humidity, pressure, dewPoint, t, error }] }
 * History: GET <rig-bridge>/api/env/history on mount and every 5 min, then
 *          extended in place from the live samples (one point per minute).
 *
 * Must be used inside RigProvider (needs the bridge URL).
 */
import { useEffect, useRef, useState } from 'react';
import { useRig } from '../contexts/RigContext.jsx';
import { useBridgeEvent } from './useBridgeEvent.js';

const HISTORY_REFRESH_MS = 5 * 60 * 1000;
const HISTORY_MAX = 24 * 60;
export const ENV_STALE_MS = 2 * 60 * 1000;

export function useEnvSensors() {
  const { rigUrl, enabled, isCloudRelay } = useRig();
  const { data, at, stale } = useBridgeEvent('env', { staleMs: ENV_STALE_MS });
  const [history, setHistory] = useState({}); // id → { name, type, samples: [{t,temp,hum,pres}] }
  const [historyError, setHistoryError] = useState(null);
  const lastLiveTRef = useRef(0);

  // History fetch (direct bridge only — the cloud relay doesn't proxy this)
  useEffect(() => {
    if (!enabled || isCloudRelay || !rigUrl) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${rigUrl}/api/env/history`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const next = {};
        for (const [id, src] of Object.entries(json.sources || {})) {
          next[id] = { name: src.name, type: src.type, samples: (src.samples || []).slice(-HISTORY_MAX) };
        }
        setHistory(next);
        setHistoryError(null);
      } catch (e) {
        if (!cancelled) setHistoryError(e?.message || 'history unavailable');
      }
    };
    load();
    const id = setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [rigUrl, enabled, isCloudRelay]);

  // Extend history from live samples
  useEffect(() => {
    if (!data || !Array.isArray(data.sources) || !data.t || data.t === lastLiveTRef.current) return;
    lastLiveTRef.current = data.t;
    setHistory((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of data.sources) {
        if (!s || s.error) continue;
        const cur = next[s.id] || { name: s.name, type: s.type, samples: [] };
        const samples = cur.samples;
        const last = samples[samples.length - 1];
        const sample = { t: data.t, temp: s.temperature, hum: s.humidity, pres: s.pressure };
        const sameMinute = last && Math.floor(last.t / 60000) === Math.floor(data.t / 60000);
        const merged = sameMinute ? [...samples.slice(0, -1), sample] : [...samples, sample].slice(-HISTORY_MAX);
        next[s.id] = { ...cur, name: s.name, type: s.type, samples: merged };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [data]);

  return {
    sources: data && Array.isArray(data.sources) ? data.sources : [],
    at,
    stale,
    history,
    historyError,
    available: !!data,
  };
}

export default useEnvSensors;
