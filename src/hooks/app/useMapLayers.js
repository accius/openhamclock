import { useState, useEffect, useCallback } from 'react';
import { syncAllSettingsToServer } from '../../utils';

export default function useMapLayers() {
  const defaults = {
    showDeDxMarkers: true,
    showDXPaths: true,
    showDXLabels: true,
    showPOTA: false,
    showPOTALabels: false,
    showWWFF: false,
    showWWFFLabels: false,
    showSOTA: false,
    showSOTALabels: false,
    showWWBOTA: false,
    showWWBOTALabels: false,
    showSatellites: false,
    showPSKReporter: true,
    showPSKPaths: true,
    showWSJTX: true,
    showDXNews: true,
    showRotatorBearing: false,
    showAPRS: true,
    showMeshCom: true,
  };

  const [mapLayers, setMapLayers] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_mapLayers');
      if (!stored) return defaults;

      const parsed = JSON.parse(stored);

      // If parsed isn't a plain object, fall back safely
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return defaults;
      }

      // Merge, but keep defaults for any newly-added keys
      return { ...defaults, ...parsed };
    } catch (e) {
      return defaults;
    }
  });

  // Persist to localStorage + server when changed
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapLayers', JSON.stringify(mapLayers));
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('mapLayersChanged', { detail: mapLayers }));
    } catch {}

    // If your upstream uses this utility, keep it — it helps keep settings in sync.
    try {
      syncAllSettingsToServer({ mapLayers });
    } catch {}
  }, [mapLayers]);

  const toggleDXPaths = useCallback(() => setMapLayers((prev) => ({ ...prev, showDXPaths: !prev.showDXPaths })), []);
  const toggleDeDxMarkers = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showDeDxMarkers: !prev.showDeDxMarkers })),
    [],
  );
  const toggleDXLabels = useCallback(() => setMapLayers((prev) => ({ ...prev, showDXLabels: !prev.showDXLabels })), []);
  const togglePOTA = useCallback(() => setMapLayers((prev) => ({ ...prev, showPOTA: !prev.showPOTA })), []);
  const togglePOTALabels = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showPOTALabels: !prev.showPOTALabels })),
    [],
  );
  const toggleWWFF = useCallback(() => setMapLayers((prev) => ({ ...prev, showWWFF: !prev.showWWFF })), []);
  const toggleWWFFLabels = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showWWFFLabels: !prev.showWWFFLabels })),
    [],
  );
  const toggleSOTA = useCallback(() => setMapLayers((prev) => ({ ...prev, showSOTA: !prev.showSOTA })), []);
  const toggleSOTALabels = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showSOTALabels: !prev.showSOTALabels })),
    [],
  );
  const toggleWWBOTA = useCallback(() => setMapLayers((prev) => ({ ...prev, showWWBOTA: !prev.showWWBOTA })), []);
  const toggleWWBOTALabels = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showWWBOTALabels: !prev.showWWBOTALabels })),
    [],
  );
  const toggleSatellites = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showSatellites: !prev.showSatellites })),
    [],
  );
  const togglePSKReporter = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showPSKReporter: !prev.showPSKReporter })),
    [],
  );
  const togglePSKPaths = useCallback(() => setMapLayers((prev) => ({ ...prev, showPSKPaths: !prev.showPSKPaths })), []);
  const toggleWSJTX = useCallback(() => setMapLayers((prev) => ({ ...prev, showWSJTX: !prev.showWSJTX })), []);
  const toggleDXNews = useCallback(() => setMapLayers((prev) => ({ ...prev, showDXNews: !prev.showDXNews })), []);
  const toggleRotatorBearing = useCallback(
    () => setMapLayers((prev) => ({ ...prev, showRotatorBearing: !prev.showRotatorBearing })),
    [],
  );
  const toggleAPRS = useCallback(() => setMapLayers((prev) => ({ ...prev, showAPRS: !prev.showAPRS })), []);
  const toggleMeshCom = useCallback(() => setMapLayers((prev) => ({ ...prev, showMeshCom: !prev.showMeshCom })), []);

  return {
    mapLayers,
    setMapLayers,
    toggleDeDxMarkers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleDXNews,
    toggleRotatorBearing,
    toggleAPRS,
    toggleMeshCom,
  };
}
