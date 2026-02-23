import i18n from '../../lang/i18n';
import { useState, useEffect, useRef } from 'react';

// 🌊 Floods & Severe Storms layer — NASA EONET
// Covers floods, severe storms, and related hydrological events worldwide.
// Free, no API key required.

export const metadata = {
  id: 'floods',
  name: i18n.t('plugins.layers.floods.name'),
  description: i18n.t('plugins.layers.floods.description'),
  icon: '🌊',
  category: 'hazards',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

export function useLayer({ enabled = false, opacity = 0.9, map = null, lowMemoryMode = false }) {
  const [markersRef, setMarkersRef] = useState([]);
  const [floodData, setFloodData] = useState([]);
  const previousEventIds = useRef(new Set());
  const isFirstLoad = useRef(true);

  const MAX_EVENTS = lowMemoryMode ? 30 : 150;
  const REFRESH_INTERVAL = lowMemoryMode ? 900000 : 600000; // 15 min vs 10 min

  // Fetch flood + severe storm data from NASA EONET
  useEffect(() => {
    if (!enabled) return;

    const fetchFloods = async () => {
      try {
        // Fetch both floods and severe storms in parallel
        const [floodsRes, stormsRes] = await Promise.all([
          fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?category=floods&status=open&limit=${MAX_EVENTS}`),
          fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&limit=${Math.floor(MAX_EVENTS / 2)}`),
        ]);

        const [floodsData, stormsData] = await Promise.all([floodsRes.json(), stormsRes.json()]);

        const combined = [...(floodsData.events || []), ...(stormsData.events || [])].slice(0, MAX_EVENTS);
        setFloodData(combined);
      } catch (err) {
        console.error('Flood/storm data fetch error:', err);
      }
    };

    fetchFloods();
    const interval = setInterval(fetchFloods, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, MAX_EVENTS, REFRESH_INTERVAL]);

  // Render markers on map
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    markersRef.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch (e) {}
    });
    setMarkersRef([]);

    if (!enabled || floodData.length === 0) return;

    const newMarkers = [];
    const currentEventIds = new Set();

    floodData.forEach((event) => {
      const eventId = event.id;
      currentEventIds.add(eventId);

      const geom = event.geometry;
      if (!geom || geom.length === 0) return;

      const latest = geom[geom.length - 1];
      if (!latest || !latest.coordinates) return;

      const lon = latest.coordinates[0];
      const lat = latest.coordinates[1];

      if (isNaN(lat) || isNaN(lon)) return;

      const isNew = !isFirstLoad.current && !previousEventIds.current.has(eventId);
      const title = event.title || 'Unknown Event';

      // Determine event type from categories
      const categories = (event.categories || []).map((c) => c.id);
      const isFlood = categories.includes('floods');
      const isStorm = categories.includes('severeStorms');

      const latestDate = latest.date ? new Date(latest.date) : null;
      const ageHours = latestDate ? (Date.now() - latestDate.getTime()) / 3600000 : 999;

      // Color scheme: blue tones for floods, purple tones for storms
      let color, size, typeIcon, typeLabel;
      if (isFlood) {
        typeLabel = 'Flood';
        typeIcon = '🌊';
        if (ageHours < 6) {
          color = '#0066FF';
          size = 20;
        } else if (ageHours < 24) {
          color = '#0088DD';
          size = 18;
        } else if (ageHours < 72) {
          color = '#2299BB';
          size = 16;
        } else {
          color = '#337799';
          size = 14;
        }
      } else {
        typeLabel = 'Severe Storm';
        typeIcon = '⛈️';
        if (ageHours < 6) {
          color = '#8800DD';
          size = 20;
        } else if (ageHours < 24) {
          color = '#7733BB';
          size = 18;
        } else if (ageHours < 72) {
          color = '#665599';
          size = 16;
        } else {
          color = '#554477';
          size = 14;
        }
      }

      // Water/storm icon SVG
      const waveSvg = isFlood
        ? `<svg width="${size * 0.6}" height="${size * 0.6}" viewBox="0 0 24 24" fill="white">
            <path d="M2 16c1.5-1.5 3-2 4.5-2s3 .5 4.5 2c1.5 1.5 3 2 4.5 2s3-.5 4.5-2"/>
            <path d="M2 12c1.5-1.5 3-2 4.5-2s3 .5 4.5 2c1.5 1.5 3 2 4.5 2s3-.5 4.5-2" opacity="0.6"/>
            <path d="M2 20c1.5-1.5 3-2 4.5-2s3 .5 4.5 2c1.5 1.5 3 2 4.5 2s3-.5 4.5-2" opacity="0.4"/>
          </svg>`
        : `<svg width="${size * 0.6}" height="${size * 0.6}" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L8 10h8L12 2z"/>
            <path d="M12 10L7 20h10L12 10z" opacity="0.7"/>
          </svg>`;

      const icon = L.divIcon({
        className: 'flood-icon',
        html: `<div style="
          background-color: ${color};
          color: white;
          width: ${size}px;
          height: ${size}px;
          border-radius: ${isFlood ? '50%' : '4px'};
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        ">${waveSvg}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, 0],
      });

      const marker = L.marker([lat, lon], {
        icon,
        opacity,
        zIndexOffset: 8500,
      }).addTo(map);

      const startDate = event.geometry[0]?.date ? new Date(event.geometry[0].date) : null;
      const latestStr = latestDate ? latestDate.toLocaleString() : 'Unknown';
      const startStr = startDate ? startDate.toLocaleDateString() : 'Unknown';
      const ageStr =
        ageHours < 1
          ? 'Just now'
          : ageHours < 24
            ? `${Math.floor(ageHours)} hr ago`
            : `${Math.floor(ageHours / 24)} days ago`;

      const sources = (event.sources || [])
        .map((s) => `<a href="${s.url}" target="_blank" style="color: var(--accent-cyan); font-size: 11px;">${s.id}</a>`)
        .join(' · ');

      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 220px;">
          <div style="font-size: 14px; font-weight: bold; color: ${color}; margin-bottom: 8px;">
            ${isNew ? '🆕 ' : ''}${typeIcon} ${title}
          </div>
          <table style="font-size: 12px; width: 100%;">
            <tr><td><b>Type:</b></td><td>${typeLabel}</td></tr>
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

    previousEventIds.current = currentEventIds;
    if (isFirstLoad.current) isFirstLoad.current = false;

    setMarkersRef(newMarkers);

    return () => {
      newMarkers.forEach((marker) => {
        try {
          map.removeLayer(marker);
        } catch (e) {}
      });
    };
  }, [enabled, floodData, map, opacity]);

  return {
    markers: markersRef,
    eventCount: floodData.length,
  };
}
