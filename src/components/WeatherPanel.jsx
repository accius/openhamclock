/**
 * WeatherPanel Component
 * Displays current weather conditions with expandable forecast details.
 *
 * Can receive pre-fetched weather data via `weatherData` prop (from App-level
 * useWeather hook), or fetch its own data via `location` prop. Pre-fetched
 * data eliminates duplicate API calls when multiple components need the same
 * weather (e.g., DE panel + header both showing home station weather).
 *
 * Shows loading skeleton and error/retry states instead of disappearing
 * when weather API is rate-limited.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWeather } from '../hooks';
import { usePanelResize } from '../contexts';

export const WeatherPanel = ({
  location,
  tempUnit,
  onTempUnitChange,
  nodeId,
  weatherData, // Optional: pre-fetched { data, loading, error } from useWeather
}) => {
  const { t } = useTranslation();
  const [weatherExpanded, setWeatherExpanded] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_weatherExpanded') === 'true';
    } catch {
      return false;
    }
  });
  const contentRef = useRef(null);
  const prevExpandedRef = useRef(weatherExpanded);
  const { requestResize, resetSize } = usePanelResize(nodeId);

  // Only resize on expand/collapse transitions, not on every render
  useEffect(() => {
    if (!nodeId || !contentRef.current) return;

    const wasExpanded = prevExpandedRef.current;
    const isExpanded = weatherExpanded;
    prevExpandedRef.current = isExpanded;

    if (isExpanded && !wasExpanded) {
      const timer = setTimeout(() => {
        const el = contentRef.current;
        if (el) {
          let container = el.parentElement;
          while (container) {
            const style = window.getComputedStyle(container);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
            container = container.parentElement;
          }
          const height = container ? container.scrollHeight : el.scrollHeight;
          if (height > 0) requestResize(height);
        }
      }, 100);
      return () => clearTimeout(timer);
    } else if (!isExpanded && wasExpanded) {
      resetSize();
    }
  }, [weatherExpanded, nodeId, requestResize, resetSize]);

  // Use pre-fetched data if provided, otherwise fetch our own
  const ownWeather = useWeather(weatherData ? null : location, tempUnit);
  const weather = weatherData || ownWeather;

  const { data: w, loading, error } = weather;

  // --- Loading state ---
  if (loading && !w) {
    return (
      <div
        ref={contentRef}
        style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px', lineHeight: 1, opacity: 0.4 }}>🌡️</span>
          <span
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            Loading weather…
          </span>
          <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }`}</style>
        </div>
      </div>
    );
  }

  // Translate error messages from useWeather hook
  const getErrorMessage = (msg) => {
    switch (msg) {
      case 'Weather unavailable':
        return t('weather.error.unavailable');
      case 'Weather service busy':
        return t('weather.error.busy');
      case 'Weather loading...':
        return t('weather.error.loading');
      default:
        return msg;
    }
  };

  // --- Error state (no data at all) ---
  if (!w && error) {
    return (
      <div
        ref={contentRef}
        style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px', lineHeight: 1 }}>⚠️</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {getErrorMessage(error.message)}
            {error.retryIn ? t('weather.error.retry', { seconds: error.retryIn }) : ''}
          </span>
        </div>
      </div>
    );
  }

  // No data, no error, no loading — location probably not set
  if (!w) return null;

  const deg = `°${w.tempUnit || tempUnit}`;
  const wind = t(`weather.unit.${w.windUnit === 'km/h' ? 'kmh' : 'mph'}`);
  const vis = t(`weather.unit.${w.visUnit === 'km' ? 'km' : 'mi'}`);

  return (
    <div ref={contentRef} style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
      {/* Compact summary row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          onClick={() => {
            const next = !weatherExpanded;
            setWeatherExpanded(next);
            try {
              localStorage.setItem('openhamclock_weatherExpanded', next.toString());
            } catch {}
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            userSelect: 'none',
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: '20px', lineHeight: 1 }}>{w.icon}</span>
          <span
            style={{
              fontSize: '18px',
              fontWeight: '700',
              color: 'var(--text-primary)',
              fontFamily: 'Orbitron, monospace',
            }}
          >
            {w.temp}
            {deg}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t(`weather.condition.${w.weatherCode}`, { defaultValue: w.description })}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            💨{w.windSpeed}
          </span>
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              transform: weatherExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            ▼
          </span>
        </div>
        {/* F/C toggle */}
        {onTempUnitChange && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTempUnitChange(tempUnit === 'F' ? 'C' : 'F');
            }}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: '600',
              flexShrink: 0,
            }}
            title={t('weather.switchUnit', { unit: tempUnit === 'F' ? 'C' : 'F' })}
          >
            °{tempUnit === 'F' ? 'C' : 'F'}
          </button>
        )}
      </div>

      {/* Error badge — show when data is stale but we have cached data */}
      {error && w && (
        <div
          style={{
            fontSize: '9px',
            color: 'var(--accent-amber)',
            fontFamily: 'JetBrains Mono, monospace',
            marginTop: '4px',
            opacity: 0.7,
          }}
        >
          ⚠ {getErrorMessage(error.message)}
          {error.retryIn ? t('weather.error.retry', { seconds: error.retryIn }) : ''}
        </div>
      )}

      {/* Expanded details */}
      {weatherExpanded && (
        <div style={{ marginTop: '10px' }}>
          {/* Feels like + hi/lo */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              marginBottom: '8px',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {w.feelsLike !== w.temp && (
              <span style={{ color: 'var(--text-muted)' }}>
                {t('weather.feelsLike', { temp: `${w.feelsLike}${deg}` })}
              </span>
            )}
            {w.todayHigh != null && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                <span style={{ color: 'var(--accent-amber)' }}>▲{w.todayHigh}°</span>{' '}
                <span style={{ color: 'var(--accent-blue)' }}>▼{w.todayLow}°</span>
              </span>
            )}
          </div>

          {/* Detail grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 12px',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('weather.wind')}</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {t(`weather.wind.${w.windDir}`, { defaultValue: w.windDir })} {w.windSpeed} {wind}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('weather.humidity')}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{w.humidity}%</span>
            </div>
            {w.windGusts > w.windSpeed + 5 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('weather.gusts')}</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {w.windGusts} {wind}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('weather.dewPoint')}</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {w.dewPoint}
                {deg}
              </span>
            </div>
            {w.pressure && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('weather.pressure')}</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {w.pressure} {t('weather.hpa')}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('weather.clouds')}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{w.cloudCover}%</span>
            </div>
            {w.visibility && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('weather.visibility')}</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {w.visibility} {vis}
                </span>
              </div>
            )}
            {w.uvIndex > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('weather.uv')}</span>
                <span
                  style={{
                    color:
                      w.uvIndex >= 8
                        ? '#ef4444'
                        : w.uvIndex >= 6
                          ? '#f97316'
                          : w.uvIndex >= 3
                            ? '#eab308'
                            : 'var(--text-secondary)',
                  }}
                >
                  {w.uvIndex.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          {/* 3-Day Forecast */}
          {w.daily?.length > 0 && (
            <div
              style={{
                marginTop: '10px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '600' }}>
                {t('weather.forecast')}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {w.daily.map((day, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '6px 2px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '4px',
                      fontSize: '10px',
                    }}
                  >
                    <div style={{ color: 'var(--text-muted)', fontWeight: '600', marginBottom: '2px' }}>
                      {i === 0 ? t('weather.today') : day.date}
                    </div>
                    <div style={{ fontSize: '16px', lineHeight: 1.2 }}>{day.icon}</div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                      <span style={{ color: 'var(--accent-amber)' }}>{day.high}°</span>
                      <span style={{ color: 'var(--text-muted)' }}>/</span>
                      <span style={{ color: 'var(--accent-blue)' }}>{day.low}°</span>
                    </div>
                    {day.precipProb > 0 && (
                      <div style={{ color: 'var(--accent-blue)', fontSize: '9px', marginTop: '1px' }}>
                        💧{day.precipProb}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WeatherPanel;
