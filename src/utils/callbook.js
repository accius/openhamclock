/**
 * Callbook utility — builds the external lookup URL for a clicked callsign.
 *
 * The callbook is the online directory opened when a user clicks a callsign in
 * the UI (DX Cluster, POTA/SOTA, PSK Reporter, map popups, etc.). The choice is
 * stored per-browser in localStorage under 'ohc_callbook' and defaults to QRZ.com.
 *
 * getCallbook()           — current callbook id ('qrz' | 'hamqth' | 'qrzcq')
 * getCallbookUrl(call)    — full lookup URL for a callsign on the current callbook
 * CALLBOOKS               — list of selectable callbooks for the settings dropdown
 */

// ── Selectable callbooks ──
// {call} is replaced with the URL-encoded base callsign.
export const CALLBOOKS = [
  { id: 'qrz', label: 'QRZ.com', urlTemplate: 'https://www.qrz.com/db/{call}' },
  { id: 'hamqth', label: 'HamQTH', urlTemplate: 'https://www.hamqth.com/{call}' },
  { id: 'qrzcq', label: 'QRZCQ', urlTemplate: 'https://www.qrzcq.com/call/{call}' },
];

const DEFAULT_CALLBOOK = 'qrz';

// Read the selected callbook id from localStorage, falling back to the default.
export function getCallbook() {
  try {
    const stored = localStorage.getItem('ohc_callbook');
    if (stored && CALLBOOKS.some((cb) => cb.id === stored)) return stored;
  } catch {}
  return DEFAULT_CALLBOOK;
}

// Build the lookup URL for a (already base-extracted) callsign.
export function getCallbookUrl(call) {
  const id = getCallbook();
  const cb = CALLBOOKS.find((c) => c.id === id) || CALLBOOKS[0];
  return cb.urlTemplate.replace('{call}', encodeURIComponent(call));
}
