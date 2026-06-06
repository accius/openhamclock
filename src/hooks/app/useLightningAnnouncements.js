import { useState, useEffect, useRef } from 'react';

const THROTTLE_MS = 30000; // announce at most once per 30 seconds
const CLEARDOWN_MS = 10000; // clear announcement after 10 seconds

function preferredUnits() {
  try {
    const config = JSON.parse(localStorage.getItem('openhamclock_config') ?? '{}');
    return config.units?.dist === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export function useLightningAnnouncements() {
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedRef = useRef(0);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    function handleProximity(e) {
      const now = Date.now();
      if (now - lastAnnouncedRef.current < THROTTLE_MS) return;
      lastAnnouncedRef.current = now;

      const { distanceKm, distanceMiles, direction } = e.detail;
      const units = preferredUnits();
      const distStr = units === 'imperial' ? `${distanceMiles} miles` : `${distanceKm} kilometres`;

      setAnnouncement(`Lightning alert: strike ${distStr} ${direction}`);

      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setAnnouncement(''), CLEARDOWN_MS);
    }

    document.addEventListener('lightning:proximity', handleProximity);
    return () => {
      document.removeEventListener('lightning:proximity', handleProximity);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return { announcement };
}
