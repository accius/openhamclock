/**
 * mapViewport — the flat map's current view and basemap, published by
 * WorldMap so controls without a map reference (Settings → Map Layers,
 * the EmComm rail's offline-area control) can offer "download the current
 * map view" and know which basemap is showing.
 *
 * Only the Leaflet (flat) map publishes bounds; on the azimuthal canvas or
 * the 3D globe the last flat view is kept.
 */

export const MAP_VIEWPORT_EVENT = 'ohc:map-viewport';

let current = { bbox: null, zoom: null, styleId: null };

/** Leaflet LatLngBounds (or plain {west,south,east,north}) + zoom → stored. */
export function publishMapViewport({ bounds, zoom, styleId } = {}) {
  const next = { ...current };
  if (bounds) {
    const b =
      typeof bounds.getWest === 'function'
        ? { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }
        : bounds;
    if ([b.west, b.south, b.east, b.north].every(Number.isFinite)) next.bbox = b;
  }
  if (Number.isFinite(zoom)) next.zoom = zoom;
  if (typeof styleId === 'string') next.styleId = styleId;
  current = next;
  try {
    window.dispatchEvent(new CustomEvent(MAP_VIEWPORT_EVENT, { detail: current }));
  } catch {
    /* non-browser */
  }
}

export const getMapViewport = () => current;

export function subscribeMapViewport(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => fn(current);
  window.addEventListener(MAP_VIEWPORT_EVENT, handler);
  return () => window.removeEventListener(MAP_VIEWPORT_EVENT, handler);
}

/** Ask the mounted map to switch basemap (same bus as remote control). */
export function requestBasemap(styleId) {
  try {
    window.dispatchEvent(new CustomEvent('ohc:set-mapview', { detail: { basemap: styleId } }));
  } catch {
    /* non-browser */
  }
}
