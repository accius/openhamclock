/**
 * useIBPMeasurements — measured NCDXF/IBP beacon SNR from a KiwiSDR beacon
 * monitor (Rig Bridge plugin kiwi-beacon-monitor).
 *
 * One page-wide poller shared by every consumer (IBP panel MEASURED view,
 * Prediction Check, the beacon-opening alert feed) so the bridge/server is
 * asked once a minute regardless of how many panels are open.
 *
 * Sources, in order:
 *   1. the Rig Bridge itself — GET <bridge>/api/beacon-monitor/measurements
 *      (works without the OpenHamClock server storing anything)
 *   2. the OpenHamClock server — GET /api/ibp/measurements?station=<callsign>
 *      (bridge forwards there; also the only path when the bridge is remote)
 *
 * App.jsx calls useIBPMeasurements(options) once to configure the poller;
 * panels call useIBPMeasurements() with no arguments to subscribe. Nothing
 * is fetched unless the Beacon monitor is enabled in Settings → Rig Bridge,
 * so the hosted site's thousands of idle users cost nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import { beaconOpenings } from '../utils/ibpMeasured.js';

const POLL_MS = 60_000;
const HOURS = 24;

const EMPTY = Object.freeze({
  measurements: [],
  source: null, // 'bridge' | 'server' | null
  station: null, // { callsign, grid, kiwi, kiwiName }
  status: 'idle', // 'idle' | 'loading' | 'ok' | 'empty' | 'unavailable'
  bridge: null, // bridge status payload (connected, currentBand, …)
  updatedAt: 0,
  enabled: false,
});

const store = {
  options: null,
  data: EMPTY,
  listeners: new Set(),
  timer: null,
  inFlight: false,
};

function emit(next) {
  store.data = next;
  for (const fn of store.listeners) fn(next);
}

/** Mirror of RigContext's URL builder (kept private there). */
export function bridgeUrlFromConfig(rigControl) {
  if (!rigControl || rigControl.enabled === false) return null;
  const host = rigControl.host?.trim();
  if (!host) return 'http://localhost:5555';
  const rawPort = String(rigControl.port ?? '').trim();
  if (rawPort === '0') return host.replace(/\/$/, '');
  const port = parseInt(rawPort, 10);
  return `${host.replace(/\/$/, '')}:${Number.isFinite(port) && port > 0 ? port : 5555}`;
}

async function fetchFromBridge(bridgeUrl) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${bridgeUrl}/api/beacon-monitor/measurements?hours=${HOURS}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.running === false || !Array.isArray(json.measurements)) return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

async function fetchFromServer(callsign) {
  try {
    const res = await fetch(`/api/ibp/measurements?station=${encodeURIComponent(callsign)}&hours=${HOURS}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.known || !Array.isArray(json.measurements)) return null;
    return json;
  } catch {
    return null;
  }
}

async function poll() {
  const opts = store.options;
  if (!opts || !opts.enabled || store.inFlight) return;
  store.inFlight = true;
  try {
    if (store.data.status === 'idle') emit({ ...store.data, status: 'loading', enabled: true });

    let next = null;
    if (opts.bridgeUrl) {
      const b = await fetchFromBridge(opts.bridgeUrl);
      if (b) {
        next = {
          measurements: b.measurements,
          source: 'bridge',
          station: { ...(b.station || {}), kiwi: b.kiwi?.id || null, kiwiName: b.kiwi?.name || null },
          bridge: { connected: !!b.connected, running: !!b.running },
        };
      }
    }
    if (!next && opts.callsign) {
      const s = await fetchFromServer(opts.callsign);
      if (s) {
        next = {
          measurements: s.measurements,
          source: 'server',
          station: { callsign: s.callsign, grid: s.grid, kiwi: s.kiwi, kiwiName: s.kiwiName },
          bridge: null,
        };
      }
    }
    if (next) {
      emit({ ...next, status: next.measurements.length ? 'ok' : 'empty', updatedAt: Date.now(), enabled: true });
    } else {
      emit({ ...EMPTY, status: 'unavailable', updatedAt: Date.now(), enabled: true });
    }
  } finally {
    store.inFlight = false;
  }
}

function ensurePolling() {
  const active = store.listeners.size > 0 && store.options?.enabled;
  if (active && !store.timer) {
    store.timer = setInterval(poll, POLL_MS);
    poll();
  } else if (!active && store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
}

/**
 * @param {Object} [options]  Only the app shell passes these:
 *   { enabled: boolean, rigControl: config.rigControl, callsign: string }
 */
export function useIBPMeasurements(options) {
  const [data, setData] = useState(store.data);

  const enabled = !!options?.enabled;
  const bridgeUrl = options ? bridgeUrlFromConfig(options.rigControl) : undefined;
  const callsign = options?.callsign && options.callsign !== 'N0CALL' ? options.callsign.toUpperCase() : '';

  // Configure (app shell only). Re-poll immediately when the source changes.
  useEffect(() => {
    if (!options) return;
    const prev = store.options;
    store.options = { enabled, bridgeUrl, callsign };
    if (!enabled) {
      emit({ ...EMPTY });
    } else if (!prev || prev.enabled !== enabled || prev.bridgeUrl !== bridgeUrl || prev.callsign !== callsign) {
      emit({ ...store.data, status: 'idle', enabled: true });
      if (store.timer) {
        clearInterval(store.timer);
        store.timer = null;
      }
    }
    ensurePolling();
    // `options` identity changes every render; the three primitives are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!options, enabled, bridgeUrl, callsign]);

  // Subscribe.
  useEffect(() => {
    store.listeners.add(setData);
    setData(store.data);
    ensurePolling();
    return () => {
      store.listeners.delete(setData);
      ensurePolling();
    };
  }, []);

  const openings = useMemo(() => (data.measurements.length ? beaconOpenings(data.measurements) : []), [data]);

  return { ...data, openings, refresh: poll };
}

/** Test hook: reset the shared poller. */
export function _resetIBPMeasurementsStore() {
  if (store.timer) clearInterval(store.timer);
  store.timer = null;
  store.options = null;
  store.data = EMPTY;
  store.listeners.clear();
  store.inFlight = false;
}

export default useIBPMeasurements;
