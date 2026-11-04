/**
 * Balloons map layer — amateur HAB / pico-balloon positions with 6-hour
 * trails from SondeHub Amateur (via /api/balloons, shared with the
 * Balloons panel through hooks/useBalloons.js — one fetch per minute no
 * matter how many consumers).
 *
 * Marker colour follows altitude (ground → stratosphere); APRS-gated
 * picos get a dashed outline. Click → popup with payload details and a
 * "Set as DX" button (onDXChange). Flat (Mercator) and azimuthal Leaflet
 * maps only — no 3D globe painter.
 */
import i18n from '../../lang/i18n';
import { useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { useBalloons } from '../../hooks/useBalloons.js';
import { calculateBearing, calculateDistance, formatDistance } from '../../utils/geo.js';
import { formatBearing } from '../../utils/bearing.js';

export const metadata = {
  id: 'balloons',
  name: i18n.t('plugins.layers.balloons.name', { defaultValue: 'Balloons (HAB/Pico)' }),
  description: i18n.t('plugins.layers.balloons.description', {
    defaultValue: 'Amateur high-altitude and pico balloons from SondeHub Amateur, with 6-hour trails',
  }),
  icon: '🎈',
  category: 'amateur',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

const MAX_MARKERS = 500;
const MAX_MARKERS_LOW = 100;

// Altitude → colour (data-driven scale, like band colours)
function altColor(m) {
  if (m == null) return '#9e9e9e';
  if (m < 1000) return '#8bc34a';
  if (m < 5000) return '#cddc39';
  if (m < 10000) return '#ffc107';
  if (m < 15000) return '#ff9800';
  if (m < 25000) return '#f44336';
  return '#e040fb';
}

function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

export function useLayer({
  enabled = false,
  opacity = 0.9,
  map = null,
  lowMemoryMode = false,
  onDXChange,
  deLat = null,
  deLon = null,
  allUnits = null,
}) {
  const { balloons } = useBalloons({ enabled });
  const layerRef = useRef([]);

  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    layerRef.current.forEach((l) => {
      try {
        map.removeLayer(l);
      } catch {}
    });
    layerRef.current = [];

    if (!enabled || !balloons.length) return;

    const units = allUnits?.dist || 'imperial';
    const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);
    const now = Date.now();
    const items = [];

    balloons.slice(0, lowMemoryMode ? MAX_MARKERS_LOW : MAX_MARKERS).forEach((b) => {
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return;
      const color = altColor(b.alt);

      // Trail (last 6 h), split at the dateline so it doesn't streak the map
      if (Array.isArray(b.trail) && b.trail.length > 1) {
        const segments = [[]];
        let prevLon = null;
        for (const [lat, lon] of b.trail) {
          if (prevLon != null && Math.abs(lon - prevLon) > 180) segments.push([]);
          segments[segments.length - 1].push([lat, lon]);
          prevLon = lon;
        }
        for (const seg of segments) {
          if (seg.length < 2) continue;
          const line = L.polyline(seg, { color, weight: 1.5, opacity: opacity * 0.7, interactive: false }).addTo(map);
          items.push(line);
        }
      }

      const size = 14;
      const icon = L.divIcon({
        className: 'balloon-icon',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px ${b.aprs ? 'dashed' : 'solid'} #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);opacity:${opacity}"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size],
      });
      const marker = L.marker([b.lat, b.lon], { icon, zIndexOffset: 5000 }).addTo(map);

      const altM = b.alt;
      const altText =
        altM == null
          ? '—'
          : units === 'metric'
            ? `${Math.round(altM).toLocaleString()} m`
            : `${Math.round(altM * 3.28084).toLocaleString()} ft (${Math.round(altM).toLocaleString()} m)`;
      const speedText =
        b.speedKmh == null
          ? '—'
          : units === 'metric'
            ? `${Math.round(b.speedKmh)} km/h`
            : `${Math.round(b.speedKmh * 0.621371)} mph`;
      let fromDe = '';
      if (hasDE) {
        const km = calculateDistance(deLat, deLon, b.lat, b.lon);
        const brg = formatBearing(calculateBearing(deLat, deLon, b.lat, b.lon), deLat, deLon);
        fromDe = `<tr><td><b>From DE:</b></td><td>${esc(formatDistance(km, units))} @ ${esc(brg || '')}</td></tr>`;
      }
      marker.bindPopup(`
        <div style="font-family: var(--font-mono); min-width: 210px;">
          <div style="font-size: 14px; font-weight: bold; color: ${color}; margin-bottom: 6px;">🎈 ${esc(b.call)}${b.aprs ? ' <span style="font-size:9px;color:var(--accent-amber)">APRS</span>' : ''}</div>
          <table style="font-size: 11px; width: 100%;">
            <tr><td><b>Altitude:</b></td><td>${esc(altText)}${b.ascentRate != null ? ` (${b.ascentRate > 0 ? '+' : ''}${b.ascentRate.toFixed(1)} m/s)` : ''}</td></tr>
            <tr><td><b>Speed:</b></td><td>${esc(speedText)}</td></tr>
            <tr><td><b>Heard:</b></td><td>${esc(ageText(b.lastHeard, now))}${b.uploader ? ` via ${esc(b.uploader)}` : ''}</td></tr>
            ${b.frequency ? `<tr><td><b>Freq:</b></td><td>${b.frequency.toFixed(3)} MHz</td></tr>` : ''}
            ${b.model || b.modulation ? `<tr><td><b>Tracker:</b></td><td>${esc([b.model, b.modulation].filter(Boolean).join(' · '))}</td></tr>` : ''}
            ${b.frames ? `<tr><td><b>Frames (6 h):</b></td><td>${b.frames}</td></tr>` : ''}
            ${fromDe}
            ${b.comment ? `<tr><td colspan="2" style="color:var(--text-muted)">${esc(b.comment)}</td></tr>` : ''}
          </table>
          <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
            <button type="button" data-balloon-dx="1" style="background:var(--bg-tertiary);color:var(--accent-cyan);border:1px solid var(--accent-cyan);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">Set as DX</button>
            <a href="https://amateur.sondehub.org/${encodeURIComponent(b.call)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); font-size: 11px;">SondeHub →</a>
          </div>
        </div>
      `);
      marker.on('popupopen', (e) => {
        const btn = e.popup?.getElement()?.querySelector('[data-balloon-dx]');
        if (btn && typeof onDXChange === 'function') {
          btn.addEventListener('click', () => onDXChange({ lat: b.lat, lon: b.lon, callsign: b.call }), { once: true });
        }
      });
      items.push(marker);
    });

    layerRef.current = items;
    return () => {
      items.forEach((l) => {
        try {
          map.removeLayer(l);
        } catch {}
      });
    };
  }, [map, enabled, opacity, balloons, lowMemoryMode, onDXChange, deLat, deLon, allUnits]);

  return { count: enabled ? balloons.length : 0 };
}
