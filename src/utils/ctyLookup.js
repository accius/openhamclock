/**
 * Client-side DXCC Entity Lookup (cty.dat)
 *
 * Fetches the parsed cty.dat prefix database from the server and provides
 * fast synchronous callsign → entity lookups.
 *
 * Usage:
 *   import { initCtyLookup, ctyLookup } from './ctyLookup';
 *
 *   // Call once on app startup (non-blocking)
 *   initCtyLookup();
 *
 *   // Then use synchronously anywhere
 *   const info = ctyLookup('W1AW');
 *   // → { entity: 'United States', cq: 5, itu: 8, cont: 'NA', lat: 43, lon: -87.9, dxcc: 'K' }
 */
import { apiFetch } from './apiFetch';

let prefixes = null; // { PREFIX: { entity, dxcc, cq, itu, cont, lat, lon } }
let exact = null;    // { CALLSIGN: { ... } }
let loaded = false;
let loading = false;

/**
 * Fetch the cty.dat database from the server. Call once on app startup.
 * Non-blocking — returns a promise but lookup degrades gracefully before it resolves.
 */
export async function initCtyLookup() {
  if (loaded || loading) return;
  loading = true;

  try {
    const res = await apiFetch('/api/cty');
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    const data = await res.json();

    if (data?.prefixes && data?.exact) {
      prefixes = data.prefixes;
      exact = data.exact;
      loaded = true;
      console.log(`[CTY] Loaded: ${Object.keys(prefixes).length} prefixes, ${Object.keys(exact).length} exact calls`);
    }
  } catch (err) {
    console.warn('[CTY] Failed to load cty.dat data:', err.message);
  } finally {
    loading = false;
  }
}

/**
 * Check if cty.dat data is loaded
 */
export function isCtyLoaded() {
  return loaded;
}

/**
 * Look up a callsign in the cty.dat database.
 * Returns null if not found or data not yet loaded.
 *
 * Handles compound calls: W1/DL5ABC, DL5ABC/P, DL5ABC/7, etc.
 *
 * @param {string} call - Amateur radio callsign
 * @returns {{ entity: string, dxcc: string, cq: number, itu: number, cont: string, lat: number, lon: number } | null}
 */
export function ctyLookup(call) {
  if (!loaded || !call) return null;

  const upper = call.toUpperCase().replace(/[^A-Z0-9/]/g, '');

  // Handle compound callsigns
  let lookupBase = upper;
  if (upper.includes('/')) {
    const parts = upper.split('/');
    const suffixes = ['P', 'M', 'MM', 'AM', 'QRP', 'A', 'B', 'LH', 'R'];
    if (parts.length === 2) {
      if (suffixes.includes(parts[1]) || /^\d$/.test(parts[1])) {
        lookupBase = parts[0];
      } else if (parts[0].length <= 4 && parts[1].length > 4) {
        lookupBase = parts[0]; // prefix/call: DL/W1ABC → DL
      } else if (parts[1].length <= 4 && parts[0].length > 4) {
        lookupBase = parts[1]; // call/prefix: W1ABC/DL → DL
      } else {
        lookupBase = parts[0];
      }
    }
  }

  // 1. Exact callsign match
  if (exact[lookupBase]) return exact[lookupBase];

  // 2. Longest prefix match (up to 6 characters)
  const maxLen = Math.min(lookupBase.length, 6);
  for (let len = maxLen; len >= 1; len--) {
    const prefix = lookupBase.substring(0, len);
    if (prefixes[prefix]) return prefixes[prefix];
  }

  return null;
}
