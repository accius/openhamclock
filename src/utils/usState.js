/**
 * US state for a coordinate — FEMA disaster declarations are listed per
 * state. Looked up offline first, in bundled simplified state outlines
 * (src/assets/geodata/us-states.json, ~100 KB, built by
 * scripts/build-us-states.cjs from Census-derived us-atlas data and loaded
 * on first use as its own chunk). Only when that finds nothing — a point
 * on a tiny island dropped by the simplification, or the chunk failing to
 * load — does it ask Nominatim (OpenStreetMap). Results are remembered per
 * location. Used live by the EmComm layout and by offline area packs.
 */

let outlines = null;

/** Even-odd point-in-polygon over flat [x0,y0,x1,y1,…] rings. */
function inRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i];
      const yi = r[i + 1];
      const xj = r[j];
      const yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Prepare the bundled outlines: per-state bounding boxes for a fast reject. */
export function prepareOutlines(data) {
  const scale = data?.scale || 100;
  const list = [];
  for (const [code, rings] of Object.entries(data?.states || {})) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minX) minX = r[i];
        if (r[i] > maxX) maxX = r[i];
        if (r[i + 1] < minY) minY = r[i + 1];
        if (r[i + 1] > maxY) maxY = r[i + 1];
      }
    }
    list.push({ code, rings, minX, minY, maxX, maxY });
  }
  return { scale, list };
}

/** State code for lat/lon from prepared outlines, or null. Pure. */
export function stateFromOutlines(prepared, lat, lon) {
  if (!prepared || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const x = lon * prepared.scale;
  const y = lat * prepared.scale;
  for (const s of prepared.list) {
    if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
    if (inRings(s.rings, x, y)) return s.code;
  }
  return null;
}

async function loadOutlines() {
  if (!outlines) {
    outlines = import('../assets/geodata/us-states.json')
      .then((m) => prepareOutlines(m.default || m))
      .catch(() => {
        outlines = null; // retry next time
        return null;
      });
  }
  return outlines;
}

/** Bundled-outline lookup only (no network). */
export async function stateFromBundle(lat, lon) {
  return stateFromOutlines(await loadOutlines(), Number(lat), Number(lon));
}

const memo = new Map();

const key = (lat, lon) => `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

/** "US-CO" → "CO"; anything else (outside the US, junk) → null. */
export function stateFromIso(iso) {
  const m = /^US-([A-Z]{2})$/.exec(String(iso || ''));
  return m ? m[1] : null;
}

/**
 * Two-letter state code for lat/lon, or null (outside the US, or the
 * point is not in the bundled outlines and Nominatim is unreachable).
 * Never throws.
 */
export async function resolveUsState(lat, lon, fetchImpl = fetch) {
  if (lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const k = key(lat, lon);
  if (memo.has(k)) return memo.get(k);
  const bundled = await stateFromBundle(lat, lon);
  if (bundled) {
    memo.set(k, bundled);
    return bundled;
  }
  try {
    const res = await fetchImpl(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=5`,
      { headers: { 'User-Agent': 'OpenHamClock' } },
    );
    if (!res?.ok) return null;
    const data = await res.json();
    const state = stateFromIso(data?.address?.['ISO3166-2-lvl4']);
    memo.set(k, state);
    return state;
  } catch {
    return null; // not remembered — try again next time
  }
}

/** Test hook. */
export function _clearUsStateMemo() {
  memo.clear();
}
