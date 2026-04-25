/**
 * Propagation routes — ITU-R P.533-14 predictions, built-in fallback, heatmap.
 */

const physics = require('../utils/propagationPhysics');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    ITURHFPROP_URL,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    upstream,
    maidenheadToLatLon,
    n0nbhCache,
  } = ctx;

  const {
    MODE_ADVANTAGE_DB,
    calculateMUF,
    calculateLUF,
    calculateSignalMargin,
    adjustReliability,
    calculateEnhancedReliability,
    calculateSNR,
    getStatus,
  } = physics;

  // Calculate distance between two points in km
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ============================================
  // ITURHFProp SERVICE INTEGRATION (ITU-R P.533-14)
  // ============================================

  // Multi-entry LRU cache for ITURHFProp results — different DE/DX paths
  // don't evict each other. Keyed by rounded coordinates + solar params.
  const iturhfpropSingleCache = new Map(); // key → { data, ts }
  const iturhfpropHourlyMap = new Map(); // key → { data, ts }
  const ITUCACHE_TTL = 30 * 60 * 1000; // 30 min — predictions don't change fast
  const ITUCACHE_MAX = 200; // max entries per cache

  function ituCacheGet(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ITUCACHE_TTL) {
      cache.delete(key);
      return null;
    }
    return entry.data;
  }
  function ituCacheSet(cache, key, data) {
    cache.set(key, { data, ts: Date.now() });
    // LRU eviction
    if (cache.size > ITUCACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  // Negative cache: exponential backoff after repeated failures
  let iturhfpropDown = 0;
  let iturhfpropFailCount = 0;
  const ITURHFPROP_FAIL_THRESHOLD = 3; // consecutive failures before backing off
  const ITURHFPROP_BACKOFF_BASE = 30 * 1000; // 30s initial backoff
  const ITURHFPROP_BACKOFF_MAX = 10 * 60 * 1000; // 10 min max backoff
  let iturhfpropInFlight = 0; // track concurrent requests
  const ITURHFPROP_MAX_INFLIGHT = 3; // cap concurrent outbound fetches

  // Sticky disable: when the proppy endpoint serves HTML (e.g. Staging deploys
  // OHC's own SPA at the proppy URL because rootDirectory was flipped empty),
  // retire it for the process lifetime. The browser-side WASM engine + local
  // heuristic cover the prediction path, so this is a noise-suppression
  // measure, not a feature loss.
  let iturhfpropRetired = false;
  function detectProppyRetired(response) {
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('text/html')) {
      if (!iturhfpropRetired) {
        iturhfpropRetired = true;
        logInfo(
          `[ITURHFProp] Disabled — endpoint at ${ITURHFPROP_URL} returned HTML, not JSON. Falling back to browser WASM + heuristic.`,
        );
      }
      return true;
    }
    return false;
  }

  function iturhfpropBackoff() {
    if (iturhfpropFailCount < ITURHFPROP_FAIL_THRESHOLD) return 0;
    // Exponential: 30s, 60s, 120s, 240s, ... capped at 10min
    const exp = Math.min(
      ITURHFPROP_BACKOFF_BASE * Math.pow(2, iturhfpropFailCount - ITURHFPROP_FAIL_THRESHOLD),
      ITURHFPROP_BACKOFF_MAX,
    );
    return exp;
  }

  function iturhfpropIsDown() {
    return iturhfpropFailCount >= ITURHFPROP_FAIL_THRESHOLD && Date.now() - iturhfpropDown < iturhfpropBackoff();
  }

  // Background fetch queue — runs ITURHFProp requests without blocking the response
  const bgQueue = new Set(); // active queue keys (prevents duplicate requests)

  function queueBackgroundFetch(cacheKey, fetchFn) {
    if (bgQueue.has(cacheKey) || bgQueue.size > 20) return; // dedup & cap
    bgQueue.add(cacheKey);
    fetchFn()
      .then((data) => {
        if (data) logDebug(`[ITURHFProp] Background fetch complete: ${cacheKey.substring(0, 40)}`);
      })
      .catch(() => {})
      .finally(() => bgQueue.delete(cacheKey));
  }

  /**
   * Fetch base prediction from ITURHFProp service
   */
  async function fetchITURHFPropPrediction(txLat, txLon, rxLat, rxLon, ssn, month, hour, txPower, txGain) {
    if (!ITURHFPROP_URL || iturhfpropRetired) return null;
    if (iturhfpropIsDown()) return null;
    if (iturhfpropInFlight >= ITURHFPROP_MAX_INFLIGHT) return null;

    const pw = Math.round(txPower || 100);
    const gn = Math.round((txGain || 0) * 10) / 10;
    const cacheKey = `${txLat.toFixed(1)},${txLon.toFixed(1)}-${rxLat.toFixed(1)},${rxLon.toFixed(1)}-${ssn}-${month}-${hour}-${pw}-${gn}`;

    const cached = ituCacheGet(iturhfpropSingleCache, cacheKey);
    if (cached) return cached;

    iturhfpropInFlight++;
    try {
      const url = `${ITURHFPROP_URL}/api/bands?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&hour=${hour}&txPower=${pw}&txGain=${gn}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s for single hour

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logErrorOnce('Hybrid', `ITURHFProp returned ${response.status}`);
        return null;
      }
      if (detectProppyRetired(response)) return null;

      const data = await response.json();
      ituCacheSet(iturhfpropSingleCache, cacheKey, data);
      iturhfpropFailCount = 0; // reset on success
      return data;
    } catch (err) {
      iturhfpropFailCount++;
      iturhfpropDown = Date.now();
      if (err.name !== 'AbortError') {
        logErrorOnce('Hybrid', `ITURHFProp: ${err.message}`);
      }
      return null;
    } finally {
      iturhfpropInFlight--;
    }
  }

  /**
   * Fetch 24-hour predictions from ITURHFProp.
   * This calls P.533-14 for all 24 hours and returns per-band, per-hour reliability.
   * Results are cached for 10 minutes since they change slowly (SSN is daily).
   */
  // Round path coordinates to 1 decimal for cache key — paths within ~10km share results
  function roundPath(lat, lon) {
    return `${(Math.round(lat * 2) / 2).toFixed(1)},${(Math.round(lon * 2) / 2).toFixed(1)}`;
  }

  async function fetchITURHFPropHourly(txLat, txLon, rxLat, rxLon, ssn, month, txPower, txGain) {
    if (!ITURHFPROP_URL || iturhfpropRetired) return null;
    if (iturhfpropIsDown()) return null;
    if (iturhfpropInFlight >= ITURHFPROP_MAX_INFLIGHT) return null;

    const pw = Math.round(txPower || 100);
    const gn = Math.round((txGain || 0) * 10) / 10;
    const cacheKey = `h-${roundPath(txLat, txLon)}-${roundPath(rxLat, rxLon)}-${ssn}-${month}-${pw}-${gn}`;

    const cached = ituCacheGet(iturhfpropHourlyMap, cacheKey);
    if (cached) return cached;

    iturhfpropInFlight++;
    try {
      const url = `${ITURHFPROP_URL}/api/predict/hourly?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&txPower=${pw}&txGain=${gn}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s — P.533 needs time for 24h×10bands

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return null;
      if (detectProppyRetired(response)) return null;

      const data = await response.json();

      if (data?.hourly?.length > 0) {
        ituCacheSet(iturhfpropHourlyMap, cacheKey, data);
        iturhfpropFailCount = 0; // reset on success
        logDebug(`[ITURHFProp] Cached 24h prediction: ${cacheKey.substring(0, 40)}`);
      }

      return data;
    } catch (err) {
      iturhfpropFailCount++;
      iturhfpropDown = Date.now();
      if (err.name === 'AbortError') {
        logErrorOnce(
          'ITURHFProp',
          `Hourly fetch timed out (attempt ${iturhfpropFailCount}), backing off ${Math.round(iturhfpropBackoff() / 1000)}s`,
        );
      } else {
        logErrorOnce('ITURHFProp', `Hourly fetch: ${err.message} (attempt ${iturhfpropFailCount})`);
      }
      return null;
    } finally {
      iturhfpropInFlight--;
    }
  }

  // ============================================
  // PROPAGATION PREDICTION API (ITU-R P.533-14 via ITURHFProp)
  // ============================================

  // Antenna profiles: key → { name, gain (dBi) }
  // Gain is relative to isotropic (dBi). P.533 uses dBi for both TX and RX antennas.
  const ANTENNA_PROFILES = {
    isotropic: { name: 'Isotropic', gain: 0 },
    dipole: { name: 'Dipole', gain: 2.15 },
    'vert-qw': { name: 'Vertical 1/4λ', gain: 1.5 },
    'vert-5/8': { name: 'Vertical 5/8λ', gain: 3.2 },
    invv: { name: 'Inverted V', gain: 1.8 },
    ocfd: { name: 'OCFD / Windom', gain: 2.5 },
    efhw: { name: 'EFHW', gain: 2.0 },
    g5rv: { name: 'G5RV', gain: 2.0 },
    yagi2: { name: 'Yagi 2-el', gain: 5.5 },
    yagi3: { name: 'Yagi 3-el', gain: 8.0 },
    yagi5: { name: 'Yagi 5-el', gain: 10.5 },
    hexbeam: { name: 'Hex Beam', gain: 5.0 },
    cobweb: { name: 'Cobweb', gain: 4.0 },
    loop: { name: 'Magnetic Loop', gain: -1.0 },
    longwire: { name: 'Long Wire / Random', gain: 0.5 },
  };

  // Expose profiles via API so the frontend can enumerate them
  app.get('/api/propagation/antennas', (req, res) => {
    res.json(ANTENNA_PROFILES);
  });

  app.get('/api/propagation', async (req, res) => {
    const { deLat, deLon, dxLat, dxLon, mode, power, antenna } = req.query;

    // Calculate signal margin from mode + power
    const txMode = (mode || 'SSB').toUpperCase();
    const txPower = parseFloat(power) || 100;
    const antennaKey = antenna || 'isotropic';
    const txGain = ANTENNA_PROFILES[antennaKey]?.gain ?? 0;
    const signalMarginDb = calculateSignalMargin(txMode, txPower, txGain);

    const useITURHFProp = ITURHFPROP_URL !== null;
    logDebug(
      `[Propagation] ${useITURHFProp ? 'P.533-14' : 'Standalone'} calculation for DE:`,
      deLat,
      deLon,
      'to DX:',
      dxLat,
      dxLon,
      `[${txMode} @ ${txPower}W, ${ANTENNA_PROFILES[antennaKey]?.name || antennaKey} (${txGain > 0 ? '+' : ''}${txGain}dBi), margin: ${signalMarginDb.toFixed(1)}dB]`,
    );

    try {
      // Solar data — uses shared 15-minute cache (same as heatmap)
      const { sfi, ssn, kIndex } = await getSolarData();
      // Also check N0NBH for more accurate SSN if available
      let effectiveSSN = ssn;
      if (n0nbhCache.data?.solarData?.sunspots) {
        const s = parseInt(n0nbhCache.data.solarData.sunspots);
        if (s >= 0) effectiveSSN = s;
      }

      // Calculate path geometry
      const de = { lat: parseFloat(deLat) || 40, lon: parseFloat(deLon) || -75 };
      const dx = { lat: parseFloat(dxLat) || 35, lon: parseFloat(dxLon) || 139 };

      const distance = haversineDistance(de.lat, de.lon, dx.lat, dx.lon);
      const midLat = (de.lat + dx.lat) / 2;
      let midLon = (de.lon + dx.lon) / 2;

      // Handle antimeridian crossing
      if (Math.abs(de.lon - dx.lon) > 180) {
        midLon = (de.lon + dx.lon + 360) / 2;
        if (midLon > 180) midLon -= 360;
      }

      const currentHour = new Date().getUTCHours();
      const currentMonth = new Date().getMonth() + 1;

      logDebug('[Propagation] Distance:', Math.round(distance), 'km');
      logDebug('[Propagation] Solar: SFI', sfi, 'SSN', effectiveSSN, 'K', kIndex);
      const bands = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
      const bandFreqs = [1.8, 3.5, 7, 10, 14, 18, 21, 24, 28];

      // Band frequency lookup: map ITURHFProp frequencies back to band names
      // ITURHFProp uses slightly different center frequencies (e.g. 2.0 for 160m, 7.1 for 40m)
      function freqToBand(freq) {
        let bestBand = null;
        let bestDist = Infinity;
        for (let i = 0; i < bandFreqs.length; i++) {
          const dist = Math.abs(freq - bandFreqs[i]);
          if (dist < bestDist) {
            bestDist = dist;
            bestBand = bands[i];
          }
        }
        return bestDist < 2 ? bestBand : null; // within 2 MHz tolerance
      }

      const predictions = {};
      let currentBands;
      let usedITURHFProp = false;
      let iturhfpropMuf = null;

      // Try ITURHFProp from cache first (instant). If cache miss, check if
      // service is reachable (quick inline fetch). If that also misses, serve
      // built-in model immediately and queue ITURHFProp in the background so
      // the NEXT request for this path gets precise P.533-14 results.
      if (useITURHFProp) {
        // Check cache synchronously first — no network call
        const pw = Math.round(txPower || 100);
        const gn = Math.round((txGain || 0) * 10) / 10;
        const hourlyKey = `h-${roundPath(de.lat, de.lon)}-${roundPath(dx.lat, dx.lon)}-${effectiveSSN}-${currentMonth}-${pw}-${gn}`;
        const cachedHourly = ituCacheGet(iturhfpropHourlyMap, hourlyKey);

        // If not in cache, try a quick inline fetch (10s timeout)
        const hourlyData =
          cachedHourly ||
          (await fetchITURHFPropHourly(de.lat, de.lon, dx.lat, dx.lon, effectiveSSN, currentMonth, txPower, txGain));

        // If still no data and service isn't down, queue background fetch
        // so the next poll (10 min) gets precise results
        if (!hourlyData && !iturhfpropIsDown()) {
          queueBackgroundFetch(hourlyKey, () =>
            fetchITURHFPropHourly(de.lat, de.lon, dx.lat, dx.lon, effectiveSSN, currentMonth, txPower, txGain),
          );
        }

        // Validate that hourly data actually has frequency results — the proppy
        // service returns 24 entries even when circuit breaker is open, but with
        // empty frequencies arrays. Without this check we'd show 0% for all bands
        // instead of falling through to the built-in model.
        const hasFreqData =
          hourlyData?.hourly?.length === 24 && hourlyData.hourly.some((h) => h.frequencies?.length > 0);

        if (hasFreqData) {
          logDebug('[Propagation] Using ITURHFProp P.533-14 for all 24 hours');
          usedITURHFProp = true;

          // Build predictions directly from P.533-14 output
          bands.forEach((band) => {
            predictions[band] = [];
          });

          for (const hourEntry of hourlyData.hourly) {
            const h = hourEntry.hour;

            // Track MUF for current hour
            if (h === currentHour && hourEntry.muf) {
              iturhfpropMuf = hourEntry.muf;
            }

            // Map each frequency result to a band, applying signal margin
            // P.533 BCR assumes SSB @ 100W isotropic. adjustReliability corrects for
            // the user's actual mode (FT8 = +34dB), power, and antenna gain.
            const hourBandReliability = {};
            for (const freqResult of hourEntry.frequencies || []) {
              const band = freqToBand(freqResult.freq);
              if (band) {
                const raw = Math.max(0, Math.min(99, Math.round(freqResult.reliability)));
                hourBandReliability[band] = adjustReliability(raw, signalMarginDb);
              }
            }

            // Fill in each band for this hour
            bands.forEach((band) => {
              const reliability = hourBandReliability[band] ?? 0;
              predictions[band].push({
                hour: h,
                reliability,
                snr: calculateSNR(reliability),
              });
            });
          }

          // Current bands summary (sorted by reliability)
          currentBands = bands
            .map((band, idx) => ({
              band,
              freq: bandFreqs[idx],
              reliability: predictions[band][currentHour]?.reliability || 0,
              snr: predictions[band][currentHour]?.snr || '-20dB',
              status: getStatus(predictions[band][currentHour]?.reliability || 0),
            }))
            .sort((a, b) => b.reliability - a.reliability);
        }
      }

      // If ITURHFProp hourly failed, try single-hour for current state
      // Skip if service is known down — fall straight through to built-in model
      if (!usedITURHFProp && useITURHFProp && !iturhfpropIsDown()) {
        const singleHour = await fetchITURHFPropPrediction(
          de.lat,
          de.lon,
          dx.lat,
          dx.lon,
          effectiveSSN,
          currentMonth,
          currentHour,
          txPower,
          txGain,
        );
        if (singleHour?.bands) {
          logDebug('[Propagation] ITURHFProp hourly unavailable, using single-hour + built-in for 24h chart');
          iturhfpropMuf = singleHour.muf;

          // Use single-hour data for current bands AND inject into predictions
          // so the chart's current-hour cell matches the bars
          currentBands = bands
            .map((band, idx) => {
              const ituBand = singleHour.bands?.[band];
              const rel = ituBand ? adjustReliability(Math.round(ituBand.reliability), signalMarginDb) : 0;
              // Pre-seed the predictions array with the ITURHFProp value for current hour
              if (!predictions[band]) predictions[band] = [];
              predictions[band][currentHour] = { hour: currentHour, reliability: rel, snr: calculateSNR(rel) };
              return {
                band,
                freq: bandFreqs[idx],
                reliability: rel,
                snr: calculateSNR(rel),
                status: rel >= 70 ? 'GOOD' : rel >= 40 ? 'FAIR' : rel > 0 ? 'POOR' : 'CLOSED',
              };
            })
            .sort((a, b) => b.reliability - a.reliability);
        }
      }

      // ===== FALLBACK: Built-in calculations =====
      // Used when ITURHFProp is unavailable (self-hosted without the service).
      // Also fills in the remaining 23 hours when only a single-hour ITURHFProp
      // result was used — without this the sparse array holes become JSON nulls
      // and crash the client (.find callback receives null instead of an object).
      if (!usedITURHFProp) {
        logDebug(
          `[Propagation] Using FALLBACK mode (built-in calculations)${useITURHFProp ? ' — ITURHFProp unavailable' : ''}`,
        );

        bands.forEach((band, idx) => {
          const freq = bandFreqs[idx];
          const existing = predictions[band] || [];
          predictions[band] = [];
          for (let hour = 0; hour < 24; hour++) {
            // Preserve ITURHFProp single-hour value if pre-seeded (keeps bars/chart in sync)
            if (existing[hour]) {
              predictions[band].push(existing[hour]);
              continue;
            }
            const reliability = calculateEnhancedReliability(
              freq,
              distance,
              midLat,
              midLon,
              hour,
              sfi,
              effectiveSSN,
              kIndex,
              de,
              dx,
              currentHour,
              signalMarginDb,
              currentMonth,
            );
            predictions[band].push({
              hour,
              reliability: Math.round(reliability),
              snr: calculateSNR(reliability),
            });
          }
        });

        if (!currentBands) {
          currentBands = bands
            .map((band, idx) => ({
              band,
              freq: bandFreqs[idx],
              reliability: predictions[band][currentHour].reliability,
              snr: predictions[band][currentHour].snr,
              status: getStatus(predictions[band][currentHour].reliability),
            }))
            .sort((a, b) => b.reliability - a.reliability);
        }
      }

      // Calculate MUF and LUF
      const currentMuf = iturhfpropMuf || calculateMUF(distance, midLat, midLon, currentHour, sfi, effectiveSSN);
      const currentLuf = calculateLUF(distance, midLat, midLon, currentHour, sfi, kIndex);

      res.json({
        model: usedITURHFProp ? 'ITU-R P.533-14' : 'Built-in estimation',
        solarData: { sfi, ssn: effectiveSSN, kIndex },
        muf: Math.round(currentMuf * 10) / 10,
        luf: Math.round(currentLuf * 10) / 10,
        distance: Math.round(distance),
        currentHour,
        currentBands,
        hourlyPredictions: predictions,
        mode: txMode,
        power: txPower,
        antenna: { key: antennaKey, name: ANTENNA_PROFILES[antennaKey]?.name || antennaKey, gain: txGain },
        signalMargin: Math.round(signalMarginDb * 10) / 10,
        iturhfprop: {
          enabled: useITURHFProp,
          available: usedITURHFProp,
        },
        dataSource: usedITURHFProp ? 'ITURHFProp (ITU-R P.533-14)' : 'Estimated from solar indices',
      });
    } catch (error) {
      logErrorOnce('Propagation', error.message);
      res.status(500).json({ error: 'Failed to calculate propagation' });
    }
  });

  // Legacy endpoint removed - merged into /api/propagation above

  // ===== PROPAGATION HEATMAP =====
  // Computes reliability grid from DE location to world grid for a selected band
  // Used by VOACAP Heatmap map layer plugin

  // Solar data cache — shared across all heatmap requests so band/mode/power
  // changes don't each trigger a slow NOAA fetch
  let solarCache = { sfi: 150, ssn: 100, kIndex: 2, ts: 0 };
  const SOLAR_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  async function getSolarData() {
    const now = Date.now();
    if (now - solarCache.ts < SOLAR_CACHE_TTL) {
      return { sfi: solarCache.sfi, ssn: solarCache.ssn, kIndex: solarCache.kIndex };
    }
    let sfi = 150,
      ssn = 100,
      kIndex = 2;
    try {
      const [fluxRes, kRes] = await Promise.allSettled([
        fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json', { signal: AbortSignal.timeout(5000) }),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', {
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
        const data = await fluxRes.value.json();
        // f107_cm_flux.json is not sorted chronologically — find the entry with
        // the latest time_tag rather than assuming the last element is current.
        if (data?.length) {
          const latest = data.reduce((best, d) => (d.time_tag > (best?.time_tag ?? '') ? d : best), null);
          if (latest?.flux != null) sfi = Math.round(latest.flux ?? 150);
        }
      }
      if (kRes.status === 'fulfilled' && kRes.value.ok) {
        const data = await kRes.value.json();
        // NOAA changed from array-of-arrays to array-of-objects — support both.
        if (data?.length) {
          const last = data[data.length - 1];
          const raw = Array.isArray(last) ? last[1] : last?.Kp;
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed)) kIndex = parsed;
        }
      }
      ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
    } catch (e) {
      logDebug('[PropHeatmap] Using cached/default solar values');
    }
    solarCache = { sfi, ssn, kIndex, ts: now };
    return { sfi, ssn, kIndex };
  }

  const PROP_HEATMAP_CACHE = {};
  const PROP_HEATMAP_TTL = 15 * 60 * 1000; // 15 minutes — propagation changes slowly
  const PROP_HEATMAP_MAX_ENTRIES = 200; // Hard cap on cache entries

  // Periodic cleanup: purge expired heatmap cache entries every 10 minutes
  setInterval(
    () => {
      const now = Date.now();
      const keys = Object.keys(PROP_HEATMAP_CACHE);
      let purged = 0;
      for (const key of keys) {
        if (now - PROP_HEATMAP_CACHE[key].ts > PROP_HEATMAP_TTL * 2) {
          delete PROP_HEATMAP_CACHE[key];
          purged++;
        }
      }
      // If still over cap, evict oldest
      const remaining = Object.keys(PROP_HEATMAP_CACHE);
      if (remaining.length > PROP_HEATMAP_MAX_ENTRIES) {
        remaining
          .sort((a, b) => PROP_HEATMAP_CACHE[a].ts - PROP_HEATMAP_CACHE[b].ts)
          .slice(0, remaining.length - PROP_HEATMAP_MAX_ENTRIES)
          .forEach((key) => {
            delete PROP_HEATMAP_CACHE[key];
            purged++;
          });
      }
      if (purged > 0)
        console.log(
          `[Cache] PropHeatmap: purged ${purged} stale entries, ${Object.keys(PROP_HEATMAP_CACHE).length} remaining`,
        );
    },
    10 * 60 * 1000,
  );

  app.get('/api/propagation/heatmap', async (req, res) => {
    // Round to whole degrees — propagation doesn't meaningfully differ within 1°,
    // and this dramatically improves cache hit rate across users
    const deLat = Math.round(parseFloat(req.query.deLat) || 0);
    const deLon = Math.round(parseFloat(req.query.deLon) || 0);
    const freq = parseFloat(req.query.freq) || 14; // MHz, default 20m
    const gridSize = Math.max(5, Math.min(20, parseInt(req.query.grid) || 10)); // 5-20° grid
    const txMode = (req.query.mode || 'SSB').toUpperCase();
    const txPower = parseFloat(req.query.power) || 100;
    const antennaKey = req.query.antenna || 'isotropic';
    const txGain = ANTENNA_PROFILES[antennaKey]?.gain ?? 0;
    const signalMarginDb = calculateSignalMargin(txMode, txPower, txGain);

    const cacheKey = `${deLat.toFixed(0)}:${deLon.toFixed(0)}:${freq}:${gridSize}:${txMode}:${txPower}:${antennaKey}`;
    const now = Date.now();

    if (PROP_HEATMAP_CACHE[cacheKey] && now - PROP_HEATMAP_CACHE[cacheKey].ts < PROP_HEATMAP_TTL) {
      return res.json(PROP_HEATMAP_CACHE[cacheKey].data);
    }

    try {
      // Solar conditions — cached separately so band/mode/power changes don't
      // each trigger a slow NOAA round-trip
      const { sfi, ssn, kIndex } = await getSolarData();

      const now2 = new Date();
      const currentHour = now2.getUTCHours();
      const currentMonth = now2.getUTCMonth() + 1;
      const de = { lat: deLat, lon: deLon };
      const halfGrid = gridSize / 2;
      const cells = [];

      // Compute reliability grid
      for (let lat = -85 + halfGrid; lat <= 85 - halfGrid; lat += gridSize) {
        for (let lon = -180 + halfGrid; lon <= 180 - halfGrid; lon += gridSize) {
          const dx = { lat, lon };
          const distance = haversineDistance(de.lat, de.lon, lat, lon);

          // Skip very short distances (< 200km) - not meaningful for HF skip
          if (distance < 200) continue;

          const midLat = (de.lat + lat) / 2;
          let midLon = (de.lon + lon) / 2;
          if (Math.abs(de.lon - lon) > 180) {
            midLon = (de.lon + lon + 360) / 2;
            if (midLon > 180) midLon -= 360;
          }

          const reliability = calculateEnhancedReliability(
            freq,
            distance,
            midLat,
            midLon,
            currentHour,
            sfi,
            ssn,
            kIndex,
            de,
            dx,
            currentHour,
            signalMarginDb,
            currentMonth,
          );

          cells.push({
            lat,
            lon,
            r: Math.round(reliability), // reliability 0-99
          });
        }
      }

      const result = {
        deLat,
        deLon,
        freq,
        gridSize,
        mode: txMode,
        power: txPower,
        signalMargin: Math.round(signalMarginDb * 10) / 10,
        solarData: { sfi, ssn, kIndex },
        hour: currentHour,
        cells,
        timestamp: new Date().toISOString(),
      };

      PROP_HEATMAP_CACHE[cacheKey] = { data: result, ts: now };

      logDebug(
        `[PropHeatmap] Computed ${cells.length} cells for ${freq} MHz [${txMode} @ ${txPower}W] from ${deLat.toFixed(1)},${deLon.toFixed(1)}`,
      );
      res.json(result);
    } catch (error) {
      logErrorOnce('PropHeatmap', error.message);
      res.status(500).json({ error: 'Failed to compute propagation heatmap' });
    }
  });

  // ===== MUF MAP =====
  // Computes MUF from DE to each grid cell using solar indices + path geometry.
  // Unlike the old ionosonde-based MUF map, this shows path-specific MUF from
  // your QTH to every point on the globe — more useful for operators.
  const MUF_MAP_CACHE = {};
  const MUF_MAP_TTL = 5 * 60 * 1000;

  app.get('/api/propagation/mufmap', async (req, res) => {
    const deLat = parseFloat(req.query.deLat) || 0;
    const deLon = parseFloat(req.query.deLon) || 0;
    const gridSize = Math.max(5, Math.min(20, parseInt(req.query.grid) || 10));

    const cacheKey = `muf-${deLat.toFixed(0)}:${deLon.toFixed(0)}:${gridSize}`;
    const now = Date.now();

    if (MUF_MAP_CACHE[cacheKey] && now - MUF_MAP_CACHE[cacheKey].ts < MUF_MAP_TTL) {
      return res.json(MUF_MAP_CACHE[cacheKey].data);
    }

    try {
      let sfi = 150,
        ssn = 100;
      try {
        const fluxRes = await fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json');
        if (fluxRes.ok) {
          const summary = await fluxRes.json();
          const flux = parseInt(summary?.Flux);
          if (flux > 0) sfi = flux;
        }
        if (n0nbhCache.data?.solarData?.sunspots) {
          ssn = parseInt(n0nbhCache.data.solarData.sunspots);
        } else {
          ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
        }
      } catch {
        logDebug('[MUFMap] Using default solar values');
      }

      const currentHour = new Date().getUTCHours();
      const halfGrid = gridSize / 2;
      const cells = [];

      for (let lat = -85 + halfGrid; lat <= 85 - halfGrid; lat += gridSize) {
        for (let lon = -180 + halfGrid; lon <= 180 - halfGrid; lon += gridSize) {
          const distance = haversineDistance(deLat, deLon, lat, lon);
          if (distance < 200) continue;

          const midLat = (deLat + lat) / 2;
          let midLon = (deLon + lon) / 2;
          if (Math.abs(deLon - lon) > 180) {
            midLon = (deLon + lon + 360) / 2;
            if (midLon > 180) midLon -= 360;
          }

          const muf = calculateMUF(distance, midLat, midLon, currentHour, sfi, ssn);
          cells.push({ lat, lon, muf: Math.round(muf * 10) / 10 });
        }
      }

      const result = {
        deLat,
        deLon,
        gridSize,
        solarData: { sfi, ssn },
        hour: currentHour,
        cells,
        timestamp: new Date().toISOString(),
      };

      MUF_MAP_CACHE[cacheKey] = { data: result, ts: now };
      logDebug(`[MUFMap] Computed ${cells.length} cells from ${deLat.toFixed(1)},${deLon.toFixed(1)}`);
      res.json(result);
    } catch (error) {
      logErrorOnce('MUFMap', error.message);
      res.status(500).json({ error: 'Failed to compute MUF map' });
    }
  });

  // ── Pre-warm cache for DX spots ──────────────────────────────────
  // Called from dxcluster.js when new DX callsigns appear.
  // Fires background ITURHFProp requests so that by the time a user
  // clicks the spot, the precise P.533-14 prediction is already cached.
  function prewarmPropagation(deLat, deLon, dxLat, dxLon) {
    if (!ITURHFPROP_URL || iturhfpropIsDown()) return;

    const currentMonth = new Date().getMonth() + 1;
    // Use defaults for mode/power — most users are SSB/100W
    const pw = 100;
    const gn = 0;
    getSolarData().then(({ ssn }) => {
      const key = `h-${roundPath(deLat, deLon)}-${roundPath(dxLat, dxLon)}-${ssn}-${currentMonth}-${pw}-${gn}`;
      if (ituCacheGet(iturhfpropHourlyMap, key)) return; // already cached
      queueBackgroundFetch(key, () => fetchITURHFPropHourly(deLat, deLon, dxLat, dxLon, ssn, currentMonth, pw, gn));
    });
  }

  // Return shared state
  return { PROP_HEATMAP_CACHE, prewarmPropagation };
};
