'use strict';

/**
 * Satellite TLE / OMM tracking routes.
 */

const fs = require('fs');
const path = require('path');
const satellitesTracked = require('./satellites-tracked');
const { normalizeJsonTree } = require('../utils/normalize');
const { MutexCounter } = require('../utils/mutex');
const { StateMachine } = require('../utils/statemachine');
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

  const fetchOmmFromCelesTrakGroups = async (group) => {
    let httpStatusCode = 0;
    let ommJson = {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout
    try {
      const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=csv`, {
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
      const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`, {
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
        const count = Object.keys(ommJson).length;
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
      const msg = ex?.message || String(ex ?? '(unknown error)');
      logWarn(`Error reading CSV: ${msg}`);
    }
    normalizeJsonTree(json);
    return json;
  };

  // record of satellites whose data is known and are part of the tracked list HAM_SATELLITES
  // note, the size of ommCache is not expected to grow beyond the size of the target list
  let ommCache = {};
  let ommCacheTimestamp = 0;

  // record of satellites whose data is known but are not being tracked,
  // note that the size of ommUnusedCache is not expected to grow beyond the intersection size of downloaded groups minus
  // any satellites downloaded that are part of the target list HAM_SATELLITES
  let ommUnusedCache = {};

  const OMM_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours, period after which OMM data considered stale
  const SPACE_TRACK_BACKOFF = 120 * 60 * 1000; // 2 hour, any satellite not allowed to repeat query to Space-Track within this period
  const CELESTRAK_BACKOFF = 120 * 60 * 1000; // 2 hour, any satellite not allowed to repeat query to CelesTrak within this period
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
  logDebug('[Satellites] Space-Track enabled: ' + isSpaceTrackEnabled);
  logDebug('[Satellites] CelesTrak enabled: ' + isCelestrakEnabled);

  let blockCelesTrakUntil = Date.now() - 1; // Timestamp until which CelesTrak fetches are blocked due to rate limiting or ban
  let blockSpaceTrackUntil = Date.now() - 1; // Timestamp until which Space-Track fetches are blocked due to rate limiting or ban
  let celestrakNumSatNeedDownload = 0;
  let noradsToDownload = [];

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
  ];

  // state-machine handlers
  const handlers = {
    START: () => {
      // toggle between OMM providers
      switch (nextOmmProvider()) {
        case 'SPACE_TRACK':
          return isSpaceTrackEnabled ? 'SPACE_TRACK_INIT' : 'START'; // return next state
          break;
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

      return 'CELESTRAK_AMATEUR_GROUP_FETCH'; // return next state
    },

    CELESTRAK_AMATEUR_GROUP_FETCH: async () => {
      // fetch new CelesTrak OMM data for the 'amateur' group to refresh cache in the background
      try {
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakGroups('amateur');
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else if (httpStatusCode === 301 || httpStatusCode === 403 || httpStatusCode === 429) {
          logWarn('[Satellites] Detected CelesTrak rate limit or ban, blocking fetches for 120mins');
          blockCelesTrakUntil = Date.now() + 120 * 60 * 1000; // Block CelesTrak fetches for 120mins
        } else if (httpStatusCode === 404) {
          logDebug("[Satellites] detected 404 'not found' on a group query, may need investigation");
        } else if (httpStatusCode === 0) {
          logErrorOnce(`[Satellites] CelesTrak OMM fetch failed with no response (possible timeout)`);
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_AMATEUR_GROUP_FETCH handler, advancing to next state: ${msg}`,
        );
      } finally {
        return 'CELESTRAK_WEATHER_GROUP_INIT'; // return next state
      }
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

      return 'CELESTRAK_WEATHER_GROUP_FETCH'; // return next state
    },

    CELESTRAK_WEATHER_GROUP_FETCH: async () => {
      // fetch new CelesTrak OMM data for the 'weather' group to refresh cache in the background
      try {
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakGroups('weather');
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else if (httpStatusCode === 301 || httpStatusCode === 403 || httpStatusCode === 429) {
          logWarn('[Satellites] Detected CelesTrak rate limit or ban, blocking fetches for 120mins');
          blockCelesTrakUntil = Date.now() + 120 * 60 * 1000; // Block CelesTrak fetches for 120mins
        } else if (httpStatusCode === 404) {
          logDebug("[Satellites] detected 404 'not found' on a group query, may need investigation");
        } else if (httpStatusCode === 0) {
          logErrorOnce(`[Satellites] CelesTrak OMM fetch failed with no response (possible timeout)`);
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_WEATHER_GROUP_FETCH handler, advancing to next state: ${msg}`,
        );
      } finally {
        return 'CELESTRAK_INDIVIDUAL_INIT'; // return next state
      }
    },

    CELESTRAK_INDIVIDUAL_INIT: async () => {
      if (blockCelesTrakUntil && Date.now() < blockCelesTrakUntil) {
        logDebug('[Satellites] Skipping CelesTrak fetch due to active backoff');
        return 'START'; // return next state
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

        noradsToDownload = sat.norad;
        return 'CELESTRAK_INDIVIDUAL_FETCH'; // return next state
      }

      return 'START'; // return next state
    },

    CELESTRAK_INDIVIDUAL_FETCH: async () => {
      // fetch new CelesTrak OMM data for individual satellites to refresh cache in the background
      try {
        if (Array.isArray(noradsToDownload))
          throw `[Satellites] CELESTRAK_INDIVIDUAL_FETCH, argument noradsToDownload should not be array`;
        const { httpStatusCode, ommJson } = await fetchOmmFromCelesTrakIndividual(noradsToDownload);
        if (httpStatusCode === 200) {
          if (ommJson && Object.keys(ommJson).length > 0) appendDataToOmmCache(ommJson);
        } else if (httpStatusCode === 301 || httpStatusCode === 403 || httpStatusCode === 429) {
          logWarn('[Satellites] Detected CelesTrak rate limit or ban, blocking fetches for 120mins');
          blockCelesTrakUntil = Date.now() + 120 * 60 * 1000; // Block CelesTrak fetches for 120mins
        } else if (httpStatusCode === 404) {
          logDebug(
            `[Satellites] NORAD ID ${noradsToDownload}, detected 404 \'not found\', may need to manually check status of this satellite via CelesTrak website`,
          );
        } else if (httpStatusCode === 0) {
          logErrorOnce(`[Satellites] CelesTrak OMM fetch failed with no response (possible timeout)`);
        }
      } catch (ex) {
        const msg = ex?.message || String(ex ?? '(unknown error)');
        logWarn(
          `[Satellites] caught unknown exception occurred in CELESTRAK_INDIVIDUAL_FETCH handler, advancing to next state: ${msg}`,
        );
      } finally {
        return 'CELESTRAK_INDIVIDUAL_INIT'; // return next state, back to INIT
      }
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
      } finally {
        return 'START'; // return next state
      }
    },
  };

  // Initialize state-machine with periodic advance every 15s
  const sm = new StateMachine(smStates, handlers);
  sm.run(); // kick-start before the first interval
  setInterval(async () => {
    sm.run();
  }, 15 * 1000);

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
      const key = objectName.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
      if (match) {
        countUsed++;
        const hamSat = Object.values(HAM_SATELLITES).find((s) => s.norad === noradId);
        hamSat.ommTimestamp = now; // record timestamp

        if (hamSat) {
          ommCache[key] = { ...hamSat, omm: omm, timestamp: now };
        }
      } else {
        // keep a separate record of satellites with unused data
        countUnused++;
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
    // Don't let Fastly/CDN pin an empty payload — when all sources fail we want
    // the next request after backoff to hit the origin, not the edge cache.
    const sendSatelliteData = (payload) => {
      if (!payload || Object.keys(payload).length === 0) {
        res.set('Cache-Control', 'no-store');
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
