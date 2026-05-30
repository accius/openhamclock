'use strict';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function DXLocalTime({ currentTime, timezone }) {
  const { t } = useTranslation();
  const [isLocal, setIsLocal] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_dxTimeDefault') === 'local';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxTimeDefault', isLocal ? 'local' : 'utc');
    } catch (e) {}
  }, [isLocal]);

  if (!timezone) return null;

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
    timeZone: timezone,
  }).format(now);

  return (
    <div style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop: '2px' }}>
      {isLocal ? localTime : utcTime}{' '}
      <span
        onClick={() => setIsLocal((prev) => !prev)}
        title={
          isLocal
            ? t('app.dxTime.showUtc', 'Show UTC time at DX location')
            : t('app.dxTime.showLocal', 'Show local time at DX location')
        }
        style={{ color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
      >
        ({isLocal ? timezone : 'UTC'}) ⇄
      </span>
    </div>
  );
}

export default DXLocalTime;
