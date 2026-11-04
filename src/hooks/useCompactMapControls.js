import { useEffect, useState } from 'react';

/** Below this viewport width the map's own controls switch to their compact form. */
export const COMPACT_MAP_CONTROLS_MAX_WIDTH = 600;

/**
 * Below this map width the controls go compact on any screen — a small map
 * panel in the Dockable layout, a tiny kiosk display. Kept well under the
 * smallest desktop map sizes in normal use (Modern at 1280×720 is ~600 px,
 * Dockable/Classic at 1024×768 ~535–585 px) so those keep the full controls.
 */
export const COMPACT_MAP_MIN_MAP_WIDTH = 480;

/**
 * The full control column (eye, lock, zoom, tall night slider) needs about
 * 315 px from the top of the map. A map with less usable height than this
 * (after the host layout's own bottom row, `bottomInset`) gets the compact
 * controls instead of a column that runs into that row. Normal desktop maps
 * are far taller (Modern at 1024×768 is ~346 px, at 1440×900 ~830 px).
 */
export const FULL_DOCK_MIN_MAP_HEIGHT = 330;

/**
 * Height the compact column needs: the eye button, then a box of `items`
 * 36 px buttons with 5 px gaps and 5 px padding, starting 10 px down.
 */
export function compactDockHeight(items) {
  const n = Math.max(0, items);
  return 10 + 42 + 5 + 10 + n * 36 + Math.max(0, n - 1) * 5;
}

/**
 * Should the compact column fold zoom / labels / night shading into a "⋯"
 * overflow popover? Only when the map is measured and the full compact
 * column would run past the usable height.
 */
export function shouldOverflowCompactDock(mapHeight, bottomInset, items) {
  if (!(mapHeight > 0)) return false;
  return compactDockHeight(items) > mapHeight - Math.max(0, bottomInset || 0);
}

/**
 * Pure decision: an explicit `true`/`false` prop wins; otherwise compact
 * controls turn on for a phone-sized viewport, a narrow map, or a map too
 * short for the full control column. Unmeasured (0) sizes never trigger.
 */
export function shouldUseCompactMapControls(prop, viewportWidth, mapWidth = 0, mapHeight = 0, bottomInset = 0) {
  if (prop === true || prop === false) return prop;
  if (viewportWidth > 0 && viewportWidth < COMPACT_MAP_CONTROLS_MAX_WIDTH) return true;
  if (mapWidth > 0 && mapWidth < COMPACT_MAP_MIN_MAP_WIDTH) return true;
  return mapHeight > 0 && mapHeight - Math.max(0, bottomInset || 0) < FULL_DOCK_MIN_MAP_HEIGHT;
}

/** Map root size, kept live with a ResizeObserver (0×0 until measured). */
export function useElementSize(ref, enabled = true) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref?.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // Whole pixels are plenty: only which side of a threshold matters
    const update = (w, h) =>
      setSize((prev) =>
        Math.round(w) === prev.width && Math.round(h) === prev.height
          ? prev
          : { width: Math.round(w), height: Math.round(h) },
      );
    const r = el.getBoundingClientRect();
    update(r.width, r.height);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) update(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, ref]);
  return size;
}

/**
 * WorldMap's compact-controls switch. `prop` is the WorldMap
 * `compactControls` prop (true forces on, false forces off, undefined =
 * auto); `size` is the map root's measured size; `bottomInset` the height
 * the host layout reserves at the bottom of the map for its own buttons.
 */
export default function useCompactMapControls(prop, size = { width: 0, height: 0 }, bottomInset = 0) {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  const forced = prop === true || prop === false;

  useEffect(() => {
    if (forced) return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [forced]);

  return shouldUseCompactMapControls(prop, viewportWidth, size.width, size.height, bottomInset);
}
