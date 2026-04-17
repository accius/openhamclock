'use strict';

import { useState, useEffect, useCallback, useRef } from 'react';
import { syncAllSettingsToServer } from '../../utils';

export default function useDXLocation(defaultDX) {
  const [dxLocation, setDxLocation] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocation');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.lat != null && parsed.lon != null) return parsed;
      }
    } catch (e) {}
    return defaultDX;
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxLocation', JSON.stringify(dxLocation));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [dxLocation]);

  const [dxLocked, setDxLocked] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocked');
      return stored === 'true';
    } catch (e) {}
    return false;
  });

  const [dxCallsign, setDxCallsign] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_dxCallsign') || null;
    } catch (e) {}
    return null;
  });

  const dxLockedRef = useRef(dxLocked);

  useEffect(() => {
    dxLockedRef.current = dxLocked;
    try {
      localStorage.setItem('openhamclock_dxLocked', dxLocked.toString());
      syncAllSettingsToServer();
    } catch (e) {}
  }, [dxLocked]);

  useEffect(() => {
    try {
      if (dxCallsign != null) {
        localStorage.setItem('openhamclock_dxCallsign', dxCallsign);
      } else {
        localStorage.removeItem('openhamclock_dxCallsign');
      }
    } catch (e) {}
  }, [dxCallsign]);

  const handleToggleDxLock = useCallback(() => {
    setDxLocked((prev) => !prev);
  }, []);

  const handleDXChange = useCallback((coords) => {
    if (!dxLockedRef.current) {
      setDxLocation({ lat: coords.lat, lon: coords.lon });
      // Callsign is only set when a spot is clicked; manual grid entry clears it
      setDxCallsign(coords.callsign !== undefined ? (coords.callsign ?? null) : null);
    }
  }, []);

  return {
    dxLocation,
    setDxLocation,
    dxCallsign,
    setDxCallsign,
    dxLocked,
    handleToggleDxLock,
    handleDXChange,
  };
}
