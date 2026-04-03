/**
 * Space weather routes — NOAA, solar indices, N0NBH, SDO images, moon.
 * Lines ~1887-2935 of original server.js
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION } = ctx;

  // Centralized cache for NOAA data (5-minute cache)
  const noaaCache = {
    flux: { data: null, timestamp: 0 },
    kindex: { data: null, timestamp: 0 },
    sunspots: { data: null, timestamp: 0 },
    xray: { data: null, timestamp: 0 },
    aurora: { data: null, timestamp: 0 },
    solarIndices: { data: null, timestamp: 0 },
  };
  const NOAA_CACHE_TTL = 5 * 60 * 1000;

  // N0NBH / HamQSL cache
  let n0nbhCache = { data: null, timestamp: 0 };
  const N0NBH_CACHE_TTL = 60 * 60 * 1000;
  // Maximum age of stale error-fallback data.  N0NBH updates every ~3 hours;
  // beyond 4 hours the data is definitively out of date and we should stop
  // serving it rather than silently mislead clients.
  const N0NBH_MAX_STALE_TTL = 4 * 60 * 60 * 1000;

  // Parse N0NBH solarxml.php XML into clean JSON
  function parseN0NBHxml(xml) {
    const get = (tag) => {
      const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : null;
    };

    const bandConditions = [];
    const bandRegex = /<band name="([^"]+)" time="([^"]+)">([^<]+)<\/band>/g;
    let match;
    while ((match = bandRegex.exec(xml)) !== null) {
      if (match[1].includes('m-') || match[1].includes('m ')) {
        bandConditions.push({
          name: match[1],
          time: match[2],
          condition: match[3],
        });
      }
    }

    const vhfConditions = [];
    const vhfRegex = /<phenomenon name="([^"]+)" location="([^"]+)">([^<]+)<\/phenomenon>/g;
    while ((match = vhfRegex.exec(xml)) !== null) {
      vhfConditions.push({
        name: match[1],
        location: match[2],
        condition: match[3],
      });
    }

    return {
      source: 'N0NBH',
      updated: get('updated'),
      solarData: {
        solarFlux: get('solarflux'),
        aIndex: get('aindex'),
        kIndex: get('kindex'),
        kIndexNt: get('kindexnt'),
        xray: get('xray'),
        sunspots: get('sunspots'),
        heliumLine: get('heliumline'),
        protonFlux: get('protonflux'),
        electronFlux: get('electonflux'),
        aurora: get('aurora'),
        normalization: get('normalization'),
        latDegree: get('latdegree'),
        solarWind: get('solarwind'),
        magneticField: get('magneticfield'),
        fof2: get('fof2'),
        mufFactor: get('muffactor'),
        muf: get('muf'),
      },
      geomagField: get('geomagfield'),
      signalNoise: get('signalnoise'),
      bandConditions,
      vhfConditions,
    };
  }

  // NOAA Space Weather - Solar Flux
  app.get('/api/noaa/flux', async (req, res) => {
    try {
      if (noaaCache.flux.data && Date.now() - noaaCache.flux.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.flux.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json');
      const data = await response.json();
      noaaCache.flux = { data, timestamp: Date.now() };
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA Flux', error.message);
      if (noaaCache.flux.data) return res.json(noaaCache.flux.data);
      res.status(500).json({ error: 'Failed to fetch solar flux data' });
    }
  });

  // NOAA Space Weather - K-Index
  app.get('/api/noaa/kindex', async (req, res) => {
    try {
      if (noaaCache.kindex.data && Date.now() - noaaCache.kindex.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.kindex.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
      const data = await response.json();
      noaaCache.kindex = { data, timestamp: Date.now() };
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA K-Index', error.message);
      if (noaaCache.kindex.data) return res.json(noaaCache.kindex.data);
      res.status(500).json({ error: 'Failed to fetch K-index data' });
    }
  });

  // NOAA Space Weather - Sunspots
  app.get('/api/noaa/sunspots', async (req, res) => {
    try {
      if (noaaCache.sunspots.data && Date.now() - noaaCache.sunspots.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.sunspots.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json');
      const data = await response.json();
      noaaCache.sunspots = { data, timestamp: Date.now() };
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA Sunspots', error.message);
      if (noaaCache.sunspots.data) return res.json(noaaCache.sunspots.data);
      res.status(500).json({ error: 'Failed to fetch sunspot data' });
    }
  });

  // Solar Indices with History and Kp Forecast
  app.get('/api/solar-indices', async (req, res) => {
    try {
      if (noaaCache.solarIndices.data && Date.now() - noaaCache.solarIndices.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.solarIndices.data);
      }

      const [fluxRes, kIndexRes, kForecastRes, sunspotRes, sfiSummaryRes, magRes] = await Promise.allSettled([
        fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
        fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
        fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json'),
        fetch('https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json'),
      ]);

      const result = {
        sfi: { current: null, history: [] },
        kp: { current: null, history: [], forecast: [] },
        ssn: { current: null, history: [] },
        bz: { current: null },
        timestamp: new Date().toISOString(),
      };

      // SFI current: prefer SWPC summary
      if (sfiSummaryRes.status === 'fulfilled' && sfiSummaryRes.value.ok) {
        try {
          const summary = await sfiSummaryRes.value.json();
          const flux = parseInt(summary?.Flux);
          if (flux > 0) result.sfi.current = flux;
        } catch {}
      }

      // SFI current fallback: N0NBH
      if (result.sfi.current == null && n0nbhCache.data?.solarData?.solarFlux) {
        const flux = parseInt(n0nbhCache.data.solarData.solarFlux);
        if (flux > 0) result.sfi.current = flux;
      }

      // SFI history
      if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
        const data = await fluxRes.value.json();
        if (data?.length) {
          // f107_cm_flux.json is not chronologically sorted — sort before slicing
          // so history shows the correct 30 most-recent readings in order.
          const sorted = [...data].sort((a, b) => (a.time_tag > b.time_tag ? 1 : -1));
          const recent = sorted.slice(-30);
          result.sfi.history = recent.map((d) => ({
            date: d.time_tag || d.date,
            value: Math.round(d.flux || d.value || 0),
          }));
          if (result.sfi.current == null) {
            result.sfi.current = result.sfi.history[result.sfi.history.length - 1]?.value ?? null;
          }
        }
      }

      // Kp history
      // NOAA changed from array-of-arrays [[header],[time,Kp,...],...] to
      // array-of-objects [{time_tag,Kp,...},...] — support both formats.
      if (kIndexRes.status === 'fulfilled' && kIndexRes.value.ok) {
        const data = await kIndexRes.value.json();
        if (data?.length) {
          const isObj = !Array.isArray(data[0]);
          const rows = isObj ? data : data.slice(1); // old format has a header row
          const recent = rows.slice(-24);
          result.kp.history = recent.map((d) => ({
            time: isObj ? d.time_tag : d[0],
            value: Number.isFinite(isObj ? d.Kp : parseFloat(d[1])) ? (isObj ? d.Kp : parseFloat(d[1])) : 0,
          }));
          result.kp.current = result.kp.history[result.kp.history.length - 1]?.value ?? null;
        }
      }

      // Kp forecast — same format change; forecast uses lowercase 'kp' field.
      if (kForecastRes.status === 'fulfilled' && kForecastRes.value.ok) {
        const data = await kForecastRes.value.json();
        if (data?.length) {
          const isObj = !Array.isArray(data[0]);
          const rows = isObj ? data : data.slice(1);
          result.kp.forecast = rows.map((d) => ({
            time: isObj ? d.time_tag : d[0],
            value: Number.isFinite(isObj ? d.kp : parseFloat(d[1])) ? (isObj ? d.kp : parseFloat(d[1])) : 0,
          }));
        }
      }

      // SSN current: prefer N0NBH
      if (n0nbhCache.data?.solarData?.sunspots) {
        const ssn = parseInt(n0nbhCache.data.solarData.sunspots);
        if (ssn >= 0) result.ssn.current = ssn;
      }

      // SSN history
      if (sunspotRes.status === 'fulfilled' && sunspotRes.value.ok) {
        const data = await sunspotRes.value.json();
        if (data?.length) {
          const recent = data.slice(-12);
          result.ssn.history = recent.map((d) => ({
            date: `${d['time-tag'] || d.time_tag || ''}`,
            value: Math.round(d.ssn || d['ISES SSN'] || 0),
          }));
          if (result.ssn.current == null) {
            result.ssn.current = result.ssn.history[result.ssn.history.length - 1]?.value ?? null;
          }
        }
      }

      // Bz (IMF Bz component from RTSW magnetic field data)
      if (magRes.status === 'fulfilled' && magRes.value.ok) {
        try {
          const magData = await magRes.value.json();
          // Format: [["time_tag","bx_gsm","by_gsm","bz_gsm","lon_gsm","lat_gsm","bt"], ...]
          // Most recent valid entry with a non-null bz_gsm
          if (magData?.length > 1) {
            for (let i = magData.length - 1; i >= 1; i--) {
              const bz = parseFloat(magData[i][3]);
              if (!isNaN(bz)) {
                result.bz.current = Math.round(bz * 10) / 10;
                break;
              }
            }
          }
        } catch {}
      }

      noaaCache.solarIndices = { data: result, timestamp: Date.now() };
      res.json(result);
    } catch (error) {
      logErrorOnce('Solar Indices', error.message);
      if (noaaCache.solarIndices.data) return res.json(noaaCache.solarIndices.data);
      res.status(500).json({ error: 'Failed to fetch solar indices' });
    }
  });

  // NASA SDO Solar Image Proxy
  const sdoImageCache = new Map();
  const SDO_CACHE_TTL = 15 * 60 * 1000;
  const SDO_STALE_SERVE = 6 * 60 * 60 * 1000;
  const SDO_VALID_TYPES = new Set(['0193', '0304', '0171', '0094', 'HMIIC']);
  const SDO_NEGATIVE_CACHE = new Map();

  const fetchFromSDO = async (type, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_${type}.jpg`, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, contentType: res.headers.get('content-type') || 'image/jpeg', source: 'SDO' };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  const HELIO_LAYERS = {
    '0193': '[SDO,AIA,AIA,193,1,100]',
    '0304': '[SDO,AIA,AIA,304,1,100]',
    '0171': '[SDO,AIA,AIA,171,1,100]',
    '0094': '[SDO,AIA,AIA,94,1,100]',
    HMIIC: '[SDO,HMI,HMI,continuum,1,100]',
  };

  const fetchFromHelioviewer = async (type, timeoutMs = 20000) => {
    const layers = HELIO_LAYERS[type];
    if (!layers) throw new Error(`No Helioviewer layer config for ${type}`);
    const now = new Date().toISOString().replace(/\.\d+Z/, 'Z');
    const url =
      `https://api.helioviewer.org/v2/takeScreenshot/?` +
      `date=${now}&imageScale=9.6` +
      `&layers=${encodeURIComponent(layers)}` +
      `&events=&eventLabels=false&display=true&watermark=false` +
      `&width=256&height=256&x0=0&y0=0`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 500) throw new Error(`Response too small (${buffer.length} bytes)`);
      return { buffer, contentType: res.headers.get('content-type') || 'image/png', source: 'Helioviewer' };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  const LMSAL_TYPES = new Set(['0193', '0304', '0171', '0094']);
  const fetchFromLMSAL = async (type, timeoutMs = 15000) => {
    if (!LMSAL_TYPES.has(type)) throw new Error(`LMSAL does not serve ${type}`);
    const url = `https://sdowww.lmsal.com/sdomedia/SunInTime/mostrecent/t${type}.jpg`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 500) throw new Error(`Response too small (${buffer.length} bytes)`);
      return { buffer, contentType: res.headers.get('content-type') || 'image/jpeg', source: 'LMSAL' };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  // SOHO/NASCOM serves HMI intensitygram (visible) when SDO primary is down
  const fetchFromSOHO = async (type, timeoutMs = 15000) => {
    if (type !== 'HMIIC') throw new Error(`SOHO fallback only serves HMIIC, not ${type}`);
    const url = 'https://soho.nascom.nasa.gov/data/realtime/hmi_igr/512/latest.jpg';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 500) throw new Error(`Response too small (${buffer.length} bytes)`);
      return { buffer, contentType: res.headers.get('content-type') || 'image/jpeg', source: 'SOHO' };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  app.get('/api/solar/image/:type', async (req, res) => {
    const type = req.params.type;
    if (!SDO_VALID_TYPES.has(type)) {
      return res.status(400).json({ error: 'Invalid image type' });
    }

    const cached = sdoImageCache.get(type);
    const now = Date.now();

    if (cached?.buffer && now - cached.timestamp < SDO_CACHE_TTL) {
      res.set('Content-Type', cached.contentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=900');
      res.set('X-SDO-Cache', 'hit');
      res.set('X-SDO-Source', cached.source || 'unknown');
      return res.send(cached.buffer);
    }

    const negTs = SDO_NEGATIVE_CACHE.get(type) || 0;
    const backoff = cached?.buffer ? 60_000 : 15_000;
    if (now - negTs < backoff) {
      if (cached?.buffer && now - cached.timestamp < SDO_STALE_SERVE) {
        res.set('Content-Type', cached.contentType || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=60');
        res.set('X-SDO-Cache', 'stale-backoff');
        return res.send(cached.buffer);
      }
      return res.status(503).json({ error: 'SDO temporarily unavailable' });
    }

    const sources = [
      { name: 'SDO', fn: () => fetchFromSDO(type) },
      { name: 'LMSAL', fn: () => fetchFromLMSAL(type) },
      { name: 'SOHO', fn: () => fetchFromSOHO(type) },
      { name: 'Helioviewer', fn: () => fetchFromHelioviewer(type) },
    ];

    for (const src of sources) {
      try {
        const { buffer, contentType, source } = await src.fn();
        sdoImageCache.set(type, { buffer, contentType, timestamp: now, source });
        SDO_NEGATIVE_CACHE.delete(type);

        console.log(`[Solar] Image fetched: ${type} (${buffer.length} bytes from ${source})`);
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=900');
        res.set('X-SDO-Cache', 'miss');
        res.set('X-SDO-Source', source);
        return res.send(buffer);
      } catch (e) {
        const reason = e.name === 'AbortError' ? 'timeout' : e.message;
        console.error(`[Solar] ${src.name} failed (${type}): ${reason}`);
      }
    }

    SDO_NEGATIVE_CACHE.set(type, now);

    if (cached?.buffer && now - cached.timestamp < SDO_STALE_SERVE) {
      res.set('Content-Type', cached.contentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=60');
      res.set('X-SDO-Cache', 'stale-error');
      return res.send(cached.buffer);
    }
    return res.status(502).json({ error: 'All solar image sources failed' });
  });

  // NASA Dial-A-Moon
  let moonImageCache = { buffer: null, contentType: null, timestamp: 0 };
  let moonMetaCache = { data: null, timestamp: 0 };
  let moonImageNegativeCache = 0;
  const MOON_CACHE_TTL = 60 * 60 * 1000;
  const MOON_NEGATIVE_CACHE_TTL = 5 * 60 * 1000;

  // Shared fetch: retrieves both image and metadata from Dial-A-Moon API
  async function fetchDialAMoon() {
    const now = new Date();
    const ts = now.toISOString().slice(0, 16);

    const apiUrl = `https://svs.gsfc.nasa.gov/api/dialamoon/${ts}`;
    const metaResponse = await fetch(apiUrl);
    if (!metaResponse.ok) throw new Error(`Dial-A-Moon API returned ${metaResponse.status}`);
    const meta = await metaResponse.json();

    // Cache metadata (phase %, age, diameter, distance)
    moonMetaCache = {
      data: {
        phase: meta.phase ?? null,
        age: meta.age ?? null,
        diameter: meta.diameter ?? null,
        distance: meta.distance ?? null,
      },
      timestamp: Date.now(),
    };

    const imageUrl = meta?.image?.url;
    if (!imageUrl) throw new Error('No image URL in Dial-A-Moon response');

    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) throw new Error(`Moon image fetch returned ${imgResponse.status}`);
    const buffer = Buffer.from(await imgResponse.arrayBuffer());
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

    moonImageCache = { buffer, contentType, timestamp: Date.now() };
  }

  app.get('/api/moon-image', async (req, res) => {
    try {
      if (moonImageCache.buffer && Date.now() - moonImageCache.timestamp < MOON_CACHE_TTL) {
        res.set('Content-Type', moonImageCache.contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(moonImageCache.buffer);
      }

      if (Date.now() - moonImageNegativeCache < MOON_NEGATIVE_CACHE_TTL) {
        if (moonImageCache.buffer) {
          res.set('Content-Type', moonImageCache.contentType);
          res.set('Cache-Control', 'public, max-age=300');
          return res.send(moonImageCache.buffer);
        }
        return res.status(503).json({ error: 'Moon image temporarily unavailable' });
      }

      await fetchDialAMoon();

      res.set('Content-Type', moonImageCache.contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(moonImageCache.buffer);
    } catch (error) {
      moonImageNegativeCache = Date.now();
      logErrorOnce('Moon Image', error.message);
      if (moonImageCache.buffer) {
        res.set('Content-Type', moonImageCache.contentType);
        return res.send(moonImageCache.buffer);
      }
      res.status(500).json({ error: 'Failed to fetch moon image' });
    }
  });

  // Moon metadata from Dial-A-Moon (phase %, age, diameter, distance)
  // Piggybacks on the same cache — no extra NASA requests.
  app.get('/api/moon-data', async (req, res) => {
    try {
      // If metadata is stale but image cache is also stale, fetch both
      if (!moonMetaCache.data || Date.now() - moonMetaCache.timestamp >= MOON_CACHE_TTL) {
        if (!moonImageCache.buffer || Date.now() - moonImageCache.timestamp >= MOON_CACHE_TTL) {
          if (Date.now() - moonImageNegativeCache >= MOON_NEGATIVE_CACHE_TTL) {
            await fetchDialAMoon();
          }
        }
      }
      if (moonMetaCache.data) {
        res.set('Cache-Control', 'public, max-age=3600');
        return res.json(moonMetaCache.data);
      }
      res.status(503).json({ error: 'Moon data not yet available' });
    } catch (error) {
      moonImageNegativeCache = Date.now();
      logErrorOnce('Moon Data', error.message);
      res.status(503).json({ error: 'Moon data temporarily unavailable' });
    }
  });

  // NOAA Space Weather - X-Ray Flux
  app.get('/api/noaa/xray', async (req, res) => {
    try {
      if (noaaCache.xray.data && Date.now() - noaaCache.xray.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.xray.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json');
      const data = await response.json();
      noaaCache.xray = { data, timestamp: Date.now() };
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA X-Ray', error.message);
      if (noaaCache.xray.data) return res.json(noaaCache.xray.data);
      res.status(500).json({ error: 'Failed to fetch X-ray data' });
    }
  });

  // NOAA OVATION Aurora Forecast
  const AURORA_CACHE_TTL = 30 * 60 * 1000;
  app.get('/api/noaa/aurora', async (req, res) => {
    try {
      if (noaaCache.aurora.data && Date.now() - noaaCache.aurora.timestamp < AURORA_CACHE_TTL) {
        return res.json(noaaCache.aurora.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
      const data = await response.json();
      noaaCache.aurora = { data, timestamp: Date.now() };
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA Aurora', error.message);
      if (noaaCache.aurora.data) return res.json(noaaCache.aurora.data);
      res.status(500).json({ error: 'Failed to fetch aurora data' });
    }
  });

  // N0NBH Parsed Band Conditions + Solar Data
  app.get('/api/n0nbh', async (req, res) => {
    try {
      if (n0nbhCache.data && Date.now() - n0nbhCache.timestamp < N0NBH_CACHE_TTL) {
        return res.json(n0nbhCache.data);
      }

      const response = await fetch('https://www.hamqsl.com/solarxml.php');
      const xml = await response.text();
      const parsed = parseN0NBHxml(xml);

      n0nbhCache = { data: parsed, timestamp: Date.now() };
      res.json({ ...parsed, fetchedAt: n0nbhCache.timestamp });
    } catch (error) {
      logErrorOnce('N0NBH', error.message);
      if (n0nbhCache.data) {
        const age = Date.now() - n0nbhCache.timestamp;
        if (age > N0NBH_MAX_STALE_TTL) {
          // Cache is too old to be useful; tell the client so it can show a
          // meaningful error rather than silently displaying stale conditions.
          return res.status(503).json({ error: 'N0NBH data unavailable and cached data is too stale' });
        }
        return res.json({ ...n0nbhCache.data, fetchedAt: n0nbhCache.timestamp, stale: true });
      }
      res.status(500).json({ error: 'Failed to fetch N0NBH data' });
    }
  });

  // Legacy raw XML endpoint
  app.get('/api/hamqsl/conditions', async (req, res) => {
    try {
      if (n0nbhCache.data && Date.now() - n0nbhCache.timestamp < N0NBH_CACHE_TTL) {
        // Re-fetch raw XML from cache won't work since we only store parsed
      }
      const response = await fetch('https://www.hamqsl.com/solarxml.php');
      const text = await response.text();
      res.set('Content-Type', 'application/xml');
      res.send(text);
    } catch (error) {
      logErrorOnce('HamQSL', error.message);
      res.status(500).json({ error: 'Failed to fetch band conditions' });
    }
  });

  // Pre-warm N0NBH cache function
  async function prewarmN0NBH() {
    try {
      const response = await fetch('https://www.hamqsl.com/solarxml.php');
      const xml = await response.text();
      const ts = Date.now();
      n0nbhCache = { data: { ...parseN0NBHxml(xml), fetchedAt: ts }, timestamp: ts };
      logInfo('[Startup] N0NBH solar data pre-warmed');
    } catch (e) {
      logWarn('[Startup] N0NBH pre-warm failed:', e.message);
    }
  }

  // Return shared state that other modules need
  return { n0nbhCache, parseN0NBHxml, prewarmN0NBH };
};
