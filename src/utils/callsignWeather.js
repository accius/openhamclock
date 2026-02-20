// src/utils/callsignWeather.js
// Lightweight Open-Meteo fetch with caching + in-flight de-dupe.
// Designed for hover overlays: fetch-on-demand, no polling.
import { normalizeLon } from './geo'; // adjust path if needed

const CACHE = new Map(); // key -> { ts, data }
const INFLIGHT = new Map(); // key -> Promise
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function keyFor(lat, lon) {
  // Rounded key prevents cache misses from tiny float differences
  const rLat = Math.round(lat * 100) / 100;
  const rLon = Math.round(lon * 100) / 100;
  return `${rLat},${rLon}`;
}

async function fetchOpenMeteo(lat, lon) {
  let apiKey = '';
  try {
    apiKey = localStorage.getItem('ohc_openmeteo_apikey') || '';
  } catch {}

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // inside your fetchWeatherByLatLon (or equivalent) before using lat/lon:
  lat = clamp(Number(lat), -90, 90);
  lon = normalizeLon(Number(lon));
  lon = clamp(lon, -180, 180);

  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,uv_index,visibility,dew_point_2m,is_day',
    'hourly=precipitation_probability',
    'temperature_unit=celsius',
    'wind_speed_unit=kmh',
    'precipitation_unit=mm',
    'timezone=auto',
    'forecast_hours=3',
  ];

  if (apiKey) params.push(`apikey=${apiKey}`);
  const base = apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';

  const res = await fetch(`${base}?${params.join('&')}`);
  if (res.status === 429) throw new Error('Rate limited');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return res.json();
}

export async function getCallsignWeather(lat, lon, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (lat == null || lon == null) return null;

  const key = keyFor(lat, lon);
  const now = Date.now();

  const cached = CACHE.get(key);
  if (cached && now - cached.ts < ttlMs) return cached.data;

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const data = await fetchOpenMeteo(lat, lon);
      CACHE.set(key, { ts: Date.now(), data });
      return data;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);
  return p;
}
