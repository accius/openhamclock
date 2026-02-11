'use strict';

import { useState, useEffect } from 'react';
import { syncAllSettingsToServer } from '../../utils';

export default function useFilters() {
  const [dxFilters, setDxFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
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
    } catch (e) { return {}; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_pskFilters', JSON.stringify(pskFilters));
      syncAllSettingsToServer();
    } catch (e) {}
  }, [pskFilters]);

  return {
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters
  };
}
