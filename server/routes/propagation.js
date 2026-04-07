/**
 * Propagation routes — ITU-R P.533-14 predictions, built-in fallback, heatmap.
 */

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
    if (!ITURHFPROP_URL) return null;
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
    if (!ITURHFPROP_URL) return null;
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
      // Used when ITURHFProp is unavailable (self-hosted without the service)
      if (!predictions['160m'] || predictions['160m'].length === 0) {
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

      const currentHour = new Date().getUTCHours();
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

  // Estimate MUF from solar indices and path geometry (fallback when ITURHFProp unavailable)
  function calculateMUF(distance, midLat, midLon, hour, sfi, ssn) {
    // Local solar time at the path midpoint (not UTC)
    const localHour = (hour + midLon / 15 + 24) % 24;

    // Estimate foF2 (critical frequency of F2 layer) from solar flux.
    // Empirical fit to ionosonde data:
    //   foF2_day ≈ 4 + 0.04·SFI (8-12 MHz at SFI 100-200, mid-lat noon)
    //   foF2_night ≈ 2 + 0.01·SFI (3-4 MHz, drops further at high lat)
    // Blended by smooth day/night curve peaking at 14:00 local solar time.
    const absLat = Math.abs(midLat);
    const latFactor = absLat < 15 ? 1.15 : absLat < 45 ? 1.05 - (absLat - 15) / 120 : 0.8 - (absLat - 45) / 250;
    const clampedLat = Math.max(0.45, latFactor);

    const foF2_day = (4 + 0.04 * sfi) * clampedLat;
    const foF2_night = (2 + 0.01 * sfi) * clampedLat;

    // Smooth day/night blend: 1.0 at 14:00 local (F2 peak), ~0 at 02:00
    const dayBlend = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(((localHour - 14) * Math.PI) / 12)));
    const foF2_est = foF2_night + (foF2_day - foF2_night) * dayBlend;

    // M-factor (MUF/foF2 ratio) — depends on elevation angle / distance.
    // Short paths: high elevation angle → lower M (~2.5)
    // Long paths (3000km): grazing incidence → M ≈ 3.0-3.3
    // Very short: M approaches sec(zenith) ≈ 2.0
    const M = distance < 500 ? 2.5 : distance < 3500 ? 2.5 + 0.7 * (distance / 3500) : 3.2;
    const muf3000 = foF2_est * M;

    if (distance <= 3500) {
      return muf3000;
    } else {
      // Multi-hop: each additional hop reduces effective MUF by ~5%
      const hops = Math.ceil(distance / 3500);
      return muf3000 * Math.pow(0.95, hops - 1);
    }
  }

  // Calculate LUF (Lowest Usable Frequency) based on D-layer absorption
  function calculateLUF(distance, midLat, midLon, hour, sfi, kIndex) {
    // LUF increases with:
    // - Higher solar flux (more D-layer ionization)
    // - Daytime (D-layer forms during day, dissipates at night)
    // - More hops (each hop passes through D-layer again)
    // - Geomagnetic activity

    // Local solar time at the path midpoint
    const localHour = (hour + midLon / 15 + 24) % 24;

    // Day/night factor: D-layer absorption is dramatically higher during daytime
    // D-layer essentially disappears at night, making low bands usable.
    // Smooth cosine curve avoids hard vertical seams on the heatmap.
    const solarAngle = ((localHour - 12) * Math.PI) / 12;
    const dayFraction = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(solarAngle)));
    // Blend from 0.15 (night) to 1.0 (noon peak)
    const dayFactor = 0.15 + 0.85 * dayFraction;

    // Solar flux factor: higher SFI = stronger D-layer = more absorption
    const sfiFactor = 1 + (sfi - 70) / 150;

    // Multi-hop penalty: each hop traverses the D-layer, compounding absorption
    // This is the key factor that makes 160m/80m much harder on long daytime paths
    const hops = Math.ceil(distance / 3500);
    const hopFactor = 1 + (hops - 1) * 0.5; // 50% increase per additional hop

    // Latitude factor: polar/auroral paths have increased absorption
    const latFactor = 1 + (Math.abs(midLat) / 90) * 0.4;

    // K-index: geomagnetic storms increase D-layer absorption
    const kFactor = 1 + kIndex * 0.15;

    // Base LUF: ~2 MHz for a single-hop night path with low solar flux
    const baseLuf = 2.0;

    return baseLuf * dayFactor * sfiFactor * hopFactor * latFactor * kFactor;
  }

  // Mode decode advantage in dB relative to SSB (higher = can decode weaker signals)
  // Based on typical required SNR thresholds for each mode
  const MODE_ADVANTAGE_DB = {
    SSB: 0, // Baseline: requires ~13dB SNR
    AM: -6, // Worse than SSB: requires ~19dB SNR
    CW: 10, // Narrow bandwidth: requires ~3dB SNR
    RTTY: 8, // Digital FSK: requires ~5dB SNR
    PSK31: 10, // Phase-shift keying: requires ~3dB SNR
    FT8: 34, // Deep decode: requires ~-21dB SNR
    FT4: 30, // Slightly less sensitive: requires ~-17dB SNR
    WSPR: 41, // Ultra-weak signal: requires ~-28dB SNR
    JS8: 37, // Conversational weak-signal: requires ~-24dB SNR
    OLIVIA: 20, // Error-correcting: requires ~-7dB SNR
    JT65: 38, // Deep decode: requires ~-25dB SNR
  };

  /**
   * Calculate signal margin in dB from mode, power, and antenna gain
   * @param {string} mode - Operating mode (SSB, CW, FT8, etc.)
   * @param {number} powerWatts - TX power in watts
   * @param {number} antGain - Antenna gain in dBi (0 = isotropic)
   * @returns {number} Signal margin in dB relative to SSB at 100W isotropic
   */
  function calculateSignalMargin(mode, powerWatts, antGain = 0) {
    const modeAdv = MODE_ADVANTAGE_DB[mode] || 0;
    const power = Math.max(0.01, powerWatts || 100);
    const powerOffset = 10 * Math.log10(power / 100); // dB relative to 100W
    return modeAdv + powerOffset + (antGain || 0);
  }

  /**
   * Apply signal margin to a base reliability value.
   * P.533 computes BCR assuming SSB at a fixed power/antenna. This adjusts
   * the reliability for the user's actual mode (FT8 decodes 34dB weaker than
   * SSB), power (1kW = +10dB over 100W), and antenna gain.
   * Uses logistic scaling to stay within 0-99 bounds.
   */
  function adjustReliability(baseRel, signalMarginDb) {
    if (signalMarginDb === 0 || baseRel <= 0) return baseRel;
    let rel = baseRel;
    const factor = signalMarginDb / 15; // normalized: ±1 at ±15dB
    if (factor > 0) {
      // Boost: push toward 99. Marginal paths benefit most.
      const headroom = 99 - rel;
      rel += headroom * (1 - Math.exp(-factor * 1.2));
    } else {
      // Penalty: push toward 0.
      rel -= rel * (1 - Math.exp(factor * 1.2));
    }
    return Math.max(0, Math.min(99, Math.round(rel)));
  }

  // Built-in reliability calculation (fallback when ITURHFProp unavailable)
  function calculateEnhancedReliability(
    freq,
    distance,
    midLat,
    midLon,
    hour,
    sfi,
    ssn,
    kIndex,
    de,
    dx,
    currentHour,
    signalMarginDb = 0,
  ) {
    const muf = calculateMUF(distance, midLat, midLon, hour, sfi, ssn);
    const luf = calculateLUF(distance, midLat, midLon, hour, sfi, kIndex);

    // Apply signal margin from mode + power to MUF/LUF boundaries.
    // Positive margin (e.g. FT8 or high power) widens the usable window:
    //   - Extends effective MUF (more power/sensitivity can use marginal propagation)
    //   - Reduces effective LUF (more power overcomes D-layer absorption)
    // Scale: ~2% per dB for MUF, ~1.5% per dB for LUF
    const effectiveMuf = muf * (1 + signalMarginDb * 0.02);
    const effectiveLuf = luf * Math.max(0.1, 1 - signalMarginDb * 0.015);

    // Calculate BASE reliability from frequency position relative to effective MUF/LUF
    let reliability = 0;

    if (freq > effectiveMuf * 1.15) {
      // Well above MUF - very poor (sporadic-E or scatter only)
      reliability = Math.max(0, 25 - (freq - effectiveMuf) * 3);
    } else if (freq > effectiveMuf) {
      // Slightly above MUF - marginal (often works via scatter, sporadic-E)
      const frac = (freq - effectiveMuf) / (effectiveMuf * 0.15);
      reliability = 55 - frac * 30;
    } else if (freq < effectiveLuf * 0.7) {
      // Well below LUF - absorbed
      reliability = Math.max(0, 15 - (effectiveLuf - freq) * 5);
    } else if (freq < effectiveLuf) {
      // Near LUF - marginal
      reliability = 15 + ((freq - effectiveLuf * 0.7) / (effectiveLuf * 0.3)) * 40;
    } else {
      // In usable range — this is where most contacts happen
      const range = effectiveMuf - effectiveLuf;

      if (range <= 0) {
        reliability = 50; // Narrow window but still usable
      } else {
        // OWF (Optimum Working Frequency) is ~85% of MUF
        const position = (freq - effectiveLuf) / range; // 0 at LUF, 1 at MUF
        const optimalPosition = 0.8; // 80% up from LUF = OWF

        if (position < optimalPosition) {
          reliability = 60 + (position / optimalPosition) * 39;
        } else {
          reliability = 99 - ((position - optimalPosition) / (1 - optimalPosition)) * 39;
        }
      }
    }

    // ── Power/mode signal margin: direct effect on reliability ──
    // In real propagation, more power = higher received SNR = better probability
    // of maintaining a link. A marginal path (30% reliability) at 100W SSB becomes
    // much more reliable at 1000W, and much worse at 5W.
    //
    // signalMarginDb: 0 at SSB/100W, +10 at SSB/1000W, -13 at SSB/5W, +34 at FT8/100W
    //
    // Apply as a sigmoid-shaped boost/penalty centered on the baseline reliability.
    // Positive margin pushes reliability toward 99, negative pushes toward 0.
    if (signalMarginDb !== 0 && reliability > 0 && reliability < 99) {
      // Convert dB margin to a reliability shift.
      // Each 10 dB roughly doubles (or halves) the chance of a usable link.
      // Use logistic scaling so we don't exceed 0-99 bounds.
      const marginFactor = signalMarginDb / 15; // normalized: ±1 at ±15dB

      if (marginFactor > 0) {
        // Boost: push toward 99. Marginal paths benefit most.
        const headroom = 99 - reliability;
        reliability += headroom * (1 - Math.exp(-marginFactor * 1.2));
      } else {
        // Penalty: push toward 0. Good paths degrade.
        const room = reliability;
        reliability -= room * (1 - Math.exp(marginFactor * 1.2));
      }
    }

    // K-index degradation — only significant storms matter
    // K=0-3: quiet/unsettled (normal), K=4: active, K=5+: storm
    if (kIndex >= 7) reliability *= 0.15;
    else if (kIndex >= 6) reliability *= 0.3;
    else if (kIndex >= 5) reliability *= 0.5;
    else if (kIndex >= 4) reliability *= 0.75;
    // K=0-3: no penalty (this is normal conditions)

    // Multi-hop: slight reduction per additional hop
    const hops = Math.ceil(distance / 3500);
    if (hops > 1) {
      reliability *= Math.pow(0.95, hops - 1); // ~5% per hop (was 8%)
    }

    // Polar path penalty (auroral absorption) — only during disturbed conditions
    if (Math.abs(midLat) > 65) {
      reliability *= 0.8;
      if (kIndex >= 4) reliability *= 0.7; // storms + polar = bad
    }

    // High bands need sufficient solar activity (but less aggressively)
    if (freq >= 21 && sfi < 90) reliability *= 0.5 + 0.5 * (sfi / 90);
    if (freq >= 28 && sfi < 110) reliability *= 0.5 + 0.5 * (sfi / 110);

    // Low bands work better at night due to D-layer dissipation
    const localHour = (hour + midLon / 15 + 24) % 24;

    // Smooth day/night factor: 1.0 = full day, 0.0 = full night
    // Uses cosine curve centered on noon (12:00) with smooth sunrise/sunset
    // transitions instead of hard cutoffs at fixed hours.
    // Sunrise ~5-7, sunset ~17-19, with smooth interpolation between.
    const solarAngle = ((localHour - 12) * Math.PI) / 12; // -π at midnight, 0 at noon
    const dayFraction = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(solarAngle)));
    // dayFraction ≈ 1.0 at noon, ≈ 0.0 at midnight, smooth transition

    if (freq <= 2) {
      // 160m: almost exclusively a nighttime DX band
      // Blends smoothly from 1.15× at night to 0.08× at day
      const nightBoost = 1.15;
      const dayPenalty = 0.08;
      reliability *= dayPenalty * dayFraction + nightBoost * (1 - dayFraction);
    } else if (freq <= 4) {
      // 80m: primarily nighttime, some gray-line, limited daytime DX
      const nightBoost = 1.1;
      const dayPenalty = 0.25;
      reliability *= dayPenalty * dayFraction + nightBoost * (1 - dayFraction);
    } else if (freq <= 7.5) {
      // 40m: usable day and night, but better at night for DX
      const nightBoost = 1.1;
      reliability *= 1.0 * dayFraction + nightBoost * (1 - dayFraction);
    }

    return Math.min(99, Math.max(0, reliability));
  }

  // Convert reliability to estimated SNR
  function calculateSNR(reliability) {
    if (reliability >= 80) return '+20dB';
    if (reliability >= 60) return '+10dB';
    if (reliability >= 40) return '0dB';
    if (reliability >= 20) return '-10dB';
    return '-20dB';
  }

  // Get status label from reliability
  function getStatus(reliability) {
    if (reliability >= 70) return 'EXCELLENT';
    if (reliability >= 50) return 'GOOD';
    if (reliability >= 30) return 'FAIR';
    if (reliability >= 15) return 'POOR';
    return 'CLOSED';
  }

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
