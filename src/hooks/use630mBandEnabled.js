import { useCallback, useEffect, useState } from 'react';
import {
  BAND_630M_CHANGE_EVENT,
  BAND_630M_STORAGE_KEY,
  loadBand630mEnabled,
  saveBand630mEnabled,
} from '../utils/bandFeatureSettings.js';

export function use630mBandEnabled() {
  const [enabled, setEnabledState] = useState(() => loadBand630mEnabled());

  useEffect(() => {
    const sync = (event) => {
      const next = typeof event?.detail?.enabled === 'boolean' ? event.detail.enabled : loadBand630mEnabled();
      setEnabledState(next);
    };
    const onStorage = (event) => {
      if (event.key === BAND_630M_STORAGE_KEY) sync();
    };

    window.addEventListener(BAND_630M_CHANGE_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BAND_630M_CHANGE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setEnabled = useCallback((next) => {
    const value = saveBand630mEnabled(next);
    setEnabledState(value);
  }, []);

  return [enabled, setEnabled];
}
