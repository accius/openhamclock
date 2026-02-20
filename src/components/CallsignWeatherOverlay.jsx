import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCallsignWeather } from '../utils/callsignWeather.js';

function degToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Very small “good enough” mapping. (We can expand later.)
function weatherCodeLabel(code) {
  if (code == null) return '—';
  if (code === 0) return 'Clear';
  if (code === 1 || code === 2) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Drizzle/Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Weather';
}

export function CallsignWeatherOverlay({ hoveredSpot, enabled, units = 'imperial' }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const lat =
    hoveredSpot?.dxLat ??
    hoveredSpot?.lat ??
    hoveredSpot?.latitude ??
    hoveredSpot?.spotLat ??
    hoveredSpot?.gridLat ??
    null;

  const lon =
    hoveredSpot?.dxLon ??
    hoveredSpot?.lon ??
    hoveredSpot?.lng ??
    hoveredSpot?.longitude ??
    hoveredSpot?.spotLon ??
    hoveredSpot?.gridLon ??
    null;

  useEffect(() => {
    // Always cancel any pending debounce when inputs change
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!enabled) {
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }

    if (lat == null || lon == null) {
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const w = await getCallsignWeather(lat, lon);
        if (!cancelled) setData(w);
      } catch (e) {
        if (!cancelled) {
          setErr(e?.message || 'Weather unavailable');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 550);

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [enabled, lat, lon]);

  const view = useMemo(() => {
    if (!data?.current) return null;

    const c = data.current;

    // Open-Meteo is metric by request: C, km/h, hPa
    let temp = c.temperature_2m;
    let wind = c.wind_speed_10m;
    const windDir = c.wind_direction_10m;

    if (units === 'imperial') {
      temp = (temp * 9) / 5 + 32;
      wind = wind * 0.621371; // km/h -> mph
    }

    const precipProb = data?.hourly?.precipitation_probability?.[0];

    return {
      temp,
      humidity: c.relative_humidity_2m,
      pressure: c.pressure_msl,
      wind,
      windDir,
      windCompass: degToCompass(windDir),
      code: c.weather_code,
      label: weatherCodeLabel(c.weather_code),
      precipProb,
    };
  }, [data, units]);

  if (!enabled) return null;
  if (!hoveredSpot) return null;

  // Only show when we have coords OR we’re currently loading for a coords hover.
  const hasCoords = lat != null && lon != null;
  if (!hasCoords && !loading) return null;

  const call = hoveredSpot?.call || hoveredSpot?.dxCall || 'DX';

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        width: 280,
        zIndex: 1200,
        background: 'rgba(0,0,0,0.82)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: 12,
        color: 'var(--text-primary)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontWeight: 900, letterSpacing: '0.04em' }}>🌦 {call}</div>
        {view?.greyline && (
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'var(--accent-amber)',
            }}
          >
            GREYLINE
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        {loading && 'Fetching weather…'}
        {!loading && err && `Weather unavailable (${err})`}
        {!loading && !err && view && view.label}
        {!loading && !err && !view && '—'}
      </div>

      {view && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>
              TEMP
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {Math.round(view.temp)}°{units === 'imperial' ? 'F' : 'C'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>
              WIND
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {Math.round(view.wind)} {units === 'imperial' ? 'mph' : 'km/h'} {view.windCompass}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>
              HUMIDITY
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{view.humidity}%</div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>
              PRESSURE
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{Math.round(view.pressure)} hPa</div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>
              PRECIP
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {view.precipProb != null ? `${Math.round(view.precipProb)}%` : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CallsignWeatherOverlay;
