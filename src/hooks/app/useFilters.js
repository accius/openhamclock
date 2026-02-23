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

  // POTA Filters
  const [potaFilters, setPotaFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_potaFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_potaFilters', JSON.stringify(potaFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [potaFilters]);

  // SOTA Filters
  const [sotaFilters, setSotaFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_sotaFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_sotaFilters', JSON.stringify(sotaFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [sotaFilters]);

  // WWFF Filters
  const [wwffFilters, setWwffFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_wwffFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('openhamclock_wwffFilters', JSON.stringify(wwffFilters));
    syncAllSettingsToServer();
  }, [wwffFilters]);

  // WWBOTA Filters
  const [wwbotaFilters, setWwbotaFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_wwbotaFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('openhamclock_wwbotaFilters', JSON.stringify(wwbotaFilters));
    syncAllSettingsToServer();
  }, [wwffFilters]);

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
    potaFilters,
    sotaFilters,
    wwffFilters,
    wwbotaFilters,
    setPskFilters,
    setPotaFilters,
    setSotaFilters,
    setWwffFilters,
    setWwbotaFilters,
    mapBandFilter,
    setMapBandFilter,
  };
}
