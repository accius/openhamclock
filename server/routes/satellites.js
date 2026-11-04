'use strict';

/**
 * Satellite TLE / OMM tracking routes.
 */

const fs = require('fs');
const path = require('path');
const satellitesTracked = require('./satellites-tracked');
const { tleToOmm, parseTleBlock } = require('../utils/tle-to-omm');
const { normalizeJsonTree } = require('../utils/normalize');
const { StateMachine } = require('../utils/statemachine');
const { celestrakFailurePolicy } = require('../utils/celestrakFailurePolicy');
const csvToJson = require('convert-csv-to-json');
const wrapper = require('axios-cookiejar-support');
const CookieJar = require('tough-cookie');
const axios = require('axios');

module.exports = function (app, ctx) {
  const { fetch, CONFIG, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION, ROOT_DIR } = ctx;

  // ============================================
  // SATELLITE TRACKING API
  // ============================================

  // Load satellite database from satellites.json (editable by contributors)
  // Note: later will fall back to hardcoded list if JSON file not found
  const loadSatellitesJson = () => {
    const jsonPaths = [
      path.join(ctx.ASSET_DIR || ROOT_DIR, 'public', 'data', 'satellites.json'),
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
      } catch (ex) {
        logWarn(`[Satellites] Failed to load ${p}: ${ex.message}`);
      }
    }
    return null;
  };

  // retrieve list of tracked satellites from separate file satellites-tracked.js
  const HAM_SATELLITES = satellitesTracked.HAM_SATELLITES;

  // Load satellite database from satellites.json if it exists, and then merge it with the hard-coded HAM_SATELLITES allowing JSON to take precedence for any overlapping entries.
  // Maintainers can override data while still relying on hard-coded defaults.
  const jsonSatellites = loadSatellitesJson();
  if (jsonSatellites) {
    for (const [key, jsonSat] of Object.entries(jsonSatellites)) {
      if (HAM_SATELLITES[key]) {
        Object.assign(HAM_SATELLITES[key], {
          // for each key field, use JSON value if present, otherwise keep existing HAM_SATELLITES value
          downlink: jsonSat.downlink || HAM_SATELLITES[key].downlink || '',
          uplink: jsonSat.uplink || HAM_SATELLITES[key].uplink || '',
          tone: jsonSat.tone || HAM_SATELLITES[key].tone || '',
          beacon: jsonSat.beacon || HAM_SATELLITES[key].beacon || '',
          notes: jsonSat.notes || HAM_SATELLITES[key].notes || '',
          name: jsonSat.name || HAM_SATELLITES[key].name,
          mode: jsonSat.mode || HAM_SATELLITES[key].mode,
          color: jsonSat.color || HAM_SATELLITES[key].color,
          priority: jsonSat.priority ?? HAM_SATELLITES[key].priority,
          norad: jsonSat.norad || HAM_SATELLITES[key].norad,
        });
      } else {
        // New satellite only in JSON — add it to HAM_SATELLITES
        HAM_SATELLITES[key] = jsonSat;
      }
    }
    logInfo(`[Satellites] Merged radio metadata — ${Object.keys(HAM_SATELLITES).length} satellites in registry`);
  }

  // Upstream URL routing. When FLETCHER_URL is set, CelesTrak / AMSAT /
  // SatNOGS fetches go through an internal Railway proxy so they egress from
  // that service's IP. CelesTrak silently drops requests from this app's main
  // egress (#1057); the proxy gives the fetches a fresh IP.
  const FLETCHER_URL = CONFIG.satellites.fletcherUrl || '';
  if (FLETCHER_URL) {
    logInfo(`[Satellites] Routing CelesTrak/AMSAT/SatNOGS fetches via ${FLETCHER_URL}`);
  }

  // SatNOGS Transmitter DB radio metadata.
  const SATNOGS_TRANSMITTER_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const SATNOGS_TRANSMITTER_MAX_RECORDS = 500;
  const SATNOGS_TRANSMITTERS_PER_SAT = 16; // per-satellite cap on the Doppler picker list
  const SATNOGS_TRANSMITTER_REQUEST_TIMEOUT = 8000;
  // One request at a time with a breather between them: four-wide bursts got
  // SatNOGS throttling us every day, ~40 relay timeouts in two minutes,
  // which paged watchtower as "fletcher degraded" for ten minutes. The data
  // changes rarely, so slow is fine. After a few consecutive failures the
  // walk stops and yesterday's metadata stays in place.
  const SATNOGS_TRANSMITTER_CONCURRENCY = 1;
  const SATNOGS_TRANSMITTER_PAUSE_MS = 250;
  const SATNOGS_TRANSMITTER_MAX_CONSECUTIVE_FAILURES = 3;
  // 24 h plus up to 2 h of jitter, so the refresh does not land at the same
  // minute of boot every day.
  const satnogsRefreshDelay = () => SATNOGS_TRANSMITTER_CACHE_DURATION + Math.floor(Math.random() * 2 * 60 * 60 * 1000);
  const SATNOGS_TRANSMITTER_ATTRIBUTION = 'Radio metadata from SatNOGS Transmitter DB (CC BY-SA 4.0)';

  let satnogsTransmitterCache = {
    timestamp: 0,
    totalRecords: 0,
    recordsByNorad: {},
    lastError: null,
  };

  let satnogsTransmitterFetchInFlight = false;
  const SATNOGS_OVERLAY_FIELDS = ['mode', 'downlink', 'uplink', 'tone', 'beacon', 'notes'];
  const satnogsRegistryBaseMetadata = new Map();

  const snapshotSatnogsBaseMetadata = (satellite) => {
    const snapshot = {};
    SATNOGS_OVERLAY_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(satellite, field)) {
        snapshot[field] = satellite[field];
      }
    });
    return snapshot;
  };

  const getSatnogsBaseMetadataForSatellite = (satellite) => {
    const key = String(satellite?.norad || '');
    if (!key) return {};
    if (!satnogsRegistryBaseMetadata.has(key)) {
      satnogsRegistryBaseMetadata.set(key, snapshotSatnogsBaseMetadata(satellite));
    }
    return satnogsRegistryBaseMetadata.get(key);
  };

  const restoreSatnogsBaseMetadata = (satellite, baseMetadata) => {
    if (!satellite) return;
    SATNOGS_OVERLAY_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(baseMetadata, field)) {
        satellite[field] = baseMetadata[field];
      } else {
        delete satellite[field];
      }
    });
    delete satellite.satnogs;
    delete satellite.transmitters;
    delete satellite.radioMetadataAttribution;
  };

  const isSatnogsTransmitterMetadataStale = () =>
    !satnogsTransmitterCache.timestamp ||
    Date.now() - satnogsTransmitterCache.timestamp >= SATNOGS_TRANSMITTER_CACHE_DURATION;

  const formatHzAsMHz = (value) => {
    const hz = Number(value);
    if (!Number.isFinite(hz) || hz <= 0) return '';
    return (hz / 1000000).toFixed(3) + ' MHz';
  };

  const formatHzRangeAsMHz = (low, high) => {
    const lowNum = Number(low);
    const highNum = Number(high);
    const lowStr = formatHzAsMHz(low);
    const highStr = formatHzAsMHz(high);

    if (!lowStr && !highStr) return '';
    if (lowStr && (!highStr || lowNum === highNum)) return lowStr;
    if (!lowStr) return highStr;

    return lowStr.replace(' MHz', '') + ' - ' + highStr;
  };

  const describeSatnogsMode = (tx) => {
    const mode = String(tx.mode || '').trim();
    const type = String(tx.type || '').trim();
    const description = String(tx.description || '').trim();

    const downlinkLow = Number(tx.downlink_low);
    const downlinkHigh = Number(tx.downlink_high);
    const uplinkLow = Number(tx.uplink_low);
    const uplinkHigh = Number(tx.uplink_high);

    const hasDownlinkRange =
      Number.isFinite(downlinkLow) &&
      Number.isFinite(downlinkHigh) &&
      downlinkLow > 0 &&
      downlinkHigh > 0 &&
      downlinkLow !== downlinkHigh;

    const hasUplinkRange =
      Number.isFinite(uplinkLow) &&
      Number.isFinite(uplinkHigh) &&
      uplinkLow > 0 &&
      uplinkHigh > 0 &&
      uplinkLow !== uplinkHigh;

    const combined = [mode, type, description].join(' ').toLowerCase();

    // SatNOGS may report the sideband used within a linear transponder as
    // USB/LSB. For OHC's compact popup, a paired uplink/downlink frequency
    // range is more usefully displayed as "Linear", matching the existing
    // curated satellite metadata.
    if (combined.includes('linear') || (hasDownlinkRange && hasUplinkRange)) {
      return 'Linear';
    }

    const baud = Number(tx.baud);

    if (mode && Number.isFinite(baud) && baud > 0 && !mode.includes(String(baud))) {
      return mode + ' ' + baud + ' baud';
    }

    return mode || type;
  };
  const scoreSatnogsTransmitter = (tx) => {
    const mode = String(tx.mode || '').toLowerCase();
    const type = String(tx.type || '').toLowerCase();
    const description = String(tx.description || '').toLowerCase();

    const hasDownlink = Boolean(tx.downlink_low || tx.downlink_high);
    const hasUplink = Boolean(tx.uplink_low || tx.uplink_high);

    let score = 0;

    // For the popup, prefer an actual radio path the operator can use.
    // Telemetry-only/data beacons are useful metadata, but they should not
    // crowd out an FM or linear transponder entry when one exists.
    if (hasDownlink && hasUplink) score += 600;
    else if (hasDownlink) score += 100;

    if (type.includes('transceiver')) score += 350;
    if (type.includes('transponder')) score += 300;
    if (description.includes('transponder')) score += 250;
    if (description.includes('linear')) score += 250;

    if (mode.includes('linear')) score += 250;
    if (mode.includes('ssb') || mode.includes('usb') || mode.includes('lsb')) score += 220;
    if (mode.includes('fm')) score += 180;

    if (mode.includes('cw')) score += hasUplink ? 80 : -10;

    if (
      mode.includes('fsk') ||
      mode.includes('bpsk') ||
      mode.includes('gmsk') ||
      mode.includes('afsk') ||
      mode.includes('doka') ||
      mode.includes('telemetry') ||
      description.includes('telemetry') ||
      description.includes('beacon')
    ) {
      score -= hasUplink ? 25 : 125;
    }

    const updated = Date.parse(tx.updated || '');
    if (Number.isFinite(updated)) score += Math.min(20, Math.floor(updated / 100000000000));

    return score;
  };

  const activeSatnogsTransmitters = (transmitters) =>
    (Array.isArray(transmitters) ? transmitters : [])
      .filter((tx) => {
        const status = String(tx.status || '').toLowerCase();
        const alive = tx.alive === true || tx.alive === 'true';
        return status === 'active' && alive;
      })
      .sort((a, b) => scoreSatnogsTransmitter(b) - scoreSatnogsTransmitter(a));
  const buildSatnogsRadioMetadata = (transmitters) => {
    const selected = activeSatnogsTransmitters(transmitters);
    if (selected.length === 0) return null;

    // Show one best/primary transmitter in the UI. SatNOGS often lists
    // multiple active entries for the same satellite: telemetry beacons,
    // data downlinks, CW beacons, and transponders. Listing all of them in
    // the compact popup makes the radio metadata hard to use.
    const best = selected[0];

    const updatedTimes = selected.map((tx) => Date.parse(tx.updated || '')).filter((ts) => Number.isFinite(ts));

    const metadata = {
      satnogs: {
        source: 'SatNOGS Transmitter DB',
        transmitterCount: selected.length,
        selectedTransmitter: best.uuid || best.description || best.mode || best.type || null,
        updated: updatedTimes.length > 0 ? new Date(Math.max(...updatedTimes)).toISOString() : null,
        attribution: SATNOGS_TRANSMITTER_ATTRIBUTION,
      },
      radioMetadataAttribution: SATNOGS_TRANSMITTER_ATTRIBUTION,
    };

    if (selected.length > 1) {
      metadata.satnogs.alternateTransmitterCount = selected.length - 1;
    }

    const mode = describeSatnogsMode(best);
    const downlink = formatHzRangeAsMHz(best.downlink_low, best.downlink_high);
    const uplink = formatHzRangeAsMHz(best.uplink_low, best.uplink_high);
    const tone = String(best.tone || best.uplink_tone || best.downlink_tone || '').trim();

    if (mode) metadata.mode = mode;
    if (downlink) metadata.downlink = downlink;
    if (uplink) metadata.uplink = uplink;
    if (tone) metadata.tone = tone;

    // Every active transmitter with BOTH an uplink and a downlink — i.e. a
    // repeater or transponder a two-station relay contact can run through.
    // The EME layout's satellite-relay mode lists these; the single "best"
    // entry above stays for the compact info popup. Always set (possibly
    // empty) so a stale list never survives a refresh.
    const hzOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    metadata.relayTransmitters = selected
      .filter((tx) => hzOrNull(tx.uplink_low) && hzOrNull(tx.downlink_low))
      .map((tx) => ({
        mode: describeSatnogsMode(tx) || String(tx.mode || '').trim() || 'Unknown',
        type: String(tx.type || '').trim(),
        description: String(tx.description || '').trim(),
        uplink: formatHzRangeAsMHz(tx.uplink_low, tx.uplink_high),
        downlink: formatHzRangeAsMHz(tx.downlink_low, tx.downlink_high),
        uplinkLowHz: hzOrNull(tx.uplink_low),
        uplinkHighHz: hzOrNull(tx.uplink_high) || hzOrNull(tx.uplink_low),
        downlinkLowHz: hzOrNull(tx.downlink_low),
        downlinkHighHz: hzOrNull(tx.downlink_high) || hzOrNull(tx.downlink_low),
        invert: tx.invert === true || tx.invert === 'true',
        tone: String(tx.tone || tx.uplink_tone || '').trim(),
      }));

    // Every active transmitter, beacons and telemetry included, for the
    // Doppler tuner's transmitter picker. Same ordering as the popup (best
    // first). Capped so a chatty catalogue entry stays small on the wire.
    metadata.transmitters = selected.slice(0, SATNOGS_TRANSMITTERS_PER_SAT).map((tx) => ({
      uuid: String(tx.uuid || '').trim(),
      mode: describeSatnogsMode(tx) || String(tx.mode || '').trim() || 'Unknown',
      type: String(tx.type || '').trim(),
      description: String(tx.description || '').trim(),
      uplinkLowHz: hzOrNull(tx.uplink_low),
      uplinkHighHz: hzOrNull(tx.uplink_high) || hzOrNull(tx.uplink_low),
      downlinkLowHz: hzOrNull(tx.downlink_low),
      downlinkHighHz: hzOrNull(tx.downlink_high) || hzOrNull(tx.downlink_low),
      invert: tx.invert === true || tx.invert === 'true',
      baud: Number.isFinite(Number(tx.baud)) && Number(tx.baud) > 0 ? Number(tx.baud) : null,
    }));

    return metadata;
  };

  const fetchSatnogsTransmittersForNorad = async (noradId) => {
    const directBase = 'https://db.satnogs.org/api/transmitters/';
    const proxyBase = FLETCHER_URL ? FLETCHER_URL.replace(/\/$/, '') + '/satnogs/api/transmitters/' : null;

    const bases = proxyBase ? [proxyBase, directBase] : [directBase];

    for (const base of bases) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SATNOGS_TRANSMITTER_REQUEST_TIMEOUT);

      try {
        const url = base + '?format=json&satellite__norad_cat_id=' + encodeURIComponent(String(noradId));

        const res = await fetch(url, {
          headers: { 'User-Agent': 'OpenHamClock/' + APP_VERSION },
          signal: controller.signal,
        });

        if (!res.ok) {
          continue;
        }

        const json = await res.json();
        const transmitters = Array.isArray(json) ? json : Array.isArray(json.results) ? json.results : [];

        return transmitters;
      } catch {
        // Try the next base URL, if any.
      } finally {
        clearTimeout(timeout);
      }
    }

    return null; // every base failed (timeout / throttled) — distinct from "no transmitters"
  };

  const applySatnogsMetadataToRegistry = (recordsByNorad) => {
    let applied = 0;
    let cleared = 0;

    Object.entries(recordsByNorad || {}).forEach(([norad, transmitters]) => {
      const target = Object.values(HAM_SATELLITES).find((sat) => String(sat.norad) === String(norad));
      if (!target) return;

      const baseMetadata = getSatnogsBaseMetadataForSatellite(target);
      const metadata = buildSatnogsRadioMetadata(transmitters);

      if (!metadata) {
        let clearedThisNorad = false;

        if (target.satnogs || target.radioMetadataAttribution) {
          restoreSatnogsBaseMetadata(target, baseMetadata);
          clearedThisNorad = true;
        }

        Object.values(ommCache || {}).forEach((entry) => {
          if (String(entry.norad) === String(norad) && (entry.satnogs || entry.radioMetadataAttribution)) {
            restoreSatnogsBaseMetadata(entry, baseMetadata);
            clearedThisNorad = true;
          }
        });

        if (clearedThisNorad) cleared++;
        return;
      }

      const existingNotes = String(baseMetadata.notes || '').trim();
      if (existingNotes && !existingNotes.includes('SatNOGS Transmitter DB')) {
        metadata.notes = existingNotes + ' ' + SATNOGS_TRANSMITTER_ATTRIBUTION;
      } else if (!existingNotes) {
        metadata.notes = SATNOGS_TRANSMITTER_ATTRIBUTION;
      }

      Object.assign(target, metadata);
      Object.values(ommCache || {}).forEach((entry) => {
        if (String(entry.norad) === String(norad)) {
          Object.assign(entry, metadata);
        }
      });
      applied++;
    });

    return { applied, cleared };
  };

  const refreshSatnogsTransmitterMetadata = async (force = false) => {
    if (satnogsTransmitterFetchInFlight) return;
    if (!force && !isSatnogsTransmitterMetadataStale()) return;

    satnogsTransmitterFetchInFlight = true;
    try {
      const norads = [
        ...new Set(
          Object.values(HAM_SATELLITES)
            .map((sat) => Number(sat.norad))
            .filter((norad) => Number.isFinite(norad) && norad > 0),
        ),
      ].sort((a, b) => a - b);

      const recordsByNorad = {};
      let totalRecords = 0;

      let consecutiveFailures = 0;
      let aborted = false;
      for (
        let i = 0;
        i < norads.length && totalRecords < SATNOGS_TRANSMITTER_MAX_RECORDS;
        i += SATNOGS_TRANSMITTER_CONCURRENCY
      ) {
        const batch = norads.slice(i, i + SATNOGS_TRANSMITTER_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (norad) => ({
            norad,
            transmitters: await fetchSatnogsTransmittersForNorad(norad),
          })),
        );

        for (const { norad, transmitters } of results) {
          if (transmitters === null) {
            consecutiveFailures++;
            continue;
          }
          consecutiveFailures = 0;
          const room = SATNOGS_TRANSMITTER_MAX_RECORDS - totalRecords;
          if (room <= 0) break;

          const limitedTransmitters = transmitters.slice(0, room);
          recordsByNorad[norad] = limitedTransmitters;
          totalRecords += limitedTransmitters.length;
        }

        if (consecutiveFailures >= SATNOGS_TRANSMITTER_MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          break;
        }
        if (i + SATNOGS_TRANSMITTER_CONCURRENCY < norads.length) {
          await new Promise((resolve) => setTimeout(resolve, SATNOGS_TRANSMITTER_PAUSE_MS));
        }
      }

      if (aborted) {
        // SatNOGS is throttling or down — keep whatever metadata we already
        // had rather than overwrite it with a partial walk. Try again later.
        const msg = `SatNOGS not answering after ${Object.keys(recordsByNorad).length} satellites — keeping previous metadata`;
        satnogsTransmitterCache = { ...satnogsTransmitterCache, lastError: msg };
        logWarn(`[Satellites] ${msg}`);
        return;
      }

      satnogsTransmitterCache = {
        timestamp: Date.now(),
        totalRecords,
        recordsByNorad,
        lastError: null,
      };

      const { applied, cleared } = applySatnogsMetadataToRegistry(recordsByNorad);
      if (applied > 0 || cleared > 0) {
        logInfo(
          '[Satellites] SatNOGS transmitter metadata updated: ' +
            applied +
            ' satellites, ' +
            totalRecords +
            ' transmitter records' +
            (cleared > 0 ? ', ' + cleared + ' stale overlays cleared' : ''),
        );
      } else {
        logWarn('[Satellites] SatNOGS transmitter metadata refresh completed with no matching active transmitters');
      }
    } catch (ex) {
      const msg = ex?.message || String(ex ?? '(unknown error)');
      satnogsTransmitterCache.lastError = msg;
      logWarn('[Satellites] SatNOGS transmitter metadata refresh failed: ' + msg);
    } finally {
      satnogsTransmitterFetchInFlight = false;
    }
  };

  const fetchOmmFromCelesTrakGroups = async (group) => {
    let httpStatusCode = 0;
    let ommJson = {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const urlBase = FLETCHER_URL
        ? `${FLETCHER_URL}/celestrak/NORAD/elements/gp.php`
        : 'https://celestrak.org/NORAD/elements/gp.php';
      const res = await fetch(`${urlBase}?GROUP=${group}&FORMAT=csv`, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });

      httpStatusCode = res.status;

      if (res.ok) {
        const text = await res.text();
        ommJson = await parseCsvText(text);
        logDebug(`[Satellites] CelesTrak OMM fetch for ${group} group successful`);
      } else if (res.status >= 400 && res.status <= 499) {
        const body = await res.text().catch(() => '<no message>');
        logWarn(`[Satellites] CelesTrak OMM fetch failed for ${group} group: ${res.status} ${body}`);
      }
    } catch (ex) {
      // timeout occurred, will return with httpStatusCode = 0
      logWarn(`[Satellites] CelesTrak OMM fetch for ${group} group timed out after 20s`);
    } finally {
      clearTimeout(timeout);
    }

    return { httpStatusCode, ommJson };
  };

  const fetchOmmFromCelesTrakIndividual = async (noradId) => {
    let httpStatusCode = 0;
    let ommJson = {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout

    try {
      const urlBase = FLETCHER_URL
        ? `${FLETCHER_URL}/celestrak/NORAD/elements/gp.php`
        : 'https://celestrak.org/NORAD/elements/gp.php';
      const res = await fetch(`${urlBase}?CATNR=${noradId}&FORMAT=json`, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });

      httpStatusCode = res.status;

      if (res.ok) {
        ommJson = await res.text();
        ommJson = JSON.parse(ommJson);
        normalizeJsonTree(ommJson);
        logDebug(`[Satellites] CelesTrak OMM fetch for NORAD ID ${noradId} successful`);
      } else if (res.status >= 400 && res.status <= 499) {
        const body = await res.text().catch(() => '<no message>');
        logWarn(`[Satellites] CelesTrak OMM fetch failed for NORAD ID ${noradId}: ${res.status} ${body}`);
      }
    } catch (ex) {
      // timeout occurred, will return with httpStatusCode = 0
      logWarn(`[Satellites] CelesTrak OMM fetch for NORAD ID ${noradId} timed out after 20s`);
    } finally {
      clearTimeout(timeout);
    }

    return { httpStatusCode, ommJson };
  };

  // AMSAT fallback - TLE based
  // Single concatenated-TLE feed at amsat.org. Covers only amateur satellites.
  // Used as a fallback for CelesTrak so that we keep resolving satellites when
  // celestrak.org is unreachable, historically a recurring failure mode on cloud hosts (#1057).
  const fetchOmmFromAmsat_TleBased = async () => {
    let httpStatusCode = 0;
    let ommArray = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const url = FLETCHER_URL
        ? `${FLETCHER_URL}/amsat/tle/current/nasabare.txt`
        : 'https://www.amsat.org/tle/current/nasabare.txt';
      const res = await fetch(url, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });

      httpStatusCode = res.status;

      if (res.ok) {
        const text = await res.text();
        ommArray = parseTleBlock(text);
        logDebug(`[Satellites] AMSAT TLE fetch successful, ${ommArray.length} TLEs parsed`);
      } else if (res.status >= 400 && res.status <= 499) {
        const body = await res.text().catch(() => '<no message>');
        logWarn(`[Satellites] AMSAT TLE fetch failed: ${res.status} ${body.slice(0, 100)}`);
      }
    } catch (ex) {
      logWarn(`[Satellites] AMSAT TLE fetch timed out after 20s`);
    } finally {
      clearTimeout(timeout);
    }

    return { httpStatusCode, ommArray };
  };

  // SatNOGS individual fallback - TLE based
  // SatNOGS DB exposes TLE based data wrapped in a JSON format.
  // The dataset has previously been shown to be questionable, and may contain stale or inaccurate data,
  // or data for satellites that have decayed and are no longer in orbit.
  const fetchOmmFromSatnogsIndividual_TleBased = async (noradId) => {
    let httpStatusCode = 0;
    let omm = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const urlBase = FLETCHER_URL ? `${FLETCHER_URL}/satnogs/api/tle/` : 'https://db.satnogs.org/api/tle/';
      const res = await fetch(`${urlBase}?norad_cat_id=${noradId}&format=json`, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });

      httpStatusCode = res.status;

      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const entry = arr[0];
          omm = tleToOmm(entry.tle0 || `NORAD ${noradId}`, entry.tle1, entry.tle2);
          if (omm) logDebug(`[Satellites] SatNOGS TLE fetch for NORAD ${noradId} successful`);
        }
      } else if (res.status >= 400 && res.status <= 499) {
        const body = await res.text().catch(() => '<no message>');
        logWarn(`[Satellites] SatNOGS fetch failed for NORAD ${noradId}: ${res.status} ${body.slice(0, 100)}`);
      }
    } catch (ex) {
      logWarn(`[Satellites] SatNOGS fetch for NORAD ${noradId} timed out after 20s`);
    } finally {
      clearTimeout(timeout);
    }

    return { httpStatusCode, omm };
  };

  const fetchOmmFromSpaceTrack = async (norad, username, password) => {
    let httpStatusCode = 0;
    let ommJson = {};

    // Create cookie jar + axios instance
    const jar = new CookieJar.CookieJar();
    const client = wrapper.wrapper(
      axios.create({
        jar,
        withCredentials: true,
        headers: {
          'User-Agent': `OpenHamClock/${APP_VERSION}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    // 1. Login to Space-Track, saves cookie
    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const loginResponse = await client.post(
        'https://www.space-track.org/ajaxauth/login',
        new URLSearchParams({ identity: username, password }),
        { signal: controller.signal },
      );

      // Fail on non-200
      if (loginResponse.status !== 200) {
        logWarn(`[Satellites] Space-Track login HTTP error: ${loginResponse.status}`);
        return { httpStatusCode: loginResponse.status, ommJson };
      }

      const body = loginResponse.data;

      // Normalize into a single lowercase string for easy matching
      let bodyStr = '';
      if (typeof body === 'string') {
        bodyStr = body.toLowerCase();
      } else if (body && typeof body === 'object') {
        // Join all object values into one string
        bodyStr = Object.values(body)
          .map((v) => String(v).toLowerCase())
          .join(' ');
      }

      // Case‑insensitive failure detection
      if (bodyStr.includes('failed') || bodyStr.includes('denied')) {
        logWarn(`[Satellites] Space-Track login rejected credentials`);
        return { httpStatusCode: 401, ommJson };
      }
    } catch (ex) {
      logWarn(`[Satellites] Space-Track login could not establish connection: ${ex.message}`);
      return { httpStatusCode: 0, ommJson };
    } finally {
      clearTimeout(timeout);
    }

    // 2. Check whoami, JSON returned confirms whether logged in or not
    const isLoggedIn = (whoami) => {
      const jsonBytes = new Uint8Array(whoami);
      if (!jsonBytes || jsonBytes.length === 0) return false;
      const json = new TextDecoder('utf-8').decode(jsonBytes);

      let obj;
      try {
        obj = JSON.parse(json);
      } catch {
        return false;
      }

      return obj.logged_in === true;
    };

    try {
      timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
      const whoamiResp = await client.get('https://www.space-track.org/app/data/whoami', {
        responseType: 'arraybuffer',
        signal: controller.signal,
      });

      const whoami = whoamiResp.data;
      const loggedIn = isLoggedIn(whoami);

      logDebug('[Satellites] Space-Track loggedIn = ' + loggedIn);
      if (!loggedIn) {
        httpStatusCode = 401;
        return { httpStatusCode, ommJson }; // return with httpStatusCode = 401 to indicate auth failure
      }
    } catch (ex) {
      logWarn(`[Satellites] Space-Track OMM fetch login failed: ${ex.message}`);
      httpStatusCode = 401;
      return { httpStatusCode, ommJson }; // return with httpStatusCode = 401 to indicate auth failure
    } finally {
      clearTimeout(timeout);
    }

    // 3. Get TLE data
    const fetchUrl =
      'https://www.space-track.org/basicspacedata/query/class/gp/norad_cat_id/' + norad.join(',') + '/format/csv';

    timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const res = await client.get(fetchUrl, {
        headers: {
          'User-Agent': `OpenHamClock/${APP_VERSION}`,
        },
        responseType: 'arraybuffer', // binary data
        signal: controller.signal,
      });

      httpStatusCode = res.status;

      // if OK then decode CSV from binary response and parse, otherwise log error for 4xx responses
      if (httpStatusCode == 200) {
        const bytes = new Uint8Array(await res.data);
        const textDecoder = new TextDecoder('utf-8');
        const text = await textDecoder.decode(bytes);

        ommJson = await parseCsvText(text);
        logDebug(`[Satellites] Space-Track OMM fetch successful`);
      } else if (res.status >= 400 && res.status <= 499) {
        logWarn(`[Satellites] Space-Track OMM fetch failed for NORAD ID '${norad}': ${res.status}`);
      }
    } catch (ex) {
      // timeout occurred, return with httpStatusCode = 0
      logWarn(`[Satellites] Space-Track OMM fetch for NORAD ID '${norad}' timed out after 20s`);
      return { httpStatusCode, ommJson };
    } finally {
      clearTimeout(timeout);
    }

    return { httpStatusCode, ommJson };
  };

  /**
   * Parse CSV text into JSON, normalizing numeric values including those in scientific notation or with leading dots.
   *
   * @async
   * @param {*} csvText
   * @returns {unknown}
   */
  const parseCsvText = async (csvText) => {
    let json = null;
    try {
      csvToJson.supportQuotedField(true);
      json = await csvToJson.csvStringToJson(csvText);
    } catch (err) {
      const msg = err?.message || String(err ?? '(unknown error)');
      logWarn(`Error reading CSV: ${msg}`);
    }
    normalizeJsonTree(json);
    return json;
  };

  // record of satellites whose data is known and are part of the tracked list HAM_SATELLITES
  // note, the size of ommCache is not expected to grow beyond the size of the target list
  let ommCache = {};
  let ommCacheTimestamp = 0;
  // Exposed for server/health.js — read by the subsystem health snapshot.
  ctx.getSatellitesLastFetchAt = () => (ommCacheTimestamp > 0 ? ommCacheTimestamp : null);

  // record of satellites whose data is known but are not being tracked,
  // note that the size of ommUnusedCache is not expected to grow beyond the intersection size of downloaded groups minus
  // any satellites downloaded that are part of the target list HAM_SATELLITES
  let ommUnusedCache = {};

  // Analysis of data age and refresh periods:
  // NORAD releases updates approximately daily, P' = 24 hours.
  //
  // There exists a chained distribution between nodes: NORAD (Space-Track) → CelesTrak (when enabled) → user.
  // Assuming each hop is phase‑uncorrelated, that the number of hops = n, and the sample period at each node = P,
  // the accumulated end‑user data age is D = [0, P' + n * P],
  // with mean = (P' + n * P) / 2 and SD = sqrt((P'^2 + n * P^2) / 12).
  //
  // If each node chooses P = P' = 24 hours and n = 2, then D = [0, 72] hours,
  // with mean = 36 hours and SD = 12 hours.
  // As can be seen, choosing P = P' accumulates data age with a significant worst case.
  //
  // Accordingly, it is usual for each node to set its sampling period P to be a fraction of P'.
  // For instance, if P = P' / 2 = 12 hours and n = 2, then D = [0, 48] hours,
  // with mean = 24 hours and SD ≈ 8.5 hours.
  //
  // We cannot control the refresh period of upstream sources (e.g., CelesTrak), but it is assumed
  // they already sample at P < P'.
  //
  // Even with this in mind, however, we SHALL set our P = P' = 24 hours, since there is significant
  // cost to us in unnecessary frequent data refresh.
  const OMM_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours, period after which OMM data considered stale
  const SPACE_TRACK_BACKOFF = 120 * 60 * 1000; // 2 hour, any satellite not allowed to repeat query to Space-Track within this period
  const CELESTRAK_BACKOFF = 120 * 60 * 1000; // 2 hour, any satellite not allowed to repeat query to CelesTrak within this period
  const CELESTRAK_RETRY_AFTER_FAILURE = 5 * 60 * 1000; // failed attempt: retry within minutes, not the full 2h backoff (#1165)
  const CELESTRAK_GROUP_MIN_DOWNLOAD_SIZE = 3; // minimum number of satellites to trigger group download as, if fewer, then more efficient to perform individual download

  const isStale = (timestamp) => {
    if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
      return true; // returns true if timestamp missing, null, undefined, or NaN
    }

    return Date.now() >= timestamp + OMM_CACHE_DURATION;
  };

  // list of external OMM providers with logic to switch between them
  const OMM_PROVIDERS = ['SPACE_TRACK', 'CELESTRAK'];
  let ommProviderIndex = -1; // on the first fetch we want the first in the list
  const nextOmmProvider = () => {
    ommProviderIndex = (ommProviderIndex + 1) % OMM_PROVIDERS.length;
    return OMM_PROVIDERS[ommProviderIndex];
  };

  const isSpaceTrackEnabled = CONFIG.satellites.spaceTrack?.enabled || false; // default false if undefined
  const isCelestrakEnabled = CONFIG.satellites.celestrak?.enabled ?? true; // default true if undefined
  const isAmsatTleEnabled = CONFIG.satellites.amsat_tle?.enabled ?? true; // default true if undefined
  const isSatnogsTleEnabled = CONFIG.satellites.satnogs_tle?.enabled ?? true; // default true if undefined
  logDebug('[Satellites] Space-Track enabled: ' + isSpaceTrackEnabled);
  logDebug('[Satellites] CelesTrak enabled: ' + isCelestrakEnabled);
  logDebug('[Satellites] AMSAT TLE enabled: ' + isAmsatTleEnabled);
  logDebug('[Satellites] SatNOGS TLE enabled: ' + isSatnogsTleEnabled);

  let blockCelesTrakUntil = Date.now() - 1; // Timestamp until which CelesTrak fetches are blocked due to rate limiting or ban
  let blockSpaceTrackUntil = Date.now() - 1; // Timestamp until which Space-Track fetches are blocked due to rate limiting or ban
  let blockAmsatUntil = Date.now() - 1; // Timestamp until which AMSAT fallback fetches are blocked
  let blockSatnogsUntil = Date.now() - 1; // Timestamp until which SatNOGS fallback fetches are blocked
  let celestrakNumSatNeedDownload = 0;
  let noradsToDownload = [];
  let lastMarkedCelestrakSats = []; // sats whose backoffCelestrakUntil the INIT states just set optimistically
  const stateMachineBootAt = Date.now();

  // Shared non-200 handling for the three CelesTrak FETCH states (#1165):
  // decide the global block (short inside the boot grace window, 120min in
  // steady state) and roll the optimistic per-sat 2h backoff back to a short
  // retry on transient failures so one cold-start timeout doesn't cost the
  // whole group the full window.
  const applyCelestrakFailure = (httpStatusCode, label) => {
    const policy = celestrakFailurePolicy(httpStatusCode, Date.now() - stateMachineBootAt);
    if (policy.blockMs > 0) {
      logWarn(
        `[Satellites] Detected CelesTrak rate limit or ban (${label}), blocking fetches for ${Math.round(policy.blockMs / 60000)}mins`,
      );
      blockCelesTrakUntil = Date.now() + policy.blockMs;
    } else if (httpStatusCode === 404) {
      logDebug(`[Satellites] detected 404 'not found' on ${label} query, may need investigation`);
    } else if (httpStatusCode === 0) {
      logErrorOnce('Satellites', 'CelesTrak OMM fetch failed with no response (possible timeout)');
    }
    if (policy.rollbackSats) {
      const retryAt = Date.now() + CELESTRAK_RETRY_AFTER_FAILURE;
      lastMarkedCelestrakSats.forEach((s) => {
        if (s.backoffCelestrakUntil > retryAt) s.backoffCelestrakUntil = retryAt;
      });
    }
  };

  // state-machine states
  const smStates = [
    'START',
    'SPACE_TRACK_INIT',
    'SPACE_TRACK_FETCH',
    'CELESTRAK_AMATEUR_GROUP_INIT',
    'CELESTRAK_AMATEUR_GROUP_FETCH',
    'CELESTRAK_WEATHER_GROUP_INIT',
    'CELESTRAK_WEATHER_GROUP_FETCH',
    'CELESTRAK_INDIVIDUAL_INIT',
    'CELESTRAK_INDIVIDUAL_FETCH',
    'AMSAT_INIT',
    'AMSAT_FETCH',
    'SATNOGS_INDIVIDUAL_INIT',
    'SATNOGS_INDIVIDUAL_FETCH',
  ];

  // state-machine handlers
  const handlers = {
    START: () => {
      // toggle between OMM providers
      switch (nextOmmProvider()) {
        case 'SPACE_TRACK':
          return isSpaceTrackEnabled ? 'SPACE_TRACK_INIT' : 'START'; // return next state
        case 'CELESTRAK': {
          const now = Date.now();
          celestrakNumSatNeedDownload = celestrakSatsToDownload(now).length; // record how many satellites with a CelesTrak datasource need data
          return isCelestrakEnabled && celestrakNumSatNeedDownload > 0 ? 'CELESTRAK_AMATEUR_GROUP_INIT' : 'START'; // return next state
        }
        default:
          break;
      }
    },

    CELESTRAK_AMATEUR_GROUP_INIT: async () => {
      if (blockCelesTrakUntil && Date.now() < blockCelesTrakUntil) {
        logDebug('[Satellites] Skipping CelesTrak fetch due to active backoff');
        return 'START'; // return next state
      }

      const now = Date.now();
      const satsNeedDownload = Object.values(HAM_SATELLITES).filter(
        (s) =>
          s.data_source === 'celestrak_amateur' &&
          isStale(s.ommTimestamp) &&
          !(s.backoffCelestrakUntil && now < s.backoffCelestrakUntil),
      );

      // if number of satellites to download to too few it is more efficient to use individual downloads than to use a group
      if (satsNeedDownload.length < CELESTRAK_GROUP_MIN_DOWNLOAD_SIZE) return 'CELESTRAK_WEATHER_GROUP_INIT'; // return next state

      // assume data for this satellite is about to be attempted,
      // set backoff so that it cannot be repeated for this satellite until CELESTRAK_BACKOFF has elapsed
      satsNeedDownload.forEach((s) => {
        s.backoffCelestrakUntil = now + CELESTRAK_BACKOFF;
      });
      lastMarkedCelestrakSats = satsNeedDownload;

      return 'CELESTRAK_AMATEUR_GROUP_FETCH'; // return next state
    },

    CELESTRAK_AMATEUR_GROUP_FETCH: async () => {
      // fetch new CelesTrak OMM data for the 'amateur' group to refresh cache in the background
      try {
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakGroups('amateur');
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else {
          applyCelestrakFailure(httpStatusCode, "'amateur' group");
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_AMATEUR_GROUP_FETCH handler, advancing to next state: ${msg}`,
        );
      }
      return 'CELESTRAK_WEATHER_GROUP_INIT'; // return next state
    },

    CELESTRAK_WEATHER_GROUP_INIT: async () => {
      if (blockCelesTrakUntil && Date.now() < blockCelesTrakUntil) {
        logDebug('[Satellites] Skipping CelesTrak fetch due to active backoff');
        return 'START'; // return next state
      }

      const now = Date.now();
      const satsNeedDownload = Object.values(HAM_SATELLITES).filter(
        (s) =>
          s.data_source === 'celestrak_weather' &&
          isStale(s.ommTimestamp) &&
          !(s.backoffCelestrakUntil && now < s.backoffCelestrakUntil),
      );

      // if number of satellites to download to too few it is more efficient to use individual downloads than to use a group
      if (satsNeedDownload.length < CELESTRAK_GROUP_MIN_DOWNLOAD_SIZE) return 'CELESTRAK_INDIVIDUAL_INIT'; // return next state

      // assume data for this satellite is about to be attempted,
      // set backoff so that it cannot be repeated for this satellite until CELESTRAK_BACKOFF has elapsed
      satsNeedDownload.forEach((s) => {
        s.backoffCelestrakUntil = now + CELESTRAK_BACKOFF;
      });
      lastMarkedCelestrakSats = satsNeedDownload;

      return 'CELESTRAK_WEATHER_GROUP_FETCH'; // return next state
    },

    CELESTRAK_WEATHER_GROUP_FETCH: async () => {
      // fetch new CelesTrak OMM data for the 'weather' group to refresh cache in the background
      try {
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakGroups('weather');
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else {
          applyCelestrakFailure(httpStatusCode, "'weather' group");
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_WEATHER_GROUP_FETCH handler, advancing to next state: ${msg}`,
        );
      }
      return 'CELESTRAK_INDIVIDUAL_INIT'; // return next state
    },

    CELESTRAK_INDIVIDUAL_INIT: async () => {
      if (blockCelesTrakUntil && Date.now() < blockCelesTrakUntil) {
        logDebug('[Satellites] Skipping CelesTrak fetch due to active backoff');
        return isAmsatTleEnabled ? 'AMSAT_INIT' : isSatnogsTleEnabled ? 'SATNOGS_INDIVIDUAL_INIT' : 'START'; // return next state
      }

      // loop until every eligible satellite has been attempted for download using CELESTRAK_INDIVIDUAL_FETCH state,
      // OR until the number of satellites needing data has INCREASED which means there has been recent timestamp expirations and
      // it is prudent to reassess whether groups download is more appropriate. This is to mitigate potential mass timestamp
      // expirations coincide with when the INDIVIDUAL state is active in which case the individual state would unnecessarily
      // have the download burden.
      const now = Date.now();
      const satsToDownload = celestrakSatsToDownload(now);
      if (satsToDownload.length <= celestrakNumSatNeedDownload && satsToDownload.length > 0) {
        celestrakNumSatNeedDownload = satsToDownload.length; // update record

        // assume data for this satellite is about to be attempted,
        // set backoff so that it cannot be repeated for this satellite until CELESTRAK_BACKOFF has elapsed
        const sat = satsToDownload[0];
        sat.backoffCelestrakUntil = now + CELESTRAK_BACKOFF;
        lastMarkedCelestrakSats = [sat];

        noradsToDownload = sat.norad;
        return 'CELESTRAK_INDIVIDUAL_FETCH'; // return next state
      }

      return isAmsatTleEnabled ? 'AMSAT_INIT' : isSatnogsTleEnabled ? 'SATNOGS_INDIVIDUAL_INIT' : 'START'; // CelesTrak chain done — fall through to AMSAT/SatNOGS fallback
    },

    CELESTRAK_INDIVIDUAL_FETCH: async () => {
      // fetch new CelesTrak OMM data for individual satellites to refresh cache in the background
      try {
        if (Array.isArray(noradsToDownload))
          throw `[Satellites] CELESTRAK_INDIVIDUAL_FETCH, argument noradsToDownload should not be array`;
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakIndividual(noradsToDownload);
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else {
          applyCelestrakFailure(httpStatusCode, `NORAD ID ${noradsToDownload}`);
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_INDIVIDUAL_FETCH handler, advancing to next state: ${msg}`,
        );
      }
      return 'CELESTRAK_INDIVIDUAL_INIT'; // return next state, back to INIT
    },

    // AMSAT fallback (covers amateur sats when CelesTrak is unreachable)
    AMSAT_INIT: async () => {
      if (blockAmsatUntil && Date.now() < blockAmsatUntil) {
        return isSatnogsTleEnabled ? 'SATNOGS_INDIVIDUAL_INIT' : 'START'; // return next state
      }

      // Only run if there are still stale satellites needing data
      const stillStale = Object.values(HAM_SATELLITES).filter((s) => isStale(s.ommTimestamp));
      if (stillStale.length === 0) return 'START';
      return 'AMSAT_FETCH';
    },

    AMSAT_FETCH: async () => {
      try {
        const { httpStatusCode, ommArray } = await fetchOmmFromAmsat_TleBased();
        if (httpStatusCode === 200 && ommArray.length > 0) {
          // AMSAT is a fallback: only take entries for satellites that are
          // still stale so its TLE-derived data cannot clobber fresher
          // CelesTrak/Space-Track OMM data fetched moments earlier.
          const staleNorads = new Set(
            Object.values(HAM_SATELLITES)
              .filter((s) => isStale(s.ommTimestamp))
              .map((s) => s.norad),
          );
          appendDataToOmmCache(ommArray.filter((omm) => staleNorads.has(omm.NORAD_CAT_ID)));
        } else if (httpStatusCode === 0 || httpStatusCode >= 500) {
          logWarn(`[Satellites] Detected AMSAT HTTP state code = ${httpStatusCode}, blocking fetches for 60mins`);
          blockAmsatUntil = Date.now() + 60 * 60 * 1000; // 1 hour
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(`[Satellites] caught unknown exception in AMSAT_FETCH handler: ${msg}`);
      }
      return isSatnogsTleEnabled ? 'SATNOGS_INDIVIDUAL_INIT' : 'START'; // return next state
    },

    // SatNOGS individual fallback (covers non-amateur stragglers), accuracy of data questionable
    SATNOGS_INDIVIDUAL_INIT: async () => {
      if (blockSatnogsUntil && Date.now() < blockSatnogsUntil) {
        return 'START';
      }
      const now = Date.now();
      const stillStale = Object.values(HAM_SATELLITES).filter(
        (s) => isStale(s.ommTimestamp) && !(s.backoffSatnogsUntil && now < s.backoffSatnogsUntil),
      );
      if (stillStale.length === 0) return 'START';
      const sat = stillStale[0];
      sat.backoffSatnogsUntil = now + 60 * 60 * 1000; // 1 hour
      noradsToDownload = sat.norad;
      return 'SATNOGS_INDIVIDUAL_FETCH';
    },

    SATNOGS_INDIVIDUAL_FETCH: async () => {
      try {
        if (Array.isArray(noradsToDownload)) {
          throw new Error('[Satellites] SATNOGS_INDIVIDUAL_FETCH: noradsToDownload should not be array');
        }
        const { httpStatusCode, omm } = await fetchOmmFromSatnogsIndividual_TleBased(noradsToDownload);
        if (httpStatusCode === 200 && omm) {
          appendDataToOmmCache([omm]);
        } else if (httpStatusCode === 0 || httpStatusCode >= 500) {
          logWarn(`[Satellites] Detected SatNOGS HTTP state code = ${httpStatusCode}, blocking fetches for 60mins`);
          blockSatnogsUntil = Date.now() + 60 * 60 * 1000; // 1 hour
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(`[Satellites] caught unknown exception in SATNOGS_INDIVIDUAL_FETCH handler: ${msg}`);
      }
      return 'SATNOGS_INDIVIDUAL_INIT';
    },

    SPACE_TRACK_INIT: async () => {
      if (blockSpaceTrackUntil && Date.now() < blockSpaceTrackUntil) {
        logDebug('[Satellites] Skipping Space-Track fetch due to active backoff');
        return 'START'; // return next state
      }

      const now = Date.now();
      noradsToDownload = Object.values(HAM_SATELLITES)
        .filter((s) => {
          if (isStale(s.ommTimestamp) && !(s.backoffSpaceTrackUntil && now < s.backoffSpaceTrackUntil)) {
            // assume data for this satellite is about to be attempted,
            // set backoff so that it cannot be repeated for this satellite until SPACE_TRACK_BACKOFF has elapsed
            s.backoffSpaceTrackUntil = now + SPACE_TRACK_BACKOFF;
            return true; // add to filter
          } else return false; // exclude from filter
        })
        .map((s) => s.norad)
        .sort((a, b) => a - b);

      return noradsToDownload.length > 0 ? 'SPACE_TRACK_FETCH' : 'START'; // return next state
    },

    SPACE_TRACK_FETCH: async () => {
      // fetch new OMM data from Space-Track to refresh cache in the background
      try {
        const { httpStatusCode, ommJson } = await fetchOmmFromSpaceTrack(
          noradsToDownload,
          CONFIG.satellites.spaceTrack._username || '', // if spaceTrackEnabled === true then logic is that username and password are defined in .env
          CONFIG.satellites.spaceTrack._password || '',
        );
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else if (httpStatusCode === 401) {
          logWarn('[Satellites] Space-Track authentication failed, check credentials, blocking for 60min');
          blockSpaceTrackUntil = Date.now() + 60 * 60 * 1000; // Block Space-Track fetches for 60mins
        } else if (httpStatusCode === 403 || httpStatusCode === 404) {
          logWarn('[Satellites] Detected Space-Track rate limit or ban, blocking fetches for 60min');
          blockSpaceTrackUntil = Date.now() + 60 * 60 * 1000; // Block Space-Track fetches for 60mins
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in SPACE_TRACK_FETCH handler, advancing to next state: ${msg}`,
        );
      }
      return 'START'; // return next state
    },
  };

  // Initialize state-machine with periodic advance every 15s
  const sm = new StateMachine(smStates, handlers);
  sm.run(); // kick-start before the first interval
  setInterval(async () => {
    sm.run();
  }, 15 * 1000);

  // Refresh SatNOGS radio metadata in the background. This is deliberately
  // independent of the TLE/OMM state machine because transmitter metadata
  // changes much less frequently than orbital data.
  refreshSatnogsTransmitterMetadata(false);
  const scheduleSatnogsRefresh = () =>
    setTimeout(() => {
      refreshSatnogsTransmitterMetadata(false);
      scheduleSatnogsRefresh();
    }, satnogsRefreshDelay());
  scheduleSatnogsRefresh();

  // satellites with a CelesTrak datasource that need data
  const celestrakSatsToDownload = (now) => {
    return Object.values(HAM_SATELLITES).filter(
      (s) =>
        s.data_source?.startsWith('celestrak') &&
        isStale(s.ommTimestamp) &&
        !(s.backoffCelestrakUntil && now < s.backoffCelestrakUntil),
    );
  };

  // append OMM JSON data to cache
  const appendDataToOmmCache = async (ommJson) => {
    if (!ommJson || !Array.isArray(ommJson)) return;

    // Build NORAD_ID value lookup set for fast matching
    const knownNoradIds = new Set(Object.values(HAM_SATELLITES).map((s) => s.norad));

    let countUsed = 0,
      countUnused = 0;
    const now = Date.now();
    ommJson.forEach((omm) => {
      const noradId = omm.NORAD_CAT_ID;
      const objectName = omm.OBJECT_NAME;
      const match = knownNoradIds.has(noradId);
      if (match) {
        countUsed++;
        const hamSat = Object.values(HAM_SATELLITES).find((s) => s.norad === noradId);
        hamSat.ommTimestamp = now; // record timestamp

        // Key by the canonical registry name, never the upstream OBJECT_NAME —
        // sources name the same bird differently (CelesTrak "ISS (ZARYA)" vs
        // AMSAT "ISS"), and keying by upstream name cached the same satellite
        // under two keys, duplicating it in the client list (#1101).
        const key = String(hamSat.name || objectName)
          .toUpperCase()
          .replace(/[^A-Z0-9\-]/g, '_');
        ommCache[key] = { ...hamSat, omm: omm, timestamp: now };
      } else {
        // keep a separate record of satellites with unused data
        countUnused++;
        const key = String(objectName)
          .toUpperCase()
          .replace(/[^A-Z0-9\-]/g, '_');
        ommUnusedCache[key] = { norad: noradId, name: objectName };
      }
    });

    ommCacheTimestamp = now;
    logInfo(`[Satellites] OMM cache updated, ${countUsed} used, ${countUnused} unused records`);
  };

  // satellite data timestamp endpoint
  app.get('/api/satellites/data/timestamp', async (req, res) => {
    return res.json({ timestamp: typeof ommCacheTimestamp === 'number' ? ommCacheTimestamp : null });
  });

  // satellite data endpoint
  app.get('/api/satellites/data', async (req, res) => {
    // Don't let the CDN pin an empty payload — when all sources fail we want
    // the next request after backoff to hit the origin, not the edge cache.
    // Good payloads get an explicit short edge TTL: the Cloudflare cache rule
    // honors origin Cache-Control and bypasses when it's absent, so without
    // this header the endpoint wouldn't be edge-cached at all.
    const sendSatelliteData = (payload) => {
      if (!payload || Object.keys(payload).length === 0) {
        res.set('Cache-Control', 'no-store');
      } else {
        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      }

      const newestTimestamp = Object.values(ommCache)
        .map((entry) => entry.timestamp)
        .filter((ts) => typeof ts === 'number')
        .reduce((max, ts) => Math.max(max, ts), 0);

      const stale = newestTimestamp === 0 || Date.now() - newestTimestamp > OMM_CACHE_DURATION;
      if (stale) res.set('X-TLE-Stale', 'true');

      return res.json({
        timestamp: ommCacheTimestamp,
        data: payload,
      });
    };

    sendSatelliteData(ommCache || {});
  });

  // Forced element-set refresh (Settings → Satellites → "Refresh TLEs").
  // Marks every tracked satellite stale so the state machine re-fetches on
  // its next 15 s tick. Write-authenticated and rate limited like the other
  // mutating routes, plus a global cool-down so a room full of browsers
  // cannot turn this into an upstream hammer.
  const FORCE_REFRESH_MIN_INTERVAL = 10 * 60 * 1000;
  let lastForcedRefreshAt = 0;
  app.post('/api/satellites/refresh', ctx.writeLimiter, ctx.requireWriteAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    const waitMs = lastForcedRefreshAt + FORCE_REFRESH_MIN_INTERVAL - now;
    if (waitMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
      return res
        .status(429)
        .json({ ok: false, error: 'TLE refresh already requested recently', retryAfterSec: Math.ceil(waitMs / 1000) });
    }
    lastForcedRefreshAt = now;
    let count = 0;
    Object.values(HAM_SATELLITES).forEach((s) => {
      s.ommTimestamp = 0;
      delete s.backoffCelestrakUntil;
      delete s.backoffSatnogsUntil;
      delete s.backoffSpaceTrackUntil;
      count++;
    });
    logInfo(`[Satellites] Forced TLE refresh requested for ${count} satellites`);
    res.json({ ok: true, satellites: count, note: 'refresh queued; new elements arrive on the next fetch cycle' });
  });

  // Satellite debug endpoint — shows which are missing, which are resolved, and which have un-utilized downloaded data
  app.get('/api/satellites/debug', (req, res) => {
    const cached = ommCache || {};
    const resolvedNorads = new Set(Object.values(cached).map((s) => s.norad));

    const findCachedTimestampByNorad = (cached, norad) => {
      const entry = Object.values(cached).find((e) => e.norad === norad);
      return entry?.timestamp ?? null;
    };

    const formatSimpleAge = (ms) => {
      if (!ms || ms < 0) return 'n/a';
      const seconds = Math.floor(ms / 1000);
      if (seconds <= 300) {
        return `${seconds} s`;
      }
      const minutes = Math.floor(seconds / 60);
      if (minutes <= 120) {
        return `${minutes} min`;
      }
      const hours = Math.floor(minutes / 60);
      if (hours <= 48) {
        return `over ${hours} hr`;
      }
      const days = Math.floor(hours / 24);
      return `over ${days} days`;
    };

    const all = Object.entries(HAM_SATELLITES).map(([key, sat]) => {
      const ts = findCachedTimestampByNorad(cached, sat.norad);

      return {
        key,
        norad: sat.norad,
        name: sat.name,
        resolved: resolvedNorads.has(sat.norad),
        ...(resolvedNorads.has(sat.norad) &&
          ts && {
            cacheAge: formatSimpleAge(Date.now() - ts),
          }),
      };
    });

    const allUnused = Object.values(ommUnusedCache)
      .map((sat) => ({
        norad: sat.norad,
        name: sat.name,
      }))
      .sort((a, b) => a.norad - b.norad);

    res.json({
      satnogsTransmitters: {
        ...(satnogsTransmitterCache.timestamp > 0 && {
          lastFetch: formatSimpleAge(Date.now() - satnogsTransmitterCache.timestamp),
        }),
        totalRecords: satnogsTransmitterCache.totalRecords || 0,
        lastError: satnogsTransmitterCache.lastError || null,
        attribution: SATNOGS_TRANSMITTER_ATTRIBUTION,
      },
      totalInRegistry: Object.keys(HAM_SATELLITES).length,
      totalResolved: Object.keys(cached).length,
      totalMissing: all.filter((s) => !s.resolved).length,
      totalNotUtilized: allUnused.length,
      missing: all.filter((s) => !s.resolved),
      resolved: all.filter((s) => s.resolved),
      notUtilized: allUnused,
    });
  });
};
