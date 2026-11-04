'use strict';
/**
 * Normalize NHC and JTWC tropical cyclone products into one storm shape:
 *
 * {
 *   id, source: 'NHC' | 'JTWC', name, designation, basin: 'AL'|'EP'|'CP'|'WP'|'IO'|'SH',
 *   classification: 'TD'|'TS'|'HU'|'MH'|'TY'|'STY'|'PTC'|'STD'|'SS'|'PC'...,
 *   category: { code: 'TD'|'TS'|'1'…'5', label, saffirSimpson: 0-5 },
 *   windKt, gustKt, pressureMb, lat, lon, movementDeg, movementKt, movementText,
 *   lastUpdate (ISO), advisoryNum, advisoryUrl, graphicsUrl,
 *   track: [[lat, lon] …]   (forecast track polyline incl. current position)
 *   forecast: [{ hour, validAt, lat, lon, windKt, gustKt }],
 *   cone: [[lat, lon] …]    (NHC cone of uncertainty / JTWC 34 kt danger swath)
 *   bestTrack: [{ time, lat, lon, windKt }] (JTWC past positions, if any)
 * }
 */

/** Saffir–Simpson category from 1-min sustained wind in knots. */
function categoryFromWind(windKt, southernHemisphere = false) {
  const kt = windKt == null || windKt === '' ? NaN : Number(windKt);
  if (!Number.isFinite(kt)) return { code: '?', label: 'Unknown', saffirSimpson: null };
  if (kt < 34) return { code: 'TD', label: 'Tropical Depression', saffirSimpson: 0 };
  if (kt < 64) return { code: 'TS', label: 'Tropical Storm', saffirSimpson: 0 };
  const hurricane = southernHemisphere ? 'Cyclone' : 'Hurricane';
  if (kt < 83) return { code: '1', label: `Category 1 ${hurricane}`, saffirSimpson: 1 };
  if (kt < 96) return { code: '2', label: `Category 2 ${hurricane}`, saffirSimpson: 2 };
  if (kt < 113) return { code: '3', label: `Category 3 ${hurricane}`, saffirSimpson: 3 };
  if (kt < 137) return { code: '4', label: `Category 4 ${hurricane}`, saffirSimpson: 4 };
  return { code: '5', label: `Category 5 ${hurricane}`, saffirSimpson: 5 };
}

const NHC_CLASS_LABEL = {
  TD: 'Tropical Depression',
  TS: 'Tropical Storm',
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  PTC: 'Potential Tropical Cyclone',
  PC: 'Post-Tropical Cyclone',
  STD: 'Subtropical Depression',
  SS: 'Subtropical Storm',
  SD: 'Subtropical Depression',
  TY: 'Typhoon',
  STY: 'Super Typhoon',
  EX: 'Extratropical',
  LO: 'Low',
  DB: 'Disturbance',
};

/** "ep212026" / "EP1" → 'EP' */
function basinFromNhcId(id, binNumber) {
  const m = String(id || '').match(/^([a-z]{2})/i) || String(binNumber || '').match(/^([A-Z]{2})/);
  return m ? m[1].toUpperCase() : null;
}

function toNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compassText(deg) {
  if (!Number.isFinite(deg)) return null;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * NHC CurrentStorms.json storm + optional parsed track/cone (from
 * tropicalKml) → normalized storm.
 */
function normalizeNhcStorm(storm, trackData = null, cone = null) {
  const lat = toNum(storm.latitudeNumeric);
  const lon = toNum(storm.longitudeNumeric);
  const windKt = toNum(storm.intensity);
  const classification = storm.classification || trackData?.meta?.stormType || null;
  const basin = basinFromNhcId(storm.id, storm.binNumber);
  const forecast = (trackData?.forecast || []).map((p) => ({ ...p }));
  // Make sure the polyline starts at the current position
  let track = Array.isArray(trackData?.track) ? trackData.track.slice() : [];
  if (lat != null && lon != null) {
    if (!track.length || Math.abs(track[0][0] - lat) > 0.3 || Math.abs(track[0][1] - lon) > 0.3) {
      track = [[lat, lon], ...track];
    }
  }
  const movementDeg = toNum(storm.movementDir);
  return {
    id: String(storm.id || '').toLowerCase(),
    source: 'NHC',
    name: storm.name || trackData?.meta?.stormName || 'Unnamed',
    designation: storm.binNumber || null,
    basin,
    classification,
    classificationLabel: NHC_CLASS_LABEL[classification] || classification,
    category: categoryFromWind(windKt),
    windKt,
    gustKt: trackData?.meta?.gustKt ?? null,
    pressureMb: toNum(storm.pressure),
    lat,
    lon,
    movementDeg,
    movementKt: toNum(storm.movementSpeed),
    movementText: compassText(movementDeg),
    lastUpdate: storm.lastUpdate || null,
    advisoryNum: storm.publicAdvisory?.advNum ? parseInt(storm.publicAdvisory.advNum, 10) : null,
    advisoryUrl: storm.publicAdvisory?.url || null,
    discussionUrl: storm.forecastDiscussion?.url || null,
    graphicsUrl: storm.forecastGraphics?.url || null,
    track,
    forecast,
    cone: Array.isArray(cone) ? cone : [],
    bestTrack: [],
  };
}

/** "141800Z" + reference date → ISO string (same month unless day wraps). */
function ddhhmmZToIso(s, now = new Date()) {
  const m = typeof s === 'string' && s.match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  let y = now.getUTCFullYear();
  let mo = now.getUTCMonth();
  // A day number well above today's means the product is from last month
  if (day > now.getUTCDate() + 7) {
    mo -= 1;
    if (mo < 0) {
      mo = 11;
      y -= 1;
    }
  }
  return new Date(Date.UTC(y, mo, day, parseInt(m[2], 10), parseInt(m[3], 10))).toISOString();
}

/**
 * JTWC RSS entry + parsed warning text + parsed KML → normalized storm.
 * Any of warning/kml may be null (RSS alone still gives name/type).
 */
function normalizeJtwcStorm(entry, warning = null, kml = null, now = new Date()) {
  const pos = warning?.position || (kml?.forecast?.[0] ? { lat: kml.forecast[0].lat, lon: kml.forecast[0].lon } : null);
  const windKt = warning?.windKt ?? kml?.forecast?.[0]?.windKt ?? null;
  const southern = entry.basin === 'SH' || (pos && pos.lat < 0);
  const forecast = warning?.forecasts?.length
    ? warning.forecasts.map((f) => ({
        hour: f.hours,
        validAt: ddhhmmZToIso(f.validAt, now),
        lat: f.lat,
        lon: f.lon,
        windKt: f.windKt,
        gustKt: f.gustKt,
      }))
    : (kml?.forecast || []).filter((f) => f.hour > 0);
  let track = Array.isArray(kml?.track) && kml.track.length ? kml.track.slice() : [];
  if (!track.length && pos) track = [[pos.lat, pos.lon], ...forecast.map((f) => [f.lat, f.lon])];
  const typeLabel = entry.type || null;
  const classification = /super typhoon/i.test(typeLabel)
    ? 'STY'
    : /typhoon/i.test(typeLabel)
      ? 'TY'
      : /storm/i.test(typeLabel)
        ? 'TS'
        : /depression/i.test(typeLabel)
          ? 'TD'
          : /cyclone/i.test(typeLabel)
            ? 'TC'
            : null;
  return {
    id: `jtwc-${entry.id}`,
    source: 'JTWC',
    name: entry.name || entry.designation,
    designation: entry.designation,
    basin: entry.basin,
    classification,
    classificationLabel: typeLabel,
    category: categoryFromWind(windKt, southern),
    windKt,
    gustKt: warning?.gustKt ?? null,
    pressureMb: warning?.pressureMb ?? null,
    lat: pos?.lat ?? null,
    lon: pos?.lon ?? null,
    movementDeg: warning?.movementDeg ?? null,
    movementKt: warning?.movementKt ?? null,
    movementText: compassText(warning?.movementDeg),
    lastUpdate: ddhhmmZToIso(warning?.positionTime || entry.issued, now),
    advisoryNum: entry.warningNum ?? null,
    advisoryUrl: entry.textUrl || null,
    discussionUrl: null,
    graphicsUrl: entry.graphicUrl || null,
    track,
    forecast,
    cone: Array.isArray(kml?.swath) ? kml.swath : [],
    bestTrack: Array.isArray(kml?.bestTrack) ? kml.bestTrack : [],
  };
}

/**
 * JTWC also lists Eastern/Central Pacific (and occasionally Atlantic)
 * systems that NHC/CPHC own; drop those so each storm appears once.
 */
function dedupeStorms(nhcStorms, jtwcStorms) {
  const covered = new Set(['EP', 'CP', 'AL']);
  const out = [...nhcStorms];
  for (const s of jtwcStorms) {
    if (covered.has(s.basin)) continue;
    if (nhcStorms.some((n) => n.name && s.name && n.name.toLowerCase() === s.name.toLowerCase())) continue;
    out.push(s);
  }
  return out;
}

module.exports = {
  categoryFromWind,
  basinFromNhcId,
  compassText,
  normalizeNhcStorm,
  normalizeJtwcStorm,
  dedupeStorms,
  ddhhmmZToIso,
  NHC_CLASS_LABEL,
};
