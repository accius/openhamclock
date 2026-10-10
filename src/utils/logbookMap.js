/**
 * logbookMap — logbook QSOs as map points, shared by the flat/azimuthal
 * "Logbook QSOs" layer (plugins/layers/useLogbookQsos.js) and the 3D globe's
 * overlay painter (paintLogbookQsos in utils/globeOverlays.js), so both
 * projections place, group and filter QSOs identically.
 *
 * Position: the logged grid square when there is one, else the DXCC entity's
 * position from cty.dat (approximate — `approx: true`). QSOs at the same
 * position on the same band share one point.
 */
import { useEffect, useMemo, useState } from 'react';
import logbookStore, { qsoMatchesFilter } from '../services/logbookStore.js';
import { getBandFromFreq } from './callsign.js';
import { ctyLookup, initCtyLookup, isCtyLoaded } from './ctyLookup.js';
import { maidenheadToLatLon } from './geo.js';

/**
 * Lines from DE are drawn only up to this many points: beyond it they merge
 * into a solid web on the flat map and wash the globe out white (measured
 * with 10,000 QSOs). Dots are always drawn; the Logbook panel tells the user
 * to narrow the filter to get the lines back.
 */
export const MAX_LOGBOOK_LINES = 500;

const qsoBand = (q) => q?.band || (q?.freq ? getBandFromFreq(q.freq) : '') || '';

/**
 * Group filtered QSOs into map points: one per position and band.
 * @param {Array<object>} qsos logbook records
 * @param {object} [opts] { filter, lookup } — lookup(call) → { lat, lon, entity } | null
 * @returns {Array<{ lat, lon, band, approx, place, qsos: Array<object> }>}
 */
export const buildLogbookMapPoints = (qsos, { filter, lookup = ctyLookup } = {}) => {
  const groups = new Map();
  for (const q of Array.isArray(qsos) ? qsos : []) {
    if (!q || !q.call || !qsoMatchesFilter(q, filter)) continue;
    let pos = null;
    let approx = false;
    let place = '';
    const grid = String(q.gridsquare || '')
      .trim()
      .toUpperCase(); // ADIF files often log grids in lower case
    if (grid) {
      pos = maidenheadToLatLon(grid);
      place = grid;
    }
    if (!pos) {
      const cty = lookup(q.call);
      if (cty && Number.isFinite(cty.lat) && Number.isFinite(cty.lon)) {
        pos = { lat: cty.lat, lon: cty.lon };
        approx = true;
        place = cty.entity || '';
      }
    }
    if (!pos) continue;
    const band = qsoBand(q);
    const key = `${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}|${band}`;
    let g = groups.get(key);
    if (!g) {
      g = { lat: pos.lat, lon: pos.lon, band, approx, place, qsos: [] };
      groups.set(key, g);
    }
    g.qsos.push(q);
  }
  return [...groups.values()];
};

/**
 * Live map points while `enabled`: follows the logbook (new QSOs, imports)
 * and the Logbook panel's view filter, and re-places grid-less QSOs once
 * cty.dat has loaded. Returns [] while disabled.
 */
export function useLogbookMapPoints(enabled) {
  const [qsos, setQsos] = useState(() => logbookStore.getAll());
  const [filter, setFilter] = useState(() => logbookStore.getViewFilter());
  const [ctyReady, setCtyReady] = useState(() => isCtyLoaded());

  useEffect(() => {
    if (!enabled) return undefined;
    const unsubLog = logbookStore.subscribe(setQsos); // delivers the current log at once
    const unsubFilter = logbookStore.subscribeViewFilter(setFilter);
    setFilter(logbookStore.getViewFilter());
    const onCty = () => setCtyReady(true);
    window.addEventListener('openhamclock-cty-loaded', onCty);
    if (!isCtyLoaded()) initCtyLookup();
    return () => {
      unsubLog();
      unsubFilter();
      window.removeEventListener('openhamclock-cty-loaded', onCty);
    };
  }, [enabled]);

  // ctyReady: grid-less QSOs only get a position once cty.dat is in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (enabled ? buildLogbookMapPoints(qsos, { filter }) : []), [enabled, qsos, filter, ctyReady]);
}
