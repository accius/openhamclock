/**
 * useWeather Hook
 * US weather: fetched server-side via NWS (unlimited, cached by background worker)
 * International weather: fetched directly from Open-Meteo by each user's browser
 *   — distributes rate limits across all users instead of concentrating on server.
 *   — optional API key support via localStorage ('ohc_openmeteo_apikey')
 *
 * Always fetches in metric (Celsius, km/h, mm) and converts client-side
 * based on the global `units` setting ('imperial' or 'metric').
 */
import { useState, useEffect, useRef } from 'react';

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
export function convertWeatherData(rawData, units = 'imperial') {
  if (!rawData) return null;

  const isMetric = units === 'metric';
  const current = rawData.current || {};
  const daily = rawData.daily || {};
  const hourly = rawData.hourly || {};
  const code = current.weather_code;
  const weather = WEATHER_CODES[code] || { desc: 'Unknown', icon: '🌡️' };

  const convTemp = (c) => (c == null ? null : Math.round(isMetric ? c : cToF(c)));
  const convWind = (k) => (k == null ? null : Math.round(isMetric ? k : kmhToMph(k)));

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
        precipSum: isMetric
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
      ? isMetric
        ? current.pressure_msl.toFixed(1)
        : hPaToInHg(current.pressure_msl).toFixed(2)
      : null,
    pressureUnit: isMetric ? 'hPa' : 'inHg',
    cloudCover: current.cloud_cover || 0,
    windSpeed: convWind(current.wind_speed_10m),
    windDir: windDirection(current.wind_direction_10m),
    windDirDeg: current.wind_direction_10m || 0,
    windGusts: convWind(current.wind_gusts_10m),
    precipitation: isMetric ? current.precipitation || 0 : parseFloat(mmToInch(current.precipitation || 0).toFixed(2)),
    uvIndex: current.uv_index || 0,
    visibility: current.visibility
      ? isMetric
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
    tempUnit: isMetric ? 'C' : 'F',
    windUnit: isMetric ? 'km/h' : 'mph',
    visUnit: isMetric ? 'km' : 'mi',
    rawTempC,
    rawFeelsLikeC: current.apparent_temperature || 0,
  };
}

// Retry delays: 15s, 30s, 60s, 120s, 300s (cap)
const RETRY_DELAYS = [15000, 30000, 60000, 120000, 300000];
const POLL_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours — matches server cache TTL

// Fetch weather directly from Open-Meteo
// Each user's browser makes its own request — rate limits are per-IP, not per-server
async function fetchOpenMeteoDirect(lat, lon) {
  let apiKey = '';
  try {
    apiKey = localStorage.getItem('ohc_openmeteo_apikey') || '';
  } catch {}

  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
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
  const response = await fetch(`${base}?${params.join('&')}`, { cache: 'no-store' });

  if (response.status === 429) throw new Error('Rate limited');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  data._source = 'openmeteo';
  return data;
}

export const useWeather = (location, units = 'imperial') => {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, retryIn }
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!location?.lat || !location?.lon) return;

    const fetchWeather = async () => {
      try {
        const lat = normalizeLat(location.lat);
        const lon = normalizeLon(location.lon);

        console.log(`[Weather] Fetching for ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        const data = await fetchOpenMeteoDirect(lat, lon);
        console.log(
          `[Weather] Result: ${data?.current?.temperature_2m}°C (${Math.round((data?.current?.temperature_2m * 9) / 5 + 32)}°F) from ${data?._source || 'unknown'}`,
        );
        setRawData(data);
        setError(null);
        retryCountRef.current = 0;
      } catch (err) {
        console.error('[Weather] Fetch error:', err.message);
        const retryIdx = Math.min(retryCountRef.current, RETRY_DELAYS.length - 1);
        const delay = RETRY_DELAYS[retryIdx];
        retryCountRef.current++;
        setError({
          message: err.message === 'Rate limited' ? 'Weather service busy' : 'Weather unavailable',
          retryIn: Math.round(delay / 1000),
        });
        retryRef.current = setTimeout(fetchWeather, delay);
      } finally {
        setLoading(false);
      }
    };

    // Debounce: wait 10 seconds after last location change before fetching.
    // Absorbs rapid DX tuning so we only fetch for the final target.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
    retryCountRef.current = 0;

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchWeather();
    }, 10000);

    const interval = setInterval(fetchWeather, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [location?.lat, location?.lon]);

  // Convert raw API data to display data based on current units
  const data = convertWeatherData(rawData, units);

  return { data, loading, error };
};

export default useWeather;
