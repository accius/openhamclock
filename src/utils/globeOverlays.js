/**
 * Globe overlay painters — plugin map layers on the 3D globe.
 *
 * The Leaflet plugin layers (src/plugins/layers/*) attach to a Leaflet map
 * instance, so they cannot render on the WebGL globe. Instead, globe-capable
 * layers paint onto ONE shared equirectangular canvas in plain lat/lon space:
 *
 *   x = (lon + 180) / 360 * width      (lon -180 at the left edge)
 *   y = (90 - lat)  / 180 * height     (lat +90 at the top edge)
 *
 * Globe3D drapes that canvas as a texture on a transparent sphere shell just
 * above the earth mesh; the UV layout of THREE.SphereGeometry matches this
 * projection exactly (u=0 at lon -180, v=1 at lat +90), so painters never
 * need to know about three.js — they are pure canvas-2D functions, testable
 * with a mocked context.
 *
 * Repainting is driven by Globe3D and happens only when a layer toggle,
 * opacity, or its data changes — never per frame (render-on-change design,
 * Raspberry Pi target). A painter given no data paints nothing; it must
 * never block or fetch.
 *
 * Shared helpers (colour ramps, Maidenhead math, zone sources) live here so
 * the flat Leaflet layers and the globe painters cannot drift apart.
 */

import { bandFromFreq } from './workedBefore.js';
import { getGreatCirclePoints } from './geo.js';
import { getBandColorForFreq } from './bandColors.js';

// ── Equirectangular projection ─────────────────────────────
export const lonToX = (lon, width) => ((lon + 180) / 360) * width;
export const latToY = (lat, height) => ((90 - lat) / 180) * height;

// Normalize a (possibly world-wrapped) longitude into [-180, 180)
export function normLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// ── Maidenhead math (shared with useMaidenheadGrid.js) ─────
const FIELD_LETTERS = 'ABCDEFGHIJKLMNOPQR';

// Field label ("EN") for a cell's SW corner in normalized coordinates
export function fieldLabel(lat, lon) {
  const lonIdx = Math.floor((normLon(lon) + 180) / 20);
  const latIdx = Math.floor((lat + 90) / 10);
  if (lonIdx < 0 || lonIdx > 17 || latIdx < 0 || latIdx > 17) return null;
  return FIELD_LETTERS[lonIdx] + FIELD_LETTERS[latIdx];
}

// Square label ("EN34") for a cell's SW corner in normalized coordinates
export function squareLabel(lat, lon) {
  const field = fieldLabel(lat, lon);
  if (!field) return null;
  const lonDigit = Math.floor(((normLon(lon) + 180) % 20) / 2);
  const latDigit = Math.floor(((lat + 90) % 10) / 1);
  return field + String(lonDigit) + String(latDigit);
}

// ── Worked grids (shared with useWorkedGrids.js) ───────────

// 4-char Maidenhead square: field letters A-R, square digits 0-9.
const GRID4_RE = /^[A-R]{2}[0-9]{2}$/;

/**
 * Normalize a logbook gridsquare to its 4-char square: uppercase, take the
 * first 4 chars (so 6-char 'en34ab' → 'EN34'), validate AA00 format.
 * Returns null for anything that is not a valid square.
 */
export function normalizeGrid4(grid) {
  if (typeof grid !== 'string') return null;
  const g = grid.trim().toUpperCase().slice(0, 4);
  return GRID4_RE.test(g) ? g : null;
}

/**
 * SW corner of a 4-char square as { south, west } in degrees. Cells are
 * 2° of longitude × 1° of latitude. Returns null for invalid grids.
 */
export function gridToRect(grid) {
  const g = normalizeGrid4(grid);
  if (!g) return null;
  const west = (g.charCodeAt(0) - 65) * 20 + (g.charCodeAt(2) - 48) * 2 - 180;
  const south = (g.charCodeAt(1) - 65) * 10 + (g.charCodeAt(3) - 48) - 90;
  return { south, west };
}

/**
 * Count logbook QSOs per worked 4-char square.
 * @param {Array} qsos logbookStore records (gridsquare, band, freq fields used)
 * @param {string|null} band optional band filter ('20m'); QSOs without a band
 *   tag fall back to bandFromFreq(freq), and drop out when neither resolves.
 * @returns {Object} plain { 'EN34': qsoCount } map
 */
export function workedGridCounts(qsos, band = null) {
  const counts = {};
  if (!Array.isArray(qsos)) return counts;
  const want = band ? String(band).trim().toLowerCase() : null;
  for (const q of qsos) {
    const g = normalizeGrid4(q?.gridsquare);
    if (!g) continue;
    if (want) {
      const b =
        String(q?.band || '')
          .trim()
          .toLowerCase() || bandFromFreq(q?.freq);
      if (b !== want) continue;
    }
    counts[g] = (counts[g] || 0) + 1;
  }
  return counts;
}

// Worked-grids fill: emerald green — bright enough to read on dark basemaps,
// saturated enough to read on light ones. Shared by the Leaflet layer and the
// globe painter.
export const WORKED_GRIDS_COLOR = { r: 46, g: 204, b: 113, hex: '#2ecc71' };

/**
 * Fill colour bucket for a square's QSO count: 1 / 2-4 / 5+ step the fill
 * alpha up so often-worked squares read darker. Returns { r, g, b, a } or
 * null for count < 1.
 */
export function workedGridsBucket(count) {
  if (!(count >= 1)) return null;
  const a = count >= 5 ? 0.6 : count >= 2 ? 0.42 : 0.25;
  return { r: WORKED_GRIDS_COLOR.r, g: WORKED_GRIDS_COLOR.g, b: WORKED_GRIDS_COLOR.b, a };
}

// ── Colour ramps (shared with useDRAP.js / useAurora.js) ───

// D-RAP ramp: ~0 MHz transparent → yellow → orange → red → dark red at 30+
// MHz. Below 1 MHz is treated as "no meaningful absorption" → null.
export function drapCmap(freq) {
  if (!(freq >= 1)) return null;

  const t = Math.min(freq / 30, 1); // normalize 0-30+ MHz to 0-1

  let r, g, b, a;
  if (t < 0.25) {
    // Faint yellow, ramping in
    const s = t / 0.25;
    r = 255;
    g = 230;
    b = Math.round(80 * (1 - s));
    a = 0.15 + s * 0.3;
  } else if (t < 0.5) {
    // Yellow → orange
    const s = (t - 0.25) / 0.25;
    r = 255;
    g = Math.round(230 - s * 90);
    b = 0;
    a = 0.45 + s * 0.2;
  } else if (t < 0.75) {
    // Orange → red
    const s = (t - 0.5) / 0.25;
    r = 255;
    g = Math.round(140 - s * 140);
    b = 0;
    a = 0.65 + s * 0.15;
  } else {
    // Red → dark red
    const s = (t - 0.75) / 0.25;
    r = Math.round(255 - s * 75);
    g = 0;
    b = Math.round(s * 40);
    a = 0.8 + s * 0.2;
  }

  return { r, g, b, a };
}

// Aurora ramp: transparent → green → yellow → red, matching NOAA's official
// OVATION visualization. Probabilities under 4% → null.
export function auroraCmap(probability) {
  if (probability < 4) return null;

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

// ── Zone sources (shared with useZones.js) ─────────────────
// Vendored GeoJSON from https://github.com/HB9HIL/hamradio-zones-geojson (MIT).
export const ZONE_SOURCES = {
  cq: { file: '/geo/cq-zones.geojson', color: '#e6a23c' },
  itu: { file: '/geo/itu-zones.geojson', color: '#4fc3f7' },
};

// ── Painters ───────────────────────────────────────────────
// Every painter has the signature (ctx, { width, height, opacity, data })
// and draws in the equirectangular space above. No data → paint nothing.

/**
 * Maidenhead grid — field level only (20° lon × 10° lat), lines + labels.
 * The whole world is always "visible" on a globe, so square-level density
 * is never drawn (same reasoning as the azimuthal projection).
 */
export function paintMaidenhead(ctx, { width, height, opacity = 0.5 }) {
  ctx.save();

  // Field boundary lines — mid-gray, semi-transparent, same styling family
  // as the Leaflet layer's major lines.
  ctx.strokeStyle = '#999999';
  ctx.globalAlpha = Math.min(1, opacity * 0.7);
  ctx.lineWidth = Math.max(1, width / 2048);
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 20) {
    const x = lonToX(lon, width);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let lat = -90; lat <= 90; lat += 10) {
    const y = latToY(lat, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Field labels at cell centers — white with a dark halo so they read on
  // any basemap.
  ctx.globalAlpha = Math.min(1, opacity + 0.2);
  ctx.font = `600 ${Math.max(4, Math.round((width / 2048) * 22))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  for (let lon = -180; lon < 180; lon += 20) {
    for (let lat = -90; lat < 90; lat += 10) {
      const text = fieldLabel(lat, lon);
      if (!text) continue;
      ctx.fillText(text, lonToX(lon + 10, width), latToY(lat + 5, height));
    }
  }
  ctx.restore();
}

/**
 * CQ/ITU zone boundaries + zone numbers.
 * data: { geojson, color } — geojson from ZONE_SOURCES[type].file, colour
 * matching the flat layer for the same zone set.
 */
export function paintZones(ctx, { width, height, opacity = 0.7, data }) {
  const features = data?.geojson?.features;
  if (!Array.isArray(features) || !features.length) return;
  const color = data.color || ZONE_SOURCES.cq.color;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = Math.min(1, opacity * 0.9);
  ctx.lineWidth = Math.max(1, (width / 2048) * 1.5);

  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const poly of polys) {
      if (!Array.isArray(poly)) continue;
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        ctx.beginPath();
        let prevLon = null;
        for (const pt of ring) {
          const lon = pt[0];
          const lat = pt[1];
          const x = lonToX(lon, width);
          const y = latToY(lat, height);
          // A lon jump > 180° means the ring crosses the antimeridian;
          // break the path there instead of streaking across the canvas.
          if (prevLon === null || Math.abs(lon - prevLon) > 180) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          prevLon = lon;
        }
        ctx.stroke();
      }
    }
  }

  // Zone numbers at each zone's label point (props *_zone_name_loc = [lat, lon]).
  ctx.globalAlpha = Math.min(1, opacity + 0.2);
  ctx.font = `700 ${Math.max(5, Math.round((width / 2048) * 26))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  for (const feature of features) {
    const props = feature?.properties || {};
    const zoneNumber = props.cq_zone_number ?? props.itu_zone_number;
    const loc = props.cq_zone_name_loc ?? props.itu_zone_name_loc;
    if (zoneNumber == null || !Array.isArray(loc) || loc.length !== 2) continue;
    ctx.fillText(String(zoneNumber), lonToX(loc[1], width), latToY(loc[0], height));
  }
  ctx.restore();
}

/**
 * D-RAP absorption grid as translucent heat cells.
 * data: { lats, lons, freqs } — the /api/drap grid (freqs[row][col] MHz,
 * rows ordered by lats, columns by lons). Each grid point is drawn as a cell
 * centered on it; layer opacity multiplies the ramp's own alpha.
 */
export function paintDrap(ctx, { width, height, opacity = 0.6, data }) {
  const lats = data?.lats;
  const lons = data?.lons;
  const freqs = data?.freqs;
  if (!Array.isArray(lats) || !Array.isArray(lons) || !Array.isArray(freqs)) return;
  if (!lats.length || !lons.length) return;

  const cw = (width / 360) * (360 / lons.length); // cell size from grid spacing
  const ch = (height / 180) * (180 / lats.length);

  ctx.save();
  for (let row = 0; row < lats.length; row++) {
    const rowFreqs = freqs[row];
    if (!rowFreqs) continue;
    const y = latToY(lats[row], height) - ch / 2;
    for (let col = 0; col < lons.length; col++) {
      const color = drapCmap(rowFreqs[col]);
      if (!color) continue;
      const x = lonToX(normLon(lons[col]), width) - cw / 2;
      ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a * opacity})`;
      // +0.5 overdraw hides seams between adjacent cells.
      ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
      // A cell centered near the antimeridian spills off one edge — draw the
      // wrapped remainder on the other side so the seam has no gap.
      if (x < 0) ctx.fillRect(x + width, y, cw + 0.5, ch + 0.5);
      else if (x + cw > width) ctx.fillRect(x - width, y, cw + 0.5, ch + 0.5);
    }
  }
  ctx.restore();
}

/**
 * Aurora (OVATION) probability grid.
 * data: the coordinates array from /api/noaa/aurora — [[lon 0-359, lat -90..90,
 * probability 0-100], ...] on a 1° grid, 181 latitude rows.
 */
export function paintAurora(ctx, { width, height, opacity = 0.6, data }) {
  if (!Array.isArray(data) || !data.length) return;

  const cw = width / 360;
  const ch = height / 181;

  ctx.save();
  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    const prob = point[2];
    const color = auroraCmap(prob);
    if (!color) continue;
    const x = lonToX(normLon(point[0]), width);
    const y = (90 - Math.round(point[1])) * ch;
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a * opacity})`;
    ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
  }
  ctx.restore();
}

/**
 * Worked grid squares — translucent fill over every 4-char square present in
 * the logbook, alpha stepped by QSO count (1 / 2-4 / 5+).
 * data: { 'EN34': qsoCount } from workedGridCounts().
 */
export function paintWorkedGrids(ctx, { width, height, opacity = 0.6, data }) {
  if (!data) return;
  const cells = Object.entries(data);
  if (!cells.length) return;

  const cw = (2 / 360) * width; // 2° lon cell
  const ch = (1 / 180) * height; // 1° lat cell

  ctx.save();
  for (const [grid, count] of cells) {
    const rect = gridToRect(grid);
    const color = workedGridsBucket(count);
    if (!rect || !color) continue;
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a * opacity})`;
    // NW corner of the cell in canvas space (north = south + 1°).
    ctx.fillRect(lonToX(rect.west, width), latToY(rect.south + 1, height), cw, ch);
  }
  ctx.restore();
}

/**
 * NEXRAD radar composite as one pre-fetched equirect image.
 * data: an HTMLImageElement/ImageBitmap already loaded by Globe3D's fetch
 * effect from the mesonet WMS in EPSG:4326 over the full world extent —
 * pixel-aligned with the overlay canvas, so a single drawImage suffices.
 * (The painter contract forbids fetching here.)
 */
export function paintWxRadar(ctx, { width, height, opacity = 0.7, data }) {
  if (!data || !data.width) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity);
  try {
    ctx.drawImage(data, 0, 0, width, height);
  } catch {
    // decode failure — skip quietly, next refresh replaces the image
  }
  ctx.restore();
}

/**
 * Lightning strikes, aged white → yellow → fading orange.
 * data: [{ lat, lon, timestamp(ms) }] from the Blitzortung socket Globe3D
 * opens in globe mode (the Leaflet layer's socket never runs in 3D).
 */
export function paintLightning(ctx, { width, height, opacity = 0.9, data }) {
  if (!Array.isArray(data) || !data.length) return;
  const now = Date.now();
  const r = Math.max(1.5, (width / 2048) * 2.2);
  ctx.save();
  for (const strike of data) {
    const ageMin = (now - strike.timestamp) / 60000;
    if (ageMin > 30) continue;
    const color =
      ageMin < 2
        ? `rgba(255,255,255,${opacity})`
        : ageMin < 10
          ? `rgba(255,221,64,${opacity * 0.85})`
          : `rgba(255,140,50,${opacity * Math.max(0.15, 1 - ageMin / 30)})`;
    const x = lonToX(strike.lon, width);
    const y = latToY(strike.lat, height);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Earthquakes as magnitude-scaled rings.
 * data: USGS GeoJSON features (geometry.coordinates = [lon, lat, depthKm],
 * properties.mag).
 */
export function paintEarthquakes(ctx, { width, height, opacity = 0.8, data }) {
  if (!Array.isArray(data) || !data.length) return;
  const k = width / 2048;
  ctx.save();
  ctx.lineWidth = Math.max(1, k * 1.5);
  for (const f of data) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    const mag = f?.properties?.mag ?? 0;
    const x = lonToX(coords[0], width);
    const y = latToY(coords[1], height);
    const r = Math.max(2, mag * 2.2) * k;
    const strong = mag >= 5;
    ctx.strokeStyle = strong ? `rgba(255,68,68,${opacity})` : `rgba(255,170,40,${opacity * 0.9})`;
    ctx.fillStyle = strong ? `rgba(255,68,68,${opacity * 0.25})` : `rgba(255,170,40,${opacity * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// EONET events share one position convention: last geometry entry.
const eonetPosition = (event) => {
  const geom = event?.geometry;
  const last = Array.isArray(geom) && geom.length ? geom[geom.length - 1] : null;
  const coords = last?.coordinates;
  return Array.isArray(coords) && coords.length >= 2 ? { lon: coords[0], lat: coords[1] } : null;
};

/** Wildfires — warm dots with a soft glow. data: NASA EONET events. */
export function paintWildfires(ctx, { width, height, opacity = 0.85, data }) {
  if (!Array.isArray(data) || !data.length) return;
  const k = width / 2048;
  ctx.save();
  for (const event of data) {
    const pos = eonetPosition(event);
    if (!pos) continue;
    const x = lonToX(pos.lon, width);
    const y = latToY(pos.lat, height);
    ctx.fillStyle = `rgba(255,120,40,${opacity * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, 5 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,80,30,${opacity})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Floods and severe storms — blue dots. data: NASA EONET events. */
export function paintFloods(ctx, { width, height, opacity = 0.85, data }) {
  if (!Array.isArray(data) || !data.length) return;
  const k = width / 2048;
  ctx.save();
  for (const event of data) {
    const pos = eonetPosition(event);
    if (!pos) continue;
    const x = lonToX(pos.lon, width);
    const y = latToY(pos.lat, height);
    ctx.fillStyle = `rgba(80,150,255,${opacity * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, 4.5 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(60,130,255,${opacity})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Shared polygon walker for GeoJSON Polygon/MultiPolygon geometries with
// antimeridian breaking (same convention as paintZones).
function tracePolygon(ctx, geom, width, height) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      ctx.beginPath();
      let prevLon = null;
      for (const pt of ring) {
        const x = lonToX(pt[0], width);
        const y = latToY(pt[1], height);
        if (prevLon === null || Math.abs(pt[0] - prevLon) > 180) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prevLon = pt[0];
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

/**
 * Active tornado warnings — filled red polygons.
 * data: api.weather.gov alert features (geometry Polygon|MultiPolygon).
 */
export function paintTornadoWarnings(ctx, { width, height, opacity = 0.8, data }) {
  if (!Array.isArray(data) || !data.length) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,60,60,${opacity})`;
  ctx.fillStyle = `rgba(255,60,60,${opacity * 0.3})`;
  ctx.lineWidth = Math.max(1, (width / 2048) * 1.5);
  for (const f of data) {
    if (f?.geometry) tracePolygon(ctx, f.geometry, width, height);
  }
  ctx.restore();
}

/**
 * ATC sectors — boundary strokes, oceanic sectors dashed cyan.
 * data: { sectors: [{ geometry, oceanic }] } from /api/atc/sectors
 * (geometries pre-densified by Globe3D's fetch effect).
 */
export function paintATCSectors(ctx, { width, height, opacity = 0.7, data }) {
  const sectors = data?.sectors;
  if (!Array.isArray(sectors) || !sectors.length) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, (width / 2048) * 1.2);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  for (const sector of sectors) {
    if (!sector?.geometry) continue;
    if (sector.oceanic) {
      ctx.strokeStyle = `rgba(73,199,217,${opacity * 0.8})`;
      ctx.setLineDash([6, 5]);
    } else {
      ctx.strokeStyle = `rgba(111,159,255,${opacity * 0.8})`;
      ctx.setLineDash([]);
    }
    tracePolygon(ctx, sector.geometry, width, height);
  }
  ctx.restore();
}

/**
 * Spatially decimate the aircraft snapshot: one aircraft per lat/lon cell,
 * highest altitude winning (the long-haul traffic worth seeing at planetary
 * zoom). Never prefix-slice the raw array instead: adsb.lol returns it
 * ordered west→east by longitude, so any cap silently drops everything east
 * of some meridian. Used by Globe3D's native 3D aircraft rendering.
 */
export function decimateAircraft(data, cellDeg = 1) {
  if (!Array.isArray(data)) return [];
  const best = new Map();
  for (const plane of data) {
    if (plane.lat == null || plane.lon == null) continue;
    const key = `${Math.round(plane.lat / cellDeg)},${Math.round(plane.lon / cellDeg)}`;
    const prev = best.get(key);
    if (!prev || (plane.alt_ft ?? 0) > (prev.alt_ft ?? 0)) best.set(key, plane);
  }
  return [...best.values()];
}

// ── Registry ───────────────────────────────────────────────
// layerId → painter, keyed by the plugin layer ids from layerRegistry.js.
// Adding a globe rendering for another layer = add a painter here (plus its
// data fetch in Globe3D's overlay-data effects); WorldMap's suppressed-layers
/**
 * History Playback — the scrubbed window's spot paths as band-colored great
 * circles fading older-in-window, DX endpoints as dots. Mirrors the flat
 * layer's rendering (plugins/layers/useHistoryPlayback.js); transport state
 * and data both come from services/historyPlaybackStore.js via Globe3D.
 * data: { spots, from, to } — a /api/history/spots response.
 */
export function paintHistoryPlayback(ctx, { width, height, opacity = 0.8, data }) {
  const spots = data?.spots;
  if (!Array.isArray(spots) || !spots.length) return;
  const { from, to } = data;
  const span = Math.max(1, (to || 0) - (from || 0));
  const drawn = spots.slice(-500);

  ctx.save();
  ctx.lineWidth = Math.max(1, (width / 2048) * 1.2);
  ctx.lineCap = 'round';

  for (const s of drawn) {
    if (s.dxLat == null || s.dxLon == null) continue;
    const color = getBandColorForFreq(s.freq);
    const age = Math.max(0, Math.min(1, (s.timestamp - from) / span));
    const alpha = Math.min(1, opacity * (0.25 + 0.75 * age));

    if (s.spotterLat != null && s.spotterLon != null) {
      const arc = getGreatCirclePoints(s.spotterLat, s.spotterLon, s.dxLat, s.dxLon, 32);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      let prevLon = null;
      for (const [lat, lon] of arc) {
        const x = lonToX(lon, width);
        const y = latToY(lat, height);
        if (prevLon === null || Math.abs(lon - prevLon) > 180) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prevLon = lon;
      }
      ctx.stroke();
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lonToX(s.dxLon, width), latToY(s.dxLat, height), Math.max(2, (width / 2048) * 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// note picks the id up automatically via GLOBE_OVERLAY_LAYER_IDS.
// Ordered: rasters first, area fills, then lines, then point markers on top.
export const GLOBE_OVERLAY_PAINTERS = {
  wxradar: paintWxRadar,
  drap: paintDrap,
  aurora: paintAurora,
  'worked-grids': paintWorkedGrids,
  maidenhead: paintMaidenhead,
  zones: paintZones,
  'atc-sectors': paintATCSectors,
  'tornado-warnings': paintTornadoWarnings,
  earthquakes: paintEarthquakes,
  wildfires: paintWildfires,
  floods: paintFloods,
  'history-playback': paintHistoryPlayback,
  lightning: paintLightning,
};

// Plugin layer ids the globe can draw itself. Aircraft and Logbook QSOs have
// no canvas painter — Globe3D renders them natively (instanced 3D models;
// markers + great-circle arcs like DX spots) — but they belong here so their
// enabled/opacity state reaches Globe3D and they stay out of WorldMap's
// suppressed-layers note (like satellites).
export const GLOBE_OVERLAY_LAYER_IDS = [...Object.keys(GLOBE_OVERLAY_PAINTERS), 'aircraft', 'logbook-qsos'];
