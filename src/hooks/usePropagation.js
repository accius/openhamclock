/**
 * usePropagation Hook
 * Fetches propagation predictions between DE and DX locations
 * Supports mode and power parameters for VOACAP-style calculations
 *
 * WASM-first flow (2026-06-05):
 *   1. Fetch /api/propagation only for its SSN + LUF + distance + solarData.
 *      Do NOT render it. The endpoint serves heuristic data when proppy is
 *      down, and EST is wrong on hard paths — we'd rather show a brief
 *      loading state than misleading green bands.
 *   2. Run the browser-side WASM engine. On success, render WASM. On
 *      failure (WASM bundle missing, coefficient download blocked, etc.)
 *      fall back to the REST/heuristic payload so something still renders
 *      instead of a permanent skeleton — that's the only path that ever
 *      produces an EST badge now.
 *
 *   `data.engine` is one of 'wasm' | 'rest' | 'heuristic'. On the hosted
 *   site, WASM is the steady state; REST/heuristic appear only on the
 *   error path. Self-hosters without the WASM bundle land on REST or
 *   heuristic immediately because the WASM import fails fast.
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
      // 1. REST in the background. We need its SSN to feed WASM and its
      // solar/LUF/distance fields to overlay on the WASM result, but we
      // intentionally do NOT setData(rest) — see file header.
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

      // 2. WASM is the authoritative renderer.
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
        setLoading(false);
        if (wasm.benchmark) {
          const b = wasm.benchmark;
          console.info(
            `[p533 benchmark] total=${b.totalMs}ms first=${b.firstCallMs}ms ` +
              `warm p50=${b.warmP50Ms}ms p90=${b.warmP90Ms}ms ` +
              `(min ${b.warmMinMs} / max ${b.warmMaxMs}, n=${b.samples - 1})`,
          );
        }
      } catch (err) {
        if (wasmAbort.signal.aborted) return;
        // Fall back to REST/heuristic only on the error path so the panel
        // shows something instead of a stuck skeleton. Self-hosters without
        // the WASM bundle land here on every refresh.
        console.warn(
          '[usePropagation] WASM engine unavailable, falling back to REST/EST. ' +
            'Self-hosters: run "node scripts/fetch-wasm.js && npm run build" to install the WASM bundle. ' +
            `(${err.message})`,
        );
        if (rest) {
          setData({ ...rest, engine: rest.iturhfprop?.available ? 'rest' : 'heuristic' });
        }
        setLoading(false);
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
