import i18n from '../../lang/i18n';

import { useState, useEffect, useRef } from 'react';

// NOAA OVATION Aurora Forecast - JSON grid data
// Endpoint: /api/noaa/aurora (proxied from services.swpc.noaa.gov/json/ovation_aurora_latest.json)
// Format: { "Forecast Time": "...", "coordinates": [[lon, lat, probability], ...] }
// Grid: 360 longitudes (0-359) × 181 latitudes (-90 to 90), probability 0-100

export const metadata = {
  id: 'aurora',
  name: i18n.t('plugins.layers.aurora.name'),
  description: i18n.t('plugins.layers.aurora.description'),
  icon: '🌌',
  category: 'space-weather',
  defaultEnabled: false,
  defaultOpacity: 0.6,
  version: '2.0.0',
};

// Aurora color ramp: transparent → green → yellow → red
// Matches NOAA's official aurora visualization
function auroraCmap(probability) {
  if (probability < 4) return null; // Skip very low values

  // Normalize 4-100 to 0-1
  const t = Math.min((probability - 4) / 80, 1);

  let r, g, b, a;
  if (t < 0.25) {
    // Dark green to green
    const s = t / 0.25;
    r = 0;
    g = Math.round(80 + s * 175);
    b = Math.round(40 * (1 - s));
    a = 0.3 + s * 0.3;
  } else if (t < 0.5) {
    // Green to yellow-green
    const s = (t - 0.25) / 0.25;
    r = Math.round(s * 200);
    g = 255;
    b = 0;
    a = 0.6 + s * 0.15;
  } else if (t < 0.75) {
    // Yellow to orange
    const s = (t - 0.5) / 0.25;
    r = 255;
    g = Math.round(255 - s * 120);
    b = 0;
    a = 0.75 + s * 0.1;
  } else {
    // Orange to red
    const s = (t - 0.75) / 0.25;
    r = 255;
    g = Math.round(135 - s * 135);
    b = Math.round(s * 30);
    a = 0.85 + s * 0.15;
  }

  return { r, g, b, a };
}

function buildAuroraCanvas(coordinates) {
  // Create a 360×181 canvas (1° resolution)
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 181;
  const ctx = canvas.getContext('2d');

  // Clear to transparent
  ctx.clearRect(0, 0, 360, 181);

  const imageData = ctx.createImageData(360, 181);
  const pixels = imageData.data;

  // Process all coordinate points
  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat, prob] = coordinates[i];
    if (prob < 4) continue; // Skip negligible

    const color = auroraCmap(prob);
    if (!color) continue;

    // NOAA grid: lon 0-359, lat -90 to 90
    // Canvas: x = lon (0-359), y = 0 is +90 (north), y = 180 is -90 (south)
    const x = Math.round(lon) % 360;
    const y = 90 - Math.round(lat); // Flip: lat 90 → y 0, lat -90 → y 180

    if (x < 0 || x >= 360 || y < 0 || y >= 181) continue;

    const idx = (y * 360 + x) * 4;
    pixels[idx] = color.r;
    pixels[idx + 1] = color.g;
    pixels[idx + 2] = color.b;
    pixels[idx + 3] = Math.round(color.a * 255);
  }

  ctx.putImageData(imageData, 0, 0);

  // Scale up with a larger canvas for smoother rendering
  const smoothCanvas = document.createElement('canvas');
  smoothCanvas.width = 720;
  smoothCanvas.height = 362;
  const sctx = smoothCanvas.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, 720, 362);

  return smoothCanvas.toDataURL('image/png');
}

export function useLayer({ enabled = false, opacity = 0.6, map = null }) {
  const [overlayLayer, setOverlayLayer] = useState(null);
  const [auroraData, setAuroraData] = useState(null);
  const [forecastTime, setForecastTime] = useState(null);
  const fetchingRef = useRef(false);

  // Fetch aurora JSON data
  useEffect(() => {
    if (!enabled) return;

    const fetchAurora = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch('/api/noaa/aurora');
        if (res.ok) {
          const data = await res.json();
          if (data.coordinates && data.coordinates.length > 0) {
            setAuroraData(data.coordinates);
            setForecastTime(data['Forecast Time'] || null);
          }
        }
      } catch (err) {
        console.error('Aurora data fetch error:', err);
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchAurora();
    // Refresh every 10 minutes
    const interval = setInterval(fetchAurora, 600000);
    return () => clearInterval(interval);
  }, [enabled]);

  // Render overlay when data or map changes
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Remove existing
    if (overlayLayer) {
      try {
        map.removeLayer(overlayLayer);
      } catch (e) {}
      setOverlayLayer(null);
    }

    if (!enabled || !auroraData) return;

    try {
      const dataUrl = buildAuroraCanvas(auroraData);

      // NOAA grid: lon 0-359, lat -90 to 90
      // Leaflet bounds: [[south, west], [north, east]]
      // Shift by 180° so 0° longitude is centered properly
      // The data starts at lon=0 (Greenwich), so the image spans [0, 360) in longitude
      // We need two overlays or shift the data. Simplest: overlay from -180 to 180 with shifted image.
      // Actually, L.imageOverlay with bounds [[-90, 0], [90, 360]] works because Leaflet wraps.
      // But for proper centering, let's use [[-90, -180], [90, 180]] and shift the canvas.

      // Build a shifted canvas where lon 0-179 goes to right half, lon 180-359 goes to left half
      const shiftedCanvas = document.createElement('canvas');
      shiftedCanvas.width = 720;
      shiftedCanvas.height = 362;
      const sctx = shiftedCanvas.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';

      // Rebuild from raw data with shifted longitudes
      const rawCanvas = document.createElement('canvas');
      rawCanvas.width = 360;
      rawCanvas.height = 181;
      const rctx = rawCanvas.getContext('2d');
      rctx.clearRect(0, 0, 360, 181);
      const imageData = rctx.createImageData(360, 181);
      const pixels = imageData.data;

      for (let i = 0; i < auroraData.length; i++) {
        const [lon, lat, prob] = auroraData[i];
        if (prob < 4) continue;

        const color = auroraCmap(prob);
        if (!color) continue;

        // Shift longitude: NOAA 0-359 → map -180 to 179
        let x = Math.round(lon);
        x = x >= 180 ? x - 180 : x + 180; // Shift so -180 maps to pixel 0
        x = x % 360;

        const y = 90 - Math.round(lat);
        if (x < 0 || x >= 360 || y < 0 || y >= 181) continue;

        const idx = (y * 360 + x) * 4;
        pixels[idx] = color.r;
        pixels[idx + 1] = color.g;
        pixels[idx + 2] = color.b;
        pixels[idx + 3] = Math.round(color.a * 255);
      }

      rctx.putImageData(imageData, 0, 0);
      sctx.drawImage(rawCanvas, 0, 0, 720, 362);

      const shiftedUrl = shiftedCanvas.toDataURL('image/png');

      const overlay = L.imageOverlay(
        shiftedUrl,
        [
          [-90, -180],
          [90, 180],
        ],
        {
          opacity: opacity,
          zIndex: 210,
          interactive: false,
        },
      );

      overlay.addTo(map);
      setOverlayLayer(overlay);
    } catch (err) {
      console.error('Aurora overlay render error:', err);
    }

    return () => {
      if (overlayLayer && map) {
        try {
          map.removeLayer(overlayLayer);
        } catch (e) {}
      }
    };
  }, [enabled, auroraData, map]);

  // Update opacity
  useEffect(() => {
    if (overlayLayer) {
      overlayLayer.setOpacity(opacity);
    }
  }, [opacity, overlayLayer]);

  return {
    layer: overlayLayer,
    forecastTime,
    refresh: () => {
      setAuroraData(null);
      fetchingRef.current = false;
    },
  };
}
