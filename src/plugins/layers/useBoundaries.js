/**
 * 🗺️ Political boundaries layer — country borders, US state lines and
 * Canadian province lines in user-configurable colours (Settings → Map
 * Layers → Boundaries).
 *
 * Sources (decoded with src/utils/topojson.js, no dependency):
 *   countries  https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
 *   US states  https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json
 *   Canada     src/assets/geodata/canada-provinces.json — Natural Earth 50m admin-1
 *              boundary lines, Canada only, simplified + quantized (6 KB)
 *
 * Only interior borders are drawn (arcs shared by two different polygons),
 * so coastlines are left to the basemap. Decoded lines are cached at module
 * level: toggling the layer or switching projection never refetches.
 */
import i18n from '../../lang/i18n';
import { useEffect, useRef, useState } from 'react';
import { mesh } from '../../utils/topojson.js';
import canadaTopo from '../../assets/geodata/canada-provinces.json';

export const metadata = {
  id: 'boundaries',
  name: i18n.t('plugins.layers.boundaries.name'),
  description: i18n.t('plugins.layers.boundaries.description'),
  icon: '🗺️',
  category: 'overlay',
  defaultEnabled: false,
  defaultOpacity: 0.8,
  version: '1.0.0',
  config: {
    nationalColor: '#f2cc60',
    stateColor: '#7fc8f8',
    showStates: true,
  },
};

export const BOUNDARY_SOURCES = {
  countries: { url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json', object: 'countries' },
  states: { url: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json', object: 'states' },
};

/** GeoJSON MultiLineString → Leaflet [[lat, lon] …][] */
export const toLatLngs = (multi) => multi.coordinates.map((line) => line.map(([lon, lat]) => [lat, lon]));

const interior = (a, b) => a !== b;

// Module-level cache: { countries: latlngs[], states: latlngs[], canada: latlngs[] }
const cache = { canada: toLatLngs(mesh(canadaTopo, 'provinces')) };
const pending = {};

async function loadLines(key) {
  if (cache[key]) return cache[key];
  if (!pending[key]) {
    const src = BOUNDARY_SOURCES[key];
    pending[key] = fetch(src.url)
      .then((r) => {
        if (!r.ok) throw new Error(`${src.url} → ${r.status}`);
        return r.json();
      })
      .then((topo) => {
        cache[key] = toLatLngs(mesh(topo, src.object, interior));
        return cache[key];
      })
      .finally(() => {
        delete pending[key];
      });
  }
  return pending[key];
}

export function useLayer({ enabled = false, opacity = 0.8, map = null, config = null }) {
  const [lines, setLines] = useState(() => ({ countries: cache.countries || null, states: cache.states || null }));
  const nationalRef = useRef(null);
  const stateRef = useRef(null);
  const nationalColor = config?.nationalColor || metadata.config.nationalColor;
  const stateColor = config?.stateColor || metadata.config.stateColor;
  const showStates = config?.showStates !== false;

  // Fetch (once per session) when enabled
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loadLines('countries')
      .then((c) => alive && setLines((p) => (p.countries === c ? p : { ...p, countries: c })))
      .catch((err) => console.error('[Boundaries] countries:', err));
    if (showStates) {
      loadLines('states')
        .then((s) => alive && setLines((p) => (p.states === s ? p : { ...p, states: s })))
        .catch((err) => console.error('[Boundaries] states:', err));
    }
    return () => {
      alive = false;
    };
  }, [enabled, showStates]);

  // Draw / redraw
  useEffect(() => {
    if (!map || typeof L === 'undefined') return undefined;
    const remove = (ref) => {
      if (ref.current) {
        try {
          map.removeLayer(ref.current);
        } catch (e) {}
        ref.current = null;
      }
    };
    remove(nationalRef);
    remove(stateRef);
    if (!enabled) return undefined;

    if (lines.countries?.length) {
      nationalRef.current = L.polyline(lines.countries, {
        color: nationalColor,
        weight: 1.4,
        opacity,
        interactive: false,
        smoothFactor: 1.2,
      }).addTo(map);
    }
    if (showStates) {
      const stateLines = [...(lines.states || []), ...cache.canada];
      if (stateLines.length) {
        stateRef.current = L.polyline(stateLines, {
          color: stateColor,
          weight: 0.9,
          opacity: opacity * 0.9,
          interactive: false,
          smoothFactor: 1.2,
        }).addTo(map);
      }
    }
    return () => {
      remove(nationalRef);
      remove(stateRef);
    };
  }, [map, enabled, lines, opacity, nationalColor, stateColor, showStates]);

  return { ready: !!lines.countries };
}
