import React from 'react';
import { useTranslation } from 'react-i18next';
import { WeatherPanel } from '../components';

const DELocationPanel = ({ location, grid, sunTimes, tempUnit, onTempUnitChange, nodeId }) => {
  const { t } = useTranslation();

  return (
    <>
      <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>
        {t('app.dxLocation.deTitle')}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>{grid}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{location.lat.toFixed(4)}°, {location.lon.toFixed(4)}°</div>
        <div style={{ marginTop: '8px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
          <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{sunTimes.sunrise}</span>
          <span style={{ color: 'var(--text-secondary)' }}> → </span>
          <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{sunTimes.sunset}</span>
        </div>
      </div>
      <WeatherPanel
        location={location}
        tempUnit={tempUnit}
        onTempUnitChange={onTempUnitChange}
        nodeId={nodeId}
      />
    </>
  );
};

export default DELocationPanel;
