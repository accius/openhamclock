/**
 * Space weather routes — NOAA, solar indices, N0NBH, SDO images, moon.
 * Lines ~1887-2935 of original server.js
 */

const { fetchFreshestImage, parseLastModified } = require('../utils/solarImageFreshness');
const { toNasaHttpsUrl } = require('../utils/nasaImageUrl');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION } = ctx;

  // Centralized cache for NOAA data (5-minute cache)
  const noaaCache = {
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

  // Solar Indices with History and Kp Forecast
  app.get('/api/solar-indices', async (req, res) => {
    try {
      if (noaaCache.solarIndices.data && Date.now() - noaaCache.solarIndices.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.solarIndices.data);
      }

      const [fluxRes, kIndexRes, kForecastRes, sunspotRes, sfiSummaryRes, magRes, kpEstRes, electronRes, dstRes] =
        await Promise.allSettled([
          fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
          fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
          fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
          fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
          fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json'),
          fetch('https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json'),
          fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json'),
          fetch('https://services.swpc.noaa.gov/json/goes/primary/integral-electrons-1-day.json'),
          fetch('https://services.swpc.noaa.gov/products/kyoto-dst.json'),
        ]);

      const result = {
        sfi: { current: null, history: [] },
        kp: { current: null, history: [], forecast: [] },
        ssn: { current: null, history: [] },
        bz: { current: null },
        // GOES >=2 MeV electron flux (e/(cm²·s·sr)) — the satellite-charging channel
        electron: { current: null, time: null },
        // Kyoto Dst (nT) via SWPC mirror; the Dst panel uses /api/swpc/dst for the series
        dst: { current: null, time: null },
        timestamp: new Date().toISOString(),
      };

      // Electron flux: last valid >=2 MeV sample
      if (electronRes.status === 'fulfilled' && electronRes.value.ok) {
        try {
          const data = await electronRes.value.json();
          for (let i = (data?.length || 0) - 1; i >= 0; i--) {
            const r = data[i];
            if (r?.energy === '>=2 MeV' && Number.isFinite(r.flux)) {
              result.electron = { current: Math.round(r.flux * 10) / 10, time: r.time_tag || null };
              break;
            }
          }
        } catch {}
      }

      // Dst: newest hourly value
      if (dstRes.status === 'fulfilled' && dstRes.value.ok) {
        try {
          const data = await dstRes.value.json();
          const last = Array.isArray(data) ? data[data.length - 1] : null;
          if (last && Number.isFinite(Number(last.dst))) {
            result.dst = { current: Number(last.dst), time: last.time_tag || null };
          }
        } catch {}
      }

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

      // Kp current: prefer the 1-minute estimated product — the observed
      // product above only publishes a new value every 3 hours, which made
      // the displayed Kp lag real conditions. History/forecast stay 3-hourly.
      if (kpEstRes.status === 'fulfilled' && kpEstRes.value.ok) {
        try {
          const data = await kpEstRes.value.json();
          const kp = parseFloat(data?.[data.length - 1]?.estimated_kp);
          if (Number.isFinite(kp) && kp >= 0 && kp <= 9) {
            result.kp.current = Math.round(kp * 100) / 100;
          }
        } catch {}
      }

      // Kp forecast — same format change; forecast uses lowercase 'kp' field.
      // The endpoint mixes past observations with future predictions; keep only
      // entries whose time_tag is in the future so the chart shows predictions.
      if (kForecastRes.status === 'fulfilled' && kForecastRes.value.ok) {
        const data = await kForecastRes.value.json();
        if (data?.length) {
          const isObj = !Array.isArray(data[0]);
          const rows = isObj ? data : data.slice(1);
          const nowIso = new Date().toISOString();
          result.kp.forecast = rows
            .filter((d) => (isObj ? d.time_tag : d[0]) > nowIso)
            .map((d) => ({
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

  // Solar Cycle — observed monthly SSN history vs the SWPC cycle-25 predicted
  // range, for the Solar Cycle panel. Monthly data changes once a month, so a
  // 24h cache is plenty. Observed history is trimmed to 2015+ (tail of cycle
  // 24 for context through all of cycle 25) — the raw feed goes back to 1749.
  const solarCycleCache = { data: null, timestamp: 0 };
  const SOLAR_CYCLE_TTL = 24 * 60 * 60 * 1000;
  const SOLAR_CYCLE_FROM = '2015-01';

  // Shared by the route and by /api/propagation (display-time month SSN):
  // cached 24 h, one upstream fetch in flight at a time, stale data served
  // if a refresh fails.
  let solarCycleInFlight = null;

  async function fetchSolarCycle() {
    const [obsRes, predRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json', {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: AbortSignal.timeout(15000),
      }),
      fetch('https://services.swpc.noaa.gov/products/solar-cycle-25-ssn-predicted-range.json', {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: AbortSignal.timeout(15000),
      }),
    ]);

    const result = { observed: [], predicted: [], timestamp: new Date().toISOString() };

    // Observed: { time-tag 'YYYY-MM', ssn, smoothed_ssn, f10.7, ... }
    // NOAA uses -1 as "not yet available" for smoothed values.
    if (obsRes.status === 'fulfilled' && obsRes.value.ok) {
      const data = await obsRes.value.json();
      if (Array.isArray(data)) {
        result.observed = data
          .filter((d) => typeof d['time-tag'] === 'string' && d['time-tag'] >= SOLAR_CYCLE_FROM)
          .map((d) => ({
            t: d['time-tag'],
            ssn: Number.isFinite(d.ssn) && d.ssn >= 0 ? Math.round(d.ssn * 10) / 10 : null,
            smoothed:
              Number.isFinite(d.smoothed_ssn) && d.smoothed_ssn >= 0 ? Math.round(d.smoothed_ssn * 10) / 10 : null,
            sfi: Number.isFinite(d['f10.7']) && d['f10.7'] >= 0 ? Math.round(d['f10.7'] * 10) / 10 : null,
          }));
      }
    }

    // Predicted range: { time-tag 'YYYY-MM', smoothed_ssn_min, smoothed_ssn_max }
    if (predRes.status === 'fulfilled' && predRes.value.ok) {
      const data = await predRes.value.json();
      if (Array.isArray(data)) {
        result.predicted = data
          .filter(
            (d) =>
              typeof d['time-tag'] === 'string' &&
              Number.isFinite(d.smoothed_ssn_min) &&
              Number.isFinite(d.smoothed_ssn_max),
          )
          .map((d) => ({
            t: d['time-tag'],
            min: Math.max(0, Math.round(d.smoothed_ssn_min * 10) / 10),
            max: Math.max(0, Math.round(d.smoothed_ssn_max * 10) / 10),
          }));
        // The feed's tail runs to 2040 with near-zero values — trim the
        // dead years (predicted max under 5 ≈ solar minimum) so the
        // chart's x-domain ends where the cycle effectively does.
        while (result.predicted.length && result.predicted[result.predicted.length - 1].max < 5) {
          result.predicted.pop();
        }
      }
    }

    if (result.observed.length === 0 && result.predicted.length === 0) {
      throw new Error('Both SWPC solar-cycle feeds returned no data');
    }

    solarCycleCache.data = result;
    solarCycleCache.timestamp = Date.now();
    return result;
  }

  async function getSolarCycle() {
    if (solarCycleCache.data && Date.now() - solarCycleCache.timestamp < SOLAR_CYCLE_TTL) {
      return solarCycleCache.data;
    }
    if (!solarCycleInFlight) {
      solarCycleInFlight = fetchSolarCycle().finally(() => {
        solarCycleInFlight = null;
      });
    }
    try {
      return await solarCycleInFlight;
    } catch (error) {
      if (solarCycleCache.data) return { ...solarCycleCache.data, stale: true };
      throw error;
    }
  }

  app.get('/api/solar-cycle', async (req, res) => {
    try {
      res.json(await getSolarCycle());
    } catch (error) {
      logErrorOnce('Solar Cycle', error.message);
      res.status(502).json({ error: 'Failed to fetch solar cycle data' });
    }
  });

  // NASA SDO Solar Image Proxy
  const sdoImageCache = new Map();
  const SDO_CACHE_TTL = 15 * 60 * 1000;
  const SDO_STALE_SERVE = 6 * 60 * 60 * 1000;
  const SDO_VALID_TYPES = new Set(['0193', '0304', '0171', '0094', 'HMIIC']);
  const SDO_NEGATIVE_CACHE = new Map();

  const fetchFromSDO = async (type, timeoutMs = 8000) => {
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
      return {
        buffer,
        contentType: res.headers.get('content-type') || 'image/jpeg',
        source: 'SDO',
        lastModified: parseLastModified(res.headers.get('last-modified')),
      };
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

  const fetchFromHelioviewer = async (type, timeoutMs = 12000) => {
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
      // Rendered on demand — no Last-Modified, treated as fresh by the chain.
      return {
        buffer,
        contentType: res.headers.get('content-type') || 'image/png',
        source: 'Helioviewer',
        lastModified: null,
      };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  const LMSAL_TYPES = new Set(['0193', '0304', '0171', '0094']);
  const fetchFromLMSAL = async (type, timeoutMs = 8000) => {
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
      return {
        buffer,
        contentType: res.headers.get('content-type') || 'image/jpeg',
        source: 'LMSAL',
        lastModified: parseLastModified(res.headers.get('last-modified')),
      };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  // SOHO/NASCOM serves HMI intensitygram (visible) when SDO primary is down
  const fetchFromSOHO = async (type, timeoutMs = 8000) => {
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
      return {
        buffer,
        contentType: res.headers.get('content-type') || 'image/jpeg',
        source: 'SOHO',
        lastModified: parseLastModified(res.headers.get('last-modified')),
      };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  // In-flight coalescing: one upstream fallback chain per image type, no
  // matter how many clients are waiting. Without this, every concurrent
  // cache-miss launched its OWN serial 4-source chain (formerly up to 65s of
  // held sockets each); on the hosted instance a slow upstream turned into a
  // thundering herd that exhausted sockets and the DNS threadpool (the
  // 2026-08-04 incident: every upstream "timeout" + EAI_AGAIN, self-sustaining
  // even after the upstream recovered).
  const sdoInflight = new Map(); // type → Promise<{buffer, contentType, source}>

  const runSolarImageChain = (type) => {
    let inflight = sdoInflight.get(type);
    if (inflight) return inflight;

    // Freshness-gated: a source that answers 200 with a weeks-old image (NASA's
    // /latest/ symlinks froze 2026-09-21) is skipped in favour of the next one.
    inflight = (async () => {
      const sources = [
        { name: 'SDO', fn: () => fetchFromSDO(type) },
        { name: 'LMSAL', fn: () => fetchFromLMSAL(type) },
        { name: 'SOHO', fn: () => fetchFromSOHO(type) },
        { name: 'Helioviewer', fn: () => fetchFromHelioviewer(type) },
      ];
      try {
        const {
          buffer,
          contentType,
          source: origin,
          lastModified,
          stale,
        } = await fetchFreshestImage(sources, {
          onFail: (name, e) => {
            const reason = e.name === 'AbortError' ? 'timeout' : e.message;
            console.error(`[Solar] ${name} failed (${type}): ${reason}`);
          },
          onStale: (name, lm) => {
            const ageH = ((Date.now() - lm) / 3600000).toFixed(1);
            logWarn(
              `[Solar] ${name} image for ${type} is ${ageH} h old (${new Date(lm).toISOString()}) — trying next source`,
            );
          },
        });
        const source = stale ? `${origin} (stale)` : origin;
        sdoImageCache.set(type, { buffer, contentType, timestamp: Date.now(), source, lastModified });
        SDO_NEGATIVE_CACHE.delete(type);
        console.log(`[Solar] Image fetched: ${type} (${buffer.length} bytes from ${source})`);
        return { buffer, contentType, source, lastModified };
      } catch (e) {
        SDO_NEGATIVE_CACHE.set(type, Date.now());
        throw e;
      }
    })().finally(() => sdoInflight.delete(type));

    sdoInflight.set(type, inflight);
    return inflight;
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
      if (cached.lastModified) res.set('X-SDO-Image-Date', new Date(cached.lastModified).toUTCString());
      return res.send(cached.buffer);
    }

    // Negative-cache backoff. The cold-cache window matters: the frontend
    // retries failed images every 30s with a cache-buster, so anything
    // shorter than that lets each retry beat re-open the floodgates right
    // after a deploy (empty in-memory cache + slow upstream = 502 storm).
    const negTs = SDO_NEGATIVE_CACHE.get(type) || 0;
    const backoff = cached?.buffer ? 60_000 : 45_000;
    if (now - negTs < backoff) {
      if (cached?.buffer && now - cached.timestamp < SDO_STALE_SERVE) {
        res.set('Content-Type', cached.contentType || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=60');
        res.set('X-SDO-Cache', 'stale-backoff');
        return res.send(cached.buffer);
      }
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'SDO temporarily unavailable' });
    }

    try {
      const { buffer, contentType, source, lastModified } = await runSolarImageChain(type);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=900');
      res.set('X-SDO-Cache', 'miss');
      res.set('X-SDO-Source', source);
      if (lastModified) res.set('X-SDO-Image-Date', new Date(lastModified).toUTCString());
      return res.send(buffer);
    } catch (e) {
      if (cached?.buffer && now - cached.timestamp < SDO_STALE_SERVE) {
        res.set('Content-Type', cached.contentType || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=60');
        res.set('X-SDO-Cache', 'stale-error');
        return res.send(cached.buffer);
      }
      res.set('Retry-After', '60');
      return res.status(502).json({ error: 'All solar image sources failed' });
    }
  });

  // NASA Dial-A-Moon
  let moonImageCache = { buffer: null, contentType: null, timestamp: 0 };
  let moonMetaCache = { data: null, timestamp: 0 };
  let moonImageNegativeCache = 0;
  const MOON_CACHE_TTL = 60 * 60 * 1000;
  const MOON_NEGATIVE_CACHE_TTL = 5 * 60 * 1000;

  // Shared fetch: retrieves both image and metadata from Dial-A-Moon API
  // Coalesce concurrent refreshes: both moon routes funnel through here, and
  // without a shared in-flight promise every expired-cache hit launched its
  // own NASA fetch pair (same stampede class as the 2026-08-04 incident).
  // The bare fetches also had no timeout — a hung socket blocked forever.
  let moonRefreshInflight = null;
  function refreshDialAMoon() {
    if (!moonRefreshInflight) {
      moonRefreshInflight = fetchDialAMoon().finally(() => {
        moonRefreshInflight = null;
      });
    }
    return moonRefreshInflight;
  }

  async function fetchDialAMoon() {
    const now = new Date();
    const ts = now.toISOString().slice(0, 16);

    const apiUrl = `https://svs.gsfc.nasa.gov/api/dialamoon/${ts}`;
    const metaResponse = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
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

    // Dial-A-Moon returns http:// image URLs since Oct 2026; accept either
    // scheme on *.nasa.gov and always fetch over https (utils/nasaImageUrl.js).
    const rawImageUrl = meta?.image?.url;
    if (!rawImageUrl) throw new Error('No image URL in Dial-A-Moon response');
    const imageUrl = toNasaHttpsUrl(rawImageUrl);
    if (!imageUrl) throw new Error(`Rejected non-NASA URL: '${rawImageUrl}'`);

    const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
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

      await refreshDialAMoon();

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
            await refreshDialAMoon();
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
  // The panel offers 6/12/24/48h history windows. We pull the 3-day SWPC feed
  // (covers the 48h max with headroom), then keep only the 0.1-0.8nm band the
  // panel plots and trim to the last 50h. Without that, the raw feed is several
  // MB per response — served to every client every 5 min.
  const XRAY_WINDOW_MS = 50 * 60 * 60 * 1000;
  app.get('/api/noaa/xray', async (req, res) => {
    try {
      if (noaaCache.xray.data && Date.now() - noaaCache.xray.timestamp < NOAA_CACHE_TTL) {
        return res.json(noaaCache.xray.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json');
      const raw = await response.json();
      const cutoff = Date.now() - XRAY_WINDOW_MS;
      const data = Array.isArray(raw)
        ? raw.filter((d) => d.energy === '0.1-0.8nm' && new Date(d.time_tag).getTime() >= cutoff)
        : raw;
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

  // NOAA D-RAP (D-Region Absorption Prediction)
  // Global grid of the highest frequency affected by 1 dB absorption (MHz).
  // Upstream is a fixed-width text table: '#' header lines (including
  // "Product Valid At"), a row of longitudes, a dashed separator, then one
  // row per latitude:  " 89 |  0.4  0.4 ..." (north → south).
  const drapCache = { data: null, timestamp: 0 };
  const DRAP_CACHE_TTL = 5 * 60 * 1000;

  function parseDrapText(text) {
    const lines = text.split('\n');
    let validAt = null;
    let lons = null;
    const lats = [];
    const freqs = [];
    let maxFreq = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#')) {
        const m = trimmed.match(/Product Valid At\s*:\s*(.+)$/i);
        if (m) validAt = m[1].trim();
        continue;
      }
      if (/^-+$/.test(trimmed)) continue;

      if (trimmed.includes('|')) {
        // Data row: "<lat> | <freq> <freq> ..."
        const [latPart, valPart] = trimmed.split('|');
        const lat = parseFloat(latPart);
        if (!Number.isFinite(lat) || !valPart) continue;
        const row = valPart
          .trim()
          .split(/\s+/)
          .map((v) => {
            const f = parseFloat(v);
            return Number.isFinite(f) ? f : 0;
          });
        if (lons && row.length !== lons.length) continue; // malformed row
        for (const f of row) if (f > maxFreq) maxFreq = f;
        lats.push(lat);
        freqs.push(row);
      } else {
        // Longitude header row (first non-comment, non-separator line)
        const vals = trimmed.split(/\s+/).map(parseFloat);
        if (!lons && vals.length > 10 && vals.every(Number.isFinite)) lons = vals;
      }
    }

    if (!lons || lats.length === 0) throw new Error('Unrecognized DRAP format');
    return {
      source: 'NOAA SWPC D-RAP',
      validAt,
      lats, // north → south
      lons, // west → east
      freqs, // freqs[latIdx][lonIdx] = highest affected frequency (MHz)
      maxFreq: Math.round(maxFreq * 10) / 10,
    };
  }

  app.get('/api/drap', async (req, res) => {
    try {
      if (drapCache.data && Date.now() - drapCache.timestamp < DRAP_CACHE_TTL) {
        return res.json(drapCache.data);
      }
      const response = await fetch('https://services.swpc.noaa.gov/text/drap_global_frequencies.txt', {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const data = { ...parseDrapText(text), fetchedAt: Date.now() };
      drapCache.data = data;
      drapCache.timestamp = Date.now();
      res.json(data);
    } catch (error) {
      logErrorOnce('DRAP', error.message);
      if (drapCache.data) return res.json({ ...drapCache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch D-RAP data' });
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
  return { n0nbhCache, parseN0NBHxml, prewarmN0NBH, getSolarCycle };
};
