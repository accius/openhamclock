/**
 * useWeather Hook
 * Fetches detailed weather data from Open-Meteo API (free, no API key)
 * 
 * Always fetches in metric (Celsius, km/h, mm) and converts client-side.
 * This prevents rounding drift when toggling F↔C (the old approach refetched
 * the API in the new unit, Math.round'd, then back-converted in the header,
 * causing ±1° drift each toggle).
 * 
 * v2: Exponential retry on 429/error, error state for UI feedback,
 *     30-min poll to reduce API pressure, exported convertWeatherData.
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
  99: { desc: 'Thunderstorm w/ heavy hail', icon: '⛈️' }
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
const cToF = (c) => c * 9 / 5 + 32;
const kmhToMph = (k) => k * 0.621371;
const mmToInch = (mm) => mm * 0.0393701;
const kmToMi = (km) => km * 0.621371;

/**
 * Convert raw Open-Meteo API response to display-ready weather data.
 * Exported so WeatherPanel can use pre-fetched data without its own hook.
 */
export function convertWeatherData(rawData, tempUnit = 'F') {
  if (!rawData) return null;

  const isMetric = tempUnit === 'C';
  const current = rawData.current || {};
  const daily = rawData.daily || {};
  const hourly = rawData.hourly || {};
  const code = current.weather_code;
  const weather = WEATHER_CODES[code] || { desc: 'Unknown', icon: '🌡️' };

  const convTemp = (c) => c == null ? null : Math.round(isMetric ? c : cToF(c));
  const convWind = (k) => k == null ? null : Math.round(isMetric ? k : kmhToMph(k));

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
          ? (daily.precipitation_sum?.[i] || 0)
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
    pressure: current.pressure_msl ? current.pressure_msl.toFixed(1) : null,
    cloudCover: current.cloud_cover || 0,
    windSpeed: convWind(current.wind_speed_10m),
    windDir: windDirection(current.wind_direction_10m),
    windDirDeg: current.wind_direction_10m || 0,
    windGusts: convWind(current.wind_gusts_10m),
    precipitation: isMetric
      ? (current.precipitation || 0)
      : parseFloat(mmToInch(current.precipitation || 0).toFixed(2)),
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

export const useWeather = (location, tempUnit = 'F') => {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, retryIn }
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const retryCountRef = useRef(0);

  // Fetch always in metric — only depends on location, NOT tempUnit
  useEffect(() => {
    if (!location?.lat || !location?.lon) return;

    const fetchWeather = async (isRetry = false) => {
      try {
        const lat = normalizeLat(location.lat);
        const lon = normalizeLon(location.lon);

        const url = `/api/weather?lat=${lat}&lon=${lon}`;
        const response = await fetch(url);

        if (response.status === 429) {
          // Rate limited — schedule exponential retry
          const retryIdx = Math.min(retryCountRef.current, RETRY_DELAYS.length - 1);
          const delay = RETRY_DELAYS[retryIdx];
          retryCountRef.current++;
          setError({ message: 'Weather service busy', retryIn: Math.round(delay / 1000) });
          setLoading(false);

          console.warn(`[Weather] Rate limited, retry #${retryCountRef.current} in ${delay / 1000}s`);
          retryRef.current = setTimeout(() => fetchWeather(true), delay);
          return;
        }

        if (response.status === 202) {
          // Server queued the request — retry in 10s to pick up cached result
          setError({ message: 'Weather loading...', retryIn: 10 });
          setLoading(false);
          retryRef.current = setTimeout(() => fetchWeather(true), 10000);
          return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();

        // Server may return _pending inside a 200 if it served queued status
        if (result._pending) {
          setError({ message: 'Weather loading...', retryIn: 10 });
          setLoading(false);
          retryRef.current = setTimeout(() => fetchWeather(true), 10000);
          return;
        }

        setRawData(result);
        setError(null);
        retryCountRef.current = 0;
      } catch (err) {
        console.error('[Weather] Fetch error:', err.message);

        // Schedule retry on network errors too
        const retryIdx = Math.min(retryCountRef.current, RETRY_DELAYS.length - 1);
        const delay = RETRY_DELAYS[retryIdx];
        retryCountRef.current++;
        setError({ message: 'Weather unavailable', retryIn: Math.round(delay / 1000) });

        retryRef.current = setTimeout(() => fetchWeather(true), delay);
      } finally {
        setLoading(false);
      }
    };

    // Debounce: wait 30 seconds after last location change before fetching.
    // This absorbs rapid DX target changes — 2000+ users changing DX constantly
    // would otherwise hammer the weather endpoint with unique coordinates.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
    retryCountRef.current = 0; // Reset retries on location change

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchWeather();
    }, 30000);

    const interval = setInterval(fetchWeather, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [location?.lat, location?.lon]); // Note: no tempUnit dependency

  // Convert raw API data to display data based on current tempUnit
  const data = convertWeatherData(rawData, tempUnit);

  return { data, loading, error };
};

export default useWeather;
