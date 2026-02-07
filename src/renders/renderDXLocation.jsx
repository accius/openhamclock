import React from 'react';
import { useTranslation } from 'react-i18next';
import { WeatherPanel } from '../components';
import { calculateBearing, calculateDistance } from '../utils/geo.js';

const DXLocationPanel = ({
  deLocation, dxLocation, grid, sunTimes,
  dxLocked, onToggleDxLock,
  showWeather, tempUnit, onTempUnitChange, nodeId
}) => {
  const { t } = useTranslation();

  const sp = Math.round(calculateBearing(deLocation.lat, deLocation.lon, dxLocation.lat, dxLocation.lon));
  const lp = (sp + 180) % 360;
  const km = Math.round(calculateDistance(deLocation.lat, deLocation.lon, dxLocation.lat, dxLocation.lon));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700' }}>
          {t('app.dxLocation.dxTitle')}
        </div>
        {onToggleDxLock && (
          <button
            onClick={onToggleDxLock}
            title={dxLocked ? t('app.dxLock.unlockTooltip') : t('app.dxLock.lockTooltip')}
            style={{
              background: dxLocked ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
              color: dxLocked ? '#000' : 'var(--text-secondary)',
              border: '1px solid ' + (dxLocked ? 'var(--accent-amber)' : 'var(--border-color)'),
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            {dxLocked ? '🔒' : '🔓'}
          </button>
        )}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>{grid}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°</div>
          <div style={{ marginTop: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{sunTimes.sunrise}</span>
            <span style={{ color: 'var(--text-secondary)' }}> → </span>
            <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{sunTimes.sunset}</span>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', marginLeft: '12px', minWidth: '90px' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '4px' }}>{t('app.dxLocation.beamDir')}</div>
          <div style={{ fontSize: '13px', marginBottom: '3px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('app.dxLocation.sp')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{sp}°</span>
          </div>
          <div style={{ fontSize: '13px', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('app.dxLocation.lp')} </span>
            <span style={{ color: 'var(--accent-purple)', fontWeight: '700' }}>{lp}°</span>
          </div>
          <div style={{ fontSize: '13px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>📏 {km.toLocaleString()} km</span>
          </div>
        </div>
      </div>
      {showWeather && (
        <WeatherPanel
          location={dxLocation}
          tempUnit={tempUnit}
          onTempUnitChange={onTempUnitChange}
          nodeId={nodeId}
        />
      )}
    </>
  );
};

export default DXLocationPanel;
