/**
 * Live changes to MAP_STYLES — today only the operator's own tile source
 * (the `custom` style), which can be added, edited, or removed from
 * Settings without a reload. MAP_STYLES is a shared module object, so the
 * change is made in place and announced; consumers that list styles
 * (WorldMap's basemap dropdown, the offline-area basemap choice) re-read it
 * through useMapStylesVersion().
 */
import { useEffect, useState } from 'react';
import { MAP_STYLES } from './config.js';
import { CUSTOM_STYLE_ID, customSourceToStyle } from './customTileSource.js';

export const MAP_STYLES_CHANGED_EVENT = 'ohc:map-styles-changed';

/** Install (or with null, remove) the operator tile source as a basemap. */
export function applyCustomTileSource(source, styles = MAP_STYLES) {
  const style = customSourceToStyle(source);
  if (style) styles[CUSTOM_STYLE_ID] = style;
  else delete styles[CUSTOM_STYLE_ID];
  try {
    window.dispatchEvent(
      new CustomEvent(MAP_STYLES_CHANGED_EVENT, { detail: { id: CUSTOM_STYLE_ID, removed: !style } }),
    );
  } catch {
    /* non-browser */
  }
}

/** A number that changes whenever MAP_STYLES does — use as a memo/effect dependency. */
export function useMapStylesVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(MAP_STYLES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(MAP_STYLES_CHANGED_EVENT, bump);
  }, []);
  return version;
}
