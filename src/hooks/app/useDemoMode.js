/**
 * useDemoMode — HamClock "demo" parity: while on, make a random harmless
 * change every 30 s so a booth display keeps moving. Session-only (not
 * persisted; a reload turns it off), toggled from Settings → Display and
 * shown as a running-man indicator in the header.
 *
 * Actions (picked at random from those available right now):
 *   • switch a panel  — dockable layout only: add/focus a random panel
 *   • toggle a layer  — gray line, Maidenhead grid, city lights, aurora, great circle
 *   • random DX       — a recent DX-cluster spot with coordinates
 *   • rotate basemap  — next tile style in MAP_STYLES
 */
import { useEffect, useRef } from 'react';
import { MAP_STYLES } from '../../utils/config.js';

export const DEMO_INTERVAL_MS = 30_000;
export const DEMO_PANELS = [
  'dx-cluster',
  'solar',
  'propagation',
  'pota',
  'contests',
  'sat-passes',
  'lunar',
  'band-conditions',
  'world-clocks',
  'dxpeditions',
];
export const DEMO_LAYERS = ['grayline', 'maidenhead', 'citylights', 'aurora', 'great-circle'];

/** Decide the next demo action from the current state (pure; exported for tests). */
export function chooseDemoAction({ layout, spots = [], basemap, random = Math.random }) {
  const options = ['layer', 'basemap'];
  if (layout === 'dockable') options.push('panel');
  const located = spots.filter((s) => Number.isFinite(s?.dxLat) && Number.isFinite(s?.dxLon));
  if (located.length) options.push('dx');
  const kind = options[Math.floor(random() * options.length)];
  switch (kind) {
    case 'panel':
      return { kind, panelId: DEMO_PANELS[Math.floor(random() * DEMO_PANELS.length)] };
    case 'layer':
      return { kind, layerId: DEMO_LAYERS[Math.floor(random() * DEMO_LAYERS.length)] };
    case 'dx': {
      const s = located[Math.floor(random() * located.length)];
      return { kind, lat: s.dxLat, lon: s.dxLon, callsign: s.dxCall || null };
    }
    case 'basemap':
    default: {
      const styles = Object.keys(MAP_STYLES).filter((k) => !MAP_STYLES[k].legacy && !MAP_STYLES[k].isCanvas);
      const i = styles.indexOf(basemap);
      return { kind: 'basemap', basemap: styles[(i + 1) % styles.length] };
    }
  }
}

export default function useDemoMode({ active, config, spots, setDxLocation, setDxCallsign }) {
  const ref = useRef({});
  ref.current = { config, spots, setDxLocation, setDxCallsign };

  useEffect(() => {
    if (!active) return undefined;
    const run = () => {
      const { config: cfg, spots: list, setDxLocation: setDx, setDxCallsign: setCall } = ref.current;
      let basemap = 'dark';
      try {
        basemap = JSON.parse(localStorage.getItem('openhamclock_mapSettings') || '{}').mapStyle || 'dark';
      } catch {
        /* ignore */
      }
      const action = chooseDemoAction({ layout: cfg?.layout, spots: list || [], basemap });
      try {
        switch (action.kind) {
          case 'panel':
            window.dispatchEvent(new CustomEvent('openhamclock:add-panel', { detail: { panelId: action.panelId } }));
            break;
          case 'layer': {
            const lc = window.hamclockLayerControls;
            if (lc?.toggleLayer) {
              const cur = lc.layers?.find((l) => l.id === action.layerId)?.enabled ?? false;
              lc.toggleLayer(action.layerId, !cur);
            }
            break;
          }
          case 'dx':
            setDx?.({ lat: action.lat, lon: action.lon });
            setCall?.(action.callsign);
            break;
          case 'basemap':
            window.dispatchEvent(new CustomEvent('ohc:set-mapview', { detail: { basemap: action.basemap } }));
            break;
          default:
            break;
        }
      } catch (e) {
        console.warn('[DemoMode] action failed:', action, e);
      }
    };
    const timer = setInterval(run, DEMO_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);
}
