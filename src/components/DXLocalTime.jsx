'use strict';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatGmtUtc } from '../utils';

export function DXLocalTime({ currentTime, timezone, solarTimezone }) {
  const { t } = useTranslation();
  const [isLocal, setIsLocal] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_dxTimeDefault') === 'local';
    } catch (e) {}
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxTimeDefault', isLocal ? 'local' : 'utc');
    } catch (e) {}
  }, [isLocal]);

  // Prefer real IANA timezone; fall back to solar approximation.
  const effectiveTimezone = timezone ?? solarTimezone?.tz;
  const isFallback = timezone == null && solarTimezone?.tz != null;

  const label = isFallback
    ? isLocal
      ? t('app.dxTime.showUtcFallback', 'Show UTC time at DX location (approximate solar time)')
      : t('app.dxTime.showLocalFallback', 'Show approximate solar local time at DX location')
    : isLocal
      ? t('app.dxTime.showUtc', 'Show UTC time at DX location')
      : t('app.dxTime.showLocal', 'Show local time at DX location');

  if (!effectiveTimezone) return null;

  const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
  if (Number.isNaN(now.getTime())) return null;

  const utcTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(now);

  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: effectiveTimezone,
  }).format(now);

  const fTz = formatGmtUtc(effectiveTimezone);

  return (
    <div style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop: '2px' }}>
      {isLocal ? localTime : utcTime}{' '}
      <button
        type="button"
        onClick={() => setIsLocal((prev) => !prev)}
        aria-label={label}
        title={label}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          color: 'var(--text-muted)',
          fontSize: '11px',
          cursor: 'pointer',
          userSelect: 'none',
          fontFamily: 'inherit',
          lineHeight: 1,
        }}
      >
        ({isLocal ? fTz : 'UTC'}){isFallback ? <span style={{ color: 'var(--accent-amber)' }}> ⚠</span> : ''} ⇄
      </button>
    </div>
  );
}

export default DXLocalTime;
