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

  // Cache for ITURHFProp predictions (5-minute cache)
  let iturhfpropCache = {
    data: null,
    key: null,
    timestamp: 0,
    maxAge: 5 * 60 * 1000, // 5 minutes
  };

  // Negative cache: if ITURHFProp fails, don't retry for 2 minutes
  // Prevents 90s+ hangs on every DX click when the service is down
  let iturhfpropDown = 0;
  const ITURHFPROP_BACKOFF = 2 * 60 * 1000; // 2 minutes

  /**
   * Fetch base prediction from ITURHFProp service
   */
  async function fetchITURHFPropPrediction(txLat, txLon, rxLat, rxLon, ssn, month, hour, txPower, txGain) {
    if (!ITURHFPROP_URL) return null;
    if (Date.now() - iturhfpropDown < ITURHFPROP_BACKOFF) return null;

    const pw = Math.round(txPower || 100);
    const gn = Math.round((txGain || 0) * 10) / 10;
    const cacheKey = `${txLat.toFixed(1)},${txLon.toFixed(1)}-${rxLat.toFixed(1)},${rxLon.toFixed(1)}-${ssn}-${month}-${hour}-${pw}-${gn}`;
    const now = Date.now();

    // Check cache
    if (iturhfpropCache.key === cacheKey && now - iturhfpropCache.timestamp < iturhfpropCache.maxAge) {
      return iturhfpropCache.data;
    }

    try {
      const url = `${ITURHFPROP_URL}/api/bands?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&hour=${hour}&txPower=${pw}&txGain=${gn}`;

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s — fail fast

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logErrorOnce('Hybrid', `ITURHFProp returned ${response.status}`);
        return null;
      }

      const data = await response.json();
      // Only log success occasionally to reduce noise

      // Cache the result
      iturhfpropCache = {
        data,
        key: cacheKey,
        timestamp: now,
        maxAge: iturhfpropCache.maxAge,
      };

      return data;
    } catch (err) {
      iturhfpropDown = Date.now();
      if (err.name !== 'AbortError') {
        logErrorOnce('Hybrid', `ITURHFProp: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Fetch 24-hour predictions from ITURHFProp.
   * This calls P.533-14 for all 24 hours and returns per-band, per-hour reliability.
   * Results are cached for 10 minutes since they change slowly (SSN is daily).
   */
  let iturhfpropHourlyCache = {
    data: null,
    key: null,
    timestamp: 0,
    maxAge: 10 * 60 * 1000, // 10 minutes — SSN/month don't change faster than this
  };

  async function fetchITURHFPropHourly(txLat, txLon, rxLat, rxLon, ssn, month, txPower, txGain) {
    if (!ITURHFPROP_URL) return null;
    if (Date.now() - iturhfpropDown < ITURHFPROP_BACKOFF) return null; // service recently failed

    const pw = Math.round(txPower || 100);
    const gn = Math.round((txGain || 0) * 10) / 10;
    const cacheKey = `hourly-${txLat.toFixed(1)},${txLon.toFixed(1)}-${rxLat.toFixed(1)},${rxLon.toFixed(1)}-${ssn}-${month}-${pw}-${gn}`;
    const now = Date.now();

    if (
      iturhfpropHourlyCache.key === cacheKey &&
      now - iturhfpropHourlyCache.timestamp < iturhfpropHourlyCache.maxAge
    ) {
      return iturhfpropHourlyCache.data;
    }

    try {
      const url = `${ITURHFPROP_URL}/api/predict/hourly?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&txPower=${pw}&txGain=${gn}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s — fail fast, fallback to built-in

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();

      // Cache on success
      if (data?.hourly?.length > 0) {
        iturhfpropHourlyCache = { data, key: cacheKey, timestamp: now, maxAge: iturhfpropHourlyCache.maxAge };
        logDebug(`[ITURHFProp] Cached 24-hour prediction (${data.hourly.length} hours)`);
      }

      return data;
    } catch (err) {
      iturhfpropDown = Date.now(); // back off for 2 minutes
      if (err.name === 'AbortError') {
        logErrorOnce('ITURHFProp', 'Hourly fetch timed out — using built-in model');
      } else {
        logErrorOnce('ITURHFProp', `Hourly fetch: ${err.message}`);
      }
      return null;
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

      // Try ITURHFProp 24-hour prediction first
      if (useITURHFProp) {
        const hourlyData = await fetchITURHFPropHourly(
          de.lat,
          de.lon,
          dx.lat,
          dx.lon,
          effectiveSSN,
          currentMonth,
          txPower,
          txGain,
        );

        if (hourlyData?.hourly?.length === 24) {
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
      if (!usedITURHFProp && useITURHFProp) {
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

          // Use single-hour data for current bands
          currentBands = bands
            .map((band, idx) => {
              const ituBand = singleHour.bands?.[band];
              const rel = ituBand ? adjustReliability(Math.round(ituBand.reliability), signalMarginDb) : 0;
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
          predictions[band] = [];
          for (let hour = 0; hour < 24; hour++) {
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
        if (data?.length) sfi = Math.round(data[data.length - 1].flux || 150);
      }
      if (kRes.status === 'fulfilled' && kRes.value.ok) {
        const data = await kRes.value.json();
        if (data?.length > 1) kIndex = parseInt(data[data.length - 1][1]) || 2;
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

    // Estimate foF2 from solar indices
    // foF2 peaks around 14:00 LOCAL solar time, drops to ~1/3 at night
    const hourFactor = 1 + 0.4 * Math.cos(((localHour - 14) * Math.PI) / 12);
    const latFactor = 1 - Math.abs(midLat) / 150;
    const foF2_est = 0.9 * Math.sqrt(ssn + 15) * hourFactor * latFactor;

    const M = 3.0;
    const muf3000 = foF2_est * M;

    if (distance < 3500) {
      return muf3000 * Math.sqrt(distance / 3000);
    } else {
      // Multi-hop: each additional hop reduces effective MUF by ~7%
      const hops = Math.ceil(distance / 3500);
      return muf3000 * Math.pow(0.93, hops - 1);
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

    // Base LUF: ~3 MHz for a single-hop night path with low solar flux
    const baseLuf = 3.0;

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

    if (freq > effectiveMuf * 1.1) {
      // Well above MUF - very poor
      reliability = Math.max(0, 30 - (freq - effectiveMuf) * 5);
    } else if (freq > effectiveMuf) {
      // Slightly above MUF - marginal (sometimes works due to scatter)
      reliability = 30 + ((effectiveMuf * 1.1 - freq) / (effectiveMuf * 0.1)) * 20;
    } else if (freq < effectiveLuf * 0.8) {
      // Well below LUF - absorbed
      reliability = Math.max(0, 20 - (effectiveLuf - freq) * 10);
    } else if (freq < effectiveLuf) {
      // Near LUF - marginal
      reliability = 20 + ((freq - effectiveLuf * 0.8) / (effectiveLuf * 0.2)) * 30;
    } else {
      // In usable range - calculate optimum
      // Optimum Working Frequency (OWF) is typically 80-85% of MUF
      const owf = effectiveMuf * 0.85;
      const range = effectiveMuf - effectiveLuf;

      if (range <= 0) {
        reliability = 30; // Very narrow window
      } else {
        // Higher reliability near OWF, tapering toward MUF and LUF
        const position = (freq - effectiveLuf) / range; // 0 at LUF, 1 at MUF
        const optimalPosition = 0.75; // 75% up from LUF = OWF

        if (position < optimalPosition) {
          // Below OWF - reliability increases as we approach OWF
          reliability = 50 + (position / optimalPosition) * 45;
        } else {
          // Above OWF - reliability decreases as we approach MUF
          reliability = 95 - ((position - optimalPosition) / (1 - optimalPosition)) * 45;
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

    // K-index degradation (geomagnetic storms)
    if (kIndex >= 7) reliability *= 0.1;
    else if (kIndex >= 6) reliability *= 0.2;
    else if (kIndex >= 5) reliability *= 0.4;
    else if (kIndex >= 4) reliability *= 0.6;
    else if (kIndex >= 3) reliability *= 0.8;

    // Very long paths (multiple hops) are harder
    const hops = Math.ceil(distance / 3500);
    if (hops > 1) {
      reliability *= Math.pow(0.92, hops - 1); // ~8% loss per additional hop
    }

    // Polar path penalty (auroral absorption)
    if (Math.abs(midLat) > 60) {
      reliability *= 0.7;
      if (kIndex >= 3) reliability *= 0.7; // Additional penalty during storms
    }

    // High bands need sufficient solar activity
    if (freq >= 21 && sfi < 100) reliability *= Math.sqrt(sfi / 100);
    if (freq >= 28 && sfi < 120) reliability *= Math.sqrt(sfi / 120);
    if (freq >= 50 && sfi < 150) reliability *= Math.pow(sfi / 150, 1.5);

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

  // Return shared state
  return { PROP_HEATMAP_CACHE };
};
