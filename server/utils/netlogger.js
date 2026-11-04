/**
 * NetLogger public API parsers (pure — no network).
 *
 *   GetActiveNets.php  → XML <NetLoggerXML><ServerList><Server><Net>…
 *   GetCheckins.php    → XML <NetLoggerXML><CheckinList><Checkin>…
 *                        (API ≤1.2 answered the legacy "|~"-delimited text;
 *                         parseCheckins accepts both)
 *
 * The XML is tiny and flat, so a dependency-free tag scanner is enough.
 * Check-ins are projected to the fields a net panel needs; postal address,
 * ZIP and member numbers that NetLogger includes are deliberately dropped
 * before anything reaches a browser.
 */

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ENTITY_MAP[lower] ?? m;
  });
}

/** All <tag>…</tag> bodies at any depth (non-nested use). */
function blocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** Text of the first <tag> inside a block, entity-decoded and trimmed ('' if absent). */
function field(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * NetLogger frequency text → MHz number or null.
 * Seen in the wild: "146520" (kHz), "147.135" (MHz), "7.272", "www.barc.ca",
 * "Echolink", "" — anything non-numeric is null (freqRaw keeps the text).
 */
function parseFrequency(raw) {
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .trim();
  const m = /^(\d+(?:\.\d+)?)\s*(khz|mhz)?$/i.exec(s);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'khz' || (!unit && v >= 1000)) v = v / 1000;
  if (v < 0.1 || v > 30000) return null;
  return Math.round(v * 1e6) / 1e6;
}

/** "2026-10-14 23:14:35" (UTC) → ISO string, or null. */
function parseNetDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(raw || '').trim());
  if (!m) return null;
  const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

/**
 * Parse GetActiveNets.php XML.
 * @returns {{ nets: Array, servers: string[], apiVersion: string|null }}
 *   nets: [{ server, name, altName, freq, freqRaw, mode, band, ncs, logger, started, checkins }]
 */
function parseActiveNets(xml) {
  const text = String(xml || '');
  const nets = [];
  const servers = [];
  for (const serverBlock of blocks(text, 'Server')) {
    const server = field(serverBlock, 'ServerName');
    if (server) servers.push(server);
    for (const netBlock of blocks(serverBlock, 'Net')) {
      const name = field(netBlock, 'NetName');
      if (!name) continue;
      const freqRaw = field(netBlock, 'Frequency');
      nets.push({
        server,
        name,
        altName: field(netBlock, 'AltNetName') || name,
        freq: parseFrequency(freqRaw),
        freqRaw,
        mode: field(netBlock, 'Mode') || null,
        band: field(netBlock, 'Band') || null,
        ncs: field(netBlock, 'NetControl') || null,
        logger: field(netBlock, 'Logger') || null,
        started: parseNetDate(field(netBlock, 'Date')),
        checkins: parseInt(field(netBlock, 'SubscriberCount'), 10) || 0,
      });
    }
  }
  const apiVersion = field(text, 'APIVersion') || null;
  return { nets, servers, apiVersion };
}

const CHECKIN_PUBLIC_FIELDS = [
  'Callsign',
  'State',
  'Remarks',
  'CityCountry',
  'FirstName',
  'Status',
  'County',
  'Grid',
  'Country',
  'PreferredName',
  'SerialNo',
];

function normaliseCheckin(get) {
  const call = String(get('Callsign') || '')
    .trim()
    .toUpperCase();
  if (!call) return null;
  const grid = String(get('Grid') || '').trim();
  return {
    serial: parseInt(get('SerialNo'), 10) || null,
    call,
    name: String(get('PreferredName') || get('FirstName') || '').trim() || null,
    state: String(get('State') || '').trim() || null,
    city: String(get('CityCountry') || '').trim() || null,
    county: String(get('County') || '').trim() || null,
    country: String(get('Country') || '').trim() || null,
    grid: /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(grid)
      ? grid.slice(0, 4).toUpperCase() + grid.slice(4).toLowerCase()
      : null,
    status: String(get('Status') || '').trim() || null,
    remarks: String(get('Remarks') || '').trim() || null,
  };
}

// Legacy GetCheckins.php text layout (fields "|", records "|~").
const LEGACY_FIELDS = [
  'Callsign',
  'CityCountry',
  'State',
  'FirstName',
  'Remarks',
  'QSLInfo',
  'CheckinTime',
  'County',
  'Grid',
  'Street',
  'Zip',
  'Status',
  'MemberID',
  'Country',
  'DXCC',
  'PreferredName',
];

/**
 * Parse GetCheckins.php — XML (current API) or legacy "|~" text.
 * @returns {{ server: string|null, net: string|null, count: number, checkins: Array }}
 */
function parseCheckins(body) {
  const text = String(body || '').trim();
  if (!text) return { server: null, net: null, count: 0, checkins: [] };

  if (text.startsWith('<')) {
    const list = blocks(text, 'CheckinList')[0] ?? text;
    const checkins = [];
    for (const block of blocks(list, 'Checkin')) {
      const c = normaliseCheckin((tag) => field(block, tag));
      if (c) checkins.push(c);
    }
    return {
      server: field(list, 'ServerName') || null,
      net: field(list, 'NetName') || null,
      count: parseInt(field(list, 'CheckinCount'), 10) || checkins.length,
      checkins,
    };
  }

  // Legacy: "CALL|City|ST|Name|Remarks|QSL|Time|County|Grid|Street|Zip|Status|Member|Country|DXCC|Pref|~…"
  const checkins = [];
  let serial = 0;
  for (const record of text.split('|~')) {
    const parts = record.split('|');
    if (parts.length < 2 || !parts[0].trim()) continue;
    serial += 1;
    const c = normaliseCheckin((tag) => {
      if (tag === 'SerialNo') return String(serial);
      const idx = LEGACY_FIELDS.indexOf(tag);
      return idx >= 0 ? parts[idx] : '';
    });
    if (c) checkins.push(c);
  }
  return { server: null, net: null, count: checkins.length, checkins };
}

module.exports = {
  parseActiveNets,
  parseCheckins,
  parseFrequency,
  parseNetDate,
  decodeEntities,
  CHECKIN_PUBLIC_FIELDS,
};
