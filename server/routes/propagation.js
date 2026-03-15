/**
 * Propagation routes — ionosonde, hybrid propagation, heatmap.
 * Lines ~8179-9360 of original server.js
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

  // ============================================
  // IONOSONDE DATA API (Real-time ionospheric data from KC2G/GIRO)
  // ============================================

  // Cache for ionosonde data (refresh every 10 minutes)
  let ionosondeCache = {
    data: null,
    timestamp: 0,
    maxAge: 10 * 60 * 1000, // 10 minutes
  };

  // Fetch real-time ionosonde data from KC2G (GIRO network)
  async function fetchIonosondeData() {
    const now = Date.now();

    // Return cached data if fresh
    if (ionosondeCache.data && now - ionosondeCache.timestamp < ionosondeCache.maxAge) {
      return ionosondeCache.data;
    }

    try {
      const response = await fetch('https://prop.kc2g.com/api/stations.json', {
        headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
        timeout: 15000,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      // Filter to only recent data (within last 2 hours) with valid readings
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const validStations = data
        .filter((s) => {
          if (s.time.slice(-1) != 'Z') s.time = `${s.time}Z`; // s.time SHOULD have a trailing Z on it so that Date() understands that it is UTC
          if (!s.fof2 || !s.station) return false;
          const stationTime = new Date(s.time);
          return stationTime > twoHoursAgo && s.cs > 0; // confidence score > 0
        })
        .map((s) => ({
          code: s.station.code,
          name: s.station.name,
          lat: parseFloat(s.station.latitude),
          lon:
            parseFloat(s.station.longitude) > 180
              ? parseFloat(s.station.longitude) - 360
              : parseFloat(s.station.longitude),
          foF2: s.fof2,
          mufd: s.mufd, // MUF at 3000km
          hmF2: s.hmf2, // Height of F2 layer
          md: parseFloat(s.md) || 3.0, // M(3000)F2 factor
          confidence: s.cs,
          time: s.time,
        }));

      ionosondeCache = {
        data: validStations,
        timestamp: now,
      };

      logDebug(`[Ionosonde] Fetched ${validStations.length} valid stations from KC2G`);
      return validStations;
    } catch (error) {
      logErrorOnce('Ionosonde', `Fetch error: ${error.message}`);
      return ionosondeCache.data || [];
    }
  }

  // API endpoint to get ionosonde data
  app.get('/api/ionosonde', async (req, res) => {
    try {
      const stations = await fetchIonosondeData();
      res.json({
        count: stations.length,
        timestamp: new Date().toISOString(),
        stations: stations,
      });
    } catch (error) {
      logErrorOnce('Ionosonde', `API: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch ionosonde data' });
    }
  });

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

  // Interpolate foF2 at a given location using inverse distance weighting
  function interpolateFoF2(lat, lon, stations) {
    if (!stations || stations.length === 0) return null;

    // Maximum distance (km) to consider ionosonde data valid
    // Beyond this, the data is too far away to be representative
    const MAX_VALID_DISTANCE = 3000; // km

    // Calculate distances to all stations
    const stationsWithDist = stations
      .map((s) => ({
        ...s,
        distance: haversineDistance(lat, lon, s.lat, s.lon),
      }))
      .filter((s) => s.foF2 > 0);

    if (stationsWithDist.length === 0) return null;

    // Sort by distance and take nearest 5
    stationsWithDist.sort((a, b) => a.distance - b.distance);

    // Check if nearest station is within valid range
    if (stationsWithDist[0].distance > MAX_VALID_DISTANCE) {
      logDebug(
        `[Ionosonde] Nearest station ${stationsWithDist[0].name} is ${Math.round(stationsWithDist[0].distance)}km away - too far, using estimates`,
      );
      return {
        foF2: null,
        mufd: null,
        hmF2: null,
        md: 3.0,
        nearestStation: stationsWithDist[0].name,
        nearestDistance: Math.round(stationsWithDist[0].distance),
        stationsUsed: 0,
        method: 'no-coverage',
        reason: `Nearest ionosonde (${stationsWithDist[0].name}) is ${Math.round(stationsWithDist[0].distance)}km away - no local coverage`,
      };
    }

    // Filter to only stations within valid range
    const validStations = stationsWithDist.filter((s) => s.distance <= MAX_VALID_DISTANCE);
    const nearest = validStations.slice(0, 5);

    // If very close to a station, use its value directly
    if (nearest[0].distance < 100) {
      return {
        foF2: nearest[0].foF2,
        mufd: nearest[0].mufd,
        hmF2: nearest[0].hmF2,
        md: nearest[0].md,
        source: nearest[0].name,
        confidence: nearest[0].confidence,
        nearestDistance: Math.round(nearest[0].distance),
        method: 'direct',
      };
    }

    // Inverse distance weighted interpolation
    let sumWeights = 0;
    let sumFoF2 = 0;
    let sumMufd = 0;
    let sumHmF2 = 0;
    let sumMd = 0;

    nearest.forEach((s) => {
      const weight = s.confidence / 100 / Math.pow(s.distance, 2);
      sumWeights += weight;
      sumFoF2 += s.foF2 * weight;
      if (s.mufd) sumMufd += s.mufd * weight;
      if (s.hmF2) sumHmF2 += s.hmF2 * weight;
      if (s.md) sumMd += s.md * weight;
    });

    return {
      foF2: sumFoF2 / sumWeights,
      mufd: sumMufd > 0 ? sumMufd / sumWeights : null,
      hmF2: sumHmF2 > 0 ? sumHmF2 / sumWeights : null,
      md: sumMd > 0 ? sumMd / sumWeights : 3.0,
      nearestStation: nearest[0].name,
      nearestDistance: Math.round(nearest[0].distance),
      stationsUsed: nearest.length,
      method: 'interpolated',
    };
  }

  // ============================================
  // HYBRID PROPAGATION SYSTEM
  // Combines ITURHFProp (ITU-R P.533-14) with real-time ionosonde data
  // ============================================

  // Cache for ITURHFProp predictions (5-minute cache)
  let iturhfpropCache = {
    data: null,
    key: null,
    timestamp: 0,
    maxAge: 5 * 60 * 1000, // 5 minutes
  };

  /**
   * Fetch base prediction from ITURHFProp service
   */
  async function fetchITURHFPropPrediction(txLat, txLon, rxLat, rxLon, ssn, month, hour) {
    if (!ITURHFPROP_URL) return null;

    const cacheKey = `${txLat.toFixed(1)},${txLon.toFixed(1)}-${rxLat.toFixed(1)},${rxLon.toFixed(1)}-${ssn}-${month}-${hour}`;
    const now = Date.now();

    // Check cache
    if (iturhfpropCache.key === cacheKey && now - iturhfpropCache.timestamp < iturhfpropCache.maxAge) {
      return iturhfpropCache.data;
    }

    try {
      const url = `${ITURHFPROP_URL}/api/bands?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&hour=${hour}`;

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

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
      if (err.name !== 'AbortError') {
        logErrorOnce('Hybrid', `ITURHFProp: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Fetch 24-hour predictions from ITURHFProp
   */
  async function fetchITURHFPropHourly(txLat, txLon, rxLat, rxLon, ssn, month) {
    if (!ITURHFPROP_URL) return null;

    try {
      const url = `${ITURHFPROP_URL}/api/predict/hourly?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}`;

      const response = await fetch(url, { timeout: 60000 }); // 60s timeout for 24-hour calc
      if (!response.ok) return null;

      const data = await response.json();
      return data;
    } catch (err) {
      if (err.name !== 'AbortError') {
        logErrorOnce('Hybrid', `ITURHFProp hourly: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Calculate ionospheric correction factor
   * Compares expected foF2 (from P.533 model) vs actual ionosonde foF2
   * Returns multiplier to adjust reliability predictions
   */
  function calculateIonoCorrection(expectedFoF2, actualFoF2, kIndex) {
    if (!expectedFoF2 || !actualFoF2) return { factor: 1.0, confidence: 'low' };

    // Ratio of actual to expected ionospheric conditions
    const ratio = actualFoF2 / expectedFoF2;

    // Geomagnetic correction (storms reduce reliability)
    const kFactor = kIndex <= 3 ? 1.0 : 1.0 - (kIndex - 3) * 0.1;

    // Combined correction factor
    // ratio > 1 means better conditions than predicted
    // ratio < 1 means worse conditions than predicted
    const factor = ratio * kFactor;

    // Confidence based on how close actual is to expected
    let confidence;
    if (Math.abs(ratio - 1) < 0.15) {
      confidence = 'high'; // Within 15% - model is accurate
    } else if (Math.abs(ratio - 1) < 0.3) {
      confidence = 'medium'; // Within 30%
    } else {
      confidence = 'low'; // Model significantly off - rely more on ionosonde
    }

    logDebug(
      `[Hybrid] Correction factor: ${factor.toFixed(2)} (expected foF2: ${expectedFoF2.toFixed(1)}, actual: ${actualFoF2.toFixed(1)}, K: ${kIndex})`,
    );

    return { factor, confidence, ratio, kFactor };
  }

  /**
   * Apply ionospheric correction to ITURHFProp predictions
   */
  function applyHybridCorrection(iturhfpropData, ionoData, kIndex, sfi) {
    if (!iturhfpropData?.bands) return null;

    // Estimate what foF2 ITURHFProp expected (based on SSN/SFI)
    const ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
    const expectedFoF2 = 0.9 * Math.sqrt(ssn + 15) * 1.2; // Rough estimate at solar noon

    // Get actual foF2 from ionosonde
    const actualFoF2 = ionoData?.foF2;

    // Calculate correction
    const correction = calculateIonoCorrection(expectedFoF2, actualFoF2, kIndex);

    // Apply correction to each band
    const correctedBands = {};
    for (const [band, data] of Object.entries(iturhfpropData.bands)) {
      const baseReliability = data.reliability || 50;

      // Apply correction factor with bounds
      let correctedReliability = baseReliability * correction.factor;
      correctedReliability = Math.max(0, Math.min(100, correctedReliability));

      // For high bands, also check if we're above/below MUF
      const freq = data.freq;
      if (actualFoF2 && freq > actualFoF2 * 3.5) {
        // Frequency likely above MUF - reduce reliability
        correctedReliability *= 0.5;
      }

      correctedBands[band] = {
        ...data,
        reliability: Math.round(correctedReliability),
        baseReliability: Math.round(baseReliability),
        correctionApplied: correction.factor !== 1.0,
        status: correctedReliability >= 70 ? 'GOOD' : correctedReliability >= 40 ? 'FAIR' : 'POOR',
      };
    }

    // Correct MUF based on actual ionosonde data
    let correctedMuf = iturhfpropData.muf;
    if (actualFoF2 && ionoData?.md) {
      // Use actual foF2 * M-factor for more accurate MUF
      const ionoMuf = actualFoF2 * (ionoData.md || 3.0);
      // Blend ITURHFProp MUF with ionosonde-derived MUF
      correctedMuf = iturhfpropData.muf * 0.4 + ionoMuf * 0.6;
    }

    return {
      bands: correctedBands,
      muf: Math.round(correctedMuf * 10) / 10,
      correction,
      model: 'Hybrid ITU-R P.533-14',
    };
  }

  /**
   * Estimate expected foF2 from P.533 model for a given hour
   */
  function estimateExpectedFoF2(ssn, lat, hour) {
    // Simplified P.533 foF2 estimation
    // diurnal variation: peak around 14:00 local, minimum around 04:00
    const hourFactor = 0.6 + 0.4 * Math.cos(((hour - 14) * Math.PI) / 12);
    const latFactor = 1 - Math.abs(lat) / 150;
    const ssnFactor = Math.sqrt(ssn + 15);

    return 0.9 * ssnFactor * hourFactor * latFactor;
  }

  // ============================================
  // ENHANCED PROPAGATION PREDICTION API (Hybrid ITU-R P.533)
  // ============================================

  app.get('/api/propagation', async (req, res) => {
    const { deLat, deLon, dxLat, dxLon, mode, power } = req.query;

    // Calculate signal margin from mode + power
    const txMode = (mode || 'SSB').toUpperCase();
    const txPower = parseFloat(power) || 100;
    const signalMarginDb = calculateSignalMargin(txMode, txPower);

    const useHybrid = ITURHFPROP_URL !== null;
    logDebug(
      `[Propagation] ${useHybrid ? 'Hybrid' : 'Standalone'} calculation for DE:`,
      deLat,
      deLon,
      'to DX:',
      dxLat,
      dxLon,
      `[${txMode} @ ${txPower}W, margin: ${signalMarginDb.toFixed(1)}dB]`,
    );

    try {
      // Get current space weather data
      let sfi = 150,
        ssn = 100,
        kIndex = 2,
        aIndex = 10;

      try {
        // Prefer SWPC summary (updates every few hours) + N0NBH for SSN
        const [summaryRes, kRes] = await Promise.allSettled([
          fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json'),
          fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
        ]);

        if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
          try {
            const summary = await summaryRes.value.json();
            const flux = parseInt(summary?.Flux);
            if (flux > 0) sfi = flux;
          } catch {}
        }
        // Fallback: N0NBH cache (daily, same as hamqsl.com)
        if (sfi === 150 && n0nbhCache.data?.solarData?.solarFlux) {
          const flux = parseInt(n0nbhCache.data.solarData.solarFlux);
          if (flux > 0) sfi = flux;
        }
        // SSN: prefer N0NBH (daily), then estimate from SFI
        if (n0nbhCache.data?.solarData?.sunspots) {
          const s = parseInt(n0nbhCache.data.solarData.sunspots);
          if (s >= 0) ssn = s;
        } else {
          ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
        }
        if (kRes.status === 'fulfilled' && kRes.value.ok) {
          const data = await kRes.value.json();
          if (data?.length > 1) kIndex = parseInt(data[data.length - 1][1]) || 2;
        }
      } catch (e) {
        logDebug('[Propagation] Using default solar values');
      }

      // Get real ionosonde data
      const ionosondeStations = await fetchIonosondeData();

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

      // Get ionospheric data at path midpoint
      const ionoData = interpolateFoF2(midLat, midLon, ionosondeStations);
      const hasValidIonoData = !!(ionoData && ionoData.method !== 'no-coverage' && ionoData.foF2);

      const currentHour = new Date().getUTCHours();
      const currentMonth = new Date().getMonth() + 1;

      logDebug('[Propagation] Distance:', Math.round(distance), 'km');
      logDebug('[Propagation] Solar: SFI', sfi, 'SSN', ssn, 'K', kIndex);
      if (hasValidIonoData) {
        logDebug(
          '[Propagation] Real foF2:',
          ionoData.foF2?.toFixed(2),
          'MHz from',
          ionoData.nearestStation || ionoData.source,
        );
      }

      // ===== HYBRID MODE: Try ITURHFProp first =====
      let hybridResult = null;
      if (useHybrid) {
        const iturhfpropData = await fetchITURHFPropPrediction(
          de.lat,
          de.lon,
          dx.lat,
          dx.lon,
          ssn,
          currentMonth,
          currentHour,
        );

        if (iturhfpropData && hasValidIonoData) {
          // Full hybrid: ITURHFProp + ionosonde correction
          hybridResult = applyHybridCorrection(iturhfpropData, ionoData, kIndex, sfi);
          logDebug('[Propagation] Using HYBRID mode (ITURHFProp + ionosonde correction)');
        } else if (iturhfpropData) {
          // ITURHFProp only (no ionosonde coverage)
          hybridResult = {
            bands: iturhfpropData.bands,
            muf: iturhfpropData.muf,
            model: 'ITU-R P.533-14 (ITURHFProp)',
          };
          logDebug('[Propagation] Using ITURHFProp only (no ionosonde coverage)');
        }
      }

      // ===== FALLBACK: Built-in calculations =====
      const bands = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
      const bandFreqs = [1.8, 3.5, 7, 10, 14, 18, 21, 24, 28];

      // Generate predictions (hybrid or fallback)
      const effectiveIonoData = hasValidIonoData ? ionoData : null;
      const predictions = {};
      let currentBands;

      if (hybridResult) {
        // Use hybrid results for current bands
        currentBands = bands
          .map((band, idx) => {
            const hybridBand = hybridResult.bands?.[band];
            if (hybridBand) {
              return {
                band,
                freq: bandFreqs[idx],
                reliability: hybridBand.reliability,
                baseReliability: hybridBand.baseReliability,
                snr: calculateSNR(hybridBand.reliability),
                status: hybridBand.status,
                corrected: hybridBand.correctionApplied,
              };
            }
            // Fallback for bands not in hybrid result
            const reliability = calculateEnhancedReliability(
              bandFreqs[idx],
              distance,
              midLat,
              midLon,
              currentHour,
              sfi,
              ssn,
              kIndex,
              de,
              dx,
              effectiveIonoData,
              currentHour,
              signalMarginDb,
            );
            return {
              band,
              freq: bandFreqs[idx],
              reliability: Math.round(reliability),
              snr: calculateSNR(reliability),
              status: getStatus(reliability),
            };
          })
          .sort((a, b) => b.reliability - a.reliability);

        // Generate 24-hour predictions with correction ratios from hybrid data
        // This makes predictions more accurate by scaling them to match the hybrid model
        bands.forEach((band, idx) => {
          const freq = bandFreqs[idx];
          predictions[band] = [];

          // Calculate built-in reliability for current hour
          const builtInCurrentReliability = calculateEnhancedReliability(
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
            effectiveIonoData,
            currentHour,
            signalMarginDb,
          );

          // Get hybrid reliability for this band (the accurate one)
          const hybridBand = hybridResult.bands?.[band];
          const hybridReliability = hybridBand?.reliability || builtInCurrentReliability;

          // Calculate correction ratio (how much to scale predictions)
          // Avoid division by zero, and cap the ratio to prevent extreme corrections
          let correctionRatio = 1.0;
          if (builtInCurrentReliability > 5) {
            correctionRatio = hybridReliability / builtInCurrentReliability;
            // Cap correction ratio to reasonable bounds (0.2x to 3x)
            correctionRatio = Math.max(0.2, Math.min(3.0, correctionRatio));
          } else if (hybridReliability > 20) {
            // Built-in thinks band is closed but hybrid says it's open
            correctionRatio = 2.0;
          }

          for (let hour = 0; hour < 24; hour++) {
            const baseReliability = calculateEnhancedReliability(
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
              effectiveIonoData,
              currentHour,
              signalMarginDb,
            );
            // Apply correction ratio and clamp to valid range
            const correctedReliability = Math.min(99, Math.max(0, Math.round(baseReliability * correctionRatio)));
            predictions[band].push({
              hour,
              reliability: correctedReliability,
              snr: calculateSNR(correctedReliability),
            });
          }
        });
      } else {
        // Full fallback - use built-in calculations
        logDebug('[Propagation] Using FALLBACK mode (built-in calculations)');

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
              ssn,
              kIndex,
              de,
              dx,
              effectiveIonoData,
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

      // Calculate MUF and LUF
      const currentMuf =
        hybridResult?.muf || calculateMUF(distance, midLat, midLon, currentHour, sfi, ssn, effectiveIonoData);
      const currentLuf = calculateLUF(distance, midLat, midLon, currentHour, sfi, kIndex);

      // Build ionospheric response
      let ionosphericResponse;
      if (hasValidIonoData) {
        ionosphericResponse = {
          foF2: ionoData.foF2?.toFixed(2),
          mufd: ionoData.mufd?.toFixed(1),
          hmF2: ionoData.hmF2?.toFixed(0),
          source: ionoData.nearestStation || ionoData.source,
          distance: ionoData.nearestDistance,
          method: ionoData.method,
          stationsUsed: ionoData.stationsUsed || 1,
        };
      } else if (ionoData?.method === 'no-coverage') {
        ionosphericResponse = {
          source: 'No ionosonde coverage',
          reason: ionoData.reason,
          nearestStation: ionoData.nearestStation,
          nearestDistance: ionoData.nearestDistance,
          method: 'estimated',
        };
      } else {
        ionosphericResponse = { source: 'model', method: 'estimated' };
      }

      // Determine data source description
      let dataSource;
      if (hybridResult && hasValidIonoData) {
        dataSource = 'Hybrid: ITURHFProp (ITU-R P.533-14) + KC2G/GIRO ionosonde';
      } else if (hybridResult) {
        dataSource = 'ITURHFProp (ITU-R P.533-14)';
      } else if (hasValidIonoData) {
        dataSource = 'KC2G/GIRO Ionosonde Network';
      } else {
        dataSource = 'Estimated from solar indices';
      }

      res.json({
        model: hybridResult?.model || 'Built-in estimation',
        solarData: { sfi, ssn, kIndex },
        ionospheric: ionosphericResponse,
        muf: Math.round(currentMuf * 10) / 10,
        luf: Math.round(currentLuf * 10) / 10,
        distance: Math.round(distance),
        currentHour,
        currentBands,
        hourlyPredictions: predictions,
        mode: txMode,
        power: txPower,
        signalMargin: Math.round(signalMarginDb * 10) / 10,
        hybrid: {
          enabled: useHybrid,
          iturhfpropAvailable: hybridResult !== null,
          ionosondeAvailable: hasValidIonoData,
          correctionFactor: hybridResult?.correction?.factor?.toFixed(2),
          confidence: hybridResult?.correction?.confidence,
        },
        dataSource,
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
  const PROP_HEATMAP_CACHE = {};
  const PROP_HEATMAP_TTL = 5 * 60 * 1000; // 5 minutes
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
    const deLat = parseFloat(req.query.deLat) || 0;
    const deLon = parseFloat(req.query.deLon) || 0;
    const freq = parseFloat(req.query.freq) || 14; // MHz, default 20m
    const gridSize = Math.max(5, Math.min(20, parseInt(req.query.grid) || 10)); // 5-20° grid
    const txMode = (req.query.mode || 'SSB').toUpperCase();
    const txPower = parseFloat(req.query.power) || 100;
    const signalMarginDb = calculateSignalMargin(txMode, txPower);

    const cacheKey = `${deLat.toFixed(0)}:${deLon.toFixed(0)}:${freq}:${gridSize}:${txMode}:${txPower}`;
    const now = Date.now();

    if (PROP_HEATMAP_CACHE[cacheKey] && now - PROP_HEATMAP_CACHE[cacheKey].ts < PROP_HEATMAP_TTL) {
      return res.json(PROP_HEATMAP_CACHE[cacheKey].data);
    }

    try {
      // Fetch current solar conditions (same as main propagation endpoint)
      let sfi = 150,
        ssn = 100,
        kIndex = 2;
      try {
        const [fluxRes, kRes] = await Promise.allSettled([
          fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
          fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
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
        logDebug('[PropHeatmap] Using default solar values');
      }

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
            null,
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

  // Calculate MUF using real ionosonde data or model
  function calculateMUF(distance, midLat, midLon, hour, sfi, ssn, ionoData) {
    // Local solar time at the path midpoint (not UTC)
    const localHour = (hour + midLon / 15 + 24) % 24;

    // If we have real MUF(3000) data, scale it for actual distance
    if (ionoData?.mufd) {
      if (distance < 3500) {
        // Single hop: MUF increases with distance (lower takeoff angle)
        return ionoData.mufd * Math.sqrt(distance / 3000);
      } else {
        // Multi-hop: effective MUF limited by weakest hop — decreases with hops
        const hops = Math.ceil(distance / 3500);
        return ionoData.mufd * Math.pow(0.93, hops - 1);
      }
    }

    // If we have foF2, calculate MUF using M(3000)F2 factor
    if (ionoData?.foF2) {
      const M = ionoData.md || 3.0;
      const muf3000 = ionoData.foF2 * M;

      if (distance < 3500) {
        return muf3000 * Math.sqrt(distance / 3000);
      } else {
        const hops = Math.ceil(distance / 3500);
        return muf3000 * Math.pow(0.93, hops - 1);
      }
    }

    // Fallback: Estimate foF2 from solar indices
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
   * Calculate signal margin in dB from mode and power
   * Used to adjust propagation reliability predictions
   * @param {string} mode - Operating mode (SSB, CW, FT8, etc.)
   * @param {number} powerWatts - TX power in watts
   * @returns {number} Signal margin in dB relative to SSB at 100W
   */
  function calculateSignalMargin(mode, powerWatts) {
    const modeAdv = MODE_ADVANTAGE_DB[mode] || 0;
    const power = Math.max(0.01, powerWatts || 100);
    const powerOffset = 10 * Math.log10(power / 100); // dB relative to 100W
    return modeAdv + powerOffset;
  }

  // Enhanced reliability calculation using real ionosonde data
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
    ionoData,
    currentHour,
    signalMarginDb = 0,
  ) {
    // Calculate MUF and LUF for this hour
    // For non-current hours, we need to estimate how foF2 changes
    let hourIonoData = ionoData;

    if (ionoData && hour !== currentHour) {
      // Estimate foF2 change based on diurnal variation
      // foF2 typically varies by factor of 2-3 between day and night
      const currentHourFactor = 1 + 0.4 * Math.cos(((currentHour - 14) * Math.PI) / 12);
      const targetHourFactor = 1 + 0.4 * Math.cos(((hour - 14) * Math.PI) / 12);
      const scaleFactor = targetHourFactor / currentHourFactor;

      hourIonoData = {
        ...ionoData,
        foF2: ionoData.foF2 * scaleFactor,
        mufd: ionoData.mufd ? ionoData.mufd * scaleFactor : null,
      };
    }

    const muf = calculateMUF(distance, midLat, midLon, hour, sfi, ssn, hourIonoData);
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
