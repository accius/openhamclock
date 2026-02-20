'use strict';

import { useState, useEffect } from 'react';
import { syncAllSettingsToServer } from '../../utils';

export default function useFilters() {
  const [dxFilters, setDxFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxFilters', JSON.stringify(dxFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [dxFilters]);

  const [pskFilters, setPskFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_pskFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_pskFilters', JSON.stringify(pskFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [pskFilters]);

  const [mapBandFilter, setMapBandFilter] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_mapBandFilter');
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapBandFilter', JSON.stringify(mapBandFilter));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [mapBandFilter]);

  return {
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters,
    mapBandFilter,
    setMapBandFilter,
  };
}
