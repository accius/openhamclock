import i18n from '../../lang/i18n';
import { useState, useEffect, useRef } from 'react';

// 🔥 Wildfires layer — NASA EONET (Earth Observatory Natural Events Tracker)
// Free, no API key, GeoJSON-like response with coordinates for active fires worldwide.

export const metadata = {
  id: 'wildfires',
  name: i18n.t('plugins.layers.wildfires.name'),
  description: i18n.t('plugins.layers.wildfires.description'),
  icon: '🔥',
  category: 'hazards',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

export function useLayer({ enabled = false, opacity = 0.9, map = null, lowMemoryMode = false }) {
  const [markersRef, setMarkersRef] = useState([]);
  const [fireData, setFireData] = useState([]);
  const previousFireIds = useRef(new Set());
  const isFirstLoad = useRef(true);

  const MAX_FIRES = lowMemoryMode ? 30 : 150;
  const REFRESH_INTERVAL = lowMemoryMode ? 900000 : 600000; // 15 min vs 10 min

  // Fetch wildfire data from NASA EONET
  useEffect(() => {
    if (!enabled) return;

    const fetchWildfires = async () => {
      try {
        const response = await fetch(
          `https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=${MAX_FIRES}`,
        );
        const data = await response.json();
        const fires = (data.events || []).slice(0, MAX_FIRES);
        setFireData(fires);
      } catch (err) {
        console.error('Wildfire data fetch error:', err);
      }
    };

    fetchWildfires();
    const interval = setInterval(fetchWildfires, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, MAX_FIRES, REFRESH_INTERVAL]);

  // Render markers on map
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    markersRef.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch (e) {}
    });
    setMarkersRef([]);

    if (!enabled || fireData.length === 0) return;

    const newMarkers = [];
    const currentFireIds = new Set();

    fireData.forEach((event) => {
      const eventId = event.id;
      currentFireIds.add(eventId);

      // EONET events can have multiple geometry entries (fire moves over time)
      // Use the most recent geometry point
      const geom = event.geometry;
      if (!geom || geom.length === 0) return;

      // Get the latest point
      const latest = geom[geom.length - 1];
      if (!latest || !latest.coordinates) return;

      const lon = latest.coordinates[0];
      const lat = latest.coordinates[1];

      if (isNaN(lat) || isNaN(lon)) return;

      const isNew = !isFirstLoad.current && !previousFireIds.current.has(eventId);
      const title = event.title || 'Unknown Fire';

      // Determine fire age for color intensity
      const latestDate = latest.date ? new Date(latest.date) : null;
      const ageHours = latestDate ? (Date.now() - latestDate.getTime()) / 3600000 : 999;

      // Color: brighter for more recent fires
      let color, size;
      if (ageHours < 6) {
        color = '#FF2200';
        size = 20;
      } else if (ageHours < 24) {
        color = '#FF6600';
        size = 18;
      } else if (ageHours < 72) {
        color = '#FF9900';
        size = 16;
      } else {
        color = '#CC7700';
        size = 14;
      }

      // Fire icon SVG
      const fireIcon = `
        <svg width="${size * 0.65}" height="${size * 0.65}" viewBox="0 0 24 24" fill="white">
          <path d="M12 23c-4.97 0-9-2.69-9-6 0-2.16 1.33-3.87 2.8-5.18C7.14 10.56 8 9 8 7c0-.55.22-1.05.58-1.42C9.62 8.44 11 10.86 11 12c0 .5.1.97.28 1.4L12.5 11l1.22 2.4C13.9 12.97 14 12.5 14 12c0-1.14.58-2.56 1.42-3.42.36.37.58.87.58 1.42 0 2-0.86 3.56-2.2 4.82C12.33 16.13 11 17.84 11 20h2c0-1.66.86-3 2.2-4.18C16.67 14.56 18 12.85 18 11c0-3.31-2.69-6-6-6-1.66 0-3.16.67-4.24 1.76C7.93 5.56 8.5 3.83 10 2c-5 2.69-7 8.07-7 11 0 5.52 4.03 10 9 10z"/>
        </svg>
      `;

      const icon = L.divIcon({
        className: 'wildfire-icon',
        html: `<div style="
          background-color: ${color};
          color: white;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          ${isNew ? 'animation: wildfire-pulse 0.8s ease-out;' : ''}
        ">${fireIcon}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, 0],
      });

      const marker = L.marker([lat, lon], {
        icon,
        opacity,
        zIndexOffset: 9000,
      }).addTo(map);

      // Format dates
      const startDate = event.geometry[0]?.date ? new Date(event.geometry[0].date) : null;
      const latestStr = latestDate ? latestDate.toLocaleString() : 'Unknown';
      const startStr = startDate ? startDate.toLocaleDateString() : 'Unknown';
      const ageStr =
        ageHours < 1
          ? 'Just now'
          : ageHours < 24
            ? `${Math.floor(ageHours)} hr ago`
            : `${Math.floor(ageHours / 24)} days ago`;

      // Source links
      const sources = (event.sources || [])
        .map((s) => `<a href="${s.url}" target="_blank" style="color: var(--accent-cyan); font-size: 11px;">${s.id}</a>`)
        .join(' · ');

      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 220px;">
          <div style="font-size: 14px; font-weight: bold; color: ${color}; margin-bottom: 8px;">
            ${isNew ? '🆕 ' : ''}🔥 ${title}
          </div>
          <table style="font-size: 12px; width: 100%;">
            <tr><td><b>Started:</b></td><td>${startStr}</td></tr>
            <tr><td><b>Last Update:</b></td><td>${latestStr}</td></tr>
            <tr><td><b>Age:</b></td><td>${ageStr}</td></tr>
            <tr><td><b>Reports:</b></td><td>${geom.length} detection${geom.length !== 1 ? 's' : ''}</td></tr>
          </table>
          ${sources ? `<div style="margin-top: 6px;">${sources}</div>` : ''}
        </div>
      `);

      newMarkers.push(marker);
    });

    previousFireIds.current = currentFireIds;
    if (isFirstLoad.current) isFirstLoad.current = false;

    setMarkersRef(newMarkers);

    return () => {
      newMarkers.forEach((marker) => {
        try {
          map.removeLayer(marker);
        } catch (e) {}
      });
    };
  }, [enabled, fireData, map, opacity]);

  return {
    markers: markersRef,
    fireCount: fireData.length,
  };
}
