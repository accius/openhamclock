/**
 * Header Component
 * Top bar with callsign, clocks, weather, and controls.
 * Responsive: wraps gracefully on tablet, collapses to essentials on mobile.
 */
import React from 'react';
import { IconGear, IconExpand, IconShrink } from './Icons.jsx';
import { QRZToggle } from './CallsignLink.jsx';
import { ctyLookup, isCtyLoaded } from '../utils/ctyLookup';
import { getFlagForEntity } from '../utils/countryFlags';

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
  showUpdateButton,
  breakpoint = 'desktop',
}) => {
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';

  const callsignSize =
    config.headerSize > 0.1 && config.headerSize <= 2
      ? `${(isMobile ? 16 : 22) * config.headerSize}px`
      : isMobile
        ? '16px'
        : '22px';
  const clockSize =
    config.headerSize > 0.1 && config.headerSize <= 2
      ? `${(isMobile ? 16 : 24) * config.headerSize}px`
      : isMobile
        ? '16px'
        : '24px';

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: isMobile ? 'center' : 'space-between',
        gap: isMobile ? '4px 8px' : '6px 12px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: isMobile ? '4px 6px' : '6px 12px',
        minHeight: isMobile ? '38px' : '46px',
        fontFamily: 'JetBrains Mono, monospace',
        boxSizing: 'border-box',
      }}
    >
      {/* Callsign */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '4px' : '12px', flexShrink: 0 }}>
        <span
          style={{
            fontSize: callsignSize,
            fontWeight: '900',
            color: 'var(--accent-amber)',
            cursor: 'pointer',
            fontFamily: 'Orbitron, monospace',
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
          onClick={onSettingsClick}
          title="Click for settings"
        >
          {config.callsign}
        </span>
        {(() => {
          const info = isCtyLoaded() ? ctyLookup(config.callsign) : null;
          const flag = info ? getFlagForEntity(info.entity) : null;
          return flag ? (
            <span style={{ fontSize: callsignSize }} title={info.entity}>
              {flag}
            </span>
          ) : null;
        })()}
        {config.version && !isMobile && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{config.version}</span>
        )}
        {!isMobile && <QRZToggle />}
      </div>

      {/* UTC Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        <span style={{ fontSize: isMobile ? '10px' : '13px', color: 'var(--accent-cyan)', fontWeight: '600' }}>
          UTC
        </span>
        <span
          style={{
            fontSize: clockSize,
            fontWeight: '700',
            color: 'var(--accent-cyan)',
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
        >
          {utcTime}
        </span>
        {!isMobile && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{utcDate}</span>
        )}
      </div>

      {/* Local Clock */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0 }}
        onClick={onTimeFormatToggle}
        title={`Click to switch to ${use12Hour ? '24-hour' : '12-hour'} format`}
      >
        <span style={{ fontSize: isMobile ? '10px' : '13px', color: 'var(--accent-amber)', fontWeight: '600' }}>
          LOCAL
        </span>
        <span
          style={{
            fontSize: clockSize,
            fontWeight: '700',
            color: 'var(--accent-amber)',
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
        >
          {localTime}
        </span>
        {!isMobile && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{localDate}</span>
        )}
      </div>

      {/* Weather & Solar Stats — hidden on mobile */}
      {!isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isTablet ? '6px' : '12px',
            fontSize: isTablet ? '11px' : '13px',
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            whiteSpace: 'nowrap',
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {localWeather?.data &&
            (() => {
              const rawC = localWeather.data.rawTempC;
              return (
                <div
                  title={`${localWeather.data.description} • Wind: ${localWeather.data.windSpeed} ${localWeather.data.windUnit || 'mph'}`}
                >
                  <span style={{ marginRight: '3px' }}>{localWeather.data.icon}</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>
                    {Math.round((rawC * 9) / 5 + 32)}°F/{Math.round(rawC)}°C
                  </span>
                </div>
              );
            })()}
          <div>
            <span style={{ color: 'var(--text-muted)' }}>SFI </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>
              {solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>K </span>
            <span
              style={{
                color:
                  parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4
                    ? 'var(--accent-red)'
                    : 'var(--accent-green)',
                fontWeight: '700',
              }}
            >
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>SSN </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
              {solarIndices?.data?.ssn?.current || spaceWeather?.data?.sunspotNumber || '--'}
            </span>
          </div>
          {!isTablet && bandConditions?.extras?.aIndex && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>A </span>
              <span
                style={{
                  color:
                    parseInt(bandConditions.extras.aIndex) >= 20
                      ? 'var(--accent-red)'
                      : parseInt(bandConditions.extras.aIndex) >= 10
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.aIndex}
              </span>
            </div>
          )}
          {!isTablet && bandConditions?.extras?.geomagField && (
            <div>
              <span
                style={{
                  fontSize: '10px',
                  color:
                    bandConditions.extras.geomagField === 'QUIET'
                      ? 'var(--accent-green)'
                      : bandConditions.extras.geomagField === 'ACTIVE' ||
                          bandConditions.extras.geomagField.includes('STORM')
                        ? 'var(--accent-red)'
                        : 'var(--accent-amber)',
                  fontWeight: '600',
                }}
              >
                {bandConditions.extras.geomagField}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '4px' : '6px', flexShrink: 0 }}>
        {!isFullscreen && !isMobile && (
          <>
            <a
              href="https://buymeacoffee.com/k0cjh"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'linear-gradient(135deg, #ff813f 0%, #ffdd00 100%)',
                border: 'none',
                padding: isTablet ? '4px 6px' : '6px 10px',
                borderRadius: '4px',
                color: '#000',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap',
              }}
              title="Buy me a coffee!"
            >
              ☕{isTablet ? '' : ' Donate'}
            </a>
            <a
              href="https://www.paypal.com/donate/?hosted_button_id=MMYPQBLA6SW68"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                border: 'none',
                padding: isTablet ? '4px 6px' : '6px 10px',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap',
              }}
              title="Donate via PayPal"
            >
              💳{isTablet ? '' : ' PayPal'}
            </a>
          </>
        )}
        {showUpdateButton && !isMobile && (
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
              whiteSpace: 'nowrap',
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
            padding: isMobile ? '4px 8px' : '6px 10px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <IconGear size={12} style={{ verticalAlign: 'middle', marginRight: isMobile ? 0 : '4px' }} />
          {!isMobile && 'Settings'}
        </button>
        <button
          onClick={onFullscreenToggle}
          style={{
            background: isFullscreen ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-tertiary)',
            border: `1px solid ${isFullscreen ? 'var(--accent-green)' : 'var(--border-color)'}`,
            padding: isMobile ? '4px 8px' : '6px 10px',
            borderRadius: '4px',
            color: isFullscreen ? 'var(--accent-green)' : 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Enter Fullscreen'}
        >
          {isFullscreen ? <IconShrink size={12} /> : <IconExpand size={12} />}
          {!isMobile && (isFullscreen ? ' Exit' : ' Full')}
        </button>
      </div>
    </div>
  );
};

export default Header;
