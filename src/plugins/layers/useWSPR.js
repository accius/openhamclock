import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';
import { getBandFromFreq } from '../../utils/callsign.js';
import { getBandColorForBand } from '../../utils/bandColors.js';
import { maidenheadToLatLon } from '../../utils/geo.js';
import { use630mBandEnabled } from '../../hooks/use630mBandEnabled.js';

/**
 * WSPR Propagation Heatmap Plugin v1.6.0
 *
 * Advanced Features:
 * - Great circle curved path lines between transmitters and receivers
 * - Color-coded by signal strength (SNR)
 * - Animated signal pulses along paths (v1.3.0)
 * - Band selector dropdown (v1.2.0)
 * - Time range slider (15min - 6hr) (v1.2.0)
 * - SNR threshold filter (v1.2.0)
 * - Hot spot density heatmap (v1.4.0)
 * - Band activity chart (v1.3.0)
 * - Propagation score indicator (v1.3.0)
 * - Best DX paths highlighting (v1.3.0)
 * - Draggable control panels via title drag (v1.4.0)
 * - Persistent panel positions (v1.4.1)
 * - Proper cleanup on disable (v1.4.1)
 * - Fixed duplicate control creation (v1.4.2)
 * - Performance optimizations (v1.4.2)
 * - Separate opacity controls for paths and heatmap (v1.4.3)
 * - Minimize/maximize toggle for all panels (v1.5.0)
 * - Statistics display (total stations, spots)
 * - Signal strength legend
 * - AGGREGATED DATA SUPPORT (v1.6.0) - 97% bandwidth reduction
 *   - Grid-level aggregation for heatmap
 *   - Aggregated path rendering between grid squares
 *   - Backward compatible with raw spot data
 *
 * Data source: PSK Reporter API (WSPR mode spots)
 * Update interval: 5 minutes
 */

export const metadata = {
  id: 'wspr',
  name: 'plugins.layers.wspr.name',
  description: 'plugins.layers.wspr.description',
  icon: '📡',
  category: 'propagation',
  defaultEnabled: false, // Opt-in only - uses PSKReporter HTTP API
  defaultOpacity: 0.7,
  version: '1.6.1',
};

// Format distance using global units preference
function fmtDist(km) {
  try {
    const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
    if (cfg.allUnits.dist === 'metric') return `${Math.round(km).toLocaleString()} km`;
  } catch (e) {}
  return `${Math.round(km * 0.621371).toLocaleString()} mi`;
}

function normalizeBandKey(band) {
  if (band == null) return null;
  const raw = String(band).trim().toLowerCase();
  if (!raw || raw === 'other') return null;
  if (raw.endsWith('cm') || raw.endsWith('m')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
}

function bandFromAnyFrequency(freq) {
  if (freq == null || freq === '') return null;
  const n = parseFloat(freq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return normalizeBandKey(getBandFromFreq(n));
}

// Get color based on SNR (darker colors for better visibility)
function getSNRColor(snr) {
  if (snr === null || snr === undefined) return '#666666';
  if (snr < -20) return '#cc0000'; // Dark red
  if (snr < -10) return '#dd4400'; // Dark orange
  if (snr < 0) return '#ee8800'; // Orange
  if (snr < 5) return '#dddd00'; // Dark yellow
  return '#00cc00'; // Dark green
}

// Get line weight based on SNR (doubled for better visibility)
function getLineWeight(snr) {
  if (snr === null || snr === undefined) return 4;
  if (snr < -20) return 4;
  if (snr < -10) return 5;
  if (snr < 0) return 6;
  if (snr < 5) return 7;
  return 8;
}

// Calculate great circle path between two points
function getGreatCirclePath(lat1, lon1, lat2, lon2, numPoints = 30) {
  // Validate input coordinates
  if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) {
    return [
      [lat1, lon1],
      [lat2, lon2],
    ];
  }

  // Check if points are very close (less than 0.5 degree)
  const deltaLat = Math.abs(lat2 - lat1);
  const deltaLon = Math.abs(lon2 - lon1);
  if (deltaLat < 0.5 && deltaLon < 0.5) {
    return [
      [lat1, lon1],
      [lat2, lon2],
    ];
  }

  const path = [];

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const lat1Rad = toRad(lat1);
  const lon1Rad = toRad(lon1);
  const lat2Rad = toRad(lat2);
  const lon2Rad = toRad(lon2);

  const cosD =
    Math.sin(lat1Rad) * Math.sin(lat2Rad) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);

  const d = Math.acos(Math.max(-1, Math.min(1, cosD)));

  if (d < 0.01 || Math.abs(d - Math.PI) < 0.01) {
    return [
      [lat1, lon1],
      [lat2, lon2],
    ];
  }

  const sinD = Math.sin(d);

  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;

    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(lat1Rad) * Math.cos(lon1Rad) + B * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = A * Math.cos(lat1Rad) * Math.sin(lon1Rad) + B * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = A * Math.sin(lat1Rad) + B * Math.sin(lat2Rad);

    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lon = toDeg(Math.atan2(y, x));

    if (isFinite(lat) && isFinite(lon)) {
      path.push([lat, lon]);
    }
  }

  if (path.length < 2) {
    return [
      [lat1, lon1],
      [lat2, lon2],
    ];
  }

  return path;
}

// Calculate propagation score (0-100)
function calculatePropagationScore(spots) {
  if (!spots || spots.length === 0) return 0;

  const avgSNR = spots.reduce((sum, s) => sum + (s.snr || -20), 0) / spots.length;
  const pathCount = spots.length;
  const strongSignals = spots.filter((s) => s.snr > 0).length;

  // Score based on: average SNR (40%), path count (30%), strong signal ratio (30%)
  const snrScore = Math.max(0, Math.min(100, ((avgSNR + 20) / 25) * 40));
  const countScore = Math.min(30, (pathCount / 100) * 30);
  const strongScore = (strongSignals / pathCount) * 30;

  return Math.round(snrScore + countScore + strongScore);
}

export function useLayer({ enabled = false, map = null, callsign, locator, lowMemoryMode = false, mapBandFilter }) {
  const [pathLayers, setPathLayers] = useState([]);
  const [markerLayers, setMarkerLayers] = useState([]);
  const [heatmapLayer, setHeatmapLayer] = useState(null);
  const [wsprData, setWsprData] = useState([]);
  const [filterByGrid, setFilterByGrid] = useState(false); // Match the unchecked UI default
  const [gridFilter, setGridFilter] = useState('');

  // v1.2.0 - Advanced Filters
  const [band630mEnabled, setBand630mEnabled] = use630mBandEnabled();
  const [timeWindow, setTimeWindow] = useState(lowMemoryMode ? 15 : 30); // minutes - shorter in low memory
  const [snrThreshold, setSNRThreshold] = useState(-30); // dB
  const [showAnimation, setShowAnimation] = useState(!lowMemoryMode); // Disable animations in low memory mode
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Low memory mode limits
  const MAX_PATHS = lowMemoryMode ? 100 : 10000;

  // v1.4.3 - Separate opacity controls
  const [pathOpacity, setPathOpacity] = useState(0.7);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.6);

  // Single combined WSPR control (activity, legend, band activity, and filters)
  const filterControlRef = useRef(null);
  const [_filterControl, setFilterControl] = useState(null);

  // Fetch WSPR data with dynamic time window and band filter

  const stripCallsign = (call) => {
    if (!call) return '';
    return call.split(/[\/\-]/)[0].toUpperCase();
  };

  // Set grid filter from locator when enabled
  useEffect(() => {
    if (locator && locator.length >= 4) {
      setGridFilter(locator.substring(0, 4).toUpperCase());
    }
  }, [locator]);

  useEffect(() => {
    if (band630mEnabled) return;
    setWsprData((current) =>
      current.filter((spot) => {
        const spotBand =
          normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freqMHz || spot.freq || spot.frequency);
        return spotBand !== '630m';
      }),
    );
  }, [band630mEnabled]);

  useEffect(() => {
    if (!enabled) return;

    const fetchWSPR = async () => {
      try {
        const timestamp = new Date().toLocaleTimeString();
        console.debug(`[WSPR] Fetching data at ${timestamp}...`);
        const response = await fetch(
          `/api/wspr/heatmap?minutes=${timeWindow}&band=all&include630m=${band630mEnabled ? 'true' : 'false'}`,
        );
        if (response.ok) {
          const data = await response.json();

          // Handle new aggregated format
          if (data.format === 'aggregated' && data.grids) {
            console.info(
              `[WSPR Plugin] Loaded aggregated data: ${data.uniqueGrids} grids, ${data.paths?.length || 0} paths from ${data.totalSpots} spots`,
            );

            // Convert aggregated grids to spot-like format for backward compatibility with rendering
            // Each grid becomes a "virtual spot" with combined TX/RX activity
            const virtualSpots = [];

            // Create spots from grids (for heatmap rendering)
            for (const grid of data.grids) {
              // Create a virtual spot for each active grid
              virtualSpots.push({
                sender: `${grid.grid} (${grid.stationCount} stations)`,
                senderGrid: grid.grid,
                senderLat: grid.lat,
                senderLon: grid.lon,
                receiver: '',
                receiverGrid: '',
                receiverLat: null,
                receiverLon: null,
                snr: grid.avgSnr,
                band: Object.keys(grid.bands).sort((a, b) => grid.bands[b] - grid.bands[a])[0] || 'Unknown',
                distance: grid.maxDistance,
                txCount: grid.txCount,
                rxCount: grid.rxCount,
                totalActivity: grid.totalActivity,
                isAggregated: true,
              });
            }

            // Add path data for rendering propagation lines
            if (data.paths && data.paths.length > 0) {
              for (const path of data.paths) {
                virtualSpots.push({
                  sender: path.from,
                  senderGrid: path.from,
                  senderLat: path.fromLat,
                  senderLon: path.fromLon,
                  receiver: path.to,
                  receiverGrid: path.to,
                  receiverLat: path.toLat,
                  receiverLon: path.toLon,
                  snr: path.avgSnr,
                  band:
                    path.band || Object.keys(path.bands).sort((a, b) => path.bands[b] - path.bands[a])[0] || 'Unknown',
                  pathCount: path.count,
                  isPath: true,
                  isAggregated: true,
                });
              }
            }

            // Store band activity for chart
            if (data.bandActivity) {
              virtualSpots.bandActivity = data.bandActivity;
            }

            setWsprData(virtualSpots);
            return;
          }

          // Legacy format handling (raw spots)
          let spots = data.spots || [];

          // Strip suffixes from all callsigns
          spots = spots.map((spot) => {
            return {
              ...spot,
              sender: stripCallsign(spot.sender),
              receiver: stripCallsign(spot.receiver),
            };
          });

          // Filter by callsign ONLY if grid filter is OFF
          if (!filterByGrid && callsign && callsign !== 'N0CALL') {
            const baseCall = stripCallsign(callsign);
            console.debug(`[WSPR] Filtering for callsign: ${baseCall} (grid filter OFF)`);

            spots = spots.filter((spot) => {
              // Show spots where I'm TX or RX
              const isTX = spot.sender === baseCall;
              const isRX = spot.receiver === baseCall;
              return isTX || isRX;
            });

            console.debug(`[WSPR] Found ${spots.length} spots for ${baseCall} (TX or RX)`);
          } else if (filterByGrid) {
            console.debug(`[WSPR] Grid filter ON - fetching ALL spots (${spots.length} total)`);
          }

          // Convert grid squares to lat/lon if coordinates are missing
          spots = spots.map((spot) => {
            let updated = { ...spot };

            // Convert sender grid to lat/lon if missing
            if ((!spot.senderLat || !spot.senderLon) && spot.senderGrid) {
              const loc = maidenheadToLatLon(spot.senderGrid);
              if (loc) {
                updated.senderLat = loc.lat;
                updated.senderLon = loc.lon;
              }
            }

            // Convert receiver grid to lat/lon if missing
            if ((!spot.receiverLat || !spot.receiverLon) && spot.receiverGrid) {
              const loc = maidenheadToLatLon(spot.receiverGrid);
              if (loc) {
                updated.receiverLat = loc.lat;
                updated.receiverLon = loc.lon;
              }
            }

            return updated;
          });

          setWsprData(spots);
          console.info(`[WSPR Plugin] Loaded ${spots.length} raw spots (${timeWindow}min; map legend controls bands)`);
        }
      } catch (err) {
        console.error('WSPR data fetch error:', err);
      }
    };

    fetchWSPR();
    const interval = setInterval(fetchWSPR, 300000); // Poll every 5 minutes (server caches for 10)

    return () => clearInterval(interval);
  }, [enabled, band630mEnabled, timeWindow, callsign, filterByGrid]);

  // Create one combined WSPR panel. The previous implementation used four
  // independent Leaflet controls; keeping all WSPR information in one pane
  // reduces map clutter and gives the layer one drag/minimize target.
  useEffect(() => {
    if (!enabled || !map) return;
    if (filterControlRef.current) return;

    const WSPRControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const container = L.DomUtil.create('div', 'wspr-filter-control wspr-combined-control', panelWrapper);
        container.style.minWidth = '258px';
        container.style.maxWidth = '286px';
        container.style.maxHeight = 'calc(100vh - 72px)';
        container.style.overflowY = 'auto';

        const fieldStyle =
          'width: 100%; box-sizing: border-box; padding: 3px 5px; background: var(--bg-tertiary); ' +
          'color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 3px;';
        const compactLabel = 'display: block; margin-bottom: 2px; font-size: 10px; color: var(--text-secondary);';

        container.innerHTML = `
          <div class="floating-panel-header">📡 WSPR</div>
          <div class="wspr-panel-content">
            <div class="wspr-stats-body" style="margin-bottom: 6px;">Initializing...</div>

            <div style="padding: 5px 0; border-top: 1px solid var(--border-color);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-weight: bold; color: var(--accent-cyan);">Band Activity</span>
                <span style="font-size: 9px; color: var(--text-muted);">WSPR / FST4W</span>
              </div>
              <div class="wspr-chart-body" style="opacity: 0.7;">Loading...</div>
            </div>

            <details open style="border-top: 1px solid var(--border-color); padding-top: 5px;">
              <summary style="cursor: pointer; font-weight: bold; color: var(--accent-cyan); margin-bottom: 6px;">Filters</summary>

              <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 5px;">
                <input type="checkbox" id="wspr-enable-630m" ${band630mEnabled ? 'checked' : ''} style="margin-right: 5px;" />
                <span>630m WSPR/RBN</span>
              </label>

              <div style="margin-bottom: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                  <label style="${compactLabel}; margin-bottom: 0;">Window</label>
                  <span style="font-size: 9px; color: var(--text-muted);">Bands: map legend</span>
                </div>
                <select id="wspr-time-filter" style="${fieldStyle}">
                  <option value="15" ${timeWindow === 15 ? 'selected' : ''}>15 min</option>
                  <option value="30" ${timeWindow === 30 ? 'selected' : ''}>30 min</option>
                  <option value="60" ${timeWindow === 60 ? 'selected' : ''}>1 hour</option>
                  <option value="120" ${timeWindow === 120 ? 'selected' : ''}>2 hours</option>
                  <option value="360" ${timeWindow === 360 ? 'selected' : ''}>6 hours</option>
                </select>
              </div>

              <div style="margin-bottom: 5px;">
                <label style="${compactLabel}">Min SNR <span id="snr-value">${snrThreshold}</span> dB</label>
                <input type="range" id="wspr-snr-filter" min="-30" max="10" value="${snrThreshold}" step="5" style="width: 100%;" />
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 5px;">
                <div>
                  <label style="${compactLabel}">Paths <span id="path-opacity-value">${Math.round(pathOpacity * 100)}</span>%</label>
                  <input type="range" id="wspr-path-opacity" min="10" max="100" value="${Math.round(pathOpacity * 100)}" step="5" style="width: 100%;" />
                </div>
                <div>
                  <label style="${compactLabel}">Heatmap <span id="heatmap-opacity-value">${Math.round(heatmapOpacity * 100)}</span>%</label>
                  <input type="range" id="wspr-heatmap-opacity" min="10" max="100" value="${Math.round(heatmapOpacity * 100)}" step="5" style="width: 100%;" />
                </div>
              </div>

              <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 5px;">
                <label style="cursor: pointer;"><input type="checkbox" id="wspr-animation" ${showAnimation ? 'checked' : ''} /> Animate</label>
                <label style="cursor: pointer;"><input type="checkbox" id="wspr-heatmap" ${showHeatmap ? 'checked' : ''} /> Heatmap</label>
              </div>

              <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 4px;">
                <input type="checkbox" id="wspr-grid-filter" ${filterByGrid ? 'checked' : ''} style="margin-right: 5px;" />
                <span>Grid filter</span>
              </label>
              <input type="text" id="wspr-grid-input"
                placeholder="${gridFilter || 'e.g. FN03'}"
                value="${gridFilter || ''}"
                maxlength="6"
                style="${fieldStyle} font-family: var(--font-mono); text-transform: uppercase;" />
            </details>

            <div style="margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--border-color); font-size: 9px; color: var(--text-muted); line-height: 1.35;">
              SNR <span style="color: var(--accent-green);">●</span> &gt;5
              <span style="color: var(--accent-green-dim);">●</span> 0…5
              <span style="color: var(--accent-amber);">●</span> -10…0
              <span style="color: var(--accent-amber-dim);">●</span> -20…-10
              <span style="color: var(--accent-red);">●</span> &lt;-20
              · <span style="color: var(--accent-cyan);">●</span> best DX
            </div>
          </div>
        `;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return panelWrapper;
      },
    });

    const control = new WSPRControl();
    map.addControl(control);
    filterControlRef.current = control;
    setFilterControl(control);

    setTimeout(() => {
      const container = document.querySelector('.wspr-filter-control');
      if (container) {
        const saved = localStorage.getItem('wspr-filter-position');
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

        makeDraggable(container, 'wspr-filter-position', { snap: 5 });
        addMinimizeToggle(container, 'wspr-filter-position', {
          contentClassName: 'wspr-panel-content',
          buttonClassName: 'wspr-minimize-btn',
        });
      }
    }, 150);

    setTimeout(() => {
      const enable630mCheck = document.getElementById('wspr-enable-630m');
      const timeSelect = document.getElementById('wspr-time-filter');
      const snrSlider = document.getElementById('wspr-snr-filter');
      const snrValue = document.getElementById('snr-value');
      const pathOpacitySlider = document.getElementById('wspr-path-opacity');
      const pathOpacityValue = document.getElementById('path-opacity-value');
      const heatmapOpacitySlider = document.getElementById('wspr-heatmap-opacity');
      const heatmapOpacityValue = document.getElementById('heatmap-opacity-value');
      const animCheck = document.getElementById('wspr-animation');
      const heatCheck = document.getElementById('wspr-heatmap');
      const gridFilterCheck = document.getElementById('wspr-grid-filter');
      const gridInput = document.getElementById('wspr-grid-input');

      if (enable630mCheck) {
        enable630mCheck.addEventListener('change', (e) => setBand630mEnabled(e.target.checked));
      }
      if (timeSelect) timeSelect.addEventListener('change', (e) => setTimeWindow(parseInt(e.target.value)));
      if (snrSlider) {
        snrSlider.addEventListener('input', (e) => {
          setSNRThreshold(parseInt(e.target.value));
          if (snrValue) snrValue.textContent = e.target.value;
        });
      }
      if (pathOpacitySlider) {
        pathOpacitySlider.addEventListener('input', (e) => {
          const value = parseInt(e.target.value) / 100;
          setPathOpacity(value);
          if (pathOpacityValue) pathOpacityValue.textContent = e.target.value;
        });
      }
      if (heatmapOpacitySlider) {
        heatmapOpacitySlider.addEventListener('input', (e) => {
          const value = parseInt(e.target.value) / 100;
          setHeatmapOpacity(value);
          if (heatmapOpacityValue) heatmapOpacityValue.textContent = e.target.value;
        });
      }
      if (animCheck) animCheck.addEventListener('change', (e) => setShowAnimation(e.target.checked));
      if (heatCheck) heatCheck.addEventListener('change', (e) => setShowHeatmap(e.target.checked));
      if (gridFilterCheck) gridFilterCheck.addEventListener('change', (e) => setFilterByGrid(e.target.checked));
      if (gridInput) {
        gridInput.addEventListener('input', (e) => {
          const value = e.target.value.toUpperCase().substring(0, 6);
          e.target.value = value;
          setGridFilter(value);
        });
      }
    }, 100);

    console.debug('[WSPR] Combined control created');
  }, [enabled, map]);

  useEffect(() => {
    const checkbox = document.getElementById('wspr-enable-630m');
    if (checkbox) checkbox.checked = band630mEnabled;
  }, [band630mEnabled]);

  // Render WSPR paths and markers
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old layers
    pathLayers.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    markerLayers.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    setPathLayers([]);
    setMarkerLayers([]);

    if (!enabled || wsprData.length === 0) return;

    const newPaths = [];
    const newMarkers = [];
    const txStations = new Set();
    const rxStations = new Set();
    const selectedMapBands = Array.isArray(mapBandFilter)
      ? new Set(mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean))
      : new Set();
    const hasMapBandFilter = selectedMapBands.size > 0;

    // Filter by SNR threshold and grid square OR callsign
    let filteredData = wsprData.filter((spot) => {
      // SNR filter
      if ((spot.snr || -30) < snrThreshold) return false;

      const spotBand = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freqMHz || spot.freq || spot.frequency);
      if (!band630mEnabled && spotBand === '630m') return false;
      if (hasMapBandFilter && (!spotBand || !selectedMapBands.has(spotBand))) return false;

      // Grid square filter (if enabled AND grid is set) - show spots in/around that grid
      if (filterByGrid && gridFilter && gridFilter.length >= 2) {
        const gridUpper = gridFilter.toUpperCase();
        const senderGrid = spot.senderGrid ? spot.senderGrid.toUpperCase() : '';
        const receiverGrid = spot.receiverGrid ? spot.receiverGrid.toUpperCase() : '';

        // Match prefix: FN matches FN03, FN02, FN21, etc.
        const senderMatch = senderGrid.startsWith(gridUpper);
        const receiverMatch = receiverGrid.startsWith(gridUpper);

        // Show if either TX or RX matches the grid prefix
        return senderMatch || receiverMatch;
      }

      // If grid filter is ON but no grid set, show ALL spots (don't filter)
      if (filterByGrid && (!gridFilter || gridFilter.length < 2)) {
        return true;
      }

      // If grid filter is OFF, filter by callsign (TX/RX involving your station)
      if (!filterByGrid && callsign && callsign !== 'N0CALL') {
        const baseCallsign = callsign.split(/[\/\-]/)[0].toUpperCase();
        const senderBase = (spot.sender || '').split(/[\/\-]/)[0].toUpperCase();
        const receiverBase = (spot.receiver || '').split(/[\/\-]/)[0].toUpperCase();

        // Show only if your callsign is TX or RX
        return senderBase === baseCallsign || receiverBase === baseCallsign;
      }

      // If no callsign and no grid filter, show all
      return true;
    });

    console.debug(
      `[WSPR Paths] Filtering: filterByGrid=${filterByGrid}, gridFilter="${gridFilter}", callsign="${callsign}", input=${wsprData.length}, output=${filteredData.length}`,
    );

    // For aggregated data, only render actual paths (items with both sender and receiver coords)
    const pathData = filteredData.filter(
      (spot) => spot.isPath || (!spot.isAggregated && spot.receiverLat && spot.receiverLon),
    );

    // Debug: Log grid squares when filter is enabled
    if (filterByGrid && gridFilter && filteredData.length > 0) {
      const grids = new Set();
      filteredData.slice(0, 5).forEach((spot) => {
        if (spot.senderGrid) grids.add(spot.senderGrid.substring(0, 4));
        if (spot.receiverGrid) grids.add(spot.receiverGrid.substring(0, 4));
      });
      console.debug(
        `[WSPR Grid] Filtering for ${gridFilter}, found ${filteredData.length} spots with grids:`,
        Array.from(grids).join(', '),
      );
    } else if (filterByGrid && gridFilter && filteredData.length === 0) {
      // Log what grids ARE available
      const availableGrids = new Set();
      wsprData.slice(0, 10).forEach((spot) => {
        if (spot.senderGrid) availableGrids.add(spot.senderGrid.substring(0, 4));
        if (spot.receiverGrid) availableGrids.add(spot.receiverGrid.substring(0, 4));
      });
      console.debug(
        `[WSPR Grid] No matches for ${gridFilter}. Available grids in data:`,
        Array.from(availableGrids).join(', '),
      );
    }
    const limitedData = pathData.slice(0, MAX_PATHS); // Limit paths based on memory mode

    // Find best DX paths (longest distance, good SNR)
    const bestPaths = limitedData
      .map((spot) => {
        const dist = Math.sqrt(
          Math.pow(spot.receiverLat - spot.senderLat, 2) + Math.pow(spot.receiverLon - spot.senderLon, 2),
        );
        return { ...spot, distance: dist };
      })
      .filter((s) => s.snr > 0)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 10);

    const bestPathSet = new Set(bestPaths.map((p) => `${p.sender}-${p.receiver}`));

    limitedData.forEach((spot) => {
      // Validate coordinates
      if (!spot.senderLat || !spot.senderLon || !spot.receiverLat || !spot.receiverLon) {
        return;
      }

      const sLat = parseFloat(spot.senderLat);
      const sLon = parseFloat(spot.senderLon);
      const rLat = parseFloat(spot.receiverLat);
      const rLon = parseFloat(spot.receiverLon);

      if (!isFinite(sLat) || !isFinite(sLon) || !isFinite(rLat) || !isFinite(rLon)) {
        return;
      }

      // Calculate great circle path
      const pathCoords = getGreatCirclePath(sLat, sLon, rLat, rLon, 30);

      if (!pathCoords || pathCoords.length < 2) {
        return;
      }

      // Check if this is a best DX path. Keep existing SNR coloring for
      // normal bands; use the customizable band color for 630m so MF paths
      // are immediately recognizable when the 630m map chip is selected.
      const isBestPath = bestPathSet.has(`${spot.sender}-${spot.receiver}`);
      const renderedBand =
        normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freqMHz || spot.freq || spot.frequency);
      const is630mPath = renderedBand === '630m';
      const pathColor = isBestPath ? '#00ffff' : is630mPath ? getBandColorForBand('630m') : getSNRColor(spot.snr);

      const path = L.polyline(pathCoords, {
        color: pathColor,
        weight: isBestPath ? 4 : is630mPath ? Math.max(5, getLineWeight(spot.snr)) : getLineWeight(spot.snr),
        opacity: pathOpacity * (isBestPath ? 0.9 : 0.6),
        smoothFactor: 1,
        className: showAnimation ? 'wspr-animated-path' : '',
      });

      const snrStr = spot.snr !== null ? `${spot.snr} dB` : 'N/A';
      const ageStr = spot.age < 60 ? `${spot.age} min ago` : `${Math.floor(spot.age / 60)}h ago`;
      const powerStr = spot.power ? `${spot.power}W` : 'N/A';
      const powerDbmStr = spot.powerDbm ? `${spot.powerDbm} dBm` : '';
      const distanceStr = spot.distance ? fmtDist(spot.distance) : 'N/A';
      const kPerWStr = spot.kPerW ? `${spot.kPerW.toLocaleString()} k/W` : 'N/A';
      const txAzStr = spot.senderAz !== null ? `${spot.senderAz}°` : 'N/A';
      const rxAzStr = spot.receiverAz !== null ? `${spot.receiverAz}°` : 'N/A';
      const spotQStr = spot.snr && spot.distance ? Math.round(spot.distance / Math.pow(10, spot.snr / 10)) : null;

      path.bindPopup(`
        <div style="font-family: var(--font-mono); min-width: 240px;">
          <div style="font-size: 13px; font-weight: bold; color: ${getSNRColor(spot.snr)}; margin-bottom: 8px; text-align: center;">
            ${esc(spot.sender)} ⇢ ${esc(spot.receiver)}
          </div>
          ${
            spot.isAggregated
              ? `
          <div style="font-size: 11px; text-align: center; margin-bottom: 8px; color: #00ccff;">
            ${spot.pathCount || 1} propagation paths
          </div>
          <table style="font-size: 11px; width: 100%; line-height: 1.6;">
            <tr><td style="opacity: 0.7;">Band:</td><td><b>${esc(spot.band || 'Multi')}</b></td></tr>
            <tr><td style="opacity: 0.7;">Avg SNR:</td><td style="color: ${getSNRColor(spot.snr)}; font-weight: bold;">${spot.snr !== null ? spot.snr + ' dB' : 'N/A'}</td></tr>
            <tr><td style="opacity: 0.7;">Path Count:</td><td><b>${spot.pathCount || 1}</b></td></tr>
          </table>
          `
              : `
          <div style="font-size: 10px; opacity: 0.7; text-align: center; margin-bottom: 8px;">
            ${ageStr}
          </div>
          <table style="font-size: 11px; width: 100%; line-height: 1.6;">
            <tr><td style="opacity: 0.7;">Freq:</td><td><b>${spot.freqMHz} MHz</b></td></tr>
            <tr><td style="opacity: 0.7;">Power:</td><td><b>${powerStr}</b> ${powerDbmStr}</td></tr>
            <tr><td style="opacity: 0.7;">SNR:</td><td style="color: ${getSNRColor(spot.snr)}; font-weight: bold;">${snrStr}</td></tr>
            ${spotQStr ? `<tr><td style="opacity: 0.7;">Quality:</td><td><b>${spotQStr} Q</b></td></tr>` : ''}
            <tr><td colspan="2" style="padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);"></td></tr>
            <tr><td style="opacity: 0.7;">Distance:</td><td><b>${distanceStr}</b></td></tr>
            <tr><td style="opacity: 0.7;">Efficiency:</td><td><b>${kPerWStr}</b></td></tr>
            <tr><td colspan="2" style="padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);"></td></tr>
            <tr><td style="opacity: 0.7;">Az TX:</td><td><b>${txAzStr}</b></td></tr>
            <tr><td style="opacity: 0.7;">Az RX:</td><td><b>${rxAzStr}</b></td></tr>
          </table>
          `
          }
        </div>
      `);

      path.addTo(map);
      newPaths.push(path);

      // Add markers with detailed tooltips
      const txKey = `${spot.sender}-${spot.senderGrid}`;
      if (!txStations.has(txKey)) {
        txStations.add(txKey);
        const txMarker = L.circleMarker([sLat, sLon], {
          radius: 5,
          fillColor: '#ff6600',
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: pathOpacity * 0.9,
          opacity: pathOpacity,
        });
        // Build detailed tooltip for TX
        let txDetails = `
          <div style="font-family: var(--font-mono); font-size: 11px; min-width: 220px;">
            <div style="font-weight: bold; color: #ff6600; margin-bottom: 6px; font-size: 12px;">📡 TX Station</div>
            <div style="margin-bottom: 6px;"><b style="font-size: 13px;">${esc(spot.sender)}</b> ⇢ <b style="font-size: 13px;">${esc(spot.receiver)}</b></div>
            <div style="opacity: 0.7; margin-bottom: 8px;">Grid: ${esc(spot.senderGrid)}</div>
        `;

        // Add frequency and band
        if (spot.freqMHz) {
          txDetails += `<div><b>${spot.freqMHz} MHz</b> (${spot.band || 'Unknown'})</div>`;
        }

        // Add power if available
        if (spot.power !== null && spot.power !== undefined) {
          const powerDbm = spot.powerDbm !== null ? ` (${spot.powerDbm.toFixed(1)} dBm)` : '';
          txDetails += `<div>Power: <b>${spot.power} W</b>${powerDbm}</div>`;
        }

        // Add SNR
        if (spot.snr !== null && spot.snr !== undefined) {
          const snrColor = spot.snr > 0 ? '#00cc00' : spot.snr > -10 ? '#ffaa00' : '#ff6600';
          txDetails += `<div>SNR: <b style="color: ${snrColor};">${spot.snr} dB</b></div>`;
        }

        // Add distance and efficiency
        if (spot.distance) {
          txDetails += `<div>Distance: <b>${fmtDist(spot.distance)}</b></div>`;
          if (spot.kPerW) {
            txDetails += `<div>Efficiency: <b>${fmtDist(spot.kPerW)}/W</b></div>`;
          }
        }

        // Add azimuth
        if (spot.senderAz !== null) {
          txDetails += `<div>Azimuth: <b>${spot.senderAz}°</b></div>`;
        }

        // Add drift if available
        if (spot.drift !== null && spot.drift !== undefined) {
          txDetails += `<div>Drift: ${spot.drift} Hz</div>`;
        }

        // Add timestamp
        if (spot.timestamp) {
          const date = new Date(spot.timestamp);
          const timeStr = date.toLocaleString();
          txDetails += `<div style="margin-top: 6px; font-size: 10px; opacity: 0.6;">${timeStr}</div>`;
        }

        txDetails += `</div>`;
        txMarker.bindPopup(txDetails);
        txMarker.addTo(map);
        newMarkers.push(txMarker);
      }

      const rxKey = `${spot.receiver}-${spot.receiverGrid}`;
      if (!rxStations.has(rxKey)) {
        rxStations.add(rxKey);
        const rxMarker = L.circleMarker([rLat, rLon], {
          radius: 5,
          fillColor: '#0088ff',
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: pathOpacity * 0.9,
          opacity: pathOpacity,
        });
        // Build detailed tooltip for RX
        let rxDetails = `
          <div style="font-family: var(--font-mono); font-size: 11px; min-width: 220px;">
            <div style="font-weight: bold; color: #0088ff; margin-bottom: 6px; font-size: 12px;">📻 RX Station</div>
            <div style="margin-bottom: 6px;"><b style="font-size: 13px;">${esc(spot.sender)}</b> ⇢ <b style="font-size: 13px;">${esc(spot.receiver)}</b></div>
            <div style="opacity: 0.7; margin-bottom: 8px;">Grid: ${esc(spot.receiverGrid)}</div>
        `;

        // Add frequency and band
        if (spot.freqMHz) {
          rxDetails += `<div><b>${spot.freqMHz} MHz</b> (${spot.band || 'Unknown'})</div>`;
        }

        // Add power if available
        if (spot.power !== null && spot.power !== undefined) {
          const powerDbm = spot.powerDbm !== null ? ` (${spot.powerDbm.toFixed(1)} dBm)` : '';
          rxDetails += `<div>Power: <b>${spot.power} W</b>${powerDbm}</div>`;
        }

        // Add SNR
        if (spot.snr !== null && spot.snr !== undefined) {
          const snrColor = spot.snr > 0 ? '#00cc00' : spot.snr > -10 ? '#ffaa00' : '#ff6600';
          rxDetails += `<div>SNR: <b style="color: ${snrColor};">${spot.snr} dB</b></div>`;
        }

        // Add distance and efficiency
        if (spot.distance) {
          rxDetails += `<div>Distance: <b>${fmtDist(spot.distance)}</b></div>`;
          if (spot.kPerW) {
            rxDetails += `<div>Efficiency: <b>${fmtDist(spot.kPerW)}/W</b></div>`;
          }
        }

        // Add azimuth
        if (spot.receiverAz !== null) {
          rxDetails += `<div>Azimuth: <b>${spot.receiverAz}°</b></div>`;
        }

        // Add drift if available
        if (spot.drift !== null && spot.drift !== undefined) {
          rxDetails += `<div>Drift: ${spot.drift} Hz</div>`;
        }

        // Add timestamp
        if (spot.timestamp) {
          const date = new Date(spot.timestamp);
          const timeStr = date.toLocaleString();
          rxDetails += `<div style="margin-top: 6px; font-size: 10px; opacity: 0.6;">${timeStr}</div>`;
        }

        rxDetails += `</div>`;
        rxMarker.bindPopup(rxDetails);
        rxMarker.addTo(map);
        newMarkers.push(rxMarker);
      }
    });

    setPathLayers(newPaths);
    setMarkerLayers(newMarkers);

    // Update stats content only (don't recreate control)
    const propScore = calculatePropagationScore(limitedData);
    const scoreColor = propScore > 70 ? '#00ff00' : propScore > 40 ? '#ffaa00' : '#ff6600';
    const totalStations = txStations.size + rxStations.size;

    // Update existing stats panel content if it exists
    setTimeout(() => {
      const statsContainer = document.querySelector('.wspr-stats-body');
      if (statsContainer && enabled) {
        const lagMinutes = Number(wsprData.sourceLagMinutes);
        const hasLag = Number.isFinite(lagMinutes) && lagMinutes > 0;
        const lagLabel = lagMinutes >= 60 ? `${Math.floor(lagMinutes / 60)}h ${lagMinutes % 60}m` : `${lagMinutes}m`;
        const timeLabel = wsprData.sourceWindowShifted
          ? `Latest ${timeWindow} min available · 630m source ${hasLag ? `${lagLabel} behind` : 'delayed'}`
          : `Last ${timeWindow} min`;

        const contentHTML = `
          <div style="display: grid; grid-template-columns: 70px 1fr; gap: 6px; align-items: stretch;">
            <div style="padding: 5px; background: var(--bg-tertiary); border-radius: 3px; text-align: center;">
              <div style="font-size: 9px; color: var(--text-muted);">Score</div>
              <div style="font-size: 17px; font-weight: bold; color: ${scoreColor}; line-height: 1.15;">${propScore}</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; align-content: center; font-size: 10px;">
              <div>Paths <span style="color: var(--accent-cyan);">${newPaths.length}</span></div>
              <div>Spots <span style="color: var(--accent-green);">${wsprData.bandActivity ? Object.values(wsprData.bandActivity).reduce((sum, count) => sum + count, 0) : limitedData.length}</span></div>
              <div>TX <span style="color: var(--accent-amber);">${txStations.size}</span></div>
              <div>RX <span style="color: var(--accent-blue);">${rxStations.size}</span></div>
            </div>
          </div>
          <div style="margin-top: 3px; font-size: 9px; color: ${wsprData.sourceWindowShifted ? 'var(--accent-amber)' : 'var(--text-muted)'}; text-align: right;">${timeLabel}</div>
        `;

        statsContainer.innerHTML = contentHTML;
      }
    }, 50);

    // Update band chart content if it exists
    setTimeout(() => {
      const chartContainer = document.querySelector('.wspr-chart-body');
      if (chartContainer && enabled) {
        const bandCounts = wsprData.bandActivity ? { ...wsprData.bandActivity } : {};
        if (!wsprData.bandActivity) {
          limitedData.forEach((spot) => {
            const band = spot.band || 'Unknown';
            bandCounts[band] = (bandCounts[band] || 0) + 1;
          });
        }

        const bandTotal = Object.values(bandCounts).reduce((sum, count) => sum + count, 0);
        const entries = Object.entries(bandCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);

        chartContainer.style.opacity = '1';
        chartContainer.style.display = 'grid';
        chartContainer.style.gridTemplateColumns = '1fr 1fr';
        chartContainer.style.gap = '3px 5px';
        chartContainer.innerHTML =
          bandTotal === 0
            ? '<div style="grid-column: 1 / -1; opacity: 0.7;">No activity in this window.</div>'
            : entries
                .map(
                  ([band, count]) => `
                    <div style="display: flex; justify-content: space-between; gap: 6px; padding: 2px 4px; background: var(--bg-tertiary); border-radius: 3px; font-size: 10px;">
                      <span>${band}</span><span style="color: var(--accent-cyan);">${count}</span>
                    </div>
                  `,
                )
                .join('');
      }
    }, 50);

    console.debug(
      `[WSPR Plugin] Rendered ${newPaths.length} paths, ${newMarkers.length} markers, ${bestPaths.length} best DX`,
    );

    return () => {
      newPaths.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      newMarkers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
    };
  }, [
    enabled,
    wsprData,
    map,
    pathOpacity,
    snrThreshold,
    showAnimation,
    timeWindow,
    filterByGrid,
    gridFilter,
    mapBandFilter,
    band630mEnabled,
  ]);

  // Render heatmap overlay (v1.4.0)
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Remove existing heatmap
    if (heatmapLayer && map) {
      try {
        map.removeLayer(heatmapLayer);
      } catch (e) {}
      setHeatmapLayer(null);
    }

    if (!enabled || !showHeatmap || wsprData.length === 0) return;

    console.debug('[WSPR] Rendering heatmap with', wsprData.length, 'spots');

    // Create heatmap circles for all TX and RX stations
    const heatPoints = [];
    const stationCounts = {};
    const selectedMapBands = Array.isArray(mapBandFilter)
      ? new Set(mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean))
      : new Set();
    const hasMapBandFilter = selectedMapBands.size > 0;

    // Filter by SNR threshold and grid square OR callsign
    let filteredData = wsprData.filter((spot) => {
      // SNR filter
      if ((spot.snr || -30) < snrThreshold) return false;

      const spotBand = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freqMHz || spot.freq || spot.frequency);
      if (!band630mEnabled && spotBand === '630m') return false;
      if (hasMapBandFilter && (!spotBand || !selectedMapBands.has(spotBand))) return false;

      // Grid square filter (if enabled AND grid is set) - show spots in/around that grid
      if (filterByGrid && gridFilter && gridFilter.length >= 2) {
        const gridUpper = gridFilter.toUpperCase();
        const senderGrid = spot.senderGrid ? spot.senderGrid.toUpperCase() : '';
        const receiverGrid = spot.receiverGrid ? spot.receiverGrid.toUpperCase() : '';

        // Match prefix: FN matches FN03, FN02, FN21, etc.
        const senderMatch = senderGrid.startsWith(gridUpper);
        const receiverMatch = receiverGrid.startsWith(gridUpper);

        // Show if either TX or RX matches the grid prefix
        return senderMatch || receiverMatch;
      }

      // If grid filter is ON but no grid set, show ALL spots (don't filter)
      if (filterByGrid && (!gridFilter || gridFilter.length < 2)) {
        return true;
      }

      // If grid filter is OFF, filter by callsign (TX/RX involving your station)
      if (!filterByGrid && callsign && callsign !== 'N0CALL') {
        const baseCallsign = callsign.split(/[\/\-]/)[0].toUpperCase();
        const senderBase = (spot.sender || '').split(/[\/\-]/)[0].toUpperCase();
        const receiverBase = (spot.receiver || '').split(/[\/\-]/)[0].toUpperCase();

        // Show only if your callsign is TX or RX
        return senderBase === baseCallsign || receiverBase === baseCallsign;
      }

      // If no callsign and no grid filter, show all
      return true;
    });

    console.debug(
      `[WSPR Heatmap] Filtering: filterByGrid=${filterByGrid}, gridFilter="${gridFilter}", input=${wsprData.length}, output=${filteredData.length}`,
    );

    // For aggregated data, grids already have activity counts
    const hasAggregatedData = filteredData.some((spot) => spot.isAggregated && spot.totalActivity);

    if (hasAggregatedData) {
      // Use pre-aggregated grid data
      filteredData.forEach((spot) => {
        // Only process grid spots (not paths)
        if (!spot.isPath && spot.senderLat && spot.senderLon && spot.totalActivity) {
          const sLat = parseFloat(spot.senderLat);
          const sLon = parseFloat(spot.senderLon);

          if (!isFinite(sLat) || !isFinite(sLon)) return;

          const key = spot.senderGrid || `${sLat.toFixed(1)},${sLon.toFixed(1)}`;
          stationCounts[key] = spot.totalActivity;
          heatPoints.push({
            lat: sLat,
            lon: sLon,
            key: key,
            grid: spot.senderGrid,
            stationCount: spot.stationCount,
            txCount: spot.txCount,
            rxCount: spot.rxCount,
          });
        }
      });
      console.debug(`[WSPR Heatmap] Using aggregated data: ${heatPoints.length} grid squares`);
    } else {
      // Legacy: count activity from individual spots
      filteredData.forEach((spot) => {
        if (!spot.senderLat || !spot.senderLon || !spot.receiverLat || !spot.receiverLon) return;

        const sLat = parseFloat(spot.senderLat);
        const sLon = parseFloat(spot.senderLon);
        const rLat = parseFloat(spot.receiverLat);
        const rLon = parseFloat(spot.receiverLon);

        if (!isFinite(sLat) || !isFinite(sLon) || !isFinite(rLat) || !isFinite(rLon)) return;

        // Count activity at each location
        const txKey = `${sLat.toFixed(1)},${sLon.toFixed(1)}`;
        const rxKey = `${rLat.toFixed(1)},${rLon.toFixed(1)}`;

        stationCounts[txKey] = (stationCounts[txKey] || 0) + 1;
        stationCounts[rxKey] = (stationCounts[rxKey] || 0) + 1;

        heatPoints.push({ lat: sLat, lon: sLon, key: txKey });
        heatPoints.push({ lat: rLat, lon: rLon, key: rxKey });
      });
    }

    // Create gradient circles for heatmap
    const heatCircles = [];
    const uniquePoints = {};

    heatPoints.forEach((point) => {
      if (!uniquePoints[point.key]) {
        uniquePoints[point.key] = {
          lat: point.lat,
          lon: point.lon,
          count: stationCounts[point.key],
          grid: point.grid,
          stationCount: point.stationCount,
          txCount: point.txCount,
          rxCount: point.rxCount,
        };
      }
    });

    Object.values(uniquePoints).forEach((point) => {
      const intensity = Math.min(point.count / 10, 1); // Normalize to 0-1

      // Color based on activity level
      let color;
      if (intensity > 0.7)
        color = '#ff0000'; // Red - very hot
      else if (intensity > 0.5)
        color = '#ff6600'; // Orange - hot
      else if (intensity > 0.3)
        color = '#ffaa00'; // Yellow - warm
      else color = '#00aaff'; // Blue - cool

      // Create focused heatmap spots (tighter, station-specific)
      const baseRadius = 8 + intensity * 15; // 8-23 pixels (even bigger!)
      const numLayers = 4; // More layers for intense glow

      for (let i = 0; i < numLayers; i++) {
        const layerRadius = baseRadius * (1.6 - i * 0.25); // Even bigger glow
        // VERY HIGH base opacity: 0.75-1.0 range, less penalty per layer
        const layerOpacity = (0.75 + intensity * 0.25) * (1 - i * 0.15) * heatmapOpacity;

        // Small offset for glow effect
        const offsetLat = point.lat + (Math.random() - 0.5) * 0.01;
        const offsetLon = point.lon + (Math.random() - 0.5) * 0.01;

        const circle = L.circle([offsetLat, offsetLon], {
          radius: layerRadius * 6000, // Much bigger for high visibility!
          fillColor: color,
          fillOpacity: layerOpacity,
          color: color,
          weight: 0,
          opacity: 0,
          className: 'wspr-heatmap-cloud', // For CSS blur
        });

        // Only add popup to the first (largest) circle
        if (i === 0) {
          const popupContent = point.grid
            ? `
            <div style="font-family: var(--font-mono);">
              <b>🔥 Grid: ${point.grid}</b><br>
              Total Activity: ${point.count}<br>
              ${point.stationCount ? `Stations: ${point.stationCount}<br>` : ''}
              ${point.txCount ? `TX: ${point.txCount} | RX: ${point.rxCount || 0}<br>` : ''}
              Lat: ${point.lat.toFixed(2)} | Lon: ${point.lon.toFixed(2)}
            </div>
          `
            : `
            <div style="font-family: var(--font-mono);">
              <b>🔥 Activity Hot Spot</b><br>
              Stations: ${point.count}<br>
              Lat: ${point.lat.toFixed(2)}<br>
              Lon: ${point.lon.toFixed(2)}
            </div>
          `;
          circle.bindPopup(popupContent);
        }

        circle.addTo(map);
        heatCircles.push(circle);
      }
    });

    // Store as layer group
    const heatGroup = L.layerGroup(heatCircles);
    setHeatmapLayer(heatGroup);

    console.debug(`[WSPR] Heatmap rendered with ${Object.keys(uniquePoints).length} hot spots`);

    return () => {
      heatCircles.forEach((circle) => {
        try {
          map.removeLayer(circle);
        } catch (e) {}
      });
    };
  }, [
    enabled,
    showHeatmap,
    wsprData,
    map,
    heatmapOpacity,
    snrThreshold,
    callsign,
    filterByGrid,
    gridFilter,
    mapBandFilter,
    band630mEnabled,
  ]);

  // Cleanup controls on disable - FIX: properly remove all controls and layers
  useEffect(() => {
    if (!enabled && map) {
      // Only log once and check if controls actually exist before attempting removal
      const hasControls = filterControlRef.current;

      if (!hasControls) {
        return; // Nothing to clean up
      }

      console.debug('[WSPR] Plugin disabled - cleaning up all controls and layers');

      // Remove filter control
      if (filterControlRef.current) {
        try {
          map.removeControl(filterControlRef.current);
          console.debug('[WSPR] Removed filter control');
        } catch (e) {
          console.error('[WSPR] Error removing filter control:', e);
        }
        filterControlRef.current = null;
        setFilterControl(null);
      }

      // Remove heatmap layer
      if (heatmapLayer) {
        try {
          map.removeLayer(heatmapLayer);
          console.debug('[WSPR] Removed heatmap layer');
        } catch (e) {
          console.error('[WSPR] Error removing heatmap layer:', e);
        }
        setHeatmapLayer(null);
      }

      // Clear all paths and markers - use refs to avoid infinite loop
      pathLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      markerLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      setPathLayers([]);
      setMarkerLayers([]);
    }
  }, [enabled, map]); // REMOVED pathLayers, markerLayers from deps to prevent infinite loop

  return {
    paths: pathLayers,
    markers: markerLayers,
    spotCount: wsprData.length,
    filteredCount: wsprData.filter((s) => (s.snr || -30) >= snrThreshold).length,
    filters: {
      band630mEnabled,
      timeWindow,
      snrThreshold,
      showAnimation,
      showHeatmap,
      pathOpacity,
      heatmapOpacity,
    },
  };
}
