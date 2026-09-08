/**
 * mapFocus — "bring this station into view" request bus (#1182).
 *
 * Any panel can ask the map to show a coordinate without holding a map
 * reference: it dispatches a window event and whichever WorldMap instance is
 * mounted answers by panning (only when the target is off-screen, unless
 * forced) and dropping a short pulse ring on the target so the eye finds it
 * in a busy view.
 */

export const MAP_FOCUS_EVENT = 'ohc-map-focus';

/** Lifetime of the pulse marker, ms. Matches the CSS animation (2 × 1.3s). */
export const MAP_FOCUS_PULSE_MS = 2600;

/**
 * Ask the map to bring a coordinate into view.
 * @param {object} req
 * @param {number} req.lat
 * @param {number} req.lon
 * @param {number} [req.zoom]  zoom level to jump to when panning (default: keep current)
 * @param {boolean} [req.force] pan even if the target is already on screen
 * @returns {boolean} false when the request was dropped (bad coords / no window)
 */
export function requestMapFocus({ lat, lon, zoom, force = false } = {}) {
  if (typeof window === 'undefined') return false;
  // Number(null) is 0 — a roster entry never heard on APRS must not send the
  // map to 0°,0°. Reject empty values before coercing numeric strings.
  if (lat == null || lon == null || lat === '' || lon === '') return false;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  const detail = { lat: la, lon: lo, force: !!force };
  if (Number.isFinite(zoom)) detail.zoom = zoom;
  window.dispatchEvent(new CustomEvent(MAP_FOCUS_EVENT, { detail }));
  return true;
}

/**
 * Longitude of `lon` in the world copy nearest to `centerLon`. Leaflet maps
 * here wrap horizontally, so a station at 170°E is best reached at −190° when
 * the view is centred on Alaska — panning "the short way" instead of dragging
 * the whole world past.
 */
export function nearestWrappedLon(centerLon, lon) {
  let best = lon;
  let bestDist = Math.abs(lon - centerLon);
  for (const cand of [lon - 360, lon + 360]) {
    const d = Math.abs(cand - centerLon);
    if (d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Is the coordinate visible inside `bounds` in any world copy?
 * @param {{ contains: Function }} bounds  Leaflet LatLngBounds (or anything with contains([lat, lon]))
 */
export function isInView(bounds, lat, lon) {
  if (!bounds || typeof bounds.contains !== 'function') return false;
  for (const lo of [lon, lon - 360, lon + 360]) {
    if (bounds.contains([lat, lo])) return true;
  }
  return false;
}
