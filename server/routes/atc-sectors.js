/**
 * ATC sector boundaries route (#996 follow-up — "show nearest ATC sector").
 *
 * Serves FIR (Flight Information Region) / ARTCC boundary polygons plus
 * curated common Center frequencies and links to LiveATC.net so a ham
 * looking at an aircraft on the map can figure out which airband frequency
 * to tune.
 *
 * Boundary data comes from the VATSPY-data community project on GitHub
 * (https://github.com/vatsimnetwork/vatspy-data-project). The boundaries
 * GeoJSON gives ~1000 FIR polygons worldwide; the VATSpy.dat metadata
 * file gives FIR id → human name mapping.
 *
 * Frequencies are curated below. ATC frequency assignments vary by altitude
 * and sub-sector within an FIR, so any single number is an approximation
 * meant as a starting point — the popup also links to LiveATC.net for the
 * full per-facility frequency list.
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION } = ctx;

  const VATSPY_BOUNDARIES_URL =
    'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson';
  const VATSPY_DAT_URL = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat';

  // Refresh upstream every 7 days. Boundaries change rarely (decade-scale);
  // VATSPY metadata bumps a bit more often but nothing operationally urgent.
  const REFRESH_TTL = 7 * 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 25000;

  // ── Curated primary Center frequencies ────────────────────────────────
  // Maps VATSPY boundary id → primary common Center frequency (MHz, AM).
  // Real-world ATC uses many sub-sector frequencies per FIR — this is just a
  // "starting point to tune" for hams; LiveATC.net link in the popup covers
  // the full per-facility list. Add to this map via PR.
  const FIR_FREQUENCIES = {
    // ── US ARTCCs ──
    KZAB: { freq: '132.075', name: 'Albuquerque Center' },
    KZAU: { freq: '134.350', name: 'Chicago Center' },
    KZBW: { freq: '124.525', name: 'Boston Center' },
    KZDC: { freq: '134.150', name: 'Washington Center' },
    KZDV: { freq: '133.225', name: 'Denver Center' },
    KZFW: { freq: '134.450', name: 'Fort Worth Center' },
    KZHU: { freq: '127.075', name: 'Houston Center' },
    KZID: { freq: '124.025', name: 'Indianapolis Center' },
    KZJX: { freq: '134.300', name: 'Jacksonville Center' },
    KZKC: { freq: '127.475', name: 'Kansas City Center' },
    KZLA: { freq: '125.200', name: 'Los Angeles Center' },
    KZLC: { freq: '134.150', name: 'Salt Lake City Center' },
    KZMA: { freq: '132.300', name: 'Miami Center' },
    KZME: { freq: '132.300', name: 'Memphis Center' },
    KZMP: { freq: '133.875', name: 'Minneapolis Center' },
    KZNY: { freq: '125.325', name: 'New York Center' },
    KZOA: { freq: '132.200', name: 'Oakland Center' },
    KZOB: { freq: '124.500', name: 'Cleveland Center' },
    KZSE: { freq: '133.450', name: 'Seattle Center' },
    KZTL: { freq: '134.150', name: 'Atlanta Center' },
    KZAN: { freq: '125.300', name: 'Anchorage Center' },
    PHZH: { freq: '128.600', name: 'Honolulu Center' },
    // ── Canadian FSS ──
    CZEG: { freq: '132.400', name: 'Edmonton ACC' },
    CZUL: { freq: '128.250', name: 'Montreal ACC' },
    CZVR: { freq: '132.150', name: 'Vancouver ACC' },
    CZWG: { freq: '128.200', name: 'Winnipeg ACC' },
    CZYZ: { freq: '124.350', name: 'Toronto ACC' },
    CZQM: { freq: '128.050', name: 'Moncton ACC' },
    // ── Major European centers ──
    EGTT: { freq: '127.105', name: 'London Control' },
    EGPX: { freq: '135.525', name: 'Scottish Control' },
    LFFF: { freq: '127.150', name: 'Paris Control' },
    EDGG: { freq: '128.350', name: 'Langen Radar (Frankfurt)' },
    EDMM: { freq: '129.475', name: 'Munich Radar' },
    EDWW: { freq: '128.075', name: 'Bremen Radar' },
    EBBU: { freq: '129.250', name: 'Brussels Control' },
    EHAA: { freq: '125.755', name: 'Amsterdam Control' },
    LSAS: { freq: '128.050', name: 'Swiss Radar' },
    LIRR: { freq: '128.800', name: 'Rome Control' },
    LIMM: { freq: '124.925', name: 'Milano Control' },
    LECM: { freq: '128.500', name: 'Madrid Control' },
    EKDK: { freq: '129.325', name: 'Copenhagen Control' },
    ESAA: { freq: '127.825', name: 'Sweden Control' },
    EFIN: { freq: '129.150', name: 'Helsinki Control' },
    EPWW: { freq: '128.300', name: 'Warsaw Control' },
    LKAA: { freq: '127.125', name: 'Praha Control' },
    LOVV: { freq: '124.350', name: 'Vienna Control' },
    // ── Australia / NZ / Pacific ──
    YBBB: { freq: '124.700', name: 'Brisbane Control' },
    YMMM: { freq: '124.350', name: 'Melbourne Control' },
    NZZC: { freq: '124.300', name: 'New Zealand Control' },
    // ── Japan / Asia ──
    RJJJ: { freq: '120.500', name: 'Tokyo Control' },
    RKRR: { freq: '128.100', name: 'Incheon Control' },
    VHHK: { freq: '129.500', name: 'Hong Kong Control' },
    WSJC: { freq: '124.300', name: 'Singapore Control' },
  };

  // ── State ─────────────────────────────────────────────────────────────
  let cache = { data: null, timestamp: 0 };
  let inFlight = null;
  let lastError = null;

  // Parse VATSpy.dat — pipe-delimited, section headers in [Brackets].
  // We want the [FIRs] section to build a boundaryId → { id, name } map.
  // Record format: FIR_ID|NAME|CALLSIGN_SUFFIX|BOUNDARY_ID
  // Multiple rows per FIR (one per callsign suffix) — first occurrence wins.
  function parseFIRsSection(dat) {
    const lookup = {};
    const lines = dat.split('\n');
    let inFirs = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inFirs = line === '[FIRs]';
        continue;
      }
      if (!inFirs || !line || line.startsWith(';')) continue;
      const parts = line.split('|');
      if (parts.length < 4) continue;
      const firId = parts[0];
      const name = parts[1];
      const boundaryId = parts[3] || firId;
      if (!boundaryId || lookup[boundaryId]) continue;
      lookup[boundaryId] = { firId, name };
    }
    return lookup;
  }

  async function fetchVatspy() {
    const ua = `OpenHamClock/${APP_VERSION}`;
    const [boundariesRes, datRes] = await Promise.all([
      fetch(VATSPY_BOUNDARIES_URL, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(VATSPY_DAT_URL, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);
    if (!boundariesRes.ok) throw new Error(`VATSPY Boundaries HTTP ${boundariesRes.status}`);
    if (!datRes.ok) throw new Error(`VATSPY .dat HTTP ${datRes.status}`);
    const [boundaries, datText] = await Promise.all([boundariesRes.json(), datRes.text()]);
    if (!boundaries || !Array.isArray(boundaries.features)) throw new Error('VATSPY Boundaries: unexpected payload');

    const nameLookup = parseFIRsSection(datText);

    // Project to a compact wire format. Keep geometry as-is (it's already
    // GeoJSON-ready); attach human name + frequency + categorisation.
    const sectors = boundaries.features
      .map((f) => {
        const props = f.properties || {};
        const boundaryId = props.id;
        if (!boundaryId || !f.geometry) return null;
        const meta = nameLookup[boundaryId] || null;
        const freq = FIR_FREQUENCIES[boundaryId] || null;
        // Classify by id prefix for popup styling — purely cosmetic.
        let kind = 'FIR';
        if (boundaryId.startsWith('KZ')) kind = 'ARTCC';
        else if (boundaryId.startsWith('CZ')) kind = 'ACC';
        else if (props.oceanic === '1') kind = 'Oceanic';
        return {
          id: boundaryId,
          name: freq?.name || meta?.name || boundaryId,
          kind,
          oceanic: props.oceanic === '1',
          freq: freq?.freq || null, // null when not curated — popup shows "varies"
          labelLat: parseFloat(props.label_lat) || null,
          labelLon: parseFloat(props.label_lon) || null,
          geometry: f.geometry,
        };
      })
      .filter(Boolean);

    logInfo(`[ATC] Loaded ${sectors.length} ATC sector boundaries from VATSPY`);
    return sectors;
  }

  app.get('/api/atc/sectors', async (req, res) => {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < REFRESH_TTL) {
      // Long client cache too — boundaries are very stable
      res.set('Cache-Control', 'public, max-age=86400');
      return res.json({ sectors: cache.data, cached: true, age: now - cache.timestamp });
    }

    if (!inFlight) {
      inFlight = fetchVatspy()
        .then((sectors) => {
          cache = { data: sectors, timestamp: Date.now() };
          lastError = null;
          return sectors;
        })
        .catch((e) => {
          lastError = e.message;
          logErrorOnce('ATC sectors', e.message);
          return null;
        })
        .finally(() => {
          inFlight = null;
        });
    }

    try {
      const data = await inFlight;
      if (data) {
        res.set('Cache-Control', 'public, max-age=86400');
        return res.json({ sectors: data, cached: false });
      }
      // Refresh failed — serve stale if we have any, else 503
      if (cache.data) {
        res.set('X-ATC-Stale', 'true');
        return res.json({ sectors: cache.data, cached: true, stale: true });
      }
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'ATC sector data unavailable', reason: lastError, sectors: [] });
    } catch (e) {
      logErrorOnce('ATC sectors', e.message);
      return res.status(500).json({ error: 'ATC sector error', reason: e.message, sectors: [] });
    }
  });
};
