/**
 * NASA VIIRS City Lights Plugin
 */
import { useEffect, useRef } from 'react';

export const metadata = {
  id: 'citylights',
  name: 'City Lights (Night)',
  description: 'NASA VIIRS City Lights visualization for nighttime areas',
  icon: '🗺️',
  category: 'overlay',
  defaultEnabled: true,
  defaultOpacity: 0.8,
};

export const useLayer = ({ map, enabled, opacity }) => {
  const layerRef = useRef(null);
  const nightUrl = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-03-12/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';

  useEffect(() => {
    if (!map) return;

    const L = window.L;
    
    // Create the layer if it doesn't exist
    if (!layerRef.current) {
      layerRef.current = L.tileLayer(nightUrl, {
        attribution: 'NASA GIBS',
        noWrap: false,
        pane: 'nightPane', // Ensure it still uses the blended pane
        zIndex: 1
      });
    }

    if (enabled) {
      layerRef.current.addTo(map);
      layerRef.current.setOpacity(opacity);
    } else {
      layerRef.current.remove();
    }

    return () => {
      if (layerRef.current) layerRef.current.remove();
    };
  }, [map, enabled]);

  // Update opacity dynamically without re-adding layer
  useEffect(() => {
    if (layerRef.current && enabled) {
      layerRef.current.setOpacity(opacity);
    }
  }, [opacity, enabled]);
};