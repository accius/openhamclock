/**
 * usePropagation Hook
 * Fetches propagation predictions between DE and DX locations
 * Supports mode and power parameters for VOACAP-style calculations
 *
 * B5b progressive-enhancement flow (2026-04-24):
 *   1. Fetch /api/propagation — server orchestrates proppy REST → heuristic.
 *      Renders immediately so first paint is always fast.
 *   2. After REST returns, kick off the browser-side WASM engine with the
 *      SSN from the REST response. On success, swap the data in; on failure
 *      or abort, keep the REST payload. `data.engine` tells the UI which
 *      path is currently rendered: 'rest' | 'heuristic' | 'wasm'.
 */
import { useState, useEffect } from 'react';
import { runBrowserEngine } from '../services/p533/engineBrowser.js';

export const usePropagation = (deLocation, dxLocation, propagationConfig = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const mode = propagationConfig.mode || 'SSB';
  const power = propagationConfig.power || 100;
  const antenna = propagationConfig.antenna || 'isotropic';

  useEffect(() => {
    if (!deLocation || !dxLocation) return;

    let alive = true;
    const wasmAbort = new AbortController();

    const run = async () => {
      // 1. REST first — fast initial paint.
      let rest = null;
      try {
        const params = new URLSearchParams({
          deLat: deLocation.lat,
          deLon: deLocation.lon,
          dxLat: dxLocation.lat,
          dxLon: dxLocation.lon,
          mode,
          power,
          antenna,
        });
        const response = await fetch(`/api/propagation?${params}`);
        if (response.ok) rest = await response.json();
      } catch (err) {
        console.error('[usePropagation] Propagation error:', err);
      }

      if (!alive) return;
      if (rest) {
        setData({ ...rest, engine: rest.iturhfprop?.available ? 'rest' : 'heuristic' });
      }
      setLoading(false);

      // 2. WASM in background — progressive-enhance to VOACAP-accurate data.
      // Silently skip if WASM isn't reachable (self-hosters without the asset).
      try {
        const wasm = await runBrowserEngine({
          deLocation,
          dxLocation,
          mode,
          power,
          antenna,
          ssn: rest?.solarData?.ssn ?? 100,
          signal: wasmAbort.signal,
        });
        if (!alive) return;
        // Preserve REST-derived fields the WASM engine doesn't own (solar data,
        // path distance, LUF) so downstream panels don't lose them on swap.
        // MUF: prefer WASM's BMUF (real ITURHFProp output) but fall back to the
        // REST value if a single-hour parse misses it, so the UI never blanks.
        setData({
          ...wasm,
          solarData: rest?.solarData,
          luf: rest?.luf,
          muf: wasm.muf ?? rest?.muf,
          distance: rest?.distance,
        });
        // Single-line benchmark dump for Doug / field validators — searchable
        // for "[p533 benchmark]" in the console. Non-DEV builds still emit it
        // since the whole point of B5c is collecting field timing data.
        if (wasm.benchmark) {
          const b = wasm.benchmark;
          console.info(
            `[p533 benchmark] total=${b.totalMs}ms first=${b.firstCallMs}ms ` +
              `warm p50=${b.warmP50Ms}ms p90=${b.warmP90Ms}ms ` +
              `(min ${b.warmMinMs} / max ${b.warmMaxMs}, n=${b.samples - 1})`,
          );
        }
      } catch (err) {
        // Expected when /wasm/p533.mjs is missing (self-hoster) or the 10 MB
        // coefficient download fails — keep the REST data we already rendered.
        if (!wasmAbort.signal.aborted) {
          console.debug('[usePropagation] WASM engine skipped:', err.message);
        }
      }
    };

    run();
    const interval = setInterval(run, 10 * 60 * 1000); // 10 minutes

    return () => {
      alive = false;
      wasmAbort.abort();
      clearInterval(interval);
    };
  }, [deLocation?.lat, deLocation?.lon, dxLocation?.lat, dxLocation?.lon, mode, power, antenna]);

  return { data, loading };
};

export default usePropagation;
