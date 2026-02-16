/**
 * AzimuthalMap Component
 * Canvas-based azimuthal equidistant projection centered on DE (user's QTH).
 * Great circle paths are straight lines. Bearings read directly off the map.
 *
 * Used when mapStyle === 'azimuthal' in WorldMap.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { getBandColor } from '../utils/callsign.js';
import { calculateGridSquare } from '../utils/geo.js';

// ── Projection Math ────────────────────────────────────────
const DEG = Math.PI / 180;

function project(lat, lon, lat0, lon0) {
  const φ = lat * DEG, λ = lon * DEG;
  const φ0 = lat0 * DEG, λ0 = lon0 * DEG;
  const cosC = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
  if (c < 1e-10) return { x: 0, y: 0, dist: 0 };
  const k = c / Math.sin(c);
  return {
    x: k * Math.cos(φ) * Math.sin(λ - λ0),
    y: -(k * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ - λ0))),
    dist: c * 6371 // distance in km
  };
}

function unproject(x, y, lat0, lon0) {
  const φ0 = lat0 * DEG, λ0 = lon0 * DEG;
  const ρ = Math.sqrt(x * x + y * y);
  if (ρ < 1e-10) return { lat: lat0, lon: lon0 };
  const c = ρ; // azimuthal equidistant: ρ = c
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const lat = Math.asin(cosC * Math.sin(φ0) + (-y * sinC * Math.cos(φ0)) / ρ) / DEG;
  const lon = (λ0 + Math.atan2(x * sinC, ρ * Math.cos(φ0) * cosC + y * Math.sin(φ0) * sinC)) / DEG;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}

// ── GeoJSON Cache ──────────────────────────────────────────
let geoCache = null;
async function fetchLand() {
  if (geoCache) return geoCache;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
    geoCache = await res.json();
  } catch { geoCache = { features: [] }; }
  return geoCache;
}

// ── Helpers ────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str);
}

// ── Component ──────────────────────────────────────────────
export default function AzimuthalMap({
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,
  potaSpots,
  wwffSpots,
  sotaSpots,
  dxPaths,
  dxFilters,
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths,
  showPOTA,
  showWWFF,
  showSOTA,
  showPSKReporter,
  showWSJTX,
  onSpotClick,
  hoveredSpot,
  callsign,
  hideOverlays,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const geoRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // pixel offset
  const dragRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const lat0 = deLocation?.lat || 0;
  const lon0 = deLocation?.lon || 0;

  // Load GeoJSON once
  useEffect(() => {
    fetchLand().then(geo => { geoRef.current = geo; });
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Coordinate conversion ────────────────────────────────
  const toCanvas = useCallback((lat, lon) => {
    const p = project(lat, lon, lat0, lon0);
    const scale = (Math.min(size.w, size.h) / 2 - 20) * zoom / Math.PI;
    return {
      x: size.w / 2 + p.x * scale + pan.x,
      y: size.h / 2 + p.y * scale + pan.y,
      dist: p.dist
    };
  }, [lat0, lon0, size.w, size.h, zoom, pan.x, pan.y]);

  const fromCanvas = useCallback((cx, cy) => {
    const scale = (Math.min(size.w, size.h) / 2 - 20) * zoom / Math.PI;
    const x = (cx - size.w / 2 - pan.x) / scale;
    const y = (cy - size.h / 2 - pan.y) / scale;
    if (Math.sqrt(x * x + y * y) > Math.PI) return null;
    return unproject(x, y, lat0, lon0);
  }, [lat0, lon0, size.w, size.h, zoom, pan.x, pan.y]);

  // ── Render ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const R = (Math.min(size.w, size.h) / 2 - 20) * zoom;
    const cx = size.w / 2 + pan.x;
    const cy = size.h / 2 + pan.y;
    const scale = R / Math.PI;

    // Background — dark ocean
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(0, 0, size.w, size.h);

    // Globe circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1a2d';
    ctx.fill();
    ctx.clip();

    // ── Land masses ──────────────────────────────────────
    const geo = geoRef.current;
    if (geo?.features) {
      ctx.fillStyle = '#1a2a3a';
      ctx.strokeStyle = '#2a3a4a';
      ctx.lineWidth = 0.5;

      geo.features.forEach(feature => {
        const geom = feature.geometry;
        if (!geom) return;
        const rings = geom.type === 'Polygon' ? [geom.coordinates] :
                      geom.type === 'MultiPolygon' ? geom.coordinates : [];

        rings.forEach(polygon => {
          polygon.forEach(ring => {
            if (ring.length < 3) return;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < ring.length; i++) {
              const [lon, lat] = ring[i];
              const p = project(lat, lon, lat0, lon0);
              const px = cx + p.x * scale;
              const py = cy + p.y * scale;
              if (!started) { ctx.moveTo(px, py); started = true; }
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          });
        });
      });
    }

    // ── Distance rings ───────────────────────────────────
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    const ringDistances = [2000, 5000, 10000, 15000, 20000]; // km
    ringDistances.forEach(km => {
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
      dxPaths.forEach(path => {
        if (!path.dxLat || !path.dxLon) return;
        const freq = parseFloat(path.freq);
        const color = getBandColor(freq);
        const isHovered = hoveredSpot?.call?.toUpperCase() === path.dxCall?.toUpperCase();

        // In azimuthal equidistant from center, great circles FROM center are straight lines
        // For paths not from center, we need to draw intermediate points
        const p = toCanvas(path.dxLat, path.dxLon);

        if (path.spotterLat && path.spotterLon) {
          const s = toCanvas(path.spotterLat, path.spotterLon);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          // Draw great circle with intermediate points
          const steps = 30;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const lat = path.spotterLat + (path.dxLat - path.spotterLat) * t;
            const lon = path.spotterLon + (path.dxLon - path.spotterLon) * t;
            // Proper great circle interpolation
            const d = Math.acos(Math.max(-1, Math.min(1,
              Math.sin(path.spotterLat * DEG) * Math.sin(path.dxLat * DEG) +
              Math.cos(path.spotterLat * DEG) * Math.cos(path.dxLat * DEG) *
              Math.cos((path.dxLon - path.spotterLon) * DEG)
            )));
            if (d < 1e-6) continue;
            const A = Math.sin((1 - t) * d) / Math.sin(d);
            const B = Math.sin(t * d) / Math.sin(d);
            const x = A * Math.cos(path.spotterLat * DEG) * Math.cos(path.spotterLon * DEG) +
                      B * Math.cos(path.dxLat * DEG) * Math.cos(path.dxLon * DEG);
            const y = A * Math.cos(path.spotterLat * DEG) * Math.sin(path.spotterLon * DEG) +
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
    if (showPSKReporter && pskReporterSpots?.length > 0) {
      pskReporterSpots.forEach(spot => {
        const lat = parseFloat(spot.lat);
        const lon = parseFloat(spot.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        const freqMHz = spot.freqMHz || (spot.freq ? spot.freq / 1e6 : 0);
        const color = getBandColor(parseFloat(freqMHz));
        const p = toCanvas(lat, lon);

        // Line from center
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

        // Dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }

    // ── WSJT-X spots ─────────────────────────────────────
    if (showWSJTX && wsjtxSpots?.length > 0) {
      const seen = new Map();
      wsjtxSpots.forEach(s => {
        const call = s.caller || s.dxCall || '';
        if (call && (!seen.has(call) || s.timestamp > seen.get(call).timestamp)) seen.set(call, s);
      });
      seen.forEach(spot => {
        const lat = parseFloat(spot.lat);
        const lon = parseFloat(spot.lon);
        if (isNaN(lat) || isNaN(lon)) return;
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

        // Diamond
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
      potaSpots.forEach(spot => {
        if (!spot.lat || !spot.lon) return;
        const p = toCanvas(spot.lat, spot.lon);
        // Green triangle
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
      wwffSpots.forEach(spot => {
        if (!spot.lat || !spot.lon) return;
        const p = toCanvas(spot.lat, spot.lon);
        // Light green inverted triangle
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
      sotaSpots.forEach(spot => {
        if (!spot.lat || !spot.lon) return;
        const p = toCanvas(spot.lat, spot.lon);
        // Orange diamond
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

    // ── DX marker ────────────────────────────────────────
    if (dxLocation?.lat != null && dxLocation?.lon != null) {
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

      // Line from center to DX
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

  }, [size, zoom, pan, lat0, lon0, deLocation, dxLocation,
      dxPaths, dxFilters, showDXPaths, hoveredSpot,
      potaSpots, showPOTA, wwffSpots, showWWFF,
      sotaSpots, showSOTA,
      pskReporterSpots, showPSKReporter,
      wsjtxSpots, showWSJTX,
      hideOverlays, toCanvas]);

  // ── Mouse handlers ───────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(prev => Math.max(0.5, Math.min(8, prev * (e.deltaY < 0 ? 1.15 : 0.87))));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 0) {
      dragRef.current = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
    }
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (dragRef.current) {
      setPan({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
      return;
    }
    // Tooltip
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pos = fromCanvas(mx, my);
    if (pos) {
      const bearing = ((Math.atan2(
        Math.sin((pos.lon - lon0) * DEG) * Math.cos(pos.lat * DEG),
        Math.cos(lat0 * DEG) * Math.sin(pos.lat * DEG) - Math.sin(lat0 * DEG) * Math.cos(pos.lat * DEG) * Math.cos((pos.lon - lon0) * DEG)
      ) / DEG) + 360) % 360;
      const p = project(pos.lat, pos.lon, lat0, lon0);
      setTooltip({
        x: mx, y: my,
        text: `${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}°  ${calculateGridSquare(pos.lat, pos.lon)}  ${Math.round(p.dist)} km  ${Math.round(bearing)}°`
      });
    } else {
      setTooltip(null);
    }
  }, [fromCanvas, lat0, lon0]);

  const handleMouseUp = useCallback((e) => {
    const wasDrag = dragRef.current && (
      Math.abs(e.clientX - (dragRef.current.startX + pan.x)) > 3 ||
      Math.abs(e.clientY - (dragRef.current.startY + pan.y)) > 3
    );
    dragRef.current = null;
    if (wasDrag) return; // was a drag, not a click

    // Click → set DX
    if (dxLocked || !onDXChange) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = fromCanvas(e.clientX - rect.left, e.clientY - rect.top);
    if (pos) onDXChange(pos);
  }, [dxLocked, onDXChange, fromCanvas, pan]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    setTooltip(null);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: '8px', background: '#0a0f1a' }}
    >
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{ width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Tooltip */}
      {tooltip && (
        <div style={{
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
        }}>
          {tooltip.text}
        </div>
      )}

      {/* Zoom controls */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        zIndex: 1000,
      }}>
        <button onClick={() => setZoom(z => Math.min(8, z * 1.4))} style={zoomBtnStyle}>+</button>
        <button onClick={() => setZoom(z => Math.max(0.5, z / 1.4))} style={zoomBtnStyle}>−</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset view" style={{ ...zoomBtnStyle, fontSize: '10px' }}>⌂</button>
      </div>
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
