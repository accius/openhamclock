/**
 * Header Component
 * Top bar with callsign, clocks, weather, and controls
 */
import React from 'react';
import { IconGear, IconExpand, IconShrink } from './Icons.jsx';
import { QRZToggle } from './CallsignLink.jsx';
export const Header = ({
  config,
  utcTime,
  utcDate,
  localTime,
  localDate,
  localWeather,
  spaceWeather,
  solarIndices,
  bandConditions,
  use12Hour,
  onTimeFormatToggle,
  onSettingsClick,
  onUpdateClick,
  onFullscreenToggle,
  isFullscreen,
  updateInProgress,
  showUpdateButton
}) => {
  return (
    <div style={{
      gridColumn: '1 / -1',
      display: 'flex',
      flexWrap: 'nowrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      padding: '6px 12px',
      minHeight: '50px',
      fontFamily: 'JetBrains Mono, monospace',
      overflow: 'hidden'
    }}>
      {/* Callsign & Settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span
          style={{
            fontSize: config.headerSize > 0.1 && config.headerSize <= 2
              ? `${22 * config.headerSize}px`
              : "22px", fontWeight: '900', color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'Orbitron, monospace', whiteSpace: 'nowrap'
          }}
          onClick={onSettingsClick}
          title="Click for settings"
        >
          {config.callsign}
        </span>
        {config.version && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{config.version}</span>}
        {(() => {
          const touch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
          const narrow = typeof window !== 'undefined' && window.innerWidth <= 1024;
          if (touch && narrow) return <span className="ohc-mobile-badge">{window.innerWidth <= 768 ? '📱' : '📱 Tablet'}</span>;
          if (touch) return <span className="ohc-mobile-badge">👆 Touch</span>;
          return null;
        })()}
        <QRZToggle />
      </div>

      {/* UTC Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={{ fontSize: '13px', color: 'var(--accent-cyan)', fontWeight: '600' }}>UTC</span>
        <span style={{
          fontSize: config.headerSize > 0.1 && config.headerSize <= 2
              ? `${24 * config.headerSize}px`
              : "24px",
          fontWeight: '700',
          color: 'var(--accent-cyan)',
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          whiteSpace: 'nowrap'
        }}>{utcTime}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{utcDate}</span>
      </div>

      {/* Local Clock - Clickable to toggle 12/24 hour format */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 }}
        onClick={onTimeFormatToggle}
        title={`Click to switch to ${use12Hour ? '24-hour' : '12-hour'} format`}
      >
        <span style={{ fontSize: '13px', color: 'var(--accent-amber)', fontWeight: '600' }}>LOCAL</span>
        <span style={{
          fontSize: config.headerSize > 0.1 && config.headerSize <= 2
              ? `${24 * config.headerSize}px`
              : "24px",
          fontWeight: '700',
          color: 'var(--accent-amber)',
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          whiteSpace: 'nowrap'
        }}>{localTime}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{localDate}</span>
      </div>

      {/* Weather & Solar Stats */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '13px', fontFamily: 'JetBrains Mono, Consolas, monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {localWeather?.data && (() => {
          // Always compute both F and C from the raw Celsius source
          // This avoids ±1° rounding drift when toggling units
          const rawC = localWeather.data.rawTempC;
          const tempF = Math.round(rawC * 9 / 5 + 32);
          const tempC = Math.round(rawC);
          const windLabel = localWeather.data.windUnit || 'mph';
          return (
            <div title={`${localWeather.data.description} • Wind: ${localWeather.data.windSpeed} ${windLabel}`}>
              <span style={{ marginRight: '3px', 
                fontSize: config.headerSize > 0.1 && config.headerSize <= 2
                  ? `${12 * config.headerSize}px`
                  : "12px",
               }}>
                {localWeather.data.icon}
              </span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: '600',
                fontSize: config.headerSize > 0.1 && config.headerSize <= 2
                  ? `${12 * config.headerSize}px`
                  : "12px",
               }}>
                {tempF}°F/{tempC}°C
              </span>
            </div>
          );
        })()}
        <div>
          <span style={{ color: 'var(--text-muted)' }}>SFI </span>
          <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>{solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>K </span>
          <span style={{ color: parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '700' }}>
            {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>SSN </span>
          <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current || spaceWeather?.data?.sunspotNumber || '--'}</span>
        </div>
        {bandConditions?.extras?.aIndex && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>A </span>
            <span style={{ color: parseInt(bandConditions.extras.aIndex) >= 20 ? 'var(--accent-red)' : parseInt(bandConditions.extras.aIndex) >= 10 ? 'var(--accent-amber)' : 'var(--accent-green)', fontWeight: '700' }}>
              {bandConditions.extras.aIndex}
            </span>
          </div>
        )}
        {bandConditions?.extras?.geomagField && (
          <div>
            <span style={{ 
              fontSize: '10px',
              color: bandConditions.extras.geomagField === 'QUIET' ? 'var(--accent-green)' : 
                     bandConditions.extras.geomagField === 'ACTIVE' || bandConditions.extras.geomagField.includes('STORM') ? 'var(--accent-red)' : 
                     'var(--accent-amber)',
              fontWeight: '600'
            }}>
              {bandConditions.extras.geomagField}
            </span>
          </div>
        )}
      </div>

      {/* Settings & Fullscreen Buttons */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {!isFullscreen && (
          <>
            <a
              href="https://buymeacoffee.com/k0cjh"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'linear-gradient(135deg, #ff813f 0%, #ffdd00 100%)',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '4px',
                color: '#000',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap'
              }}
              title="Buy me a coffee!"
            >
              ☕ Donate
            </a>
            <a
              href="https://www.paypal.com/donate/?hosted_button_id=MMYPQBLA6SW68"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap'
              }}
              title="Donate via PayPal"
            >
              💳 PayPal
            </a>
          </>
        )}
        {showUpdateButton && (
          <button
            onClick={onUpdateClick}
            disabled={updateInProgress}
            style={{
              background: updateInProgress ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-tertiary)',
              border: `1px solid ${updateInProgress ? 'var(--accent-green)' : 'var(--border-color)'}`,
              padding: '6px 10px',
              borderRadius: '4px',
              color: updateInProgress ? 'var(--accent-green)' : 'var(--text-secondary)',
              fontSize: '12px',
              cursor: updateInProgress ? 'wait' : 'pointer',
              whiteSpace: 'nowrap'
            }}
            title="Run update now (server will restart)"
          >
            {updateInProgress ? 'UPDATING...' : 'UPDATE'}
          </button>
        )}
        <button
          onClick={onSettingsClick}
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            padding: '6px 10px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          <IconGear size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Settings
        </button>
        <button
          onClick={onFullscreenToggle}
          style={{
            background: isFullscreen ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-tertiary)',
            border: `1px solid ${isFullscreen ? 'var(--accent-green)' : 'var(--border-color)'}`,
            padding: '6px 10px',
            borderRadius: '4px',
            color: isFullscreen ? 'var(--accent-green)' : 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
          title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"}
        >
          {isFullscreen
            ? <><IconShrink size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Exit</>
            : <><IconExpand size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Full</>
          }
        </button>
      </div>
    </div>
  );
};

export default Header;
