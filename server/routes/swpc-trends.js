/**
 * Space weather trend series for the Space Wx Trends panel.
 *
 * Proxies three SWPC real-time feeds and downsamples each to 10-minute
 * bins over the last 24 h, so the panel draws sparklines from a few
 * hundred points instead of ~3000 one-minute records:
 *   - solar wind plasma (speed km/s, density p/cc)  — rtsw_wind_1m
 *   - interplanetary magnetic field (Bt, Bz nT)      — rtsw_mag_1m
 *   - GOES integral proton flux (>=10 MeV pfu)       — integral-protons-1-day
 *   - GOES integral electron flux (>=2 MeV)          — integral-electrons-1-day
 *
 * GET /api/swpc/trends → { wind, mag, protons, electrons, latest, fetchedAt }
 * each series: [{ t: epochMs, ...values }]
 */

const WIND_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const MAG_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
const PROTON_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json';
const ELECTRON_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-electrons-1-day.json';

const CACHE_TTL = 10 * 60 * 1000;
const BIN_MS = 10 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Downsample records into fixed time bins, averaging each numeric field.
 * `records` = [{ t: epochMs, ...numericFields }]; null/NaN values are
 * skipped per-field so one bad sample doesn't poison a bin.
 */
function binSeries(records, fields, binMs = BIN_MS) {
  const bins = new Map();
  for (const rec of records) {
    if (!Number.isFinite(rec.t)) continue;
    const key = Math.floor(rec.t / binMs) * binMs;
    let bin = bins.get(key);
    if (!bin) {
      bin = { sums: {}, counts: {} };
      bins.set(key, bin);
    }
    for (const f of fields) {
      const v = rec[f];
      if (typeof v === 'number' && Number.isFinite(v)) {
        bin.sums[f] = (bin.sums[f] || 0) + v;
        bin.counts[f] = (bin.counts[f] || 0) + 1;
      }
    }
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bin]) => {
      const out = { t };
      for (const f of fields) {
        out[f] = bin.counts[f] ? Math.round((bin.sums[f] / bin.counts[f]) * 100) / 100 : null;
      }
      return out;
    });
}

// SWPC rtsw time_tag has no zone suffix but is UTC
const parseSwpcTime = (tag) => {
  if (typeof tag !== 'string') return NaN;
  return Date.parse(tag.endsWith('Z') ? tag : tag + 'Z');
};

function slimWind(raw, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  return binSeries(
    raw
      .map((r) => ({ t: parseSwpcTime(r.time_tag), speed: r.proton_speed, density: r.proton_density }))
      .filter((r) => r.t >= cutoff),
    ['speed', 'density'],
  );
}

function slimMag(raw, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  return binSeries(
    raw.map((r) => ({ t: parseSwpcTime(r.time_tag), bt: r.bt, bz: r.bz_gsm })).filter((r) => r.t >= cutoff),
    ['bt', 'bz'],
  );
}

function slimProtons(raw, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  return binSeries(
    raw
      .filter((r) => r.energy === '>=10 MeV')
      .map((r) => ({ t: Date.parse(r.time_tag), flux: r.flux }))
      .filter((r) => r.t >= cutoff),
    ['flux'],
  );
}

// GOES >=2 MeV electrons: the geosynchronous-satellite-charging channel.
// The feed carries only the >=2 MeV energy, but filter anyway in case SWPC
// adds >=0.8 MeV the way the proton product carries several energies.
function slimElectrons(raw, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  return binSeries(
    raw
      .filter((r) => r.energy === '>=2 MeV')
      .map((r) => ({ t: Date.parse(r.time_tag), flux: r.flux }))
      .filter((r) => r.t >= cutoff),
    ['flux'],
  );
}

/** Last non-null value of a field in a binned series. */
function latestValue(series, field) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][field] != null) return series[i][field];
  }
  return null;
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${url.split('/').pop()} responded ${response.status}`);
    return response.json();
  }

  app.get('/api/swpc/trends', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('swpc:trends', async () => {
        // Feeds are independent — a dead one degrades to an empty series
        // instead of taking the whole panel down.
        const [wind, mag, protons, electrons] = await Promise.allSettled([
          fetchJson(WIND_URL),
          fetchJson(MAG_URL),
          fetchJson(PROTON_URL),
          fetchJson(ELECTRON_URL),
        ]);
        const windSeries = wind.status === 'fulfilled' ? slimWind(wind.value) : [];
        const magSeries = mag.status === 'fulfilled' ? slimMag(mag.value) : [];
        const protonSeries = protons.status === 'fulfilled' ? slimProtons(protons.value) : [];
        const electronSeries = electrons.status === 'fulfilled' ? slimElectrons(electrons.value) : [];
        if (!windSeries.length && !magSeries.length && !protonSeries.length && !electronSeries.length) {
          throw new Error('all SWPC trend feeds failed or empty');
        }
        return {
          wind: windSeries,
          mag: magSeries,
          protons: protonSeries,
          electrons: electronSeries,
          latest: {
            speed: latestValue(windSeries, 'speed'),
            density: latestValue(windSeries, 'density'),
            bt: latestValue(magSeries, 'bt'),
            bz: latestValue(magSeries, 'bz'),
            proton10: latestValue(protonSeries, 'flux'),
            electron2: latestValue(electronSeries, 'flux'),
          },
          fetchedAt: new Date().toISOString(),
        };
      });
      cache = { data, timestamp: Date.now() };
      logDebug('[SWPC Trends]', data.wind.length, 'wind bins,', data.mag.length, 'mag bins');
      res.json(data);
    } catch (error) {
      logErrorOnce('SWPC Trends', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch space weather trends' });
    }
  });
};

module.exports.binSeries = binSeries;
module.exports.slimWind = slimWind;
module.exports.slimMag = slimMag;
module.exports.slimProtons = slimProtons;
module.exports.slimElectrons = slimElectrons;
module.exports.latestValue = latestValue;
