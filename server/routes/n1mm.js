/**
 * Contest Logger UDP + API (N1MM / DXLog) routes.
 * Lines ~12670-12972 of original server.js
 */

const dgram = require('dgram');

module.exports = function (app, ctx) {
  const {
    CONFIG,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    writeLimiter,
    requireWriteAuth,
    maidenheadToLatLon,
    extractBaseCallsign,
    estimateLocationFromPrefix,
    extractGridFromComment,
  } = ctx;

  const N1MM_UDP_PORT = parseInt(process.env.N1MM_UDP_PORT || '12060');
  const N1MM_ENABLED = process.env.N1MM_UDP_ENABLED === 'true';
  const N1MM_MAX_QSOS = parseInt(process.env.N1MM_MAX_QSOS || '200');
  const N1MM_QSO_MAX_AGE = parseInt(process.env.N1MM_QSO_MAX_AGE_MINUTES || '360') * 60 * 1000;

  const contestQsoState = {
    qsos: [],
    stats: { total: 0, lastSeen: 0 },
  };
  const contestQsoIds = new Map();

  function extractContactInfoXml(text) {
    if (!text) return null;
    const start = text.indexOf('<contactinfo');
    if (start === -1) return null;
    const end = text.indexOf('</contactinfo>', start);
    if (end === -1) return null;
    return text.slice(start, end + '</contactinfo>'.length);
  }

  function getXmlTag(xml, tag) {
    if (!xml) return '';
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(re);
    return match ? match[1].trim() : '';
  }

  function parseN1MMTimestamp(value) {
    if (!value) return null;
    const normalized = value.trim().replace(' ', 'T');
    const tsUtc = Date.parse(`${normalized}Z`);
    if (!Number.isNaN(tsUtc)) return tsUtc;
    const tsLocal = Date.parse(normalized);
    if (!Number.isNaN(tsLocal)) return tsLocal;
    return null;
  }

  function normalizeCallsign(value) {
    return (value || '').trim().toUpperCase();
  }

  function n1mmFreqToMHz(value, bandMHz) {
    const v = parseFloat(value);
    if (!v || Number.isNaN(v)) return bandMHz || null;

    // N1MM often reports freq in 10 Hz units (e.g., 1420000 => 14.2 MHz).
    // Use band as a hint to pick the most plausible scaling.
    const candidates = [
      v / 1000000, // Hz -> MHz
      v / 100000, // 10 Hz -> MHz
      v / 1000, // kHz -> MHz
    ];

    if (bandMHz && !Number.isNaN(bandMHz)) {
      let best = candidates[0];
      let bestDiff = Math.abs(best - bandMHz);
      for (let i = 1; i < candidates.length; i++) {
        const diff = Math.abs(candidates[i] - bandMHz);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = candidates[i];
        }
      }
      return best;
    }

    if (v >= 1000000) return v / 1000000;
    if (v >= 100000) return v / 100000;
    if (v >= 1000) return v / 1000;
    return bandMHz || null;
  }

  function resolveQsoLocation(dxCall, grid, comment) {
    let gridToUse = grid;
    if (!gridToUse && comment) {
      const extracted = extractGridFromComment(comment);
      if (extracted) gridToUse = extracted;
    }
    if (gridToUse) {
      const loc = maidenheadToLatLon(gridToUse);
      if (loc) {
        return { lat: loc.lat, lon: loc.lon, grid: gridToUse, source: 'grid' };
      }
    }
    // Strip modifiers (5Z4/OZ6ABL → OZ6ABL) so prefix estimation uses the home call
    const baseCall = extractBaseCallsign(dxCall);
    const prefixLoc = estimateLocationFromPrefix(baseCall);
    if (prefixLoc) {
      return {
        lat: prefixLoc.lat,
        lon: prefixLoc.lon,
        grid: prefixLoc.grid || null,
        source: prefixLoc.source || 'prefix',
      };
    }
    return null;
  }

  function pruneContestQsos() {
    const now = Date.now();
    contestQsoState.qsos = contestQsoState.qsos.filter((q) => now - q.timestamp <= N1MM_QSO_MAX_AGE);
    if (contestQsoState.qsos.length > N1MM_MAX_QSOS) {
      contestQsoState.qsos = contestQsoState.qsos.slice(-N1MM_MAX_QSOS);
    }
    if (contestQsoIds.size > N1MM_MAX_QSOS * 10) {
      contestQsoIds.clear();
      contestQsoState.qsos.forEach((q) => contestQsoIds.set(q.id, q.timestamp));
    }
  }

  function rememberContestQsoId(id) {
    contestQsoIds.set(id, Date.now());
    if (contestQsoIds.size > 2000) {
      let removed = 0;
      for (const key of contestQsoIds.keys()) {
        contestQsoIds.delete(key);
        removed++;
        if (removed >= 500) break;
      }
    }
  }

  function addContestQso(qso) {
    if (!qso || !qso.dxCall) return false;
    const now = Date.now();
    const timestamp = Number.isFinite(qso.timestamp) ? qso.timestamp : now;
    const id =
      qso.id ||
      `${qso.source || 'qso'}-${qso.myCall || ''}-${qso.dxCall}-${timestamp}-${qso.bandMHz || qso.freqMHz || ''}-${qso.mode || ''}`;
    if (contestQsoIds.has(id)) return false;
    qso.id = id;
    qso.timestamp = timestamp;
    rememberContestQsoId(id);
    contestQsoState.qsos.push(qso);
    contestQsoState.stats.total += 1;
    contestQsoState.stats.lastSeen = now;
    pruneContestQsos();
    return true;
  }

  function parseN1MMContactInfo(xml) {
    const dxCall = normalizeCallsign(getXmlTag(xml, 'call'));
    if (!dxCall) return null;

    const myCall =
      normalizeCallsign(getXmlTag(xml, 'mycall')) ||
      normalizeCallsign(getXmlTag(xml, 'stationprefix')) ||
      CONFIG.callsign;

    const bandStr = getXmlTag(xml, 'band');
    const bandMHz = bandStr ? parseFloat(bandStr) : null;
    const rxRaw = parseFloat(getXmlTag(xml, 'rxfreq'));
    const txRaw = parseFloat(getXmlTag(xml, 'txfreq'));
    const freqMHz = n1mmFreqToMHz(!Number.isNaN(rxRaw) ? rxRaw : !Number.isNaN(txRaw) ? txRaw : null, bandMHz);
    const mode = (getXmlTag(xml, 'mode') || '').toUpperCase();
    const comment = getXmlTag(xml, 'comment') || '';
    const gridRaw = getXmlTag(xml, 'gridsquare');
    const grid = (gridRaw || extractGridFromComment(comment) || '').toUpperCase();
    const contestName = getXmlTag(xml, 'contestname') || '';
    const timestampStr = getXmlTag(xml, 'timestamp') || '';
    const timestamp = parseN1MMTimestamp(timestampStr) || Date.now();
    const id = getXmlTag(xml, 'ID') || '';

    const loc = resolveQsoLocation(dxCall, grid, comment);

    const qso = {
      id,
      source: 'n1mm',
      timestamp,
      time: timestampStr,
      myCall,
      dxCall,
      bandMHz: Number.isNaN(bandMHz) ? null : bandMHz,
      freqMHz: Number.isNaN(freqMHz) ? null : freqMHz,
      rxFreq: Number.isNaN(rxRaw) ? null : rxRaw,
      txFreq: Number.isNaN(txRaw) ? null : txRaw,
      mode,
      grid: grid || null,
      contest: contestName,
    };

    if (loc) {
      qso.lat = loc.lat;
      qso.lon = loc.lon;
      qso.locSource = loc.source;
      if (!qso.grid && loc.grid) qso.grid = loc.grid;
    }

    return qso;
  }

  function normalizeContestQso(input, source) {
    if (!input || typeof input !== 'object') return null;
    const dxCall = normalizeCallsign(input.dxCall || input.call);
    if (!dxCall) return null;
    const myCall = normalizeCallsign(input.myCall || input.mycall || input.deCall) || CONFIG.callsign;
    const bandMHz = parseFloat(input.bandMHz || input.band);
    const freqMHz = parseFloat(input.freqMHz || input.freq);
    const mode = (input.mode || '').toUpperCase();
    const grid = (input.grid || input.gridsquare || '').toUpperCase();
    const timestamp =
      typeof input.timestamp === 'number' ? input.timestamp : parseN1MMTimestamp(input.timestamp) || Date.now();

    let lat = parseFloat(input.lat);
    let lon = parseFloat(input.lon);
    let locSource = '';

    if (grid && (Number.isNaN(lat) || Number.isNaN(lon))) {
      const loc = maidenheadToLatLon(grid);
      if (loc) {
        lat = loc.lat;
        lon = loc.lon;
        locSource = 'grid';
      }
    }

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      const loc = estimateLocationFromPrefix(extractBaseCallsign(dxCall));
      if (loc) {
        lat = loc.lat;
        lon = loc.lon;
        if (!locSource) locSource = loc.source || 'prefix';
      }
    }

    return {
      id: input.id || '',
      source,
      timestamp,
      time: input.time || '',
      myCall,
      dxCall,
      bandMHz: Number.isNaN(bandMHz) ? null : bandMHz,
      freqMHz: Number.isNaN(freqMHz) ? null : freqMHz,
      mode,
      grid: grid || null,
      lat: Number.isNaN(lat) ? null : lat,
      lon: Number.isNaN(lon) ? null : lon,
      locSource,
    };
  }

  let n1mmSocket = null;
  if (N1MM_ENABLED) {
    try {
      n1mmSocket = dgram.createSocket('udp4');

      n1mmSocket.on('message', (buf) => {
        const text = buf.toString('utf8');
        const xml = extractContactInfoXml(text);
        if (!xml) return;
        const qso = parseN1MMContactInfo(xml);
        if (qso) addContestQso(qso);
      });

      n1mmSocket.on('error', (err) => {
        logErrorOnce('N1MM UDP', err.message);
      });

      n1mmSocket.on('listening', () => {
        const addr = n1mmSocket.address();
        console.log(`[N1MM] UDP listener on ${addr.address}:${addr.port}`);
      });

      n1mmSocket.bind(N1MM_UDP_PORT, '0.0.0.0');
    } catch (e) {
      console.error(`[N1MM] Failed to start UDP listener: ${e.message}`);
    }
  }

  // API endpoint: get contest QSOs
  app.get('/api/contest/qsos', (req, res) => {
    const limitRaw = parseInt(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
    const since = parseInt(req.query.since) || 0;

    pruneContestQsos();

    const filtered = since ? contestQsoState.qsos.filter((q) => q.timestamp > since) : contestQsoState.qsos;

    res.json({
      qsos: filtered.slice(-limit),
      stats: {
        total: contestQsoState.stats.total,
        lastSeen: contestQsoState.stats.lastSeen,
      },
      timestamp: Date.now(),
    });
  });

  // API endpoint: ingest contest QSOs (JSON)
  app.post('/api/contest/qsos', writeLimiter, requireWriteAuth, (req, res) => {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    let accepted = 0;

    for (const entry of payload) {
      const qso = normalizeContestQso(entry, 'http');
      if (qso && addContestQso(qso)) accepted++;
    }

    res.json({ ok: true, accepted, timestamp: Date.now() });
  });
};
