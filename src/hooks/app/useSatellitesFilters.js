'use strict';

import { useState, useEffect, useMemo } from 'react';

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
    } catch (e) {}
  }, [satelliteFilters]);

  const filteredSatellites = useMemo(() => {
    return satelliteFilters.length > 0
      ? (satellitesData || []).filter(sat => satelliteFilters.includes(sat.name))
      : satellitesData;
  }, [satelliteFilters, satellitesData]);

  return {
    satelliteFilters,
    setSatelliteFilters,
    filteredSatellites
  };
}
