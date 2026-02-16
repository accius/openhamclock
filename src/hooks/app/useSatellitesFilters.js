'use strict';

import { useState, useEffect, useMemo } from 'react';
import { syncAllSettingsToServer } from '../../utils';

export default function useSatellitesFilters(satellitesData) {
  const [satelliteFilters, setSatelliteFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_satelliteFilters');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_satelliteFilters', JSON.stringify(satelliteFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [satelliteFilters]);

  const filteredSatellites = useMemo(() => {
    // If no satellites are selected in the filter, show NONE (empty array)
    // Only show satellites that are explicitly selected
    return satelliteFilters.length > 0
      ? (satellitesData || []).filter(sat => satelliteFilters.includes(sat.name))
      : [];
  }, [satelliteFilters, satellitesData]);

  return {
    satelliteFilters,
    setSatelliteFilters,
    filteredSatellites
  };
}
