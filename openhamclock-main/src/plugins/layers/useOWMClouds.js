/**
 * OWM Clouds Layer for OpenHamClock Uses open Weather API
 * Added for USRadioguy.com - Real-time global cloud overlay
 */
// src/plugins/layers/OWMClouds.js
import React, { useEffect, useRef } from 'react';

export const metadata = {
  id: 'owm-clouds',
  name: 'Global Clouds (OWM)',
  description: 'Real-time global cloud overlay',
  icon: '☁️',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.5,
  localOnly: true
};

// The registry looks for this EXACT name: useLayer
export function useLayer({ enabled = false, opacity = 0.5, map = null }) {
  const layerRef = useRef(null);

  useEffect(() => {

    if (!map) return;

    if (enabled) {
      const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY || '';
      
      if (!layerRef.current) {
        layerRef.current = L.tileLayer(
          `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${apiKey}`,
          {
            opacity: opacity,
            zIndex: 1000,
            attribution: '© OpenWeatherMap'
          }
        );
        layerRef.current.addTo(map);
      } else {
        layerRef.current.setOpacity(opacity);
      }
    } else {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    }
  }, [map, enabled, opacity]);
}
