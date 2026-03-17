/**
 * Header Component
 * Top bar with callsign, clocks, weather, and controls.
 * Responsive: wraps gracefully on tablet, collapses to essentials on mobile.
 */
import { IconGear, IconExpand, IconShrink } from './Icons.jsx';
import DonateButton from './DonateButton.jsx';
import { QRZToggle } from './CallsignLink.jsx';
import { ctyLookup, isCtyLoaded } from '../utils/ctyLookup';
import { getFlagUrl } from '../utils/countryFlags';

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

  const scale = config.headerSize > 0 && config.headerSize <= 10 ? config.headerSize : 1;
  const callsignSize = `${(isMobile ? 16 : 22) * scale}px`;
  const clockSize = `${(isMobile ? 16 : 24) * scale}px`;
  const statsSize = `${(isMobile ? 10 : 13) * scale}px`;
  const labelSize = `${(isMobile ? 10 : 13) * scale}px`;

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
          const flagUrl = info ? getFlagUrl(info.entity) : null;
          return flagUrl ? (
            <img
              src={flagUrl}
              alt={info.entity}
              title={info.entity}
              style={{
                height: '1em',
                verticalAlign: 'middle',
                borderRadius: '2px',
                objectFit: 'contain',
              }}
              crossOrigin="anonymous"
              loading="eager"
            />
          ) : null;
        })()}
        {config.version && !isMobile && (
          <span
            onClick={() => window.dispatchEvent(new Event('openhamclock-show-whatsnew'))}
            style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}
            title="What's new in this version"
          >
            v{config.version}
          </span>
        )}
        {!isMobile && <QRZToggle />}
      </div>

      {/* UTC Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        <span style={{ fontSize: labelSize, color: 'var(--accent-cyan)', fontWeight: '600' }}>UTC</span>
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
          <span style={{ fontSize: `${12 * scale}px`, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {utcDate}
          </span>
        )}
      </div>

      {/* Local Clock */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0 }}
        onClick={onTimeFormatToggle}
        title={`Click to switch to ${use12Hour ? '24-hour' : '12-hour'} format`}
      >
        <span style={{ fontSize: labelSize, color: 'var(--accent-amber)', fontWeight: '600' }}>LOCAL</span>
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
          <span style={{ fontSize: `${12 * scale}px`, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {localDate}
          </span>
        )}
      </div>

      {/* Weather & Solar Stats — hidden on mobile */}
      {!isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isTablet ? '6px' : '12px',
            fontSize: statsSize,
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
              {solarIndices?.data?.ssn?.current ?? spaceWeather?.data?.sunspotNumber ?? '--'}
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
          {!isTablet && bandConditions?.extras?.solarWind && (
            <div title="Solar Wind Speed">
              <span style={{ color: 'var(--text-muted)' }}>SW </span>
              <span
                style={{
                  color:
                    parseFloat(bandConditions.extras.solarWind) >= 700
                      ? 'var(--accent-red)'
                      : parseFloat(bandConditions.extras.solarWind) >= 500
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.solarWind}
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

      {/* Buttons — only on mobile (desktop/tablet uses sidebar) */}
      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={onSettingsClick}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              padding: '4px 8px',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <IconGear size={12} />
          </button>
          <button
            onClick={onFullscreenToggle}
            style={{
              background: isFullscreen ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-tertiary)',
              border: `1px solid ${isFullscreen ? 'var(--accent-green)' : 'var(--border-color)'}`,
              padding: '4px 8px',
              borderRadius: '4px',
              color: isFullscreen ? 'var(--accent-green)' : 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <IconShrink size={12} /> : <IconExpand size={12} />}
          </button>
        </div>
      )}
    </div>
  );
};

export default Header;
