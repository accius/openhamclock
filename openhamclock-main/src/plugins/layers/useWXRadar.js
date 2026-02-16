import i18n from '../../lang/i18n';

import { useState, useEffect } from 'react';

export const metadata = {
  id: 'wxradar',
  name: i18n.t('plugins.layers.wxradar.name'),
  description: i18n.t('plugins.layers.wxradar.description'),
  icon: '☁️',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.6,
  version: '1.0.0'
};

export function useLayer({ enabled = false, opacity = 0.6, map = null }) {
  const [layerRef, setLayerRef] = useState(null);
  const [radarTimestamp, setRadarTimestamp] = useState(Date.now());

  const wmsConfig = {
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi',
    options: {
      layers: 'nexrad-n0r-900913',
      format: 'image/png',
      transparent: true,
      attribution: i18n.t('plugins.layers.wxradar.attribution'),
      opacity: opacity,
      zIndex: 200
    }
  };

  // Add/remove layer
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    if (enabled && !layerRef) {
      try {
        const layer = L.tileLayer.wms(wmsConfig.url, wmsConfig.options);
        layer.addTo(map);
        setLayerRef(layer);
      } catch (err) {
        console.error('WXRadar error:', err);
      }
    } else if (!enabled && layerRef) {
      map.removeLayer(layerRef);
      setLayerRef(null);
    }

    return () => {
      if (layerRef && map) {
        try {
          map.removeLayer(layerRef);
        } catch (e) {
          // Layer already removed
        }
      }
    };
  }, [enabled, map]);

  // Update opacity
  useEffect(() => {
    if (layerRef) {
      layerRef.setOpacity(opacity);
    }
  }, [opacity, layerRef]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setRadarTimestamp(Date.now());
    }, 120000);

    return () => clearInterval(interval);
  }, [enabled]);

  // Force refresh
  useEffect(() => {
    if (layerRef && enabled) {
      layerRef.setParams({ t: radarTimestamp }, false);
      layerRef.redraw();
    }
  }, [radarTimestamp, layerRef, enabled]);

  return {
    layer: layerRef,
    refresh: () => setRadarTimestamp(Date.now())
  };
}
