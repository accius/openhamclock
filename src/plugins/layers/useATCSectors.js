/**
 * ATC Sector boundaries layer (#996 follow-up — "show nearest ATC sector").
 *
 * Renders FIR / ARTCC boundary polygons so hams listening to airband can
 * figure out which Center is controlling traffic in a given area. Click a
 * polygon → popup with the FIR name, a primary common Center frequency
 * (when curated for that FIR), and a LiveATC.net deep-link for the full
 * per-facility frequency list.
 */
import { useEffect, useState, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';

export const metadata = {
  id: 'atc-sectors',
  name: 'ATC Sectors',
  description: 'Air Traffic Control sector boundaries (FIR / ARTCC) with primary frequencies',
  icon: '🗼',
  category: 'transport',
  defaultEnabled: false,
  defaultOpacity: 0.45,
  version: '1.0.0',
};

// Tiny great-circle helper so we can highlight whichever sector contains
// DE without pulling in turf or proj4.
function distSq(latA, lonA, latB, lonB) {
  const dlat = latA - latB;
  let dlon = lonA - lonB;
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  return dlat * dlat + dlon * dlon;
}

export function useLayer({ enabled = false, opacity = 0.45, map = null, deLat = null, deLon = null }) {
  const [sectors, setSectors] = useState([]);
  const layersRef = useRef([]);

  // Fetch sectors once when the layer is first enabled. The server caches
  // upstream for 7 days so this is cheap.
  useEffect(() => {
    if (!enabled || sectors.length > 0) return;
    let alive = true;
    fetch('/api/atc/sectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!alive || !body || !Array.isArray(body.sectors)) return;
        setSectors(body.sectors);
      })
      .catch(() => {
        /* swallow — layer just renders empty if fetch fails */
      });
    return () => {
      alive = false;
    };
  }, [enabled, sectors.length]);

  // Render
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear existing
    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    layersRef.current = [];

    if (!enabled || sectors.length === 0) return;

    // Find the sector nearest DE's lon/lat for highlighting. We do a cheap
    // "nearest label" lookup rather than a proper point-in-polygon (Leaflet
    // has no built-in for that) — close enough for the highlight since FIR
    // boundaries are roughly centered on their label point.
    let nearestIdx = -1;
    if (typeof deLat === 'number' && typeof deLon === 'number') {
      let best = Infinity;
      sectors.forEach((s, i) => {
        if (s.labelLat == null || s.labelLon == null) return;
        const d = distSq(deLat, deLon, s.labelLat, s.labelLon);
        if (d < best) {
          best = d;
          nearestIdx = i;
        }
      });
    }

    const renderer = L.canvas({ padding: 0.5 });
    const newLayers = [];

    sectors.forEach((s, idx) => {
      // Color-code by sector kind. Oceanic FIRs get a different shade so
      // they don't dominate visually (they're huge but rarely the answer
      // to "who's flying over me right now").
      const isNearest = idx === nearestIdx;
      let color = '#4fc3f7'; // FIR blue
      if (s.kind === 'ARTCC') color = '#ffb74d';
      else if (s.kind === 'ACC') color = '#fff176';
      else if (s.oceanic) color = '#80cbc4';
      if (isNearest) color = '#ff7043'; // your home sector pops

      const fillOpacity = isNearest ? Math.min(1, opacity * 1.5) : opacity * 0.25;
      const weight = isNearest ? 2 : 0.8;

      // GeoJSON polygons can be Polygon or MultiPolygon; L.geoJSON handles both
      try {
        const layer = L.geoJSON(s.geometry, {
          renderer,
          style: {
            color,
            weight,
            opacity: 0.7,
            fillColor: color,
            fillOpacity,
            interactive: true,
          },
        });

        const popupHtml = `
          <div style="font-family: var(--font-mono); font-size: 12px; min-width: 180px;">
            <div style="font-weight: bold; color: var(--accent-cyan); margin-bottom: 4px;">
              🗼 ${esc(s.name)}${isNearest ? ' <span style="color: #ff7043; font-size: 10px;">(your sector)</span>' : ''}
            </div>
            <div style="font-size: 11px;">
              <div><b>ID:</b> ${esc(s.id)} <span style="opacity:0.7;">(${esc(s.kind)})</span></div>
              ${
                s.freq
                  ? `<div><b>Primary:</b> ${esc(s.freq)} MHz <span style="opacity:0.7;">AM</span></div>`
                  : `<div style="color: var(--text-muted); font-style: italic;">No curated frequency; varies by altitude/sector</div>`
              }
              <div style="margin-top: 4px;">
                <a href="https://www.liveatc.net/search/?icao=${encodeURIComponent(s.id)}"
                   target="_blank" rel="noopener"
                   style="color: var(--accent-cyan); font-size: 11px;">
                  Find on LiveATC.net →
                </a>
              </div>
              <div style="font-size: 9px; color: var(--text-muted); margin-top: 6px;">
                Always-useful: <b>121.500</b> emergency · <b>123.450</b> air-to-air · airband is AM mode
              </div>
            </div>
          </div>
        `;
        layer.bindPopup(popupHtml);
        layer.addTo(map);
        newLayers.push(layer);
      } catch {
        // Bad geometry → skip
      }
    });

    layersRef.current = newLayers;
    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
    };
  }, [enabled, sectors, map, opacity, deLat, deLon]);

  return { sectorCount: sectors.length };
}
