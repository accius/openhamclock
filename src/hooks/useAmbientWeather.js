/**
 * useAmbientWeather Hook
 * Fetches latest station data from Ambient Weather REST API and converts client-side.
 *
 * Raw base is ALWAYS the Ambient-provided US units:
 *  - tempf (°F), wind mph, rain inches, pressure inHg
 * Conversion happens at read time for unit toggles (F↔C), like useWeather.
 *
 * Env/config:
 *  - AMBIENT_API_KEY
 *  - AMBIENT_APPLICATION_KEY
 *  - AMBIENT_DEVICE_MAC (optional)
 *  - AMBIENT_POLL_SECONDS (optional, default 60)
 */
import { useEffect, useMemo, useState } from 'react';

// --- unit conversion helpers (raw base is US) ---
const fToC = (f) => (f - 32) * 5 / 9;
const mphToKmh = (mph) => mph * 1.609344;
const inToMm = (inch) => inch * 25.4;
const inHgToHpa = (inHg) => inHg * 33.8638866667;

function windDirection(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function toBool(v) {
  // Ambient sometimes returns "0"/"1" strings or 0/1 ints
  if (v === true || v === false) return v;
  if (v == null) return null;
  if (typeof v === 'string') return v !== '0' && v.toLowerCase() !== 'false' && v !== '';
  return !!v;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getEnv(name) {
  // Vite: import.meta.env
  // CRA: process.env
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && name in import.meta.env) return import.meta.env[name];
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env && name in process.env) return process.env[name];
  } catch {}
  return undefined;
}

export const useAmbientWeather = (tempUnit = 'F') => {
  const [rawDevice, setRawDevice] = useState(null); // { macAddress, info, lastData }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const apiKey = getEnv('VITE_AMBIENT_API_KEY');
  const appKey = getEnv('VITE_AMBIENT_APPLICATION_KEY');
  const deviceMac = (getEnv('VITE_AMBIENT_DEVICE_MAC') || '').trim().toLowerCase();
  const pollSeconds = Math.max(15, parseInt(getEnv('VITE_AMBIENT_POLL_SECONDS') || '60', 10) || 60);

  useEffect(() => {
    if (!apiKey || !appKey) {
	  setLoading(false);
	  setError({ code: "missing_credentials", message: "Ambient keys not configured" });
	  return;
	}

    let mounted = true;

    const fetchAmbient = async () => {
      try {
        setError(null);

        const url = `https://api.ambientweather.net/v1/devices?apiKey=${encodeURIComponent(apiKey)}&applicationKey=${encodeURIComponent(appKey)}`;
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const json = await resp.json();

        // Ambient may return an array; be defensive if a single object is returned.
        const devices = Array.isArray(json) ? json : (json ? [json] : []);

        if (devices.length === 0) throw new Error('No devices returned');

        let chosen = devices[0];
        if (deviceMac) {
          const match = devices.find(d => String(d.macAddress || '').toLowerCase() === deviceMac);
          if (match) chosen = match;
        }

        // Ensure lastData exists
        if (!chosen.lastData) throw new Error('Device has no lastData');

        if (mounted) setRawDevice(chosen);
      } catch (e) {
	   if (mounted) setError({ code: "fetch_error", message: e?.message || "Ambient fetch error" });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchAmbient();
    const id = setInterval(fetchAmbient, pollSeconds * 1000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [apiKey, appKey, deviceMac, pollSeconds]);

  const data = useMemo(() => {
    if (!rawDevice?.lastData) return null;

    const isMetric = tempUnit === 'C';
    const ld = rawDevice.lastData;

    const updatedAtMs = safeNum(ld.dateutc) ?? (ld.date ? Date.parse(ld.date) : null);
    const updatedAgeSec = updatedAtMs ? Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000)) : null;

    const convTemp = (f) => {
      const n = safeNum(f);
      if (n == null) return null;
      return Math.round(isMetric ? fToC(n) : n);
    };

    const convWind = (mph) => {
      const n = safeNum(mph);
      if (n == null) return null;
      return Math.round(isMetric ? mphToKmh(n) : n);
    };

    const convRain = (inch) => {
      const n = safeNum(inch);
      if (n == null) return null;
      return isMetric ? Math.round(inToMm(n) * 10) / 10 : Math.round(n * 1000) / 1000; // mm to 0.1, in to 0.001
    };

    const convPressure = (inHg) => {
      const n = safeNum(inHg);
      if (n == null) return null;
      return isMetric ? (inHgToHpa(n)).toFixed(1) : n.toFixed(3);
    };

    return {
	  lastUpdated: updatedAtMs ? new Date(updatedAtMs).toISOString() : null,

	  // common aliases for UI
	  barometer: convPressure(ld.baromrelin ?? ld.baromabsin),
	  rainRate: convRain(ld.rainratein),  // may be undefined on some stations -> null	
      // meta
      name: rawDevice.info?.name || 'Ambient Station',
      macAddress: rawDevice.macAddress, // consider not using in UI
      updatedAtMs,
      updatedAgeSec,
      tz: ld.tz || '',

      // outside
      temp: convTemp(ld.tempf),
      feelsLike: convTemp(ld.feelsLike),
      humidity: ld.humidity != null ? Math.round(ld.humidity) : null,
      dewPoint: convTemp(ld.dewPoint),

      // wind
      windSpeed: convWind(ld.windspeedmph),
      windGust: convWind(ld.windgustmph),
      maxDailyGust: convWind(ld.maxdailygust),
      windDirDeg: safeNum(ld.winddir),
      windDir: windDirection(ld.winddir_avg10m ?? ld.winddir),

      // rain
      rainHourly: convRain(ld.hourlyrainin),
      rainEvent: convRain(ld.eventrainin),
      rainDaily: convRain(ld.dailyrainin),
      rainWeekly: convRain(ld.weeklyrainin),
      rainMonthly: convRain(ld.monthlyrainin),
      rainYearly: convRain(ld.yearlyrainin),
      lastRainIso: ld.lastRain || null,

      // pressure + solar
      pressureRel: convPressure(ld.baromrelin),
      pressureAbs: convPressure(ld.baromabsin),
      uv: safeNum(ld.uv) ?? 0,
      solar: safeNum(ld.solarradiation),

      // indoor
      indoorTemp: convTemp(ld.tempinf),
      indoorHumidity: ld.humidityin != null ? Math.round(ld.humidityin) : null,
      indoorFeelsLike: convTemp(ld.feelsLikein),
      indoorDewPoint: convTemp(ld.dewPointin),

      // batteries
      battOutOk: toBool(ld.battout),
      battInOk: toBool(ld.battin),
      battRainOk: toBool(ld.battrain),

      // units
      tempUnit: isMetric ? 'C' : 'F',
      windUnit: isMetric ? 'km/h' : 'mph',
      rainUnit: isMetric ? 'mm' : 'in',
      pressureUnit: isMetric ? 'hPa' : 'inHg',
    };
  }, [rawDevice, tempUnit]);

  return { data, loading, error };
};
