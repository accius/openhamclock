import { useState, useEffect, useRef } from 'react';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';

/**
 * VOACAP-Style Propagation Heatmap Plugin v1.0.0
 *
 * Shows color-coded propagation predictions from your DE location to
 * the entire world for a selected HF band — green (good), yellow
 * (marginal), red (poor). Inspired by the original HamClock VOACAP overlay.
 *
 * Data source: /api/propagation/heatmap (server-side, uses ITU-R P.533-style model)
 * Update interval: 5 minutes
 */

export const metadata = {
  id: 'voacap-heatmap',
  name: 'VOACAP Propagation Map',
  description: 'Color-coded HF propagation predictions from your station to the world',
  icon: '🌐',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.55,
  version: '1.0.0',
};

// HF bands: label, frequency in MHz
const BANDS = [
  { label: '160m', freq: 1.8 },
  { label: '80m', freq: 3.5 },
  { label: '40m', freq: 7 },
  { label: '30m', freq: 10 },
  { label: '20m', freq: 14 },
  { label: '17m', freq: 18 },
  { label: '15m', freq: 21 },
  { label: '12m', freq: 24 },
  { label: '10m', freq: 28 },
];

// Reliability to color: HamClock-style wide spectrum
// magenta (0%) → red → orange → yellow → green (100%)
// Cubic smoothstep — smooth interpolation between edge0 and edge1, with zero
// first-derivative at both ends. Eliminates the visible "step" you'd get from
// a linear ramp between bands.
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function reliabilityColor(r) {
  if (r >= 99) return { color: 'rgb(0,220,0)', alpha: 0.85 };

  let red, green, blue;
  if (r < 25) {
    // Below VOACAP's usefully-modelled range. Color stays as a dim
    // red-purple but the alpha will be tapered to ~0 (see below), so the
    // exact RGB barely matters — it just sets the hue you see at the very
    // edge of the predicted region.
    const t = r / 25;
    red = 40 + Math.round(t * 180);
    green = 30;
    blue = 80 - Math.round(t * 80);
  } else if (r < 40) {
    // Low: Red → Orange
    const t = (r - 25) / 15;
    red = 220 + Math.round(t * 35);
    green = Math.round(t * 120);
    blue = 0;
  } else if (r < 60) {
    // Fair: Orange → Yellow
    const t = (r - 40) / 20;
    red = 255;
    green = 120 + Math.round(t * 135);
    blue = 0;
  } else if (r < 80) {
    // Good: Yellow → Yellow-Green
    const t = (r - 60) / 20;
    red = 255 - Math.round(t * 140);
    green = 255;
    blue = 0;
  } else {
    // Excellent: Yellow-Green → Green
    const t = (r - 80) / 20;
    red = 115 - Math.round(t * 115);
    green = 220 + Math.round(t * 35);
    blue = 0;
  }

  // Smooth alpha taper from 0 → 0.85 across r=0..40 (#990 round 3).
  // Previously the alpha jumped from 0.25 at r<10 to 0.75 at r=40 in
  // discrete bands, which read as a hard vertical cliff at VOACAP's
  // useful-range boundary. A cubic smoothstep makes the edge fade
  // gradually into the base map — visually a real propagation map rather
  // than a stamped-out region.
  const alpha = smoothstep(0, 40, r) * 0.85;
  return { color: `rgb(${red},${green},${blue})`, alpha };
}

export function useLayer({ map, enabled, opacity, locator }) {
  const [selectedBand, setSelectedBand] = useState(() => {
    const saved = localStorage.getItem('voacap-heatmap-band');
    return saved ? parseInt(saved) : 4; // Default: 20m (index 4)
  });
  const [gridSize, setGridSize] = useState(() => {
    const saved = localStorage.getItem('voacap-heatmap-grid');
    return saved ? parseInt(saved) : 5;
  });
  const [propMode, setPropMode] = useState(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
      return cfg.propagation?.mode || 'SSB';
    } catch {
      return 'SSB';
    }
  });
  const [propPower, setPropPower] = useState(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
      return cfg.propagation?.power || 100;
    } catch {
      return 100;
    }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const layersRef = useRef([]);
  const controlRef = useRef(null);
  const intervalRef = useRef(null);

  // Listen for config changes (fired by saveConfig in config.js)
  useEffect(() => {
    const onConfigChange = (e) => {
      const cfg = e.detail || {};
      const newMode = cfg.propagation?.mode || 'SSB';
      const newPower = cfg.propagation?.power || 100;
      setPropMode((prev) => (prev !== newMode ? newMode : prev));
      setPropPower((prev) => (prev !== newPower ? newPower : prev));
    };

    window.addEventListener('openhamclock-config-change', onConfigChange);
    return () => window.removeEventListener('openhamclock-config-change', onConfigChange);
  }, []);

  // Parse DE location from locator grid square
  const deLocation = (() => {
    if (!locator || locator.length < 4) return null;
    const g = locator.toUpperCase();
    const lon = (g.charCodeAt(0) - 65) * 20 - 180;
    const lat = (g.charCodeAt(1) - 65) * 10 - 90;
    const lonMin = parseInt(g[2]) * 2;
    const latMin = parseInt(g[3]) * 1;
    return { lat: lat + latMin + 0.5, lon: lon + lonMin + 1 };
  })();

  // Fetch heatmap data
  useEffect(() => {
    if (!enabled || !deLocation) return;

    const fetchData = async () => {
      const band = BANDS[selectedBand];
      if (!band) return;

      setLoading(true);
      try {
        // Round to whole degrees — propagation doesn't differ within 1°,
        // and identical URLs share server + browser + CDN caches
        const url = `/api/propagation/heatmap?deLat=${Math.round(deLocation.lat)}&deLon=${Math.round(deLocation.lon)}&freq=${band.freq}&grid=${gridSize}&mode=${propMode}&power=${propPower}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          setData(json);
          setLastFetch(Date.now());
        }
      } catch (err) {
        console.error('[VOACAP Heatmap] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    intervalRef.current = setInterval(fetchData, 5 * 60 * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, deLocation?.lat, deLocation?.lon, selectedBand, gridSize, propMode, propPower]);

  // Create control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    // Avoid duplicate controls
    if (controlRef.current) {
      try {
        map.removeControl(controlRef.current);
      } catch (e) {}
      controlRef.current = null;
    }

    const VOACAPControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const container = L.DomUtil.create('div', 'voacap-heatmap-control', panelWrapper);

        const bandOptions = BANDS.map(
          (b, i) => `<option value="${i}" ${i === selectedBand ? 'selected' : ''}>${b.label} (${b.freq} MHz)</option>`,
        ).join('');

        const gridOptions = [5, 10, 15, 20]
          .map((g) => `<option value="${g}" ${g === gridSize ? 'selected' : ''}>${g}°</option>`)
          .join('');

        const modeOptions = ['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'AM', 'FM']
          .map((m) => `<option value="${m}" ${m === propMode ? 'selected' : ''}>${m}</option>`)
          .join('');

        const powerOptions = [5, 10, 25, 50, 100, 200, 400, 500, 750, 1000, 1500]
          .map((p) => `<option value="${p}" ${p === propPower ? 'selected' : ''}>${p}W</option>`)
          .join('');

        container.innerHTML = `
            <div class="floating-panel-header">🌐 VOACAP Heatmap</div>

              <div style="margin-bottom: 6px;">
                <label style="color: var(--text-secondary); font-size: 10px;">Band</label>
                <select id="voacap-band-select" style="
                  width: 100%; margin-top: 2px; padding: 4px;
                  background: var(--bg-tertiary); color: var(--text-primary);
                  border: 1px solid var(--border-color); border-radius: 3px;
                  font-family: var(--font-mono); font-size: 11px;
                ">${bandOptions}</select>
              </div>
              <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                <div style="flex: 1;">
                  <label style="color: var(--text-secondary); font-size: 10px;">Mode</label>
                  <select id="voacap-mode-select" style="
                    width: 100%; margin-top: 2px; padding: 4px;
                    background: var(--bg-tertiary); color: var(--text-primary);
                    border: 1px solid var(--border-color); border-radius: 3px;
                    font-family: var(--font-mono); font-size: 11px;
                  ">${modeOptions}</select>
                </div>
                <div style="flex: 1;">
                  <label style="color: var(--text-secondary); font-size: 10px;">Power</label>
                  <select id="voacap-power-select" style="
                    width: 100%; margin-top: 2px; padding: 4px;
                    background: var(--bg-tertiary); color: var(--text-primary);
                    border: 1px solid var(--border-color); border-radius: 3px;
                    font-family: var(--font-mono); font-size: 11px;
                  ">${powerOptions}</select>
                </div>
              </div>
              <div style="margin-bottom: 8px;">
                <label style="color: var(--text-secondary); font-size: 10px;">Grid Resolution</label>
                <select id="voacap-grid-select" style="
                  width: 100%; margin-top: 2px; padding: 4px;
                  background: var(--bg-tertiary); color: var(--text-primary);
                  border: 1px solid var(--border-color); border-radius: 3px;
                  font-family: var(--font-mono); font-size: 11px;
                ">${gridOptions}</select>
              </div>
              <div style="
                display: flex; justify-content: space-between; align-items: center;
                background: var(--bg-tertiary); border-radius: 4px; padding: 4px 6px;
              ">
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(40,30,80,0.5); border-radius: 2px;" title="< 10% reliability"></span>
                <span style="color: var(--text-secondary); font-size: 9px;">Poor</span>
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(255,80,0,0.9); border-radius: 2px;"></span>
                <span style="color: var(--text-secondary); font-size: 9px;">Low</span>
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(255,255,0,0.9); border-radius: 2px;"></span>
                <span style="color: var(--text-secondary); font-size: 9px;">Fair</span>
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(0,220,0,0.9); border-radius: 2px;"></span>
                <span style="color: var(--text-secondary); font-size: 9px;">Good</span>
              </div>
              <div id="voacap-status" style="color: var(--text-muted); font-size: 9px; margin-top: 6px; text-align: center;">
                ${loading ? 'Loading...' : data ? `${data.mode || 'SSB'} ${data.power || 100}W | SFI: ${data.solarData?.sfi} K: ${data.solarData?.kIndex}` : 'Ready'}
              </div>
        `;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return panelWrapper;
      },
    });

    const control = new VOACAPControl();
    map.addControl(control);
    controlRef.current = control;

    // Helper to update both plugin state AND global config in localStorage
    const updateGlobalConfig = (mode, power) => {
      try {
        const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
        if (!cfg.propagation) cfg.propagation = {};
        cfg.propagation.mode = mode;
        cfg.propagation.power = power;
        localStorage.setItem('openhamclock_config', JSON.stringify(cfg));
        // Don't dispatch event here — we're already updating local state directly
      } catch (e) {}
    };

    // Wire up event handlers after DOM is ready
    setTimeout(() => {
      const container = document.querySelector('.voacap-heatmap-control');
      if (container) {
        // Apply saved position
        const saved = localStorage.getItem('voacap-heatmap-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch (e) {}
        }

        makeDraggable(container, 'voacap-heatmap-position', { snap: 5 });
        addMinimizeToggle(container, 'voacap-heatmap-position', {
          contentClassName: 'voacap-panel-content',
          buttonClassName: 'voacap-minimize-btn',
        });
      }

      const bandSelect = document.getElementById('voacap-band-select');
      const gridSelect = document.getElementById('voacap-grid-select');
      const modeSelect = document.getElementById('voacap-mode-select');
      const powerSelect = document.getElementById('voacap-power-select');

      if (bandSelect) {
        bandSelect.addEventListener('change', (e) => {
          const val = parseInt(e.target.value);
          setSelectedBand(val);
          localStorage.setItem('voacap-heatmap-band', val);
        });
      }
      if (gridSelect) {
        gridSelect.addEventListener('change', (e) => {
          const val = parseInt(e.target.value);
          setGridSize(val);
          localStorage.setItem('voacap-heatmap-grid', val);
        });
      }
      if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          setPropMode(val);
          updateGlobalConfig(val, propPower);
        });
      }
      if (powerSelect) {
        powerSelect.addEventListener('change', (e) => {
          const val = parseFloat(e.target.value);
          setPropPower(val);
          updateGlobalConfig(propMode, val);
        });
      }
    }, 150);
  }, [enabled, map]);

  // Update status text and sync panel dropdowns when mode/power change
  useEffect(() => {
    if (!enabled) return;

    const statusEl = document.getElementById('voacap-status');
    if (statusEl) {
      if (loading) {
        statusEl.textContent = 'Loading...';
      } else if (data) {
        statusEl.textContent = `${data.mode || 'SSB'} ${data.power || 100}W | SFI: ${data.solarData?.sfi} K: ${data.solarData?.kIndex}`;
      }
    }

    // Sync dropdowns if changed externally (e.g. from Settings panel)
    const modeSelect = document.getElementById('voacap-mode-select');
    const powerSelect = document.getElementById('voacap-power-select');
    if (modeSelect && modeSelect.value !== propMode) modeSelect.value = propMode;
    if (powerSelect && parseFloat(powerSelect.value) !== propPower) powerSelect.value = propPower;
  }, [loading, data, enabled, propMode, propPower]);

  // Render heatmap rectangles on the map
  useEffect(() => {
    if (!map || !enabled) return;

    // Clear old layers
    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    layersRef.current = [];

    if (!data?.cells?.length) return;

    const grid = data.gridSize || 10;
    const half = grid / 2;
    const newLayers = [];

    // ─── Spatial blur of the reliability grid (#990 round 4) ──────────────
    // VOACAP's output has a real discontinuity where the short-path prediction
    // gives up and long-path becomes shorter — adjacent cells can jump from
    // r=5 to r=52, which renders as a visual cliff regardless of how smooth
    // the alpha taper is. A 3×3 box average over the cell grid feathers that
    // discontinuity over a couple of cells visually, without claiming the
    // underlying physics is wrong (the data is preserved everywhere else).
    // Longitude wraps at ±180; latitude doesn't.
    const cellMap = new Map();
    for (const c of data.cells) cellMap.set(`${c.lat},${c.lon}`, c);
    const wrapLon = (lon) => ((lon + 540) % 360) - 180;
    const smoothedR = new Map();
    for (const c of data.cells) {
      let sum = 0;
      let count = 0;
      for (const dlat of [-grid, 0, grid]) {
        for (const dlon of [-grid, 0, grid]) {
          const n = cellMap.get(`${c.lat + dlat},${wrapLon(c.lon + dlon)}`);
          if (n) {
            sum += n.r || 0;
            count++;
          }
        }
      }
      smoothedR.set(c, count > 0 ? sum / count : c.r);
    }

    // Use a shared canvas renderer for all cells — avoids SVG anti-aliasing
    // seams and is significantly faster for hundreds of rectangles
    const renderer = L.canvas({ padding: 0.5 });

    // 3-world-copies for Mercator wraparound continuity. On the azimuthal
    // equidistant projection (#990) longitude offsets of ±360° project to the
    // same point as offset 0, so the extra copies just overdraw and amplify
    // the projection distortion near the antipode where `k = c/sin(c)` blows
    // up. Use a single copy on azimuthal; keep the fan-out on Mercator.
    const isAzimuthal = map.options?.crs?.code === 'AzimuthalEquidistant';
    const offsets = isAzimuthal ? [0] : [-360, 0, 360];

    // Build cell polygons with subdivided edges instead of L.rectangle. A
    // rectangle in lat/lon space projects to a curved shape under azimuthal,
    // but L.rectangle draws it as a 4-vertex polygon with STRAIGHT pixel-space
    // edges — which is why Dan's screenshot in #990 showed blocky/distorted
    // cells across the disc. With ~5 subdivisions per edge (20 vertices per
    // cell perimeter) the polygon follows the projection's curvature smoothly
    // on azimuthal AND still renders correctly on Mercator.
    //
    // ~5 subdivisions × 4 edges × ~650 cells × up-to-3 world copies ≈ 39k
    // vertices total — well within Canvas2D's comfort zone.
    const SUBDIVISIONS = 5;
    const buildCellPolygon = (centerLat, centerLon, h, lonOffset) => {
      const pts = [];
      const step = (2 * h) / SUBDIVISIONS;
      // S edge, W → E
      for (let i = 0; i <= SUBDIVISIONS; i++) pts.push([centerLat - h, centerLon - h + i * step + lonOffset]);
      // E edge, S → N (skip duplicate corner)
      for (let i = 1; i <= SUBDIVISIONS; i++) pts.push([centerLat - h + i * step, centerLon + h + lonOffset]);
      // N edge, E → W (skip duplicate corner)
      for (let i = 1; i <= SUBDIVISIONS; i++) pts.push([centerLat + h, centerLon + h - i * step + lonOffset]);
      // W edge, N → S (skip duplicate corners on both ends)
      for (let i = 1; i < SUBDIVISIONS; i++) pts.push([centerLat + h - i * step, centerLon - h + lonOffset]);
      return pts;
    };

    data.cells.forEach((cell) => {
      const r = smoothedR.get(cell) ?? cell.r;
      const { color, alpha } = reliabilityColor(r);

      // Scale alpha by the user opacity slider (slider default 0.6 = 60%)
      const cellAlpha = alpha * (opacity / 0.6);

      for (const offset of offsets) {
        const poly = L.polygon(buildCellPolygon(cell.lat, cell.lon, half, offset), {
          stroke: false,
          fillColor: color,
          fillOpacity: Math.min(1, cellAlpha),
          weight: 0,
          interactive: false,
          bubblingMouseEvents: true,
          renderer,
        });

        poly.addTo(map);
        newLayers.push(poly);
      }
    });

    layersRef.current = newLayers;

    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
    };
  }, [map, enabled, data, opacity, selectedBand]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled && map) {
      if (controlRef.current) {
        try {
          map.removeControl(controlRef.current);
        } catch (e) {}
        controlRef.current = null;
      }
      layersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      layersRef.current = [];
    }
  }, [enabled, map]);

  return { data, loading, selectedBand };
}
