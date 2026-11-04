'use strict';
/**
 * KML parsers for tropical cyclone forecast products.
 *
 *  - NHC forecast track KMZ (…_TRACK.kmz): LineString placemarks for the
 *    72 h / 120 h track plus Point placemarks per forecast hour whose HTML
 *    description carries valid time, location and max wind.
 *  - NHC cone KMZ (…_CONE.kmz): one Polygon placemark (outer ring).
 *  - JTWC storm KMZ (wpNNYY.kmz): Point placemarks "DD/HHZ - NN knots" for
 *    forecast positions, "<id> Storm Track" LineString, "34 knot Danger
 *    Swath" Polygon, and a "Previous Best Track Posits" folder.
 *
 * Regex-based on purpose: the documents are machine-generated, a few tens
 * of KB, and we need four tag types — a DOM parser would be a new dependency.
 * All coordinates come back as [lat, lon] (Leaflet order).
 */

const num = (s) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** "<coordinates>lon,lat,alt lon,lat,alt …</coordinates>" → [[lat, lon], …] */
function parseCoordinates(text) {
  if (!text) return [];
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const [lon, lat] = tok.split(',').map(num);
    if (lat != null && lon != null) out.push([lat, lon]);
  }
  return out;
}

const tagText = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : null;
};

const stripCdata = (s) =>
  s == null
    ? null
    : s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** Generic placemark extraction. */
function parsePlacemarks(kml) {
  const out = [];
  const re = /<Placemark(?:\s[^>]*)?>([\s\S]*?)<\/Placemark>/gi;
  let m;
  while ((m = re.exec(kml))) {
    const body = m[1];
    const pm = {
      name: stripCdata(tagText(body, 'name')) || '',
      description: stripCdata(tagText(body, 'description')) || '',
      point: null,
      line: null,
      polygon: null,
      data: {},
    };
    const point = tagText(body, 'Point');
    if (point) pm.point = parseCoordinates(tagText(point, 'coordinates'))[0] || null;
    const line = tagText(body, 'LineString');
    if (line) pm.line = parseCoordinates(tagText(line, 'coordinates'));
    const poly = tagText(body, 'Polygon');
    if (poly) {
      const outer = tagText(poly, 'outerBoundaryIs') || poly;
      pm.polygon = parseCoordinates(tagText(outer, 'coordinates'));
    }
    const dataRe = /<Data\s+name="([^"]+)"\s*>\s*<value>([\s\S]*?)<\/value>/gi;
    let d;
    while ((d = dataRe.exec(body))) pm.data[d[1]] = stripCdata(d[2]);
    out.push(pm);
  }
  return out;
}

/**
 * NHC track KML → { track: [[lat,lon]…], forecast: [{hour, validAt, lat, lon,
 * windKt, gustKt}], meta: { stormName, atcfId, advisoryNum, windKt, gustKt,
 * pressureMb, movement } }
 */
function parseNhcTrack(kml) {
  const pms = parsePlacemarks(kml);
  let track = [];
  const forecast = [];
  const meta = {};
  for (const pm of pms) {
    if (pm.line && pm.line.length > track.length) track = pm.line;
    if (pm.data.stormName && !meta.stormName) {
      meta.stormName = pm.data.stormName;
      meta.atcfId = pm.data.atcfid || null;
      meta.advisoryNum = num(pm.data.advisoryNum);
      meta.windKt = num(pm.data.maxWindKnots);
      meta.gustKt = num(pm.data.maxGustKnots);
      meta.pressureMb = num(pm.data.minimumPressure);
      meta.movement = pm.data.stormMovement || null;
      meta.stormType = pm.data.stormType || null;
    }
    if (pm.point) {
      const d = pm.description;
      const hour = d.match(/(\d+)\s*hr\s*Forecast/i);
      // The current-position placemark says "Advisory Information" (styleUrl
      // #initial_point) instead of "NN hr Forecast"
      const init = !hour && /Advisory Information|Initial|Current/i.test(d);
      const valid = d.match(/Valid at:\s*([^]*?)(?:\s+Location:|$)/i);
      const wind = d.match(/Maximum Wind:\s*(\d+)\s*knots/i);
      const gust = d.match(/Wind Gusts:\s*(\d+)\s*knots/i);
      forecast.push({
        hour: hour ? parseInt(hour[1], 10) : init ? 0 : null,
        validAt: valid ? valid[1].trim() : null,
        lat: pm.point[0],
        lon: pm.point[1],
        windKt: wind ? parseInt(wind[1], 10) : null,
        gustKt: gust ? parseInt(gust[1], 10) : null,
      });
    }
  }
  forecast.sort((a, b) => (a.hour ?? 999) - (b.hour ?? 999));
  return { track, forecast, meta };
}

/** NHC cone KML → [[lat,lon]…] outer ring of the (largest) cone polygon, or []. */
function parseNhcCone(kml) {
  let best = [];
  for (const pm of parsePlacemarks(kml)) {
    if (pm.polygon && pm.polygon.length > best.length) best = pm.polygon;
  }
  return best;
}

/** "TAU 12 - 2026101506Z" → { hour: 12, validAt: '2026-10-15T06:00Z' } */
function parseJtwcTau(s) {
  const m = s && s.match(/TAU\s*(\d+)\s*-\s*(\d{4})(\d{2})(\d{2})(\d{2})Z/i);
  if (!m) return { hour: null, validAt: null };
  return { hour: parseInt(m[1], 10), validAt: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:00Z` };
}

/**
 * JTWC KML → { track, forecast: [{hour, validAt, lat, lon, windKt}],
 * swath: [[lat,lon]…] (34 kt danger area), bestTrack: [{time, lat, lon, windKt}] }
 */
function parseJtwcKml(kml) {
  const pms = parsePlacemarks(kml);
  let track = [];
  let swath = [];
  const forecast = [];
  const bestTrack = [];
  for (const pm of pms) {
    if (pm.line && /storm track/i.test(pm.name) && pm.line.length > track.length) track = pm.line;
    else if (pm.line && !track.length) track = pm.line;
    if (pm.polygon && pm.polygon.length > swath.length) swath = pm.polygon;
    if (!pm.point) continue;
    const posit = /^\d{8}Z$/.test(pm.name);
    if (posit) {
      const w = pm.description.match(/(\d+)\s*knots/i);
      const y = pm.name;
      bestTrack.push({
        time: `20${y.slice(0, 2)}-${y.slice(2, 4)}-${y.slice(4, 6)}T${y.slice(6, 8)}:00Z`,
        lat: pm.point[0],
        lon: pm.point[1],
        windKt: w ? parseInt(w[1], 10) : null,
      });
      continue;
    }
    const knots = pm.name.match(/(\d+)\s*knots/i) || pm.description.match(/WIND SPD\s*(\d+)\s*KTS/i);
    const tau = parseJtwcTau(pm.description);
    // Warning-position placemark has the warning header in its name but no TAU
    if (knots || tau.hour != null) {
      forecast.push({
        hour: tau.hour ?? 0,
        validAt: tau.validAt,
        lat: pm.point[0],
        lon: pm.point[1],
        windKt: knots ? parseInt(knots[1], 10) : null,
      });
    }
  }
  forecast.sort((a, b) => a.hour - b.hour);
  return { track, forecast, swath, bestTrack };
}

module.exports = { parseCoordinates, parsePlacemarks, parseNhcTrack, parseNhcCone, parseJtwcKml, parseJtwcTau };
