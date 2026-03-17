import i18n from '../../lang/i18n';
import { useState, useEffect, useRef, useCallback } from 'react';

// 🌪️ Tornado Warnings layer — NWS Weather Alerts API
// Displays active tornado watches, warnings, and emergencies from the
// National Weather Service. Polygons show affected areas, color-coded
// by severity. Free API, no key required.
//
// Useful for SKYWARN, ARES/RACES, and emergency comms — see which grids
// are under active tornado alerts while monitoring SKYWARN frequencies.

export const metadata = {
  id: 'tornado-warnings',
  name: i18n.t('plugins.layers.tornadoWarnings.name'),
  description: i18n.t('plugins.layers.tornadoWarnings.description'),
  icon: '🌪️',
  category: 'hazards',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.1.0',
};

// NWS alert event types we care about, in priority order
const TORNADO_EVENTS = [
  'Tornado Emergency',
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning', // often precedes tornado warnings
];

// Color and style config per alert type
// Warnings = red outlined polygons, Watches = amber outlined polygons
const ALERT_STYLES = {
  'Tornado Emergency': {
    color: '#8B0000',
    fill: '#8B0000',
    weight: 3,
    fillOpacity: 0.5,
    icon: '‼️',
    size: 28,
    zOffset: 10200,
  },
  'Tornado Warning': {
    color: '#FF0000',
    fill: '#FF0000',
    weight: 3,
    fillOpacity: 0.5,
    icon: '🌪️',
    size: 24,
    zOffset: 10100,
  },
  'Tornado Watch': {
    color: '#FFAA00',
    fill: '#FFAA00',
    weight: 2,
    fillOpacity: 0.08,
    fillOpacity: 0.5,
    icon: '👁️',
    size: 20,
    zOffset: 10000,
  },
  'Severe Thunderstorm Warning': {
    color: '#FF8C00',
    fill: '#FF8C00',
    weight: 2,
    fillOpacity: 0.5,
    icon: '⛈️',
    size: 20,
    zOffset: 9900,
  },
};

const DEFAULT_STYLE = {
  color: '#FF6600',
  fill: '#FF6600',
  weight: 2,
  fillOpacity: 0.5,
  icon: '⚠️',
  size: 18,
  zOffset: 9800,
};

function getAlertStyle(eventName) {
  return ALERT_STYLES[eventName] || DEFAULT_STYLE;
}

// Calculate centroid of a polygon ring [[lon,lat], ...]
function polygonCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  let latSum = 0,
    lonSum = 0;
  for (const [lon, lat] of ring) {
    latSum += lat;
    lonSum += lon;
  }
  return { lat: latSum / ring.length, lon: lonSum / ring.length };
}

export function useLayer({ enabled = false, opacity = 0.7, map = null, lowMemoryMode = false }) {
  const [alertData, setAlertData] = useState([]);
  const layerItemsRef = useRef([]);
  const previousAlertIds = useRef(new Set());
  const isFirstLoad = useRef(true);

  const MAX_ALERTS = lowMemoryMode ? 30 : 150;
  const REFRESH_INTERVAL = lowMemoryMode ? 180000 : 120000;

  // Remove all layers from map
  const clearLayers = useCallback(() => {
    layerItemsRef.current.forEach((item) => {
      try {
        map?.removeLayer(item);
      } catch (e) {}
    });
    layerItemsRef.current = [];
  }, [map]);

  // Fetch tornado alerts from NWS
  useEffect(() => {
    if (!enabled) {
      setAlertData([]);
      return;
    }

    const fetchAlerts = async () => {
      try {
        const params = new URLSearchParams();
        TORNADO_EVENTS.forEach((e) => params.append('event', e));
        params.append('status', 'actual');
        const response = await fetch(`https://api.weather.gov/alerts/active?${params.toString()}`, {
          headers: {
            'User-Agent': 'OpenHamClock (https://github.com/accius/openhamclock)',
            Accept: 'application/geo+json',
          },
        });
        if (!response.ok) throw new Error(`NWS API: ${response.status}`);
        const data = await response.json();
        const alerts = (data.features || []).slice(0, MAX_ALERTS);
        setAlertData(alerts);
      } catch (err) {
        console.error('[Tornado] Fetch error:', err);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, MAX_ALERTS, REFRESH_INTERVAL]);

  // Render polygons and markers on map
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Always clear previous layers first
    clearLayers();

    if (!enabled || alertData.length === 0) return;

    const newItems = [];
    const currentAlertIds = new Set();

    alertData.forEach((feature) => {
      const props = feature.properties;
      const alertId = props.id || feature.id;
      currentAlertIds.add(alertId);

      const event = props.event || 'Unknown';
      const style = getAlertStyle(event);
      const isNew = !isFirstLoad.current && !previousAlertIds.current.has(alertId);

      const geometry = feature.geometry;
      let centroid = null;

      // Draw polygon if geometry exists
      if (geometry && geometry.coordinates) {
        const geoType = geometry.type;
        let polygonCoords;

        if (geoType === 'Polygon') {
          polygonCoords = [geometry.coordinates];
        } else if (geoType === 'MultiPolygon') {
          polygonCoords = geometry.coordinates;
        } else {
          return; // Unsupported geometry type
        }

        polygonCoords.forEach((polyRings) => {
          // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
          const latLngRings = polyRings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));

          const polygon = L.polygon(latLngRings, {
            color: style.color,
            fillColor: style.fill,
            fillOpacity: style.fillOpacity * opacity,
            weight: style.weight,
            opacity: opacity,
            dashArray: event.includes('Watch') ? '8 4' : null,
          });

          polygon.addTo(map);
          newItems.push(polygon);

          // Get centroid from first ring
          if (!centroid && polyRings[0]) {
            centroid = polygonCentroid(polyRings[0]);
          }
        });
      }

      // Skip alerts without renderable geometry
      if (!centroid) return;

      // Create centroid marker
      const icon = L.divIcon({
        className: 'tornado-warning-icon',
        html: `<div style="
          background-color: ${style.color};
          color: white;
          width: ${style.size}px;
          height: ${style.size}px;
          border-radius: ${event.includes('Watch') ? '4px' : '50%'};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${style.size * 0.5}px;
          border: 2px solid rgba(255,255,255,0.8);
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          ${isNew ? 'animation: tornado-pulse 0.6s ease-out 3;' : ''}
        ">${style.icon}</div>`,
        iconSize: [style.size, style.size],
        iconAnchor: [style.size / 2, style.size / 2],
        popupAnchor: [0, -style.size / 2],
      });

      const marker = L.marker([centroid.lat, centroid.lon], {
        icon,
        opacity,
        zIndexOffset: style.zOffset,
      }).addTo(map);

      // Format timing info
      const expires = props.expires ? new Date(props.expires) : null;
      const now = Date.now();
      const expiresIn = expires ? Math.max(0, Math.floor((expires.getTime() - now) / 60000)) : null;
      const expiresStr =
        expiresIn !== null
          ? expiresIn <= 0
            ? 'Expired'
            : expiresIn < 60
              ? `${expiresIn} min`
              : `${Math.floor(expiresIn / 60)}h ${expiresIn % 60}m`
          : 'Unknown';

      const areas = props.areaDesc || 'Unknown area';
      const sender = props.senderName || '';
      const headline = props.headline || '';
      const description = props.description || '';
      const shortDesc = description.length > 300 ? description.substring(0, 300) + '...' : description;

      const severity = props.severity || '';
      const urgency = props.urgency || '';
      const certainty = props.certainty || '';

      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 250px; max-width: 350px;">
          <div style="font-size: 14px; font-weight: bold; color: ${style.color}; margin-bottom: 6px;">
            ${isNew ? '🆕 ' : ''}${style.icon} ${event}
          </div>
          ${headline ? `<div style="font-size: 11px; font-weight: 600; margin-bottom: 8px; line-height: 1.3;">${headline}</div>` : ''}
          <table style="font-size: 11px; width: 100%; line-height: 1.4;">
            <tr><td style="white-space: nowrap; padding-right: 8px;"><b>Areas:</b></td><td>${areas}</td></tr>
            <tr><td><b>Expires in:</b></td><td style="color: ${expiresIn !== null && expiresIn <= 15 ? '#FF3300' : 'inherit'}; font-weight: ${expiresIn !== null && expiresIn <= 15 ? '700' : 'normal'};">${expiresStr}</td></tr>
            <tr><td><b>Severity:</b></td><td>${severity}</td></tr>
            <tr><td><b>Urgency:</b></td><td>${urgency}</td></tr>
            <tr><td><b>Certainty:</b></td><td>${certainty}</td></tr>
            ${sender ? `<tr><td><b>Issued by:</b></td><td>${sender}</td></tr>` : ''}
          </table>
          ${shortDesc ? `<div style="font-size: 10px; color: #aaa; margin-top: 8px; line-height: 1.4; border-top: 1px solid #333; padding-top: 6px;">${shortDesc}</div>` : ''}
          ${props.web ? `<div style="margin-top: 6px;"><a href="${props.web}" target="_blank" style="color: #00bcd4; font-size: 11px;">Full Alert →</a></div>` : ''}
        </div>
      `);

      newItems.push(marker);
    });

    previousAlertIds.current = currentAlertIds;
    if (isFirstLoad.current) isFirstLoad.current = false;

    layerItemsRef.current = newItems;

    return () => clearLayers();
  }, [enabled, alertData, map, opacity, clearLayers]);

  return {
    markers: layerItemsRef.current,
    alertCount: alertData.length,
  };
}
