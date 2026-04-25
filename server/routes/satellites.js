/**
 * Satellite TLE tracking routes.
 * Lines ~7624-8178 of original server.js
 */

const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION, ROOT_DIR } = ctx;

  // ============================================
  // SATELLITE TRACKING API
  // ============================================

  // Load satellite database from satellites.json (editable by contributors)
  // Falls back to hardcoded list if file not found
  function loadSatellitesJson() {
    const jsonPaths = [
      path.join(ROOT_DIR, 'public', 'data', 'satellites.json'),
      path.join(ROOT_DIR, 'data', 'satellites.json'),
    ];
    for (const p of jsonPaths) {
      try {
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (data.satellites && Object.keys(data.satellites).length > 0) {
            logInfo(`[Satellites] Loaded ${Object.keys(data.satellites).length} satellites from ${path.basename(p)}`);
            return data.satellites;
          }
        }
      } catch (e) {
        logWarn(`[Satellites] Failed to load ${p}: ${e.message}`);
      }
    }
    return null;
  }

  // Try JSON file first, fall back to hardcoded
  const jsonSatellites = loadSatellitesJson();

  // Curated list of active ham radio and amateur-accessible satellites
  // Last audited: March 2026
  //
  // REMOVED (dead/decayed/not ham):
  //   AO-92 (43137) — re-entered Feb 2024
  //   PO-101 (43678) — previously listed as decommissioned, restored (still active)
  //   AO-27 (22825) — dead since ~2020
  //   RS-15 (23439) — dead for years
  //   FO-99 (43937) — dead/marginal
  //   UVSQ-SAT (47438) — science payload, not ham
  //   MeznSat (46489) — science payload, not ham
  //   CAS-5A (54684) — decayed from orbit
  //   ARISS/SSTV-ISS — duplicate NORAD 25544, consolidated into ISS entry
  //
  // ADDED:
  //   AO-123 (ASRTU-1) — FM transponder, active since Aug 2025
  //   SO-124 (HADES-R) — FM repeater, active since Feb 2025
  //   SO-125 (HADES-ICM) — FM repeater, active since Jun 2025
  //   QMR-KWT-2 — FM repeater/SSTV, launched Dec 2025, NORAD 67291
  //   EWS-G1 (GOES-13, 29155) — geostationary, GVAR/SD, 1685.7/1676.0 MHz
  //   EWS-G2 (GOES-15, 36411) — geostationary, GVAR/SD, 1685.7/1676.0 MHz
  //   ELEKTRO-L2 (41105) — geostationary, HRIT/LRIT, 1691.0 MHz
  //   ELEKTRO-L3 (44903) — geostationary, HRIT/LRIT, 1691.0 MHz
  //   GK-2A (43823) — geostationary, HRIT/LRIT, 1692.14 MHz
  //   HIMAWARI-9 (41836) — geostationary, HimawariCast, 4148.0 MHz
  //   NOAA-20 (43013) — polar, HRD X-Band, 7812.0 MHz
  //   NOAA-21 (54234) — polar, HRD X-Band, 7812.0 MHz
  //
  // UPDATED: Frequency data (downlink, uplink, tone, armTone, frequency,
  //   hrptFrequency, grbFrequency, sdFrequency) merged from satconfig.json
  //   for all applicable satellites — ISS, SO-50, AO-91, AO-123, SO-125,
  //   QMR-KWT-2, GOES-18/19, METOP-B/C, METEOR M2-3/4, RS-44, QO-100,
  //   AO-7, FO-29, JO-97, AO-73, CAS-4A/4B, CAS-6, XW-2A/B/C/F, IO-117
  //
  // FIXED: TEVEL NORAD IDs corrected per AMSAT TLE bulletin
  //
  const HAM_SATELLITES = {
    // ── High Priority — Popular FM Satellites ──────────────────────
    ISS: {
      norad: 25544,
      name: 'ISS (ZARYA)',
      color: '#00ffff',
      priority: 1,
      mode: 'FM/APRS/SSTV',
      downlink: '145.800 MHz',
      uplink: '145.990 MHz',
      tone: '67.0 Hz',
    },
    'SO-50': {
      norad: 27607,
      name: 'SO-50',
      color: '#00ff00',
      priority: 1,
      mode: 'FM',
      downlink: '436.795 MHz',
      uplink: '145.850 MHz',
      tone: '67.0 Hz',
      armTone: '74.4 Hz',
    },
    'AO-91': {
      norad: 43017,
      name: 'AO-91 (Fox-1B)',
      color: '#ff6600',
      priority: 2,
      mode: 'FM (sunlight only)',
      downlink: '145.960 MHz',
      uplink: '435.250 MHz',
      tone: '67.0 Hz',
    },
    'AO-123': {
      norad: 61781,
      name: 'AO-123 (ASRTU-1)',
      color: '#ff3399',
      priority: 1,
      mode: 'FM',
      downlink: '435.400 MHz',
      uplink: '145.850 MHz',
      tone: '67.0 Hz',
    },
    'SO-124': {
      norad: 62690,
      name: 'SO-124 (HADES-R)',
      color: '#ff44aa',
      priority: 1,
      mode: 'FM',
    },
    'SO-125': {
      norad: 63492,
      name: 'SO-125 (HADES-ICM)',
      color: '#ff55bb',
      priority: 1,
      mode: 'FM',
      downlink: '436.666 MHz',
      uplink: '145.875 MHz',
      tone: '67.0 Hz',
    },
    'QMR-KWT-2': {
      norad: 67291,
      name: 'QMR-KWT-2',
      color: '#ff88dd',
      priority: 1,
      mode: 'FM/SSTV',
      downlink: '436.950 MHz',
      uplink: '145.920 MHz',
      tone: '67.0 Hz',
    },
    'PO-101': {
      norad: 43678,
      name: 'PO-101 (DIWATA-2B)',
      color: '#cc66ff',
      priority: 2,
      mode: 'FM',
      downlink: '145.900 MHz',
      uplink: '437.500 MHz',
      tone: '141.3 Hz',
    },

    // ── Weather Satellites — GOES & METEOR ─────────────────────────
    'GOES-18': {
      norad: 51850,
      name: 'GOES-18',
      color: '#66ff66',
      priority: 1,
      mode: 'GRB/HRIT/LRIT',
      frequency: '1694.100 MHz',
      grbFrequency: '1686.600 MHz',
    },
    'GOES-19': {
      norad: 60133,
      name: 'GOES-19',
      color: '#33cc33',
      priority: 1,
      mode: 'GRB/HRIT/LRIT',
      frequency: '1694.100 MHz',
      grbFrequency: '1686.600 MHz',
    },
    'METOP-B': {
      norad: 38771,
      name: 'MetOp-B',
      color: '#FF6600',
      priority: 1,
      mode: 'HRPT/AHRPT',
      hrptFrequency: '1701.300 MHz',
    },
    'METOP-C': {
      norad: 43689,
      name: 'MetOp-C',
      color: '#FF8800',
      priority: 1,
      mode: 'HRPT/AHRPT',
      hrptFrequency: '1701.300 MHz',
    },
    'METEOR-M2-3': {
      norad: 57166,
      name: 'METEOR M2-3',
      color: '#FF0000',
      priority: 1,
      mode: 'HRPT/LRPT',
      frequency: '137.900 MHz',
      hrptFrequency: '1700.000 MHz',
    },
    'METEOR-M2-4': {
      norad: 59051,
      name: 'METEOR M2-4',
      color: '#FF0000',
      priority: 1,
      mode: 'HRPT/LRPT',
      frequency: '137.100 MHz',
      hrptFrequency: '1700.000 MHz',
    },

    // ── Weather Satellites — Geostationary (non-GOES) ─────────────
    'EWS-G1': {
      norad: 29155,
      name: 'EWS-G1 (GOES-13)',
      color: '#0066ff',
      priority: 2,
      mode: 'GVAR/SD',
      frequency: '1685.700 MHz',
      sdFrequency: '1676.000 MHz',
    },
    'EWS-G2': {
      norad: 36411,
      name: 'EWS-G2 (GOES-15)',
      color: '#0044cc',
      priority: 2,
      mode: 'GVAR/SD',
      frequency: '1685.700 MHz',
      sdFrequency: '1676.000 MHz',
    },
    'ELEKTRO-L2': {
      norad: 41105,
      name: 'ELEKTRO-L2',
      color: '#ffcc00',
      priority: 2,
      mode: 'HRIT/LRIT',
      frequency: '1691.000 MHz',
    },
    'ELEKTRO-L3': {
      norad: 44903,
      name: 'ELEKTRO-L3',
      color: '#ff9900',
      priority: 2,
      mode: 'HRIT/LRIT',
      frequency: '1691.000 MHz',
    },
    'GK-2A': {
      norad: 43823,
      name: 'GK-2A',
      color: '#ff33cc',
      priority: 1,
      mode: 'HRIT/LRIT',
      frequency: '1692.140 MHz',
    },
    'HIMAWARI-9': {
      norad: 41836,
      name: 'HIMAWARI-9',
      color: '#9900cc',
      priority: 1,
      mode: 'HimawariCast',
      frequency: '4148.000 MHz',
    },

    // ── Weather Satellites — Polar (X-Band) ───────────────────────
    'NOAA-20': {
      norad: 43013,
      name: 'NOAA-20',
      color: '#00ccff',
      priority: 2,
      mode: 'HRD (X-Band)',
      frequency: '7812.000 MHz',
    },
    'NOAA-21': {
      norad: 54234,
      name: 'NOAA-21',
      color: '#0099ff',
      priority: 2,
      mode: 'HRD (X-Band)',
      frequency: '7812.000 MHz',
    },

    // ── Linear Transponder Satellites ──────────────────────────────
    'RS-44': {
      norad: 44909,
      name: 'RS-44 (DOSAAF)',
      color: '#ff0066',
      priority: 1,
      mode: 'Linear',
      downlink: '435.610 - 435.670 MHz',
      uplink: '145.935 - 145.995 MHz',
    },
    'QO-100': {
      norad: 43700,
      name: "QO-100 (Es'hail-2)",
      color: '#ffff00',
      priority: 1,
      mode: 'Linear (GEO)',
      downlink: '10489.550 - 10489.800 MHz',
      uplink: '2400.050 - 2400.300 MHz',
    },
    'AO-7': {
      norad: 7530,
      name: 'AO-7',
      color: '#ffcc00',
      priority: 2,
      mode: 'Linear (daylight)',
      downlink: '145.925 - 145.975 MHz',
      uplink: '432.125 - 432.175 MHz',
    },
    'FO-29': {
      norad: 24278,
      name: 'FO-29 (JAS-2)',
      color: '#ff6699',
      priority: 2,
      mode: 'Linear (scheduled)',
      downlink: '435.800 - 435.900 MHz',
      uplink: '145.900 - 146.000 MHz',
    },
    'JO-97': {
      norad: 43803,
      name: 'JO-97 (JY1Sat)',
      color: '#cc99ff',
      priority: 2,
      mode: 'Linear/FM',
      downlink: '145.855 - 145.875 MHz',
      uplink: '435.100 - 435.120 MHz',
    },
    'AO-73': {
      norad: 39444,
      name: 'AO-73 (FUNcube-1)',
      color: '#ffcc66',
      priority: 2,
      mode: 'Linear/Telemetry',
      downlink: '145.950 - 145.970 MHz',
      uplink: '435.130 - 435.150 MHz',
    },
    'EO-88': {
      norad: 42017,
      name: 'EO-88 (Nayif-1)',
      color: '#ffaa66',
      priority: 3,
      mode: 'Linear/Telemetry',
    },

    // ── CAS (Chinese Amateur Satellites) ───────────────────────────
    'CAS-4A': {
      norad: 42761,
      name: 'CAS-4A',
      color: '#9966ff',
      priority: 2,
      mode: 'Linear',
      downlink: '145.910 - 145.930 MHz',
      uplink: '435.210 - 435.230 MHz',
    },
    'CAS-4B': {
      norad: 42759,
      name: 'CAS-4B',
      color: '#9933ff',
      priority: 2,
      mode: 'Linear',
      downlink: '145.915 - 145.935 MHz',
      uplink: '435.270 - 435.290 MHz',
    },
    'CAS-6': {
      norad: 44881,
      name: 'CAS-6 (TO-108)',
      color: '#cc66ff',
      priority: 2,
      mode: 'Linear',
      downlink: '145.915 - 145.935 MHz',
      uplink: '435.270 - 435.290 MHz',
    },

    // ── XW-2 Constellation (CAS-3) — intermittent ─────────────────
    'XW-2A': {
      norad: 40903,
      name: 'XW-2A (CAS-3A)',
      color: '#66ff99',
      priority: 3,
      mode: 'Linear',
      downlink: '145.660 - 145.680 MHz',
      uplink: '435.030 - 435.050 MHz',
    },
    'XW-2B': {
      norad: 40911,
      name: 'XW-2B (CAS-3B)',
      color: '#66ffcc',
      priority: 3,
      mode: 'Linear',
      downlink: '145.730 - 145.750 MHz',
      uplink: '435.090 - 435.110 MHz',
    },
    'XW-2C': {
      norad: 40906,
      name: 'XW-2C (CAS-3C)',
      color: '#99ffcc',
      priority: 3,
      mode: 'Linear',
      downlink: '145.795 - 145.815 MHz',
      uplink: '435.150 - 435.170 MHz',
    },
    'XW-2F': {
      norad: 40910,
      name: 'XW-2F (CAS-3F)',
      color: '#ccffcc',
      priority: 3,
      mode: 'Linear',
      downlink: '145.975 - 145.995 MHz',
      uplink: '435.330 - 435.350 MHz',
    },

    // ── Digipeaters ────────────────────────────────────────────────
    'IO-86': {
      norad: 40931,
      name: 'IO-86 (LAPAN-A2/ORARI)',
      color: '#33ccaa',
      priority: 2,
      mode: 'APRS Digipeater',
      downlink: '145.825 MHz',
      uplink: '145.825 MHz',
    },
    'IO-117': {
      norad: 53106,
      name: 'IO-117 (GreenCube)',
      color: '#00ff99',
      priority: 2,
      mode: 'Digipeater',
      downlink: '435.310 MHz',
      uplink: '435.310 MHz',
    },

    // ── TEVEL Constellation — activated periodically ───────────────
    // NORAD IDs corrected per AMSAT TLE bulletin Dec 2022
    'TEVEL-1': {
      norad: 51013,
      name: 'TEVEL-1',
      color: '#66ccff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-2': {
      norad: 51069,
      name: 'TEVEL-2',
      color: '#66ddff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-3': {
      norad: 50988,
      name: 'TEVEL-3',
      color: '#66eeff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-4': {
      norad: 51063,
      name: 'TEVEL-4',
      color: '#77ccff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-5': {
      norad: 50998,
      name: 'TEVEL-5',
      color: '#77ddff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-6': {
      norad: 50999,
      name: 'TEVEL-6',
      color: '#77eeff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-7': {
      norad: 51062,
      name: 'TEVEL-7',
      color: '#88ccff',
      priority: 3,
      mode: 'FM',
    },
    'TEVEL-8': {
      norad: 50989,
      name: 'TEVEL-8',
      color: '#88ddff',
      priority: 3,
      mode: 'FM',
    },
  };

  // Use satellites.json data if available, merging radio metadata into hardcoded entries
  // JSON file is the source of truth for radio data (downlink, uplink, tone, notes)
  // Hardcoded entries are the fallback for NORAD IDs and basic info
  if (jsonSatellites) {
    for (const [key, jsonSat] of Object.entries(jsonSatellites)) {
      if (HAM_SATELLITES[key]) {
        // Merge: JSON radio metadata into existing entry
        Object.assign(HAM_SATELLITES[key], {
          downlink: jsonSat.downlink || HAM_SATELLITES[key].downlink || '',
          uplink: jsonSat.uplink || HAM_SATELLITES[key].uplink || '',
          tone: jsonSat.tone || HAM_SATELLITES[key].tone || '',
          beacon: jsonSat.beacon || HAM_SATELLITES[key].beacon || '',
          notes: jsonSat.notes || HAM_SATELLITES[key].notes || '',
          // Allow JSON to override these too
          name: jsonSat.name || HAM_SATELLITES[key].name,
          mode: jsonSat.mode || HAM_SATELLITES[key].mode,
          color: jsonSat.color || HAM_SATELLITES[key].color,
          priority: jsonSat.priority ?? HAM_SATELLITES[key].priority,
          norad: jsonSat.norad || HAM_SATELLITES[key].norad,
        });
      } else {
        // New satellite only in JSON — add it
        HAM_SATELLITES[key] = jsonSat;
      }
    }
    logInfo(`[Satellites] Merged radio metadata — ${Object.keys(HAM_SATELLITES).length} satellites in registry`);
  }

  let tleCache = { data: null, timestamp: 0 };
  const TLE_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours — TLEs don't change that fast
  const TLE_STALE_SERVE_LIMIT = 48 * 60 * 60 * 1000; // Serve stale cache up to 48h while retrying
  let tleNegativeCache = 0; // Timestamp of last total failure
  const TLE_NEGATIVE_TTL = 30 * 60 * 1000; // 30 min backoff after all sources fail

  // TLE data sources in priority order — automatic failover
  const TLE_SOURCES = {
    celestrak: {
      name: 'CelesTrak',
      fetchGroups: async (groups, signal) => {
        const tleData = {};
        for (const group of groups) {
          try {
            const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
              headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
              signal,
            });
            if (res.ok) parseTleText(await res.text(), tleData, group);
            else if (res.status === 429 || res.status === 403)
              throw new Error(`CelesTrak returned ${res.status} (rate limited or banned)`);
          } catch (e) {
            if (e.message?.includes('rate limited') || e.message?.includes('banned')) throw e; // Bubble up to trigger failover
            logDebug(`[Satellites] CelesTrak group ${group} failed: ${e.message}`);
          }
        }
        return tleData;
      },
    },
    celestrak_legacy: {
      name: 'CelesTrak (legacy)',
      fetchGroups: async (groups, signal) => {
        const tleData = {};
        // Legacy domain uses different URL format
        const legacyMap = { amateur: 'amateur', weather: 'weather', goes: 'goes' };
        for (const group of groups) {
          try {
            const res = await fetch(`https://celestrak.com/NORAD/elements/${legacyMap[group] || group}.txt`, {
              headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
              signal,
            });
            if (res.ok) parseTleText(await res.text(), tleData, group);
          } catch (e) {
            logDebug(`[Satellites] CelesTrak legacy group ${group} failed: ${e.message}`);
          }
        }
        return tleData;
      },
    },
    amsat: {
      name: 'AMSAT',
      fetchGroups: async (_groups, signal) => {
        // AMSAT provides a single combined file for amateur satellites
        const tleData = {};
        try {
          const res = await fetch('https://www.amsat.org/tle/current/nasabare.txt', {
            headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
            signal,
          });
          if (res.ok) parseTleText(await res.text(), tleData, 'amateur');
        } catch (e) {
          logDebug(`[Satellites] AMSAT TLE failed: ${e.message}`);
        }
        return tleData;
      },
    },
  };

  // Configurable source order via env var: TLE_SOURCES=celestrak,amsat,celestrak_legacy
  const TLE_SOURCE_ORDER = (process.env.TLE_SOURCES || 'celestrak,celestrak_legacy,amsat')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => TLE_SOURCES[s]);

  function parseTleText(text, tleData, group) {
    // Build NORAD lookup set for fast matching
    const knownNorads = new Set(Object.values(HAM_SATELLITES).map((s) => s.norad));

    const lines = text.trim().split('\n');
    for (let i = 0; i < lines.length - 2; i += 3) {
      const name = lines[i]?.trim();
      const line1 = lines[i + 1]?.trim();
      const line2 = lines[i + 2]?.trim();
      if (name && line1 && line1.startsWith('1 ')) {
        const noradId = parseInt(line1.substring(2, 7));

        // Only include satellites we've curated in HAM_SATELLITES
        if (!knownNorads.has(noradId)) continue;

        const alreadyExists = Object.values(tleData).some((sat) => sat.norad === noradId);
        if (alreadyExists) continue;

        const hamSat = Object.values(HAM_SATELLITES).find((s) => s.norad === noradId);
        if (hamSat) {
          const key = name.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
          tleData[key] = { ...hamSat, tle1: line1, tle2: line2 };
        }
      }
    }
  }

  app.get('/api/satellites/tle', async (req, res) => {
    // Don't let Fastly/CDN pin an empty payload — when all sources fail we want
    // the next request after backoff to hit the origin, not the edge cache.
    const sendTle = (payload) => {
      if (!payload || Object.keys(payload).length === 0) {
        res.set('Cache-Control', 'no-store');
      }
      return res.json(payload);
    };

    try {
      const now = Date.now();

      // Return memory cache if fresh
      if (tleCache.data && now - tleCache.timestamp < TLE_CACHE_DURATION) {
        return res.json(tleCache.data);
      }

      // If all sources recently failed, serve stale cache or empty
      if (now - tleNegativeCache < TLE_NEGATIVE_TTL) {
        if (tleCache.data && now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT) {
          res.set('X-TLE-Stale', 'true');
          return res.json(tleCache.data);
        }
        return sendTle(tleCache.data || {});
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const groups = ['amateur', 'weather', 'goes'];
      let tleData = {};
      let sourceUsed = null;

      // Try each source in order until one succeeds with meaningful data
      for (const sourceKey of TLE_SOURCE_ORDER) {
        const source = TLE_SOURCES[sourceKey];
        try {
          tleData = await source.fetchGroups(groups, controller.signal);
          if (Object.keys(tleData).length >= 5) {
            sourceUsed = source.name;
            break; // Got enough data
          }
          logDebug(
            `[Satellites] ${source.name} returned only ${Object.keys(tleData).length} satellites, trying next source...`,
          );
        } catch (e) {
          logWarn(`[Satellites] ${source.name} failed: ${e.message}`);
        }
      }

      clearTimeout(timeout);

      // Fill missing satellites — CelesTrak group files don't include every ham sat.
      // Fetch individual TLEs by NORAD catalog number for any HAM_SATELLITES not yet resolved.
      // Tries CelesTrak CATNR first, then SatNOGS API as fallback.
      const foundNorads = new Set(Object.values(tleData).map((s) => s.norad));
      const missingSats = Object.entries(HAM_SATELLITES).filter(([, s]) => !foundNorads.has(s.norad));
      // Run the per-NORAD fallback when group fetches returned nothing (banned IP / rate-limited)
      // OR when only a handful are missing. The <= 30 cap protects against hammering when most
      // satellites are already resolved; when group fetches gave us zero, hammering is the goal.
      if (missingSats.length > 0 && (Object.keys(tleData).length === 0 || missingSats.length <= 30)) {
        logDebug(
          `[Satellites] ${missingSats.length} sats missing from group files: ${missingSats.map(([k]) => k).join(', ')}`,
        );
        // Fetch in batches of 5 to avoid hammering upstream
        for (let i = 0; i < missingSats.length; i += 5) {
          const batch = missingSats.slice(i, i + 5);
          const results = await Promise.allSettled(
            batch.map(async ([key, sat]) => {
              // Try CelesTrak individual CATNR lookup first
              try {
                const catRes = await fetch(
                  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.norad}&FORMAT=tle`,
                  {
                    headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                    signal: AbortSignal.timeout(5000),
                  },
                );
                if (catRes.ok) {
                  const catText = await catRes.text();
                  const catLines = catText.trim().split('\n');
                  if (catLines.length >= 3 && catLines[1].trim().startsWith('1 ')) {
                    const tleKey = key.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
                    tleData[tleKey] = { ...sat, tle1: catLines[1].trim(), tle2: catLines[2].trim() };
                    logDebug(`[Satellites] Filled ${key} (NORAD ${sat.norad}) from CelesTrak CATNR`);
                    return key;
                  }
                  logDebug(
                    `[Satellites] CelesTrak CATNR ${sat.norad} returned unexpected format: ${catLines.length} lines`,
                  );
                }
              } catch (e) {
                logDebug(`[Satellites] CelesTrak CATNR ${sat.norad} failed: ${e.message}`);
              }

              // Fallback: SatNOGS TLE API
              try {
                const satnogsRes = await fetch(
                  `https://db.satnogs.org/api/tle/?norad_cat_id=${sat.norad}&format=json`,
                  {
                    headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                    signal: AbortSignal.timeout(5000),
                  },
                );
                if (satnogsRes.ok) {
                  const satnogsData = await satnogsRes.json();
                  const entry = Array.isArray(satnogsData) ? satnogsData[0] : satnogsData;
                  if (entry?.tle1 && entry?.tle2) {
                    const tleKey = key.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
                    tleData[tleKey] = { ...sat, tle1: entry.tle1.trim(), tle2: entry.tle2.trim() };
                    logDebug(`[Satellites] Filled ${key} (NORAD ${sat.norad}) from SatNOGS`);
                    return key;
                  }
                }
              } catch (e) {
                logDebug(`[Satellites] SatNOGS ${sat.norad} failed: ${e.message}`);
              }

              logDebug(`[Satellites] Could not resolve TLE for ${key} (NORAD ${sat.norad}) from any source`);
              return null;
            }),
          );
          const filled = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
          if (filled.length > 0) logDebug(`[Satellites] Batch filled: ${filled.join(', ')}`);
          // Small delay between batches to be polite
          if (i + 5 < missingSats.length) await new Promise((r) => setTimeout(r, 300));
        }
        logDebug(`[Satellites] After fill: ${Object.keys(tleData).length} total satellites resolved`);
      }

      // ISS fallback — try CelesTrak direct if ISS not found
      const issExists = Object.values(tleData).some((sat) => sat.norad === 25544);
      if (!issExists) {
        try {
          const issRes = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', {
            signal: AbortSignal.timeout(5000),
          });
          if (issRes.ok) {
            const issLines = (await issRes.text()).trim().split('\n');
            if (issLines.length >= 3) {
              tleData['ISS'] = { ...HAM_SATELLITES['ISS'], tle1: issLines[1].trim(), tle2: issLines[2].trim() };
            }
          }
        } catch (e) {
          logDebug('[Satellites] ISS fallback failed');
        }
      }

      if (Object.keys(tleData).length > 0) {
        tleCache = { data: tleData, timestamp: now };
        if (sourceUsed) logInfo(`[Satellites] Loaded ${Object.keys(tleData).length} satellites from ${sourceUsed}`);
      } else {
        // All sources failed — set negative cache to avoid hammering
        tleNegativeCache = now;
        logWarn('[Satellites] All TLE sources failed, backing off for 30 min');
        // Serve stale if available
        if (tleCache.data && now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT) {
          res.set('X-TLE-Stale', 'true');
          return res.json(tleCache.data);
        }
      }

      sendTle(tleData);
    } catch (error) {
      // Return stale cache or empty if everything fails
      sendTle(tleCache.data || {});
    }
  });

  // Satellite debug endpoint — shows which sats resolved and which are missing
  app.get('/api/satellites/debug', (req, res) => {
    const cached = tleCache.data || {};
    const resolvedNorads = new Set(Object.values(cached).map((s) => s.norad));
    const all = Object.entries(HAM_SATELLITES).map(([key, sat]) => ({
      key,
      norad: sat.norad,
      name: sat.name,
      resolved: resolvedNorads.has(sat.norad),
      tleKey: Object.keys(cached).find((k) => cached[k].norad === sat.norad) || null,
    }));
    res.json({
      cacheAge: tleCache.timestamp ? `${Math.round((Date.now() - tleCache.timestamp) / 1000)}s ago` : 'empty',
      totalInRegistry: Object.keys(HAM_SATELLITES).length,
      totalResolved: Object.keys(cached).length,
      totalMissing: all.filter((s) => !s.resolved).length,
      missing: all.filter((s) => !s.resolved),
      resolved: all.filter((s) => s.resolved),
    });
  });
};
