/**
 * useWeather Hook
 * US weather: fetched server-side via NWS (unlimited, cached by background worker)
 * International weather: fetched directly from Open-Meteo by each user's browser
 *   — distributes rate limits across all users instead of concentrating on server.
 *   — optional API key support via localStorage ('ohc_openmeteo_apikey')
 *
 * Always fetches in metric (Celsius, km/h, mm) and converts client-side
 * based on the global `allUnits` setting ({dist, temp, press} being 'imperial' or 'metric' for each).
 */
import { useState, useEffect, useRef } from 'react';
import { mapOwmToOpenMeteo } from '../utils/owmWeather.js';

// Weather source selection (discussion #474). 'openmeteo' (default, no key
// needed) or 'openweathermap' (requires the user's own OWM key). Both are
// stored browser-local only, like the callbook credentials.
export const WEATHER_SOURCE_KEY = 'ohc_weather_source';
export const OWM_APIKEY_KEY = 'ohc_owm_apikey';
export const WEATHER_SOURCE_CHANGE_EVENT = 'ohc-weather-source-change';

export const getWeatherSource = () => {
  try {
    const s = localStorage.getItem(WEATHER_SOURCE_KEY);
    return s === 'openweathermap' ? 'openweathermap' : 'openmeteo';
  } catch {
    return 'openmeteo';
  }
};

const getOwmApiKey = () => {
  try {
    return localStorage.getItem(OWM_APIKEY_KEY) || import.meta.env.VITE_OPENWEATHER_API_KEY || '';
  } catch {
    return import.meta.env.VITE_OPENWEATHER_API_KEY || '';
  }
};

// Weather code to description and icon mapping
const WEATHER_CODES = {
  0: { desc: 'Clear sky', icon: '☀️' },
  1: { desc: 'Mainly clear', icon: '🌤️' },
  2: { desc: 'Partly cloudy', icon: '⛅' },
  3: { desc: 'Overcast', icon: '☁️' },
  45: { desc: 'Fog', icon: '🌫️' },
  48: { desc: 'Depositing rime fog', icon: '🌫️' },
  51: { desc: 'Light drizzle', icon: '🌧️' },
  53: { desc: 'Moderate drizzle', icon: '🌧️' },
  55: { desc: 'Dense drizzle', icon: '🌧️' },
  56: { desc: 'Light freezing drizzle', icon: '🌧️' },
  57: { desc: 'Dense freezing drizzle', icon: '🌧️' },
  61: { desc: 'Slight rain', icon: '🌧️' },
  63: { desc: 'Moderate rain', icon: '🌧️' },
  65: { desc: 'Heavy rain', icon: '🌧️' },
  66: { desc: 'Light freezing rain', icon: '🌧️' },
  67: { desc: 'Heavy freezing rain', icon: '🌧️' },
  71: { desc: 'Slight snow', icon: '🌨️' },
  73: { desc: 'Moderate snow', icon: '🌨️' },
  75: { desc: 'Heavy snow', icon: '❄️' },
  77: { desc: 'Snow grains', icon: '🌨️' },
  80: { desc: 'Slight rain showers', icon: '🌦️' },
  81: { desc: 'Moderate rain showers', icon: '🌦️' },
  82: { desc: 'Violent rain showers', icon: '⛈️' },
  85: { desc: 'Slight snow showers', icon: '🌨️' },
  86: { desc: 'Heavy snow showers', icon: '❄️' },
  95: { desc: 'Thunderstorm', icon: '⛈️' },
  96: { desc: 'Thunderstorm w/ slight hail', icon: '⛈️' },
  99: { desc: 'Thunderstorm w/ heavy hail', icon: '⛈️' },
};

// Wind direction from degrees
function windDirection(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Normalize longitude to -180 to 180 range
function normalizeLon(lon) {
  if (lon == null) return lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

// Normalize latitude to -90 to 90 range
function normalizeLat(lat) {
  if (lat == null) return lat;
  return Math.max(-90, Math.min(90, lat));
}

// Conversion helpers — always from Celsius/metric base
const cToF = (c) => (c * 9) / 5 + 32;
const kmhToMph = (k) => k * 0.621371;
const mmToInch = (mm) => mm * 0.0393701;
const kmToMi = (km) => km * 0.621371;
const hPaToInHg = (hPa) => hPa * 0.02953;

/**
 * Convert raw Open-Meteo API response to display-ready weather data.
 * Exported so WeatherPanel can use pre-fetched data without its own hook.
 */
export function convertWeatherData(rawData, allUnits) {
  if (!rawData) return null;

  const isMetricDist = allUnits.dist === 'metric';
  const isMetricTemp = allUnits.temp === 'metric';
  const isMetricPress = allUnits.press === 'metric';
  const current = rawData.current || {};
  const daily = rawData.daily || {};
  const hourly = rawData.hourly || {};
  const code = current.weather_code;
  const weather = WEATHER_CODES[code] || { desc: 'Unknown', icon: '🌡️' };

  const convTemp = (c) => (c == null ? null : Math.round(isMetricTemp ? c : cToF(c)));
  const convWind = (k) => (k == null ? null : Math.round(isMetricDist ? k : kmhToMph(k)));

  // Build hourly forecast (next 24h in 3h intervals)
  const hourlyForecast = [];
  if (hourly.time && hourly.temperature_2m) {
    for (let i = 0; i < Math.min(24, hourly.time.length); i += 3) {
      const hCode = hourly.weather_code?.[i];
      const hWeather = WEATHER_CODES[hCode] || { desc: '', icon: '🌡️' };
      hourlyForecast.push({
        time: new Date(hourly.time[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        temp: convTemp(hourly.temperature_2m[i]),
        precipProb: hourly.precipitation_probability?.[i] || 0,
        icon: hWeather.icon,
      });
    }
  }

  // Build daily forecast
  const dailyForecast = [];
  if (daily.time) {
    for (let i = 0; i < Math.min(3, daily.time.length); i++) {
      const dCode = daily.weather_code?.[i];
      const dWeather = WEATHER_CODES[dCode] || { desc: '', icon: '🌡️' };
      dailyForecast.push({
        date: new Date(daily.time[i] + 'T12:00:00').toLocaleDateString([], { weekday: 'short' }),
        high: convTemp(daily.temperature_2m_max?.[i]),
        low: convTemp(daily.temperature_2m_min?.[i]),
        precipProb: daily.precipitation_probability_max?.[i] || 0,
        precipSum: isMetricDist
          ? daily.precipitation_sum?.[i] || 0
          : parseFloat(mmToInch(daily.precipitation_sum?.[i] || 0).toFixed(2)),
        icon: dWeather.icon,
        desc: dWeather.desc,
        windMax: convWind(daily.wind_speed_10m_max?.[i]),
        uvMax: daily.uv_index_max?.[i] || 0,
      });
    }
  }

  const rawTempC = current.temperature_2m || 0;

  return {
    temp: convTemp(current.temperature_2m),
    feelsLike: convTemp(current.apparent_temperature),
    description: weather.desc,
    icon: weather.icon,
    humidity: Math.round(current.relative_humidity_2m || 0),
    dewPoint: convTemp(current.dew_point_2m),
    pressure: current.pressure_msl
      ? isMetricPress
        ? current.pressure_msl.toFixed(1)
        : hPaToInHg(current.pressure_msl).toFixed(2)
      : null,
    pressureUnit: isMetricPress ? 'hPa' : 'inHg',
    cloudCover: current.cloud_cover || 0,
    windSpeed: convWind(current.wind_speed_10m),
    windDir: windDirection(current.wind_direction_10m),
    windDirDeg: current.wind_direction_10m || 0,
    windGusts: convWind(current.wind_gusts_10m),
    precipitation: isMetricDist
      ? current.precipitation || 0
      : parseFloat(mmToInch(current.precipitation || 0).toFixed(2)),
    uvIndex: current.uv_index || 0,
    visibility: current.visibility
      ? isMetricDist
        ? (current.visibility / 1000).toFixed(1)
        : kmToMi(current.visibility / 1000).toFixed(1)
      : null,
    isDay: current.is_day === 1,
    weatherCode: code,
    todayHigh: convTemp(daily.temperature_2m_max?.[0]),
    todayLow: convTemp(daily.temperature_2m_min?.[0]),
    hourly: hourlyForecast,
    daily: dailyForecast,
    timezone: rawData.timezone || '',
    tempUnit: isMetricTemp ? 'C' : 'F',
    windUnit: isMetricDist ? 'km/h' : 'mph',
    visUnit: isMetricDist ? 'km' : 'mi',
    rawTempC,
    rawFeelsLikeC: current.apparent_temperature || 0,
  };
}

// Retry delays after a fetch error. Tight cap because each browser is its own
// per-IP rate-limit bucket — a single 429 should never wedge the panel.
const RETRY_DELAYS = [5000, 15000, 30000];
// Settle window after a location change. Absorbs rapid DX tuning while keeping
// time-to-first-weather under the 1-3s target.
const DEBOUNCE_MS = 1500;
const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Fetch weather directly from Open-Meteo
// Each user's browser makes its own request — rate limits are per-IP, not per-server
async function fetchOpenMeteoDirect(lat, lon) {
  let apiKey = '';
  try {
    apiKey = localStorage.getItem('ohc_openmeteo_apikey') || '';
  } catch {}

  // Round to 1 decimal (~11km) — weather doesn't change within that range,
  // and identical URLs share browser cache hits across nearby DX spots
  const params = [
    `latitude=${parseFloat(lat).toFixed(1)}`,
    `longitude=${parseFloat(lon).toFixed(1)}`,
    'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,uv_index,visibility,dew_point_2m,is_day',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,uv_index_max,wind_speed_10m_max',
    'hourly=temperature_2m,precipitation_probability,weather_code',
    'temperature_unit=celsius',
    'wind_speed_unit=kmh',
    'precipitation_unit=mm',
    'timezone=auto',
    'forecast_days=3',
    'forecast_hours=24',
  ];
  if (apiKey) params.push(`apikey=${apiKey}`);

  const base = apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
  const response = await fetch(`${base}?${params.join('&')}`);

  if (response.status === 429) throw new Error('Rate limited');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  data._source = 'openmeteo';
  return data;
}

// Fetch weather from OpenWeatherMap (free 2.5 tier: current + 3h forecast)
// and map it into the Open-Meteo shape the panels consume. Same direct-from-
// browser model as Open-Meteo: the user's key, the user's IP.
async function fetchOpenWeatherMapDirect(lat, lon, apiKey) {
  const qs = `lat=${parseFloat(lat).toFixed(2)}&lon=${parseFloat(lon).toFixed(2)}&units=metric&appid=${apiKey}`;
  const [curRes, fcRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?${qs}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?${qs}`),
  ]);
  if (curRes.status === 429 || fcRes.status === 429) throw new Error('Rate limited');
  if (curRes.status === 401) throw new Error('OpenWeatherMap key rejected');
  if (!curRes.ok) throw new Error(`HTTP ${curRes.status}`);

  const current = await curRes.json();
  const forecast = fcRes.ok ? await fcRes.json() : null; // current alone still renders
  const data = mapOwmToOpenMeteo(current, forecast);
  if (!data) throw new Error('Unexpected OpenWeatherMap response');
  data._source = 'openweathermap';
  return data;
}

export const useWeather = (location, allUnits = { dist: 'imperial', temp: 'imperial', press: 'imperial' }) => {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, retryIn, rateLimited, persistent }
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const retryCountRef = useRef(0);
  const consecutive429sRef = useRef(0);
  const firstFireRef = useRef(true);

  // Re-fetch when the user flips the weather source in Settings.
  const [sourceTick, setSourceTick] = useState(0);
  useEffect(() => {
    const onChange = () => setSourceTick((n) => n + 1);
    window.addEventListener(WEATHER_SOURCE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(WEATHER_SOURCE_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (location?.lat == null || location?.lon == null) return;

    const fetchWeather = async () => {
      try {
        const lat = normalizeLat(location.lat);
        const lon = normalizeLon(location.lon);

        console.info(`[Weather] Fetching for ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        const owmKey = getWeatherSource() === 'openweathermap' ? getOwmApiKey() : '';
        // OWM without a key silently falls through to the keyless default.
        const data = owmKey ? await fetchOpenWeatherMapDirect(lat, lon, owmKey) : await fetchOpenMeteoDirect(lat, lon);
        console.info(
          `[Weather] Result: ${data?.current?.temperature_2m}°C (${Math.round((data?.current?.temperature_2m * 9) / 5 + 32)}°F) from ${data?._source || 'unknown'}`,
        );
        setRawData(data);
        setError(null);
        retryCountRef.current = 0;
        consecutive429sRef.current = 0;
      } catch (err) {
        console.error('[Weather] Fetch error:', err.message);
        const isRateLimit = err.message === 'Rate limited';
        if (isRateLimit) consecutive429sRef.current++;
        else consecutive429sRef.current = 0;

        const retryIdx = Math.min(retryCountRef.current, RETRY_DELAYS.length - 1);
        const delay = RETRY_DELAYS[retryIdx];
        retryCountRef.current++;
        setError({
          message: isRateLimit ? 'Weather service busy' : 'Weather unavailable',
          retryIn: Math.round(delay / 1000),
          rateLimited: isRateLimit,
          persistent: consecutive429sRef.current >= 2,
        });
        retryRef.current = setTimeout(fetchWeather, delay);
      } finally {
        setLoading(false);
      }
    };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
    retryCountRef.current = 0;
    setLoading(true);

    // Fire immediately on the first run of this hook (initial app mount or first
    // valid location). Subsequent location changes wait DEBOUNCE_MS to absorb
    // rapid DX tuning.
    const isFirstFire = firstFireRef.current;
    firstFireRef.current = false;
    debounceRef.current = setTimeout(fetchWeather, isFirstFire ? 0 : DEBOUNCE_MS);

    const interval = setInterval(fetchWeather, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lon, sourceTick]);

  // Convert raw API data to display data based on current units
  const data = convertWeatherData(rawData, allUnits);

  return { data, loading, error };
};

export default useWeather;
