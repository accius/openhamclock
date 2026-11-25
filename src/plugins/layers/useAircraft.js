/**
 * Aircraft tracking layer (#996).
 *
 * Plots live aircraft positions from the server's adsb.lol proxy. adsb.lol
 * only answers within 250 NM of a point (#1284), so the layer asks for the
 * area around the station when zoomed out, or around the map centre from
 * zoom 5, and refetches when that point crosses into another 0.5° cell. Each aircraft is a heading-oriented icon; click shows callsign /
 * type / altitude / speed / squawk. Refilters to the current viewport on
 * pan/zoom and caps the marker count.
 */
import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { deadReckonPosition, destinationPoint, getGreatCirclePoints } from '../../utils/geo.js';
import { aircraftCell, aircraftUrl } from '../../utils/aircraftQuery.js';

export const metadata = {
  id: 'aircraft',
  name: 'Aircraft',
  description:
    'Live aircraft within 250 NM of your station, or of the map centre when zoomed in (adsb.lol community feed)',
  icon: '✈️',
  category: 'transport',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.1.0',
  config: {
    leadTimeMins: 0, // predicted-track vector length; 0 disables (off by default)
  },
};

// Max markers to render per refresh. Server returns the global aircraft list
// (~6000 typical), but plotting all of them tanks the map. We pick the ones
// currently in view and cap at MAX_VIEWPORT_MARKERS.
const MAX_VIEWPORT_MARKERS = 400;
const MAX_VIEWPORT_MARKERS_LOW = 80;
const POLL_MS = 30_000; // server caches for 60 s; 30 s polls keep us cache-warm
const POLL_MS_LOW = 60_000;
// From this zoom the query follows the map centre; below it, the station (#1284)
const FOLLOW_VIEW_MIN_ZOOM = 5;

// Track-prediction (lead time) vectors only draw at this zoom or closer.
// The layer has no persistent hover/selection concept (markers are rebuilt on
// every 30-60 s poll, interaction is click-to-popup only), so gating on zoom
// is the model this layer supports: continent-level views stay clean, and at
// regional zooms the viewport naturally bounds how many vectors are in play.
const PREDICTION_MIN_ZOOM = 6;
// Ignore taxiing / hovering targets — a dead-reckoned vector for them is noise.
const PREDICTION_MIN_SPEED_KN = 30;

/**
 * Unwrap `lon` to the world copy nearest `refLon` (which may itself be an
 * unwrapped longitude beyond ±180 from getGreatCirclePoints).
 */
function unwrapNear(lon, refLon) {
  while (lon - refLon > 180) lon -= 360;
  while (lon - refLon < -180) lon += 360;
  return lon;
}

function planeSvg(heading, color) {
  // Heading 0 = north; SVG plane points up natively, so rotation is direct.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
    style="transform: rotate(${heading || 0}deg); transform-origin: center; filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.7));">
    <path fill="${color}" d="M12 2 L13.4 9 L22 11 L22 13 L13.4 12.4 L13 19 L16 20.5 L16 22 L12 21 L8 22 L8 20.5 L11 19 L10.6 12.4 L2 13 L2 11 L10.6 9 Z"/>
  </svg>`;
}

export function useLayer({
  enabled = false,
  opacity = 0.9,
  map = null,
  lowMemoryMode = false,
  config = null,
  deLat = null,
  deLon = null,
}) {
  const [aircraft, setAircraft] = useState([]);
  const markersRef = useRef([]);
  const [viewportTick, setViewportTick] = useState(0);
  // Cell around the map centre — the area the server is asked about (#1284)
  const [centerKey, setCenterKey] = useState(null);

  const maxMarkers = lowMemoryMode ? MAX_VIEWPORT_MARKERS_LOW : MAX_VIEWPORT_MARKERS;
  const pollMs = lowMemoryMode ? POLL_MS_LOW : POLL_MS;

  // Fetch loop
  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const [cLat, cLon] = (centerKey || '').split(',').map(Number);
    const url = centerKey ? aircraftUrl(cLat, cLon) : null;
    if (!url) return;

    const fetchAircraft = async () => {
      try {
        const res = await fetch(url);
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
  }, [enabled, pollMs, centerKey]);

  // Broadcast the fetched aircraft list to the text view panel (#1002).
  // Updates arrive at poll cadence (30-60s), no throttling needed.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('mapdata:aircraft', { detail: enabled ? { enabled: true, aircraft } : { enabled: false } }),
    );
  }, [enabled, aircraft]);
  useEffect(() => () => window.dispatchEvent(new CustomEvent('mapdata:aircraft', { detail: { enabled: false } })), []);

  // Bump viewportTick on map pan/zoom so the render effect refilters.
  useEffect(() => {
    if (!map || !enabled) return;
    // Zoomed out, the view is far wider than one 250 NM query and its centre
    // is often empty ocean or desert — ask about the station's area instead.
    // Zoomed in, follow the view so panning to an airport shows its traffic.
    const syncCenter = () => {
      try {
        const c = map.getCenter();
        const followView = map.getZoom() >= FOLLOW_VIEW_MIN_ZOOM || !Number.isFinite(deLat) || !Number.isFinite(deLon);
        const cell = followView ? aircraftCell(c.lat, c.lng) : aircraftCell(deLat, deLon);
        if (cell) setCenterKey(cell.key);
      } catch {
        /* map not ready */
      }
    };
    syncCenter();
    const bump = () => {
      setViewportTick((t) => t + 1);
      syncCenter();
    };
    map.on('moveend', bump);
    map.on('zoomend', bump);
    return () => {
      map.off('moveend', bump);
      map.off('zoomend', bump);
    };
  }, [map, enabled, deLat, deLon]);

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

    const leadTimeMins = Number(config?.leadTimeMins ?? metadata.config.leadTimeMins) || 0;
    let zoom = 0;
    try {
      zoom = map.getZoom();
    } catch {}
    const drawPredictions = leadTimeMins > 0 && zoom >= PREDICTION_MIN_ZOOM;

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

      // Track-prediction (lead time) vector: great-circle dead reckoning from
      // the current position along the reported course at the reported ground
      // speed. Thin dashed line in the marker's color, with a small
      // perpendicular tick at the predicted endpoint.
      if (
        drawPredictions &&
        !a.onGround &&
        Number.isFinite(a.heading) &&
        Number.isFinite(a.speed_kn) &&
        a.speed_kn >= PREDICTION_MIN_SPEED_KN
      ) {
        const end = deadReckonPosition(a.lat, a.lon, a.heading, a.speed_kn, leadTimeMins);
        // getGreatCirclePoints unwraps longitudes, so the path stays continuous
        // across the antimeridian instead of streaking across the map.
        const path = getGreatCirclePoints(a.lat, a.lon, end.lat, end.lon, 16);
        const line = L.polyline(path, {
          color,
          weight: 1,
          opacity: opacity * 0.65,
          dashArray: '4, 6',
          interactive: false,
        }).addTo(map);
        newMarkers.push(line);

        // Endpoint tick: short segment perpendicular to the course, sized
        // relative to the vector so it stays proportionate at any zoom.
        const [endLat, endLonUnwrapped] = path[path.length - 1];
        const distKm = a.speed_kn * 1.852 * (leadTimeMins / 60);
        const tickKm = Math.max(1.5, distKm * 0.04);
        const left = destinationPoint(end.lat, end.lon, a.heading - 90, tickKm);
        const right = destinationPoint(end.lat, end.lon, a.heading + 90, tickKm);
        const tick = L.polyline(
          [
            [left.lat, unwrapNear(left.lon, endLonUnwrapped)],
            [endLat, endLonUnwrapped],
            [right.lat, unwrapNear(right.lon, endLonUnwrapped)],
          ],
          {
            color,
            weight: 2,
            opacity: opacity * 0.65,
            interactive: false,
          },
        ).addTo(map);
        newMarkers.push(tick);
      }
    }

    markersRef.current = newMarkers;
    return () => {
      newMarkers.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch {}
      });
    };
  }, [enabled, aircraft, map, opacity, maxMarkers, viewportTick, config?.leadTimeMins]);

  return {
    aircraftCount: aircraft.length,
  };
}
