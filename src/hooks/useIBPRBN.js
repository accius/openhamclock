/**
 * useIBPRBN — RBN cross-reference for IBP beacons
 *
 * Polls /api/rbn/spots?callsigns=... (bulk endpoint) for all 18 IBP beacon
 * callsigns in a single request every 60 s, and returns a Map of
 * callsign → { maxSNR, count } so IBPPanel can show which beacons are
 * currently being heard by RBN skimmers.
 */
import { useState, useEffect } from 'react';
import { IBP_BEACONS } from '../utils/ibp.js';

const POLL_INTERVAL = 60_000; // 60 s — one full IBP cycle between polls
const WINDOW_MINUTES = 5; // look back 5 min (covers ~1.7 full IBP cycles)

const ALL_CALLSIGNS = IBP_BEACONS.map((b) => b.callsign);

async function fetchAllBeaconSpots() {
  const res = await fetch(
    `/api/rbn/spots?callsigns=${ALL_CALLSIGNS.map(encodeURIComponent).join(',')}&minutes=${WINDOW_MINUTES}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return new Map();
  const json = await res.json();
  const map = new Map();
  for (const [cs, { spots }] of Object.entries(json.results ?? {})) {
    if (!spots.length) continue;
    const snrs = spots.map((s) => s.snr).filter((s) => s != null);
    const maxSNR = snrs.length ? Math.max(...snrs) : null;
    // spot.callsign = the skimmer that heard the beacon; spot.dx = the beacon callsign
    const count = new Set(spots.map((s) => s.callsign)).size;
    map.set(cs, { maxSNR, count });
  }
  return map;
}

/**
 * Returns a Map<callsign, { maxSNR: number|null, count: number }>
 * for all IBP beacons that have RBN spots in the last WINDOW_MINUTES.
 * Absent from the map means no recent spots.
 */
export function useIBPRBN() {
  const [data, setData] = useState(new Map());

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const result = await fetchAllBeaconSpots();
        if (active) setData(result);
      } catch (_) {}
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []); // no deps — ALL_CALLSIGNS is a module-level constant

  return data;
}
