/**
 * LocationPanel Component
 * Displays DE and DX location info with grid squares and sun times
 */
import React from 'react';
import {
  latLonToMaidenhead,
  calculateBearing,
  calculateDistance,
  formatDistance,
  getMoonPhase,
  getMoonPhaseEmoji,
} from '../utils/geo.js';
import { formatBearing, useBearingMode } from '../utils/bearing.js';

export const LocationPanel = ({
  config,
  dxLocation,
  deSunTimes,
  dxSunTimes,
  currentTime,
  dxLocked,
  onToggleDxLock,
}) => {
  const deGrid = latLonToMaidenhead({ lat: config.location.lat, lon: config.location.lon });
  const dxGrid = latLonToMaidenhead({ lat: dxLocation.lat, lon: dxLocation.lon });
  const bearing = calculateBearing(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon);
  const bearingMode = useBearingMode();
  const distance = calculateDistance(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon);
  const moonPhase = getMoonPhase(currentTime);
  const moonEmoji = getMoonPhaseEmoji(moonPhase);

  return (
    <div className="panel" style={{ padding: '12px' }}>
      <div className="panel-header">◎ LOCATIONS</div>

      {/* DE Location */}
      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '4px',
          }}
        >
          <span
            style={{
              color: 'var(--accent-amber)',
              fontWeight: '700',
              fontSize: '14px',
            }}
          >
            DE: {config.callsign}
          </span>
          <span
            style={{
              color: 'var(--accent-green)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
            }}
          >
            {deGrid}
          </span>
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {config.location.lat.toFixed(4)}°, {config.location.lon.toFixed(4)}°
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            marginTop: '4px',
          }}
        >
          ☀ {deSunTimes.sunrise} / {deSunTimes.sunset} UTC
        </div>
      </div>

      {/* DX Location */}
      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                color: 'var(--accent-blue)',
                fontWeight: '700',
                fontSize: '14px',
              }}
            >
              DX Target
            </span>
            {onToggleDxLock && (
              <button
                onClick={onToggleDxLock}
                title={dxLocked ? 'Unlock DX position (allow map clicks)' : 'Lock DX position (prevent map clicks)'}
                style={{
                  background: dxLocked ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                  color: dxLocked ? '#000' : 'var(--text-secondary)',
                  border: '1px solid ' + (dxLocked ? 'var(--accent-amber)' : 'var(--border-color)'),
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                {dxLocked ? '🔒' : '🔓'}
              </button>
            )}
          </div>
          <span
            style={{
              color: 'var(--accent-green)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
            }}
          >
            {dxGrid}
          </span>
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            marginTop: '4px',
          }}
        >
          ☀ {dxSunTimes.sunrise} / {dxSunTimes.sunset} UTC
        </div>
      </div>

      {/* Path Info */}
      <div
        style={{
          padding: '10px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>BEARING</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: '700',
                color: 'var(--accent-cyan)',
                fontFamily: 'Orbitron, monospace',
              }}
            >
              {formatBearing(bearing, config.location.lat, config.location.lon, bearingMode)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>DISTANCE</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: '700',
                color: 'var(--accent-cyan)',
                fontFamily: 'Orbitron, monospace',
              }}
            >
              {formatDistance(distance, config.allUnits.dist)}
            </div>
          </div>
        </div>
      </div>

      {/* Moon Phase */}
      <div
        style={{
          textAlign: 'center',
          padding: '8px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
        }}
      >
        <span style={{ fontSize: '20px', marginRight: '8px' }}>{moonEmoji}</span>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          {moonPhase < 0.25 ? 'Waxing' : moonPhase < 0.5 ? 'Waxing' : moonPhase < 0.75 ? 'Waning' : 'Waning'}{' '}
          {Math.round(moonPhase * 100)}%
        </span>
      </div>
    </div>
  );
};

export default LocationPanel;
