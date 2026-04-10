import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';

/**
 * Reverse Beacon Network (RBN) Plugin v1.0.0
 *
 * Features:
 * - Shows who's hearing YOUR signal
 * - Real-time skimmer spots
 * - Signal strength mapping (SNR heatmap)
 * - Color-coded by signal strength
 * - Band filter
 * - Time window filter
 * - Great circle paths to skimmers
 *
 * Data source: Reverse Beacon Network API
 * Update interval: 10 seconds
 */

// Make control panel draggable by its title and save position
// Registry so a second call for the same storageKey cancels the previous listeners.

export const metadata = {
  id: 'rbn',
  name: 'plugins.layers.rbn.name',
  description: 'plugins.layers.rbn.description',
  icon: '📡',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0',
};

// Convert grid square to lat/lon
function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;

  grid = grid.toUpperCase();
  const lon = (grid.charCodeAt(0) - 65) * 20 - 180;
  const lat = (grid.charCodeAt(1) - 65) * 10 - 90;
  const lon2 = parseInt(grid[2]) * 2;
  const lat2 = parseInt(grid[3]);

  let longitude = lon + lon2 + 1;
  let latitude = lat + lat2 + 0.5;

  if (grid.length >= 6) {
    const lon3 = (grid.charCodeAt(4) - 65) * (2 / 24);
    const lat3 = (grid.charCodeAt(5) - 65) * (1 / 24);
    longitude = lon + lon2 + lon3 + 1 / 24;
    latitude = lat + lat2 + lat3 + 0.5 / 24;
  }

  return { lat: latitude, lon: longitude };
}

// Get color based on SNR (signal-to-noise ratio)
function getSNRColor(snr) {
  if (snr === null || snr === undefined) return '#888888';
  if (snr < 0) return '#ff3333'; // Red: Weak
  if (snr < 10) return '#ff9933'; // Orange: Fair
  if (snr < 20) return '#ffcc33'; // Yellow: Good
  if (snr < 30) return '#99ff33'; // Light green: Very good
  return '#33ff33'; // Bright green: Excellent
}

// Get marker size based on SNR
function getMarkerSize(snr) {
  if (snr === null || snr === undefined) return 6;
  if (snr < 0) return 6;
  if (snr < 10) return 8;
  if (snr < 20) return 10;
  if (snr < 30) return 12;
  return 14;
}

// Calculate great circle path - returns array of path segments (split at dateline)
function getGreatCirclePath(lat1, lon1, lat2, lon2, numPoints = 30) {
  if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) {
    return [
      [
        [lat1, lon1],
        [lat2, lon2],
      ],
    ];
  }

  const deltaLat = Math.abs(lat2 - lat1);
  const deltaLon = Math.abs(lon2 - lon1);
  if (deltaLat < 0.5 && deltaLon < 0.5) {
    return [
      [
        [lat1, lon1],
        [lat2, lon2],
      ],
    ];
  }

  // Normalize longitudes to handle dateline crossing
  let lon1Norm = lon1;
  let lon2Norm = lon2;
  const crossesDateline = Math.abs(lon2 - lon1) > 180;

  if (crossesDateline) {
    // Adjust longitudes to take shorter path
    if (lon2 > lon1) {
      lon1Norm = lon1 + 360;
    } else {
      lon2Norm = lon2 + 360;
    }
  }

  const path = [];

  // Convert to radians
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lon1Rad = (lon1Norm * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const lon2Rad = (lon2Norm * Math.PI) / 180;

  // Calculate distance
  const d = Math.acos(
    Math.sin(lat1Rad) * Math.sin(lat2Rad) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad),
  );

  // Handle very small distances
  if (isNaN(d) || d < 0.0001) {
    return [
      [
        [lat1, lon1],
        [lat2, lon2],
      ],
    ];
  }

  // Generate points along the path
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);

    const x = A * Math.cos(lat1Rad) * Math.cos(lon1Rad) + B * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = A * Math.cos(lat1Rad) * Math.sin(lon1Rad) + B * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = A * Math.sin(lat1Rad) + B * Math.sin(lat2Rad);

    const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    let lon = (Math.atan2(y, x) * 180) / Math.PI;

    // Normalize longitude back to -180 to 180 range
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;

    path.push([lat, lon]);
  }

  // If path crosses dateline, split into segments
  if (crossesDateline) {
    const segments = [];
    let currentSegment = [path[0]];

    for (let i = 1; i < path.length; i++) {
      const prevLon = path[i - 1][1];
      const currLon = path[i][1];

      // Check if this segment crosses dateline (jump > 180°)
      if (Math.abs(currLon - prevLon) > 180) {
        // Finish current segment
        segments.push(currentSegment);
        // Start new segment
        currentSegment = [path[i]];
      } else {
        currentSegment.push(path[i]);
      }
    }

    // Add final segment
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    return segments;
  }

  // Return single segment
  return [path];
}

// Convert frequency to band
function freqToBand(freq) {
  freq = freq / 1000; // Convert to MHz
  if (freq >= 1.8 && freq < 2.0) return '160m';
  if (freq >= 3.5 && freq < 4.0) return '80m';
  if (freq >= 5.3 && freq < 5.4) return '60m';
  if (freq >= 7.0 && freq < 7.3) return '40m';
  if (freq >= 10.1 && freq < 10.15) return '30m';
  if (freq >= 14.0 && freq < 14.35) return '20m';
  if (freq >= 18.068 && freq < 18.168) return '17m';
  if (freq >= 21.0 && freq < 21.45) return '15m';
  if (freq >= 24.89 && freq < 24.99) return '12m';
  if (freq >= 28.0 && freq < 29.7) return '10m';
  if (freq >= 40.0 && freq < 42.0) return '8m';
  if (freq >= 50.0 && freq < 54.0) return '6m';
  if (freq >= 70.0 && freq < 70.5) return '4m';
  return 'Other';
}

function normalizeBandKey(band) {
  if (band == null) return null;
  const raw = String(band).trim().toLowerCase();
  if (!raw || raw === 'other') return null;
  if (raw.endsWith('cm') || raw.endsWith('m')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
}

export function useLayer({
  enabled = false,
  opacity = 0.7,
  map = null,
  callsign,
  lowMemoryMode = false,
  mapBandFilter,
}) {
  const [spots, setSpots] = useState([]);
  const [selectedBand, setSelectedBand] = useState('all');
  const [timeWindow, setTimeWindow] = useState(lowMemoryMode ? 2 : 5); // minutes - shorter in low memory
  const [minSNR, setMinSNR] = useState(-10);
  const [showPaths, setShowPaths] = useState(true);
  const [spotterFilter, setSpotterFilter] = useState('');
  const [queryMode, setQueryMode] = useState('dx'); // 'dx' = who hears me, 'spotter' = what does a skimmer hear
  const [stats, setStats] = useState({ total: 0, skimmers: 0, avgSNR: 0 });

  // Low memory mode limits
  const UPDATE_INTERVAL = lowMemoryMode ? 30000 : 10000; // 10s normal, 30s low-memory (panel says "Update: 10sec")

  const layersRef = useRef([]);
  const controlRef = useRef(null);
  const updateIntervalRef = useRef(null);

  // Fetch RBN spots
  const fetchRBNSpots = async () => {
    // In spotter mode, query by the spotter callsign; in dx mode, query by user's callsign
    let queryCallsign;
    let queryModeParam;
    if (queryMode === 'spotter' && spotterFilter.trim()) {
      queryCallsign = spotterFilter.split(',')[0].trim().toUpperCase();
      queryModeParam = 'spotter';
    } else {
      queryCallsign = callsign;
      queryModeParam = 'dx';
    }

    if (!queryCallsign || queryCallsign === 'N0CALL') {
      if (queryMode === 'spotter') {
        console.log('[RBN] Spotter mode: enter a skimmer callsign');
      } else {
        console.log('[RBN] No valid callsign configured');
      }
      return;
    }

    try {
      // Server filters by callsign and enriches with locations — no client-side firehose scanning
      const response = await fetch(
        `/api/rbn/spots?callsign=${encodeURIComponent(queryCallsign)}&minutes=${Math.ceil(timeWindow)}&mode=${queryModeParam}`,
        { headers: { Accept: 'application/json' } },
      );

      if (!response.ok) {
        throw new Error(`RBN API error: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.spots && Array.isArray(data.spots)) {
        const mySpots = data.spots;

        console.log(`[RBN] Received ${mySpots.length} spots for ${callsign}`);

        // Log spot details
        if (mySpots.length > 0) {
          mySpots.forEach((spot, idx) => {
            if (queryMode === 'spotter') {
              console.log(
                `  ${idx + 1}. DX: ${spot.dx}, Skimmer: ${spot.callsign}, Freq: ${spot.freqMHz} MHz, SNR: ${spot.snr} dB, Band: ${spot.band}, dxLat: ${spot.dxLat ?? 'MISSING'}, dxLon: ${spot.dxLon ?? 'MISSING'}, dxGrid: ${spot.dxGrid ?? 'MISSING'}`,
              );
            } else {
              console.log(
                `  ${idx + 1}. Skimmer: ${spot.callsign}, Freq: ${spot.freqMHz} MHz, SNR: ${spot.snr} dB, Band: ${spot.band}, Grid: ${spot.grid ?? 'MISSING'}, Lat: ${spot.skimmerLat ?? '?'}, Lon: ${spot.skimmerLon ?? '?'}`,
              );
            }
          });
        }

        // Client-side location fallback for any spots the server couldn't resolve
        const enrichedSpots = await Promise.all(
          mySpots.map(async (spot) => {
            if (spot.grid && spot.skimmerLat != null && spot.skimmerLon != null) return spot;
            try {
              const locationResponse = await fetch(`/api/rbn/location/${spot.callsign}`);
              if (locationResponse.ok) {
                const loc = await locationResponse.json();
                return {
                  ...spot,
                  grid: loc.grid,
                  skimmerLat: loc.lat,
                  skimmerLon: loc.lon,
                  skimmerCountry: loc.country,
                };
              }
            } catch (err) {
              console.warn(`[RBN] Location fallback failed for ${spot.callsign}`);
            }
            return spot;
          }),
        );

        // Store ALL spots — the render effect handles band/SNR/age filtering
        // so slider changes take effect instantly without re-fetching
        setSpots(enrichedSpots);

        // Calculate statistics from all spots
        const validSNRs = enrichedSpots.map((s) => s.snr).filter((snr) => snr !== null && snr !== undefined);

        if (queryModeParam === 'spotter') {
          const uniqueDX = new Set(enrichedSpots.map((s) => s.dx));
          setStats({
            total: enrichedSpots.length,
            skimmers: uniqueDX.size, // In spotter mode, show unique DX stations count
            avgSNR: validSNRs.length > 0 ? (validSNRs.reduce((a, b) => a + b, 0) / validSNRs.length).toFixed(1) : 0,
          });
        } else {
          const uniqueSkimmers = new Set(enrichedSpots.map((s) => s.callsign));
          setStats({
            total: enrichedSpots.length,
            skimmers: uniqueSkimmers.size,
            avgSNR: validSNRs.length > 0 ? (validSNRs.reduce((a, b) => a + b, 0) / validSNRs.length).toFixed(1) : 0,
          });
        }
      }
    } catch (error) {
      console.error('[RBN] Error fetching spots:', error);
    }
  };

  // Fetch data on mount and set interval
  useEffect(() => {
    const shouldFetch = enabled && (queryMode === 'spotter' ? spotterFilter.trim() : callsign && callsign !== 'N0CALL');

    if (shouldFetch) {
      fetchRBNSpots();
      updateIntervalRef.current = setInterval(fetchRBNSpots, UPDATE_INTERVAL);
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [enabled, callsign, timeWindow, queryMode, spotterFilter]);

  // Render markers and paths
  useEffect(() => {
    if (!map || !enabled) return;

    // Clear old layers
    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    layersRef.current = [];

    if (spots.length === 0) return;

    // Get user's location (DE marker)
    const deLocation = window.deLocation || { lat: 43.6785, lon: -79.2935 }; // Default to Toronto

    // Filter spots by band, SNR, and AGE
    const now = Date.now();
    const timeWindowMs = timeWindow * 60 * 1000; // Convert minutes to milliseconds
    const selectedMapBands = Array.isArray(mapBandFilter)
      ? new Set(mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean))
      : new Set();
    const hasMapBandFilter = selectedMapBands.size > 0;

    // Parse spotter filter: comma-separated callsigns (case-insensitive)
    // In spotter mode, the filter is used as the query target, not a client-side filter
    const spotterCallsigns =
      queryMode === 'dx' && spotterFilter
        ? spotterFilter
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];

    const filteredSpots = spots.filter((spot) => {
      const band = freqToBand(spot.frequency || spot.freq || 0);
      const normalizedBand = normalizeBandKey(spot.band || band);
      const snr = spot.snr || spot.db || 0;

      // Spotter filter (dx mode only) — only show spots from specific skimmer stations
      if (spotterCallsigns.length > 0) {
        const skimmer = (spot.callsign || '').toUpperCase();
        if (!spotterCallsigns.some((f) => skimmer.includes(f))) return false;
      }

      // Band filter
      if (selectedBand !== 'all' && selectedBand !== 'All' && band !== selectedBand) return false;
      if (hasMapBandFilter && (!normalizedBand || !selectedMapBands.has(normalizedBand))) return false;

      // SNR filter
      if (snr < minSNR) return false;

      // AGE filter - only show spots within the time window
      const spotTimestamp = new Date(spot.timestamp).getTime();
      const ageMs = now - spotTimestamp;
      if (ageMs > timeWindowMs) {
        return false; // Spot is too old, don't show it
      }

      return true;
    });

    console.log(
      `[RBN] Rendering ${filteredSpots.length} spots (within ${timeWindow < 1 ? (timeWindow * 60).toFixed(0) + 's' : timeWindow.toFixed(1) + 'min'} window)`,
    );

    // In spotter mode, resolve the spotter's own location for path origin
    let spotterOrigin = null;
    if (queryMode === 'spotter' && filteredSpots.length > 0) {
      const first = filteredSpots[0];
      if (first.skimmerLat != null && first.skimmerLon != null) {
        spotterOrigin = { lat: first.skimmerLat, lon: first.skimmerLon };
      } else if (first.grid) {
        spotterOrigin = gridToLatLon(first.grid);
      }
    }

    // Render each spot
    filteredSpots.forEach((spot) => {
      const snr = spot.snr || 0;
      const freq = spot.frequency || 0;
      const band = spot.band || freqToBand(freq);
      const timestamp = new Date(spot.timestamp);
      const markerSize = getMarkerSize(snr);
      const markerColor = getSNRColor(snr);

      if (queryMode === 'spotter') {
        // SPOTTER MODE: markers at DX station locations, paths from spotter to each DX
        const dxLat = spot.dxLat;
        const dxLon = spot.dxLon;
        if (!Number.isFinite(dxLat) || !Number.isFinite(dxLon)) return;

        const dxCall = spot.dx || 'Unknown';
        const dxGrid = spot.dxGrid || '';
        const skimmerCall = spot.callsign || 'Unknown';

        // Path from spotter to DX station
        if (showPaths && spotterOrigin) {
          const pathSegments = getGreatCirclePath(spotterOrigin.lat, spotterOrigin.lon, dxLat, dxLon);
          pathSegments.forEach((pathPoints) => {
            const pathLine = L.polyline(pathPoints, {
              color: getSNRColor(snr),
              weight: 2,
              opacity: opacity * 0.6,
              dashArray: '5, 5',
            });
            pathLine.addTo(map);
            layersRef.current.push(pathLine);
          });
        }

        // DX station marker
        const marker = L.circleMarker([dxLat, dxLon], {
          radius: markerSize,
          fillColor: markerColor,
          color: '#ffffff',
          weight: 2,
          opacity: opacity,
          fillOpacity: opacity * 0.8,
        });

        marker.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <strong>${esc(dxCall)}</strong><br>
            Spotted by: <strong>${esc(skimmerCall)}</strong><br>
            SNR: <strong>${snr} dB</strong><br>
            Band: <strong>${esc(band)}</strong><br>
            Freq: <strong>${(freq / 1000).toFixed(1)} kHz</strong><br>
            ${dxGrid ? `Grid: ${esc(dxGrid)}<br>` : ''}
            Time: ${timestamp.toLocaleTimeString()}
          </div>
        `);

        marker.addTo(map);
        layersRef.current.push(marker);
      } else {
        // DX MODE (default): markers at skimmer locations, paths from DE to skimmer
        const skimmerGrid = spot.grid;

        if (!skimmerGrid) {
          console.warn(`[RBN] No grid square for skimmer ${spot.callsign}`);
          return;
        }

        let skimmerLoc;
        if (spot.skimmerLat != null && spot.skimmerLon != null) {
          skimmerLoc = { lat: spot.skimmerLat, lon: spot.skimmerLon };
        } else {
          skimmerLoc = gridToLatLon(skimmerGrid);
        }

        if (!skimmerLoc) return;

        const skimmerCall = spot.callsign || 'Unknown';

        if (showPaths) {
          const pathSegments = getGreatCirclePath(deLocation.lat, deLocation.lon, skimmerLoc.lat, skimmerLoc.lon);
          pathSegments.forEach((pathPoints) => {
            const pathLine = L.polyline(pathPoints, {
              color: getSNRColor(snr),
              weight: 2,
              opacity: opacity * 0.6,
              dashArray: '5, 5',
            });
            pathLine.addTo(map);
            layersRef.current.push(pathLine);
          });
        }

        const marker = L.circleMarker([skimmerLoc.lat, skimmerLoc.lon], {
          radius: markerSize,
          fillColor: markerColor,
          color: '#ffffff',
          weight: 2,
          opacity: opacity,
          fillOpacity: opacity * 0.8,
        });

        marker.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <strong>📡 ${esc(skimmerCall)}</strong><br>
            Heard: <strong>${esc(callsign)}</strong><br>
            SNR: <strong>${snr} dB</strong><br>
            Band: <strong>${esc(band)}</strong><br>
            Freq: <strong>${(freq / 1000).toFixed(1)} kHz</strong><br>
            Grid: ${esc(skimmerGrid)}<br>
            Time: ${timestamp.toLocaleTimeString()}
          </div>
        `);

        marker.addTo(map);
        layersRef.current.push(marker);
      }
    });
  }, [
    map,
    enabled,
    spots,
    selectedBand,
    minSNR,
    showPaths,
    opacity,
    callsign,
    timeWindow,
    mapBandFilter,
    spotterFilter,
    queryMode,
  ]);

  // Create control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'rbn-control', panelWrapper);
        div.style.cssText = `
          min-width: 250px;
          max-width: 300px;
        `;
        div.innerHTML = `
        <div class="floating-panel-header">📡 RBN: ${callsign}</div>

          <div id="rbn-stats-display" style="margin-bottom: 8px; color: var(--text-secondary);">
          Spots: <strong>0</strong> | Skimmers: <strong>0</strong><br>
          Avg SNR: <strong>0 dB</strong>
        </div>
        <div style="margin-bottom: 6px;">
          <label>Mode:</label>
          <select id="rbn-query-mode" style="width: 100%; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px;">
            <option value="dx">Who hears me?</option>
            <option value="spotter">What does a skimmer hear?</option>
          </select>
        </div>
        <div id="rbn-spotter-section" style="margin-bottom: 6px;">
          <label id="rbn-spotter-label">Spotter:</label>
          <input type="text" id="rbn-spotter-filter" placeholder="e.g. NU4F, W3LPL" style="width: 100%; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px; font-size: 12px; box-sizing: border-box;">
          <div id="rbn-spotter-hint" style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">Comma-separated. Leave blank for all.</div>
        </div>
        <div style="margin-bottom: 6px;">
          <label>Band:</label>
          <select id="rbn-band-select" style="width: 100%; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px;">
            <option value="all">All Bands</option>
            <option value="160m">160m</option>
            <option value="80m">80m</option>
            <option value="40m">40m</option>
            <option value="30m">30m</option>
            <option value="20m">20m</option>
            <option value="17m">17m</option>
            <option value="15m">15m</option>
            <option value="12m">12m</option>
            <option value="10m">10m</option>
            <option value="8m">8m</option>
            <option value="6m">6m</option>
            <option value="4m">4m</option>
          </select>
        </div>
        <div style="margin-bottom: 6px;">
          <label>Time: <span id="rbn-time-value">5.0min</span></label>
          <input type="range" id="rbn-time-slider" min="0.1" max="15" step="0.1" value="5" style="width: 100%;">
        </div>
        <div style="margin-bottom: 6px;">
          <label>Min SNR: <span id="rbn-snr-value">-10</span> dB</label>
          <input type="range" id="rbn-snr-slider" min="-30" max="30" step="5" value="-10" style="width: 100%;">
        </div>
        <div style="margin-bottom: 4px;">
          <label>
            <input type="checkbox" id="rbn-paths-check" checked>
            Show Paths
          </label>
        </div>
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-color); font-size: 10px; color: var(--text-muted);">
          Data: reversebeacon.net | Update: 10sec
        </div>
        `;

        // Add event listeners
        setTimeout(() => {
          const modeSelect = document.getElementById('rbn-query-mode');
          const spotterInput = document.getElementById('rbn-spotter-filter');
          const spotterLabel = document.getElementById('rbn-spotter-label');
          const spotterHint = document.getElementById('rbn-spotter-hint');
          const bandSelect = document.getElementById('rbn-band-select');
          const timeSlider = document.getElementById('rbn-time-slider');
          const timeValue = document.getElementById('rbn-time-value');
          const snrSlider = document.getElementById('rbn-snr-slider');
          const snrValue = document.getElementById('rbn-snr-value');
          const pathsCheck = document.getElementById('rbn-paths-check');

          // Helper to update spotter input labels based on mode
          const updateSpotterUI = (mode) => {
            if (!spotterInput || !spotterLabel || !spotterHint) return;
            if (mode === 'spotter') {
              spotterLabel.textContent = 'Skimmer callsign:';
              spotterInput.placeholder = 'e.g. KD2OGR, W3LPL';
              spotterHint.textContent = 'Enter a skimmer callsign to see what it hears.';
            } else {
              spotterLabel.textContent = 'Spotter:';
              spotterInput.placeholder = 'e.g. NU4F, W3LPL';
              spotterHint.textContent = 'Comma-separated. Leave blank for all.';
            }
          };

          if (modeSelect) {
            modeSelect.value = queryMode;
            updateSpotterUI(queryMode);
            modeSelect.addEventListener('change', (e) => {
              setQueryMode(e.target.value);
              updateSpotterUI(e.target.value);
            });
          }

          if (spotterInput) {
            spotterInput.value = spotterFilter;
            let spotterDebounce = null;
            spotterInput.addEventListener('input', (e) => {
              clearTimeout(spotterDebounce);
              spotterDebounce = setTimeout(() => setSpotterFilter(e.target.value), 300);
            });
          }

          if (bandSelect) {
            bandSelect.value = selectedBand;
            bandSelect.addEventListener('change', (e) => setSelectedBand(e.target.value));
          }

          if (timeSlider && timeValue) {
            // Set initial value
            timeSlider.value = timeWindow;
            if (timeWindow < 1) {
              timeValue.textContent = (timeWindow * 60).toFixed(0) + 's';
            } else {
              timeValue.textContent = timeWindow.toFixed(1) + 'min';
            }

            timeSlider.addEventListener('input', (e) => {
              const val = parseFloat(e.target.value);
              // Display as seconds if < 1 minute, otherwise minutes
              if (val < 1) {
                timeValue.textContent = (val * 60).toFixed(0) + 's';
              } else {
                timeValue.textContent = val.toFixed(1) + 'min';
              }
              setTimeWindow(val);
            });
          }

          if (snrSlider && snrValue) {
            snrSlider.value = minSNR;
            snrValue.textContent = minSNR;
            snrSlider.addEventListener('input', (e) => {
              const val = e.target.value;
              snrValue.textContent = val;
              setMinSNR(parseInt(val));
            });
          }

          if (pathsCheck) {
            pathsCheck.checked = showPaths;
            pathsCheck.addEventListener('change', (e) => setShowPaths(e.target.checked));
          }
        }, 100);

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        return panelWrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    // Make the control draggable and minimizable
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      // const container = control.getContainer();
      const container = document.querySelector('.rbn-control');
      if (container) {
        // Apply saved position IMMEDIATELY before making draggable
        const saved = localStorage.getItem('rbn-panel-position');
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

        makeDraggable(container, 'rbn-panel-position', { snap: 5 });
        addMinimizeToggle(container, 'rbn-panel-position', {
          contentClassName: 'rbn-panel-content',
          buttonClassName: 'rbn-minimize-btn',
        });
      }
    }, 150);

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, enabled, callsign]); // Only recreate when map, enabled, or callsign changes — mode switch updates labels via DOM

  // Separate effect to update stats display without recreating the entire control
  useEffect(() => {
    if (!enabled || !controlRef.current) return;

    const container = controlRef.current.getContainer();
    if (!container) return;

    // Find stats display (before minimize toggle wraps content)
    const statsDisplay =
      container.querySelector('#rbn-stats-display') || container.querySelector('.rbn-panel-content #rbn-stats-display');

    if (statsDisplay) {
      const countLabel = queryMode === 'spotter' ? 'DX Stations' : 'Skimmers';
      statsDisplay.innerHTML = `
        Spots: <strong>${stats.total}</strong> | ${countLabel}: <strong>${stats.skimmers}</strong><br>
        Avg SNR: <strong>${stats.avgSNR} dB</strong>
      `;
    }
  }, [enabled, stats, queryMode]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled) {
      layersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      layersRef.current = [];

      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    }
  }, [enabled, map]);

  return null;
}
