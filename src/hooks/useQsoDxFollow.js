/**
 * useQsoDxFollow — the DX marker follows what is typed in the QSO form.
 *
 * As the call is typed the marker moves to its country (cty.dat); once a valid
 * grid is entered it moves to that square instead (qsoPosition). Moves wait
 * for a short pause in typing and only fire when the position or call actually
 * changes: a new DX position refetches propagation and DX weather.
 *
 * Only typed changes count — a form opened with a prefilled call (from a spot,
 * which already set DX) or an existing QSO leaves the marker alone until the
 * call or grid is edited.
 *
 * If the form goes away without saving (Cancel, closing the popup, Delete),
 * the marker goes back to where it was before the first move. The DX lock is
 * honoured by onDXChange itself (useDXLocation ignores changes while locked).
 *
 * @param {object} opts { call, grid, onDXChange, dxLocation, dxCallsign } —
 *   without onDXChange the hook does nothing.
 * @returns {{ markSaved: () => void, restore: () => void }}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { initCtyLookup, isCtyLoaded } from '../utils/ctyLookup.js';
import { qsoPosition } from '../utils/logbookMap.js';

export const DX_FOLLOW_DELAY_MS = 400;

export default function useQsoDxFollow({ call, grid, onDXChange, dxLocation, dxCallsign }) {
  const initialRef = useRef({ call, grid }); // values the form opened with
  const originRef = useRef(null); // DX before our first move — restored if not saved
  const lastRef = useRef(null); // last position + call we sent
  const savedRef = useRef(false);
  const latest = useRef({});
  latest.current = { onDXChange, dxLocation, dxCallsign };

  // Grid-less calls need cty.dat; re-resolve once it has loaded.
  const [ctyReady, setCtyReady] = useState(() => isCtyLoaded());
  useEffect(() => {
    if (!onDXChange || isCtyLoaded()) return undefined;
    const onCty = () => setCtyReady(true);
    window.addEventListener('openhamclock-cty-loaded', onCty);
    initCtyLookup();
    return () => window.removeEventListener('openhamclock-cty-loaded', onCty);
  }, [onDXChange]);

  useEffect(() => {
    if (!onDXChange) return undefined;
    const init = initialRef.current;
    if (call === init.call && grid === init.grid) return undefined; // nothing typed yet
    const timer = setTimeout(() => {
      const c = String(call || '')
        .trim()
        .toUpperCase();
      const pos = qsoPosition(c, grid);
      if (!pos) return;
      const last = lastRef.current;
      if (last && last.lat === pos.lat && last.lon === pos.lon && last.callsign === c) return;
      if (!originRef.current) {
        const { dxLocation: loc, dxCallsign: dxCall } = latest.current;
        originRef.current = { lat: loc?.lat, lon: loc?.lon, callsign: dxCall ?? null };
      }
      lastRef.current = { lat: pos.lat, lon: pos.lon, callsign: c };
      latest.current.onDXChange({ lat: pos.lat, lon: pos.lon, callsign: c || null });
    }, DX_FOLLOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [call, grid, ctyReady, onDXChange]);

  const restore = useCallback(() => {
    const o = originRef.current;
    originRef.current = null;
    lastRef.current = null;
    if (!o || savedRef.current || !Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return;
    latest.current.onDXChange?.({ lat: o.lat, lon: o.lon, callsign: o.callsign });
  }, []);

  const markSaved = useCallback(() => {
    savedRef.current = true;
  }, []);

  // Closed without saving (popup dismissed, panel closed, form remounted).
  useEffect(() => restore, [restore]);

  return { markSaved, restore };
}
