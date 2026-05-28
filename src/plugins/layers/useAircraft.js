/**
 * Aircraft tracking layer (#996).
 *
 * Plots live aircraft positions from the server-side OpenSky proxy. Each
 * aircraft is a heading-oriented icon; click shows callsign / country /
 * altitude / speed / squawk. Refilters to the current map viewport on pan/zoom
 * so we never try to plot 5000+ markers at once.
 */
import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';

export const metadata = {
  id: 'aircraft',
  name: 'Aircraft',
  description: 'Live aircraft positions from OpenSky Network',
  icon: '✈️',
  category: 'transport',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

// Max markers to render per refresh. Server returns the global aircraft list
// (~6000 typical), but plotting all of them tanks the map. We pick the ones
// currently in view and cap at MAX_VIEWPORT_MARKERS.
const MAX_VIEWPORT_MARKERS = 400;
const MAX_VIEWPORT_MARKERS_LOW = 80;
const POLL_MS = 30_000; // server caches for 60 s; 30 s polls keep us cache-warm
const POLL_MS_LOW = 60_000;

function planeSvg(heading, color) {
  // Heading 0 = north; SVG plane points up natively, so rotation is direct.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
    style="transform: rotate(${heading || 0}deg); transform-origin: center; filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.7));">
    <path fill="${color}" d="M12 2 L13.4 9 L22 11 L22 13 L13.4 12.4 L13 19 L16 20.5 L16 22 L12 21 L8 22 L8 20.5 L11 19 L10.6 12.4 L2 13 L2 11 L10.6 9 Z"/>
  </svg>`;
}

export function useLayer({ enabled = false, opacity = 0.9, map = null, lowMemoryMode = false }) {
  const [aircraft, setAircraft] = useState([]);
  const markersRef = useRef([]);
  const [viewportTick, setViewportTick] = useState(0);

  const maxMarkers = lowMemoryMode ? MAX_VIEWPORT_MARKERS_LOW : MAX_VIEWPORT_MARKERS;
  const pollMs = lowMemoryMode ? POLL_MS_LOW : POLL_MS;

  // Fetch loop
  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const fetchAircraft = async () => {
      try {
        const res = await fetch('/api/aircraft');
        if (!res.ok) return;
        const body = await res.json();
        if (!alive) return;
        if (Array.isArray(body?.aircraft)) setAircraft(body.aircraft);
      } catch {
        /* swallow — transient failures are fine, next poll retries */
      }
    };

    fetchAircraft();
    const interval = setInterval(fetchAircraft, pollMs);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled, pollMs]);

  // Bump viewportTick on map pan/zoom so the render effect refilters.
  useEffect(() => {
    if (!map || !enabled) return;
    const bump = () => setViewportTick((t) => t + 1);
    map.on('moveend', bump);
    map.on('zoomend', bump);
    return () => {
      map.off('moveend', bump);
      map.off('zoomend', bump);
    };
  }, [map, enabled]);

  // Render markers
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear previous
    markersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    markersRef.current = [];

    if (!enabled || !aircraft.length) return;

    // Viewport filter
    let bounds = null;
    try {
      bounds = map.getBounds();
    } catch {}
    const inView = bounds ? aircraft.filter((a) => bounds.contains([a.lat, a.lon])) : aircraft;

    // Cap to avoid melting the map. Prefer higher-altitude (typically faster +
    // farther-traveling) aircraft when truncating — they're the ones an HF/VHF
    // op is most likely scanning for in the first place.
    const subset =
      inView.length > maxMarkers
        ? [...inView].sort((a, b) => (b.alt_ft || 0) - (a.alt_ft || 0)).slice(0, maxMarkers)
        : inView;

    const newMarkers = [];
    for (const a of subset) {
      // 30,000 ft is roughly the cruise floor for big jets — color-code so
      // higher altitudes (where aircraft scatter / OTH reflections are most
      // likely) stand out from ground/low-altitude clutter.
      const color = a.onGround ? '#888' : a.alt_ft && a.alt_ft > 30000 ? '#4fc3f7' : '#ffeb3b';
      const icon = L.divIcon({
        className: 'aircraft-icon',
        html: planeSvg(a.heading, color),
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([a.lat, a.lon], { icon, opacity, keyboard: false });

      const altFt = a.alt_ft != null ? Math.round(a.alt_ft) : null;
      const speedKn = a.speed_kn != null ? Math.round(a.speed_kn) : null;
      const headingDeg = a.heading != null ? Math.round(a.heading) : null;
      const popup = `
        <div style="font-family: var(--font-mono); min-width: 180px; font-size: 12px;">
          <div style="font-weight: bold; color: var(--accent-cyan); margin-bottom: 4px;">
            ✈️ ${esc(a.call || a.id || '?')}
          </div>
          <table style="font-size: 11px; width: 100%; border-collapse: collapse;">
            ${a.desc ? `<tr><td>Type:</td><td>${esc(a.desc)}</td></tr>` : a.type ? `<tr><td>Type:</td><td>${esc(a.type)}</td></tr>` : ''}
            ${a.operator ? `<tr><td>Operator:</td><td>${esc(a.operator)}</td></tr>` : ''}
            ${a.registration ? `<tr><td>Reg:</td><td>${esc(a.registration)}</td></tr>` : ''}
            ${altFt != null ? `<tr><td>Altitude:</td><td>${altFt.toLocaleString()} ft</td></tr>` : ''}
            ${speedKn != null ? `<tr><td>Speed:</td><td>${speedKn} kn</td></tr>` : ''}
            ${headingDeg != null ? `<tr><td>Heading:</td><td>${headingDeg}°</td></tr>` : ''}
            ${a.squawk ? `<tr><td>Squawk:</td><td>${esc(a.squawk)}</td></tr>` : ''}
            ${a.onGround ? '<tr><td colspan="2" style="color: #888; font-style: italic;">On ground</td></tr>' : ''}
          </table>
          <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px;">
            Source: adsb.lol (community)
          </div>
        </div>
      `;
      marker.bindPopup(popup);
      marker.addTo(map);
      newMarkers.push(marker);
    }

    markersRef.current = newMarkers;
    return () => {
      newMarkers.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch {}
      });
    };
  }, [enabled, aircraft, map, opacity, maxMarkers, viewportTick]);

  return {
    aircraftCount: aircraft.length,
  };
}
