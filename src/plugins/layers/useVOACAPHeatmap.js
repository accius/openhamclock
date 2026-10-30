import { useState, useEffect, useRef } from 'react';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';
import useDisplayHourIso from '../../hooks/useDisplayHourIso.js';
import { isTimeShifted } from '../../utils/displayTime.js';
import {
  BANDS,
  SHIFTED_COLOR,
  GRID_SIZES,
  MODES,
  POWERS,
  deFromLocator,
  getVoacapSettings,
  heatmapUrl,
  reliabilityColor,
  setVoacapSettings,
  smoothReliability,
  subscribeVoacapSettings,
  voacapStatus,
} from '../../utils/voacapHeatmap.js';

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

// Bands, colour scale, smoothing and the settings store are shared with the
// 3D globe's painter: utils/voacapHeatmap.js.

export function useLayer({ map, enabled, opacity, locator }) {
  const [selectedBand, setSelectedBand] = useState(() => getVoacapSettings().bandIndex);
  const [gridSize, setGridSize] = useState(() => getVoacapSettings().grid);
  const [propMode, setPropMode] = useState(() => getVoacapSettings().mode);
  const [propPower, setPropPower] = useState(() => getVoacapSettings().power);
  const [data, setData] = useState(null);
  // The hour the map is for — follows Time Shift (one fetch per display hour).
  const displayHour = useDisplayHourIso(enabled);
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

  // Settings changed by a VOACAP panel (this one or the 3D globe's).
  useEffect(
    () =>
      subscribeVoacapSettings((st) => {
        setSelectedBand(st.bandIndex);
        setGridSize(st.grid);
        setPropMode(st.mode);
        setPropPower(st.power);
      }),
    [],
  );

  // DE location: centre of the locator's 4-character square
  const deLocation = deFromLocator(locator);

  // Fetch heatmap data
  useEffect(() => {
    if (!enabled || !deLocation) return;

    let controller = null;
    const fetchData = async () => {
      const band = BANDS[selectedBand];
      if (!band) return;

      // Latest request wins: during Time Shift playback the hour can move on
      // before the previous map arrives.
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      try {
        const url = heatmapUrl({
          deLat: deLocation.lat,
          deLon: deLocation.lon,
          freq: band.freq,
          grid: gridSize,
          mode: propMode,
          power: propPower,
          // Only while Time Shift is on; otherwise the server's "now" (and the
          // displayHour dependency refetches when the real hour moves on).
          at: isTimeShifted() ? displayHour : undefined,
        });
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        if (err?.name !== 'AbortError') console.error('[VOACAP Heatmap] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    intervalRef.current = setInterval(fetchData, 5 * 60 * 1000);

    return () => {
      controller?.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, deLocation?.lat, deLocation?.lon, selectedBand, gridSize, propMode, propPower, displayHour]);

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

        const gridOptions = GRID_SIZES.map(
          (g) => `<option value="${g}" ${g === gridSize ? 'selected' : ''}>${g}°</option>`,
        ).join('');

        const modeOptions = MODES.map(
          (m) => `<option value="${m}" ${m === propMode ? 'selected' : ''}>${m}</option>`,
        ).join('');

        const powerOptions = POWERS.map(
          (p) => `<option value="${p}" ${p === propPower ? 'selected' : ''}>${p}W</option>`,
        ).join('');

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
                ${loading ? 'Loading...' : data ? voacapStatus(data).text : 'Ready'}
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
          setVoacapSettings({ bandIndex: parseInt(e.target.value) });
        });
      }
      if (gridSelect) {
        gridSelect.addEventListener('change', (e) => {
          setVoacapSettings({ grid: parseInt(e.target.value) });
        });
      }
      if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
          setVoacapSettings({ mode: e.target.value });
        });
      }
      if (powerSelect) {
        powerSelect.addEventListener('change', (e) => {
          setVoacapSettings({ power: parseFloat(e.target.value) });
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
        const status = voacapStatus(data);
        statusEl.textContent = status.text;
        // Time Shift colour when the map is not "now".
        statusEl.style.color = status.shifted ? SHIFTED_COLOR : '';
      }
    }

    // Sync dropdowns if changed externally (e.g. from Settings panel)
    const modeSelect = document.getElementById('voacap-mode-select');
    const powerSelect = document.getElementById('voacap-power-select');
    const bandSelect = document.getElementById('voacap-band-select');
    const gridSelect = document.getElementById('voacap-grid-select');
    if (modeSelect && modeSelect.value !== propMode) modeSelect.value = propMode;
    if (powerSelect && parseFloat(powerSelect.value) !== propPower) powerSelect.value = propPower;
    if (bandSelect && parseInt(bandSelect.value) !== selectedBand) bandSelect.value = selectedBand;
    if (gridSelect && parseInt(gridSelect.value) !== gridSize) gridSelect.value = gridSize;
  }, [loading, data, enabled, propMode, propPower, selectedBand, gridSize]);

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

    // 3×3 blur of the reliability grid (#990 round 4) — see smoothReliability.
    const smoothedR = smoothReliability(data);

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
      // The renderer too: Leaflet keeps a renderer (canvas + move/zoom
      // listeners) on the map until it is removed itself.
      [...newLayers, renderer].forEach((layer) => {
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
