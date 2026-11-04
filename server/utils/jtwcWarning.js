'use strict';
/**
 * Joint Typhoon Warning Center parsers.
 *
 *  - parseJtwcRss(xml): the jtwc.rss feed has one <item> per region whose
 *    HTML description lists every active system with links to the warning
 *    text (…web.txt) and KMZ overlay.
 *  - parseJtwcWarningText(txt): the plain-text warning (WTPN3x) — current
 *    position/time, movement, winds, and the 12/24/36/… h forecast table.
 */

/** "22.7N 141.1E" / "23.4 N, 139.4 E" → { lat, lon } (S/W negative). */
function parseLatLon(s) {
  const m = s && s.match(/(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])/i);
  if (!m) return null;
  const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
  const lon = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
  return { lat, lon };
}

const unescapeHtml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // &amp; last: decoding it first would turn &amp;lt; into <
    .replace(/&amp;/g, '&');

/** Basin from a JTWC product id prefix (wp/io/sh/ep/cp). */
function basinFromProductId(id) {
  const p = (id || '').slice(0, 2).toLowerCase();
  return { wp: 'WP', io: 'IO', sh: 'SH', ep: 'EP', cp: 'CP', al: 'AL' }[p] || p.toUpperCase();
}

/**
 * → [{ id: 'wp2826', designation: '28W', name: 'Twentyeight', type:
 *      'Tropical Depression', warningNum: 12, issued: '14/2100Z', basin,
 *      region, textUrl, kmzUrl, graphicUrl }]
 */
function parseJtwcRss(xml) {
  const storms = [];
  if (typeof xml !== 'string') return storms;
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let item;
  while ((item = itemRe.exec(xml))) {
    const body = item[1];
    const region = (body.match(/<category>([\s\S]*?)<\/category>/i) || ['', ''])[1].trim();
    const descM = body.match(/<description>([\s\S]*?)<\/description>/i);
    if (!descM) continue;
    let desc = descM[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    desc = unescapeHtml(desc);
    // Each system: "<b>Tropical Storm  21E (Trudy) Warning #06 </b> … <ul>…</ul>"
    const sysRe =
      /<b>\s*([A-Za-z][A-Za-z ]*?)\s+(\d{2}[A-Z])\s*\(([^)]*)\)\s*Warning\s*#?\s*(\d+)\s*<\/b>([\s\S]*?)(?=<b>\s*[A-Za-z][A-Za-z ]*?\s+\d{2}[A-Z]\s*\(|$)/g;
    let s;
    while ((s = sysRe.exec(desc))) {
      const [, type, designation, name, warningNum, rest] = s;
      const issued = (rest.match(/Issued at\s*([\d/]+Z)/i) || [null, null])[1];
      const textUrl = (rest.match(/href=['"]([^'"]+web\.txt)['"]/i) || [null, null])[1];
      const kmzUrl = (rest.match(/href=['"]([^'"]+\.kmz)['"]/i) || [null, null])[1];
      const graphicUrl = (rest.match(/href=['"]([^'"]+\.gif)['"]/i) || [null, null])[1];
      const idM = (textUrl || kmzUrl || '').match(/\/([a-z]{2}\d{4})(?:web)?\.(?:txt|kmz)$/i);
      const id = idM ? idM[1].toLowerCase() : `${designation.toLowerCase()}`;
      storms.push({
        id,
        designation,
        name: name.trim(),
        type: type.replace(/\s+/g, ' ').trim(),
        warningNum: parseInt(warningNum, 10),
        issued,
        basin: basinFromProductId(id),
        region,
        textUrl,
        kmzUrl,
        graphicUrl,
      });
    }
  }
  // De-duplicate (a system can be listed in two regional items)
  const seen = new Set();
  return storms.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
}

/**
 * → { position: {lat, lon}, positionTime: '141800Z', movementDeg, movementKt,
 *     windKt, gustKt, pressureMb, forecasts: [{hours, validAt, lat, lon,
 *     windKt, gustKt}], header }
 */
function parseJtwcWarningText(txt) {
  const out = {
    position: null,
    positionTime: null,
    movementDeg: null,
    movementKt: null,
    windKt: null,
    gustKt: null,
    pressureMb: null,
    forecasts: [],
    header: null,
  };
  if (typeof txt !== 'string') return out;
  const t = txt.replace(/\r/g, '');
  out.header = (t.match(/^\s*1\.\s*(.+?)\s*$/m) || [null, null])[1];

  const warn = t.match(/WARNING POSITION:\s*\n\s*(\d{6}Z)\s*---\s*NEAR\s*([\d.]+[NS]\s*[\d.]+[EW])/i);
  if (warn) {
    out.positionTime = warn[1];
    out.position = parseLatLon(warn[2]);
  }
  const mv = t.match(/MOVEMENT PAST SIX HOURS\s*-\s*(\d+)\s*DEGREES AT\s*(\d+)\s*KTS/i);
  if (mv) {
    out.movementDeg = parseInt(mv[1], 10);
    out.movementKt = parseInt(mv[2], 10);
  }
  const presentIdx = t.search(/PRESENT WIND DISTRIBUTION/i);
  const windsRe = /MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT,\s*GUSTS\s*(\d+)\s*KT/gi;
  if (presentIdx >= 0) {
    windsRe.lastIndex = presentIdx;
    const w = windsRe.exec(t);
    if (w) {
      out.windKt = parseInt(w[1], 10);
      out.gustKt = parseInt(w[2], 10);
    }
  }
  const pres = t.match(/MINIMUM CENTRAL PRESSURE AT \d{6}Z IS\s*(\d+)\s*MB/i);
  if (pres) out.pressureMb = parseInt(pres[1], 10);

  const fcRe =
    /(\d+)\s*HRS?,\s*VALID AT:\s*\n\s*(\d{6}Z)\s*---\s*([\d.]+[NS]\s*[\d.]+[EW])[\s\S]*?MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT,\s*GUSTS\s*(\d+)\s*KT/gi;
  let f;
  while ((f = fcRe.exec(t))) {
    const pos = parseLatLon(f[3]);
    if (!pos) continue;
    out.forecasts.push({
      hours: parseInt(f[1], 10),
      validAt: f[2],
      lat: pos.lat,
      lon: pos.lon,
      windKt: parseInt(f[4], 10),
      gustKt: parseInt(f[5], 10),
    });
  }
  return out;
}

module.exports = { parseLatLon, parseJtwcRss, parseJtwcWarningText, basinFromProductId };
