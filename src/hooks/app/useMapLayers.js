'use strict';

import { useState, useEffect, useCallback } from 'react';

export default function useMapLayers() {
  const [mapLayers, setMapLayers] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_mapLayers');
      const defaults = { showDXPaths: true, showDXLabels: true, showPOTA: true, showSatellites: false, showPSKReporter: true, showWSJTX: true };
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch (e) {
      return { showDXPaths: true, showDXLabels: true, showPOTA: true, showSatellites: false, showPSKReporter: true, showWSJTX: true };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapLayers', JSON.stringify(mapLayers));
    } catch (e) {}
  }, [mapLayers]);

  const toggleDXPaths = useCallback(() => setMapLayers(prev => ({ ...prev, showDXPaths: !prev.showDXPaths })), []);
  const toggleDXLabels = useCallback(() => setMapLayers(prev => ({ ...prev, showDXLabels: !prev.showDXLabels })), []);
  const togglePOTA = useCallback(() => setMapLayers(prev => ({ ...prev, showPOTA: !prev.showPOTA })), []);
  const toggleSatellites = useCallback(() => setMapLayers(prev => ({ ...prev, showSatellites: !prev.showSatellites })), []);
  const togglePSKReporter = useCallback(() => setMapLayers(prev => ({ ...prev, showPSKReporter: !prev.showPSKReporter })), []);
  const toggleWSJTX = useCallback(() => setMapLayers(prev => ({ ...prev, showWSJTX: !prev.showWSJTX })), []);

  return {
    mapLayers,
    setMapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleSatellites,
    togglePSKReporter,
    toggleWSJTX
  };
}
