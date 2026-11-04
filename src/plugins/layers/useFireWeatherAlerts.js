/**
 * 🔥 Fire weather alerts layer — NWS Red Flag Warnings (solid red) and Fire
 * Weather Watches (dashed amber) as fire-zone polygons, from
 * /api/fire-weather/alerts. Complements the Wildfires layer (actual fires)
 * with where conditions are primed for them. Shares its poll with the Fire
 * Weather panel through sharedFetcher.
 */
import i18n from '../../lang/i18n';
import { useEffect, useRef } from 'react';
import { esc, sanitizeUrl } from '../../utils/escapeHtml.js';
import { useFireWeather } from '../../hooks/useFireWeather.js';
import { formatDistance } from '../../utils/geo.js';

export const metadata = {
  id: 'fire-weather-alerts',
  name: i18n.t('plugins.layers.fireWeatherAlerts.name'),
  description: i18n.t('plugins.layers.fireWeatherAlerts.description'),
  icon: '🚩',
  category: 'hazards',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0',
};

// Data-driven alert colours (NWS convention: Red Flag = red, watch = amber)
export const FIRE_ALERT_STYLES = {
  'Red Flag Warning': { color: '#ff2d2d', fillOpacity: 0.3, weight: 2, dash: null, short: 'RFW' },
  'Fire Weather Watch': { color: '#ffb020', fillOpacity: 0.18, weight: 2, dash: '8 5', short: 'FWW' },
};
const DEFAULT_STYLE = { color: '#ff7a00', fillOpacity: 0.2, weight: 2, dash: null, short: 'FW' };

export const fireAlertStyle = (event) => FIRE_ALERT_STYLES[event] || DEFAULT_STYLE;

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

function popupHtml(alert, units) {
  const st = fireAlertStyle(alert.event);
  const zones = alert.zoneNames?.length
    ? alert.zoneNames.slice(0, 8).join(', ') + (alert.zoneNames.length > 8 ? '…' : '')
    : alert.areaDesc || '';
  return `
    <div style="font-family: var(--font-mono); min-width: 240px; max-width: 340px;">
      <div style="font-size: 13px; font-weight: bold; color: ${st.color}; margin-bottom: 6px;">🚩 ${esc(alert.event)}</div>
      ${alert.headline ? `<div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; line-height: 1.3;">${esc(alert.headline)}</div>` : ''}
      <table style="font-size: 11px; width: 100%; line-height: 1.4;">
        <tr><td style="white-space:nowrap;padding-right:8px;"><b>Areas:</b></td><td>${esc(zones)}</td></tr>
        <tr><td><b>Starts:</b></td><td>${esc(fmtTime(alert.onset))}</td></tr>
        <tr><td><b>Ends:</b></td><td>${esc(fmtTime(alert.ends))}</td></tr>
        ${alert.km != null ? `<tr><td><b>From DE:</b></td><td>${esc(formatDistance(alert.km, units))} · ${Math.round(alert.bearing)}°</td></tr>` : ''}
        ${alert.senderName ? `<tr><td><b>Issued by:</b></td><td>${esc(alert.senderName)}</td></tr>` : ''}
      </table>
      ${alert.description ? `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 6px; line-height: 1.4; border-top: 1px solid var(--border-color); padding-top: 6px; max-height: 120px; overflow:auto;">${esc(alert.description)}</div>` : ''}
      ${alert.web ? `<div style="margin-top: 6px;"><a href="${sanitizeUrl(alert.web)}" target="_blank" rel="noopener" style="color: var(--accent-cyan); font-size: 11px;">Full alert →</a></div>` : ''}
    </div>`;
}

export function useLayer({
  enabled = false,
  opacity = 0.7,
  map = null,
  deLat = null,
  deLon = null,
  allUnits = null,
  lowMemoryMode = false,
}) {
  const { alerts } = useFireWeather(enabled, deLat, deLon);
  const groupRef = useRef(null);
  const units = allUnits?.dist || 'metric';

  useEffect(() => {
    if (!map || typeof L === 'undefined') return undefined;
    if (groupRef.current) {
      try {
        map.removeLayer(groupRef.current);
      } catch (e) {}
      groupRef.current = null;
    }
    if (!enabled || !alerts.length) return undefined;

    const group = L.layerGroup();
    const max = lowMemoryMode ? 40 : 200;

    for (const alert of alerts.slice(0, max)) {
      const st = fireAlertStyle(alert.event);
      const g = alert.geometry;
      if (g && g.coordinates) {
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const latLngs = polys.map((rings) => rings.map((ring) => ring.map(([lon, lat]) => [lat, lon])));
        if (latLngs.length) {
          L.polygon(latLngs, {
            color: st.color,
            weight: st.weight,
            opacity,
            fillColor: st.color,
            fillOpacity: st.fillOpacity * opacity,
            dashArray: st.dash,
          })
            .bindPopup(popupHtml(alert, units), { maxWidth: 360 })
            .addTo(group);
        }
      }
      if (alert.centroid) {
        const icon = L.divIcon({
          className: 'fire-weather-alert-icon',
          html: `<div style="background:${st.color};color:#111;font:700 9px/16px var(--font-mono);text-align:center;width:30px;height:16px;border-radius:3px;border:1px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.5);">${st.short}</div>`,
          iconSize: [30, 16],
          iconAnchor: [15, 8],
          popupAnchor: [0, -8],
        });
        L.marker([alert.centroid.lat, alert.centroid.lon], { icon, opacity, zIndexOffset: 9000 })
          .bindPopup(popupHtml(alert, units), { maxWidth: 360 })
          .addTo(group);
      }
    }

    group.addTo(map);
    groupRef.current = group;
    return () => {
      try {
        map.removeLayer(group);
      } catch (e) {}
      if (groupRef.current === group) groupRef.current = null;
    };
  }, [map, enabled, alerts, opacity, units, lowMemoryMode]);

  return { alertCount: alerts.length };
}
