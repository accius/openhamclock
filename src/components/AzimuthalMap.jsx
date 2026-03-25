/**
 * AzimuthalMap Component
 * Canvas-based azimuthal equidistant projection centered on DE (user's QTH).
 * Great circle paths are straight lines. Bearings read directly off the map.
 *
 * A transparent Leaflet overlay map (using azimuthal CRS) is layered on top
 * so that ALL plugin layers (satellites, lightning, aurora, etc.) work.
 * Leaflet handles pan/zoom; canvas syncs to Leaflet's view state.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { getBandColor, getBandFromFreq } from '../utils/callsign.js';
import { calculateGridSquare } from '../utils/geo.js';
import { MAP_STYLES } from '../utils/config.js';
import { createTileReprojector } from '../utils/tileReproject.js';
import { createAzimuthalCRS } from '../utils/azimuthalCRS.js';
import { matchesDXSpotPath } from '../utils/dxClusterSpotMatcher';

// ── Projection Math ────────────────────────────────────────
const DEG = Math.PI / 180;

function project(lat, lon, lat0, lon0) {
  const φ = lat * DEG,
    λ = lon * DEG;
  const φ0 = lat0 * DEG,
    λ0 = lon0 * DEG;
  const cosC = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
  if (c < 1e-10) return { x: 0, y: 0, dist: 0 };
  const k = c / Math.sin(c);
  return {
    x: k * Math.cos(φ) * Math.sin(λ - λ0),
    y: -(k * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ - λ0))),
    dist: c * 6371, // distance in km
  };
}

// ── GeoJSON Cache ──────────────────────────────────────────
let geoCache = null;
async function fetchLand() {
  if (geoCache) return geoCache;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
    geoCache = await res.json();
  } catch {
    geoCache = { features: [] };
  }
  return geoCache;
}

// ── Helpers ────────────────────────────────────────────────
const normalizeBandKey = (band) => {
  if (band == null) return null;
  const raw = String(band).trim().toLowerCase();
  if (!raw || raw === 'other') return null;
  if (raw.endsWith('cm') || raw.endsWith('m')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
};

// Countries style: consistent color per country name (matches WorldMap)
const COUNTRY_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
  '#808000',
  '#000075',
  '#e6beff',
  '#ff6961',
  '#77dd77',
  '#fdfd96',
  '#84b6f4',
  '#fdcae1',
  '#c1e1c1',
  '#b39eb5',
  '#ffb347',
];
function hashCountryColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return COUNTRY_COLORS[Math.abs(hash) % COUNTRY_COLORS.length];
}

const bandFromAnyFrequency = (freq) => {
  if (freq == null || freq === '') return null;
  const n = parseFloat(freq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return normalizeBandKey(getBandFromFreq(n));
};

// ── Component ──────────────────────────────────────────────
export default function AzimuthalMap({
  leafletReady,
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,
  potaSpots,
  wwffSpots,
  sotaSpots,
  wwbotaSpots,
  dxPaths,
  dxFilters,
  mapBandFilter,
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths,
  showPOTA,
  showWWFF,
  showSOTA,
  showWWBOTA,
  showPSKReporter,
  showPSKPaths = true,
  showMutualReception = true,
  showWSJTX,
  onSpotClick,
  hoveredSpot,
  callsign,
  hideOverlays,
  hideUi = false,
  tileStyle = null,
  gibsOffset = 0,
  lowMemoryMode = false,
  onMapReady,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const leafletDivRef = useRef(null);
  const leafletMapRef = useRef(null);
  const geoRef = useRef(null);
  const reprojRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tilesReady, setTilesReady] = useState(false);
  const interactingRef = useRef(false);
  const interactTimer = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  // View state derived from Leaflet (or default before Leaflet init)
  const [viewState, setViewState] = useState(null);

  const selectedMapBands = Array.isArray(mapBandFilter)
    ? new Set(mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean))
    : new Set();
  const hasMapBandFilter = selectedMapBands.size > 0;
  const bandPassesMapFilter = (band) => {
    if (!hasMapBandFilter) return true;
    const key = normalizeBandKey(band);
    return !!key && selectedMapBands.has(key);
  };

  const lat0 = deLocation?.lat || 0;
  const lon0 = deLocation?.lon || 0;

  // Load GeoJSON once
  useEffect(() => {
    fetchLand().then((geo) => {
      geoRef.current = geo;
    });
  }, []);

  // ── Leaflet overlay map ────────────────────────────────────
  const deKeyRef = useRef(`${lat0},${lon0}`);

  useEffect(() => {
    const L = window.L;
    if (!L || !leafletDivRef.current) return;

    // Compute initial zoom: globe radius fills canvas
    const initR = Math.min(size.w, size.h) / 2 - 20;
    const initZoom = Math.log2(Math.max(1, initR / Math.PI));

    const crs = createAzimuthalCRS(lat0, lon0);
    if (!crs) return;

    const map = L.map(leafletDivRef.current, {
      crs,
      center: [lat0, lon0],
      zoom: initZoom,
      zoomSnap: 0,
      zoomDelta: 0.5,
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    leafletMapRef.current = map;
    deKeyRef.current = `${lat0},${lon0}`;

    // Sync canvas to Leaflet view
    const syncView = () => {
      const dePx = map.latLngToContainerPoint([lat0, lon0]);
      const R = Math.PI * Math.pow(2, map.getZoom());
      setViewState({ cx: dePx.x, cy: dePx.y, R, scale: R / Math.PI });
    };

    map.on('move zoom viewreset resize', syncView);
    syncView(); // initial sync

    // Click → set DX
    map.on('click', (e) => {
      if (dxLocked || !onDXChange) return;
      onDXChange({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    // Tooltip on mousemove
    map.on('mousemove', (e) => {
      const p = project(e.latlng.lat, e.latlng.lng, lat0, lon0);
      const bearing =
        (Math.atan2(
          Math.sin((e.latlng.lng - lon0) * DEG) * Math.cos(e.latlng.lat * DEG),
          Math.cos(lat0 * DEG) * Math.sin(e.latlng.lat * DEG) -
            Math.sin(lat0 * DEG) * Math.cos(e.latlng.lat * DEG) * Math.cos((e.latlng.lng - lon0) * DEG),
        ) /
          DEG +
          360) %
        360;
      setTooltip({
        x: e.containerPoint.x,
        y: e.containerPoint.y,
        text: `${e.latlng.lat.toFixed(1)}°, ${e.latlng.lng.toFixed(1)}°  ${calculateGridSquare(e.latlng.lat, e.latlng.lng)}  ${Math.round(p.dist)} km  ${Math.round(bearing)}°`,
      });
    });
    map.on('mouseout', () => setTooltip(null));

    // Track interaction for half-res tile rendering
    map.on('movestart zoomstart', () => {
      interactingRef.current = true;
    });
    map.on('moveend zoomend', () => {
      clearTimeout(interactTimer.current);
      interactTimer.current = setTimeout(() => {
        interactingRef.current = false;
      }, 200);
    });

    if (onMapReady) onMapReady(map);

    return () => {
      map.off();
      map.remove();
      leafletMapRef.current = null;
      if (onMapReady) onMapReady(null);
    };
  }, [lat0, lon0, size.w > 0 ? 1 : 0, leafletReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve tile URL template for current style
  const useTiles =
    tileStyle &&
    tileStyle !== 'plain' &&
    MAP_STYLES[tileStyle] &&
    !MAP_STYLES[tileStyle].isCanvas &&
    !MAP_STYLES[tileStyle].countriesOverlay;
  const tileUrlTemplate = useTiles
    ? tileStyle === 'MODIS'
      ? (() => {
          const date = new Date(Date.now() - ((gibsOffset || 0) * 24 + 12) * 60 * 60 * 1000);
          const ds = date.toISOString().split('T')[0];
          return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${ds}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
        })()
      : MAP_STYLES[tileStyle].url
    : null;

  // Init / destroy / update reprojector
  useEffect(() => {
    if (!tileUrlTemplate) {
      if (reprojRef.current) {
        reprojRef.current.destroy();
        reprojRef.current = null;
      }
      setTilesReady(false);
      return;
    }

    if (!reprojRef.current) {
      reprojRef.current = createTileReprojector({
        tileUrlTemplate,
        onProgress: (p) => {
          if (p >= 1) setTilesReady(true);
        },
      });
    } else {
      reprojRef.current.setUrl(tileUrlTemplate);
    }
    setTilesReady(false);
    const rp = reprojRef.current;
    // Derive zoom/pan from viewState for the reprojector
    const vs = viewState || {
      cx: size.w / 2,
      cy: size.h / 2,
      R: Math.min(size.w, size.h) / 2 - 20,
      scale: (Math.min(size.w, size.h) / 2 - 20) / Math.PI,
    };
    const azZoom = vs.R / (Math.min(size.w, size.h) / 2 - 20) || 1;
    rp.render({
      canvasWidth: size.w,
      canvasHeight: size.h,
      centerLat: lat0,
      centerLon: lon0,
      zoom: azZoom,
      panX: vs.cx - size.w / 2,
      panY: vs.cy - size.h / 2,
      lowMemory: lowMemoryMode,
    })
      .then(() => setTilesReady(true))
      .catch(() => {});

    return () => {};
  }, [tileUrlTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reprojRef.current) {
        reprojRef.current.destroy();
        reprojRef.current = null;
      }
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      setSize({ w, h });
      // Notify Leaflet of size change
      if (leafletMapRef.current) {
        leafletMapRef.current.invalidateSize({ animate: false });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Coordinate conversion (using viewState) ────────────────
  const vs = viewState || {
    cx: size.w / 2,
    cy: size.h / 2,
    R: Math.min(size.w, size.h) / 2 - 20,
    scale: (Math.min(size.w, size.h) / 2 - 20) / Math.PI,
  };

  const toCanvas = useCallback(
    (lat, lon) => {
      const p = project(lat, lon, lat0, lon0);
      return {
        x: vs.cx + p.x * vs.scale,
        y: vs.cy + p.y * vs.scale,
        dist: p.dist,
      };
    },
    [lat0, lon0, vs.cx, vs.cy, vs.scale],
  );

  // ── Canvas Render ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { cx, cy, R, scale } = vs;

    const isCountriesStyle = tileStyle === 'countries';

    // Background — dark ocean (or blue for countries style)
    ctx.fillStyle = isCountriesStyle ? '#2a5a9a' : '#0a0f1a';
    ctx.fillRect(0, 0, size.w, size.h);

    // Globe circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = isCountriesStyle ? '#4a90d9' : '#0d1a2d';
    ctx.fill();
    ctx.clip();

    // ── Globe background: tile imagery or GeoJSON polygons ──
    let tileImageDrawn = false;
    if (useTiles && reprojRef.current && tilesReady && reprojRef.current.isReady()) {
      try {
        const azZoom = R / (Math.min(size.w, size.h) / 2 - 20) || 1;
        const imageData = reprojRef.current.reprojectSync({
          canvasWidth: size.w,
          canvasHeight: size.h,
          centerLat: lat0,
          centerLon: lon0,
          zoom: azZoom,
          panX: cx - size.w / 2,
          panY: cy - size.h / 2,
          halfRes: interactingRef.current,
          lowMemory: lowMemoryMode,
        });
        if (imageData) {
          // putImageData ignores canvas transforms (DPR scaling), so paint
          // via a temp canvas + drawImage which respects the current transform.
          const tmp = document.createElement('canvas');
          tmp.width = imageData.width;
          tmp.height = imageData.height;
          tmp.getContext('2d').putImageData(imageData, 0, 0);
          ctx.drawImage(tmp, 0, 0);
          tileImageDrawn = true;
        }
      } catch (e) {
        console.warn('[AzimuthalMap] Tile render failed, falling back to plain:', e);
      }
    }

    // Fall back to GeoJSON land masses if no tile imagery (or always for countries style)
    if (!tileImageDrawn || isCountriesStyle) {
      const geo = geoRef.current;
      if (geo?.features) {
        geo.features.forEach((feature) => {
          const geom = feature.geometry;
          if (!geom) return;

          // Countries style: per-country colors
          if (isCountriesStyle) {
            const name = feature.properties?.name || feature.id || 'Unknown';
            ctx.fillStyle = hashCountryColor(name);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
          } else {
            ctx.fillStyle = '#1a2a3a';
            ctx.strokeStyle = '#2a3a4a';
            ctx.lineWidth = 0.5;
          }

          const rings =
            geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

          rings.forEach((polygon) => {
            polygon.forEach((ring) => {
              if (ring.length < 3) return;
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < ring.length; i++) {
                const [lon, lat] = ring[i];
                const p = project(lat, lon, lat0, lon0);
                const px = cx + p.x * scale;
                const py = cy + p.y * scale;
                if (!started) {
                  ctx.moveTo(px, py);
                  started = true;
                } else ctx.lineTo(px, py);
              }
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            });
          });
        });
      }
    }

    // Re-clip after putImageData (putImageData ignores clip)
    if (tileImageDrawn) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
    }

    // ── Distance rings ───────────────────────────────────
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    const ringDistances = [2000, 5000, 10000, 15000, 20000]; // km
    ringDistances.forEach((km) => {
      const angularDist = km / 6371; // radians
      const r = angularDist * scale;
      if (r > 2 && r < R * 1.5) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.fillStyle = 'rgba(0, 255, 204, 0.3)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const labelText = km >= 1000 ? `${km / 1000}k km` : `${km} km`;
        ctx.fillText(labelText, cx, cy - r + 12);
      }
    });
    ctx.setLineDash([]);

    // ── Bearing lines (every 30°) ────────────────────────
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    const bearingLabels = ['N', '30', '60', 'E', '120', '150', 'S', '210', '240', 'W', '300', '330'];
    for (let b = 0; b < 360; b += 30) {
      const rad = (b - 90) * DEG; // -90 because canvas Y is flipped
      const endX = cx + Math.cos(rad) * R;
      const endY = cy + Math.sin(rad) * R;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Bearing label outside circle
      const labelR = R + 14;
      const lx = cx + Math.cos(rad) * labelR;
      const ly = cy + Math.sin(rad) * labelR;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.font = b % 90 === 0 ? 'bold 11px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bearingLabels[b / 30], lx, ly);
    }

    // ── DX Cluster paths ─────────────────────────────────
    if (showDXPaths && dxPaths?.length > 0) {
      dxPaths.forEach((path) => {
        if (!path.dxLat || !path.dxLon) return;
        const band = bandFromAnyFrequency(path.freq);
        if (!bandPassesMapFilter(band)) return;

        const freq = parseFloat(path.freq);
        const color = getBandColor(freq);
        const isHovered = matchesDXSpotPath(hoveredSpot, path);

        const p = toCanvas(path.dxLat, path.dxLon);

        // Only draw spotter circle and lines if spotter coordinates are valid (not null/undefined).
        // Using != null instead of truthy check (&&) ensures coordinates at 0,0 are handled correctly.
        if (Number.isFinite(path.spotterLat) && Number.isFinite(path.spotterLon)) {
          const s = toCanvas(path.spotterLat, path.spotterLon);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          const steps = 30;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const d = Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  Math.sin(path.spotterLat * DEG) * Math.sin(path.dxLat * DEG) +
                    Math.cos(path.spotterLat * DEG) *
                      Math.cos(path.dxLat * DEG) *
                      Math.cos((path.dxLon - path.spotterLon) * DEG),
                ),
              ),
            );
            if (d < 1e-6) continue;
            const A = Math.sin((1 - t) * d) / Math.sin(d);
            const B = Math.sin(t * d) / Math.sin(d);
            const x =
              A * Math.cos(path.spotterLat * DEG) * Math.cos(path.spotterLon * DEG) +
              B * Math.cos(path.dxLat * DEG) * Math.cos(path.dxLon * DEG);
            const y =
              A * Math.cos(path.spotterLat * DEG) * Math.sin(path.spotterLon * DEG) +
              B * Math.cos(path.dxLat * DEG) * Math.sin(path.dxLon * DEG);
            const z = A * Math.sin(path.spotterLat * DEG) + B * Math.sin(path.dxLat * DEG);
            const iLat = Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG;
            const iLon = Math.atan2(y, x) / DEG;
            const ip = toCanvas(iLat, iLon);
            ctx.lineTo(ip.x, ip.y);
          }
          ctx.strokeStyle = isHovered ? '#ffffff' : color;
          ctx.lineWidth = isHovered ? 3 : 1.2;
          ctx.globalAlpha = isHovered ? 1 : 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // DX dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, isHovered ? 8 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#ffffff' : color;
        ctx.fill();
        ctx.strokeStyle = isHovered ? color : '#fff';
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.stroke();
      });
    }

    // ── PSK Reporter spots ───────────────────────────────
    // Build mutual reception lookup for gold ring indicators
    const pskMutualSet = new Set();
    if (showMutualReception && pskReporterSpots?.length > 0) {
      const txSet = new Set();
      const rxSet = new Set();
      for (const s of pskReporterSpots) {
        if (s.direction === 'tx') txSet.add(`${s.receiver?.toUpperCase()}|${s.band}`);
        else if (s.direction === 'rx') rxSet.add(`${s.sender?.toUpperCase()}|${s.band}`);
      }
      for (const key of txSet) {
        if (rxSet.has(key)) pskMutualSet.add(key);
      }
    }

    if (showPSKReporter && pskReporterSpots?.length > 0) {
      pskReporterSpots.forEach((spot) => {
        const lat = parseFloat(spot.lat);
        const lon = parseFloat(spot.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        const freqMHz = spot.freqMHz || (spot.freq ? spot.freq / 1e6 : 0);
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(freqMHz || spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const displayCall = spot.direction === 'rx' ? spot.sender : spot.receiver;
        const mutual = pskMutualSet.has(`${displayCall?.toUpperCase()}|${spot.band}`);
        const color = getBandColor(parseFloat(freqMHz));
        const p = toCanvas(lat, lon);

        if (showPSKPaths) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.3;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, mutual ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (mutual) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }

    // ── WSJT-X spots ─────────────────────────────────────
    if (showWSJTX && wsjtxSpots?.length > 0) {
      const seen = new Map();
      wsjtxSpots.forEach((s) => {
        const call = s.caller || s.dxCall || '';
        if (call && (!seen.has(call) || s.timestamp > seen.get(call).timestamp)) seen.set(call, s);
      });
      seen.forEach((spot) => {
        const lat = parseFloat(spot.lat);
        const lon = parseFloat(spot.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.dialFrequency || spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const p = toCanvas(lat, lon);
        const isEst = spot.gridSource === 'prefix';

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 1;
        ctx.globalAlpha = isEst ? 0.15 : 0.3;
        ctx.setLineDash([2, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#a78bfa';
        ctx.globalAlpha = isEst ? 0.5 : 0.9;
        ctx.fillRect(-3, -3, 6, 6);
        ctx.globalAlpha = 1;
        ctx.restore();
      });
    }

    // ── POTA spots ───────────────────────────────────────
    if (showPOTA && potaSpots?.length > 0) {
      potaSpots.forEach((spot) => {
        if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) return;
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const p = toCanvas(spot.lat, spot.lon);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 6);
        ctx.lineTo(p.x - 5, p.y + 4);
        ctx.lineTo(p.x + 5, p.y + 4);
        ctx.closePath();
        ctx.fillStyle = '#44cc44';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }

    // ── WWFF spots ───────────────────────────────────────
    if (showWWFF && wwffSpots?.length > 0) {
      wwffSpots.forEach((spot) => {
        if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) return;
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const p = toCanvas(spot.lat, spot.lon);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + 6);
        ctx.lineTo(p.x - 5, p.y - 4);
        ctx.lineTo(p.x + 5, p.y - 4);
        ctx.closePath();
        ctx.fillStyle = '#a3f3a3';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }

    // ── SOTA spots ───────────────────────────────────────
    if (showSOTA && sotaSpots?.length > 0) {
      sotaSpots.forEach((spot) => {
        if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) return;
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const p = toCanvas(spot.lat, spot.lon);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ff9632';
        ctx.fillRect(-4, -4, 8, 8);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(-4, -4, 8, 8);
        ctx.restore();
      });
    }

    // ── WWBOTA spots ─────────────────────────────────────
    if (showWWBOTA && wwbotaSpots?.length > 0) {
      wwbotaSpots.forEach((spot) => {
        if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) return;
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        const p = toCanvas(spot.lat, spot.lon);
        // Blue circle for WWBOTA
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#4488ff';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }

    // ── DX marker ────────────────────────────────────────
    if (Number.isFinite(dxLocation?.lat) && Number.isFinite(dxLocation?.lon)) {
      const dp = toCanvas(dxLocation.lat, dxLocation.lon);
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 170, 255, 0.3)';
      ctx.fill();
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#00aaff';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DX', dp.x, dp.y);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(dp.x, dp.y);
      ctx.strokeStyle = 'rgba(0, 170, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore(); // unclip

    // ── DE marker (always at center) ─────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 170, 0, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DE', cx, cy);

    // ── Info overlay ─────────────────────────────────────
    if (!hideOverlays) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(8, size.h - 30, 260, 22);
      ctx.fillStyle = '#00ffcc';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const grid = calculateGridSquare(lat0, lon0);
      ctx.fillText(`Azimuthal Equidistant · ${grid} · ${lat0.toFixed(2)}°, ${lon0.toFixed(2)}°`, 14, size.h - 19);
    }
  }, [
    size,
    viewState,
    lat0,
    lon0,
    deLocation,
    dxLocation,
    dxPaths,
    dxFilters,
    mapBandFilter,
    showDXPaths,
    hoveredSpot,
    potaSpots,
    showPOTA,
    wwffSpots,
    showWWFF,
    sotaSpots,
    showSOTA,
    wwbotaSpots,
    showWWBOTA,
    pskReporterSpots,
    showPSKReporter,
    showPSKPaths,
    showMutualReception,
    wsjtxSpots,
    showWSJTX,
    hideOverlays,
    toCanvas,
    useTiles,
    tilesReady,
    tileStyle,
    lowMemoryMode,
    vs,
  ]);

  // Globe clip path for the Leaflet overlay (hide markers outside globe)
  const clipStyle = viewState ? { clipPath: `circle(${viewState.R}px at ${viewState.cx}px ${viewState.cy}px)` } : {};

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: '8px',
        background: '#0a0f1a',
      }}
    >
      {/* Canvas — tile/GeoJSON background, distance rings, bearing lines, built-in overlays */}
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Leaflet overlay — transparent, handles interaction + plugin layers */}
      <div
        ref={leafletDivRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          zIndex: 1,
          ...clipStyle,
        }}
        className="azimuthal-leaflet-overlay"
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 14,
            top: tooltip.y - 28,
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '3px 8px',
            color: '#00ffcc',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2000,
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Zoom controls */}
      {!hideUi && leafletMapRef.current && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            zIndex: 1000,
          }}
        >
          <button onClick={() => leafletMapRef.current?.zoomIn(0.5)} style={zoomBtnStyle}>
            +
          </button>
          <button onClick={() => leafletMapRef.current?.zoomOut(0.5)} style={zoomBtnStyle}>
            −
          </button>
          <button
            onClick={() => {
              const map = leafletMapRef.current;
              if (!map) return;
              const initR = Math.min(size.w, size.h) / 2 - 20;
              const initZoom = Math.log2(Math.max(1, initR / Math.PI));
              map.setView([lat0, lon0], initZoom);
            }}
            title="Reset view"
            style={{ ...zoomBtnStyle, fontSize: '10px' }}
          >
            ⌂
          </button>
        </div>
      )}
    </div>
  );
}

const zoomBtnStyle = {
  width: '30px',
  height: '30px',
  background: 'rgba(0, 0, 0, 0.7)',
  border: '1px solid #555',
  borderRadius: '4px',
  color: '#ccc',
  fontSize: '16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '"JetBrains Mono", monospace',
};
