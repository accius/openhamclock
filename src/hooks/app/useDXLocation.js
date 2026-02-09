'use strict';

import { useState, useEffect, useCallback } from 'react';

export default function useDXLocation(defaultDX) {
  const [dxLocation, setDxLocation] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocation');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.lat && parsed.lon) return parsed;
      }
    } catch (e) {}
    return defaultDX;
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxLocation', JSON.stringify(dxLocation));
    } catch (e) {}
  }, [dxLocation]);

  const [dxLocked, setDxLocked] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocked');
      return stored === 'true';
    } catch (e) {}
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxLocked', dxLocked.toString());
    } catch (e) {}
  }, [dxLocked]);

  const handleToggleDxLock = useCallback(() => {
    setDxLocked(prev => !prev);
  }, []);

  const handleDXChange = useCallback((coords) => {
    setDxLocation({ lat: coords.lat, lon: coords.lon });
  }, []);

  return {
    dxLocation,
    setDxLocation,
    dxLocked,
    handleToggleDxLock,
    handleDXChange
  };
}
