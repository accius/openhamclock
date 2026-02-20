/**
 * Great Circle Path Plugin
 * Draws the short-path and long-path great circle between DE and DX stations
 */
import { useState, useEffect, useRef } from 'react';
import { getGreatCirclePoints, replicatePath, calculateBearing, calculateDistance } from '../../utils/geo.js';

export const metadata = {
  id: 'great-circle',
  name: 'DE/DX Great Circle',
  description: 'Short-path and long-path great circle between DE and DX',
  icon: '🌐',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.8,
  version: '1.0.0',
};

/**
 * Compute the long-path great circle arc by routing through the antipode
 * of the short-path midpoint, reusing getGreatCirclePoints for both halves.
 */
function getLongPathPoints(lat1, lon1, lat2, lon2) {
  // Get short-path midpoint
  const spPoints = getGreatCirclePoints(lat1, lon1, lat2, lon2, 2);
  const mid = spPoints[1];
  // Antipode of the midpoint lies on the long-path side of the great circle
  const antiLat = -mid[0];
  const antiLon = mid[1] > 0 ? mid[1] - 180 : mid[1] + 180;
  // Two short-path segments that together form the long path
  const seg1 = getGreatCirclePoints(lat1, lon1, antiLat, antiLon, 100);
  const seg2 = getGreatCirclePoints(antiLat, antiLon, lat2, lon2, 100);
  return seg1.concat(seg2.slice(1));
}

function readLocations() {
  let de = null;
  let dx = null;
  try {
    const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
    if (cfg.location) de = cfg.location;
  } catch (e) {}
  try {
    dx = JSON.parse(localStorage.getItem('openhamclock_dxLocation') || 'null');
  } catch (e) {}
  return { de, dx };
}

export function useLayer({ enabled = false, opacity = 0.8, map = null }) {
  const [locations, setLocations] = useState(() => readLocations());
  const layersRef = useRef([]);

  // Poll localStorage for location changes
  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      const { de, dx } = readLocations();
      setLocations((prev) => {
        if (!de || !dx) return prev;
        if (prev.de?.lat === de.lat && prev.de?.lon === de.lon && prev.dx?.lat === dx.lat && prev.dx?.lon === dx.lon) {
          return prev;
        }
        return { de, dx };
      });
    };

    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, [enabled]);

  // Render paths
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Remove old layers
    layersRef.current.forEach((l) => {
      try {
        map.removeLayer(l);
      } catch (e) {}
    });
    layersRef.current = [];

    const { de, dx } = locations;
    if (!enabled || !de || !dx) return;

    const sp = Math.round(calculateBearing(de.lat, de.lon, dx.lat, dx.lon));
    const lp = (sp + 180) % 360;
    const km = Math.round(calculateDistance(de.lat, de.lon, dx.lat, dx.lon));
    const distStr = (() => {
      try {
        const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
        if (cfg.units === 'metric') return `${km.toLocaleString()} km`;
      } catch (e) {}
      return `${Math.round(km * 0.621371).toLocaleString()} mi`;
    })();

    const popupContent = `
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
        <b>Great Circle Path</b><br>
        SP: ${sp}° &nbsp; LP: ${lp}°<br>
        Distance: ${distStr}
      </div>
    `;

    const tooltipOpts = { sticky: true, direction: 'top', offset: [0, -10] };

    // Short path — solid cyan line (replicated across world copies)
    const spPoints = getGreatCirclePoints(de.lat, de.lon, dx.lat, dx.lon, 100);
    replicatePath(spPoints).forEach((copy) => {
      const spLine = L.polyline(copy, {
        color: '#00d4ff',
        weight: 2.5,
        opacity: opacity,
        smoothFactor: 1,
      });
      spLine.bindTooltip(popupContent, tooltipOpts);
      spLine.addTo(map);
      layersRef.current.push(spLine);
    });

    // Long path — dashed purple line (replicated across world copies)
    const lpPoints = getLongPathPoints(de.lat, de.lon, dx.lat, dx.lon);
    if (lpPoints.length > 0) {
      replicatePath(lpPoints).forEach((copy) => {
        const lpLine = L.polyline(copy, {
          color: '#b388ff',
          weight: 1.5,
          opacity: opacity * 0.5,
          dashArray: '8, 6',
          smoothFactor: 1,
        });
        lpLine.bindTooltip(popupContent, tooltipOpts);
        lpLine.addTo(map);
        layersRef.current.push(lpLine);
      });
    }

    return () => {
      layersRef.current.forEach((l) => {
        try {
          map.removeLayer(l);
        } catch (e) {}
      });
      layersRef.current = [];
    };
  }, [enabled, locations, map, opacity]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled && map) {
      layersRef.current.forEach((l) => {
        try {
          map.removeLayer(l);
        } catch (e) {}
      });
      layersRef.current = [];
    }
  }, [enabled, map]);

  return { layers: layersRef.current };
}
