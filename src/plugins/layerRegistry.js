/**
 * Layer Plugin Registry
 */

import * as N3FJPLoggedQSOsPlugin from './layers/useN3FJPLoggedQSOs.js';
import * as WXRadarPlugin from './layers/useWXRadar.js';
import * as OWMCloudsPlugin from './layers/useOWMClouds.js';
import * as CityLightsPlugin from './layers/useCityLights.js';
import * as EarthquakesPlugin from './layers/useEarthquakes.js';
import * as AuroraPlugin from './layers/useAurora.js';
import * as WSPRPlugin from './layers/useWSPR.js';
import * as GrayLinePlugin from './layers/useGrayLine.js';
import * as LightningPlugin from './layers/useLightning.js';
import * as RBNPlugin from './layers/useRBN.js';
import * as ContestQsosPlugin from './layers/useContestQsos.js';
import * as GreatCirclePlugin from './layers/useGreatCircle.js';
import * as VOACAPHeatmapPlugin from './layers/useVOACAPHeatmap.js';
import * as MUFMapPlugin from './layers/useMUFMap.js';
import * as SatellitePlugin from './layers/useSatelliteLayer.js';

const layerPlugins = [
  OWMCloudsPlugin,
  CityLightsPlugin,
  SatellitePlugin,
  WXRadarPlugin,
  EarthquakesPlugin,
  AuroraPlugin,
  WSPRPlugin,
  GrayLinePlugin,
  LightningPlugin,
  RBNPlugin,
  ContestQsosPlugin,
  N3FJPLoggedQSOsPlugin,
  GreatCirclePlugin,
  VOACAPHeatmapPlugin,
  MUFMapPlugin,
];

// Memoize the layer list - it never changes at runtime
let cachedLayers = null;

export function getAllLayers() {
  if (cachedLayers) return cachedLayers;
  
  cachedLayers = layerPlugins
    .filter(plugin => plugin.metadata && plugin.useLayer)
    .map(plugin => ({
      id: plugin.metadata.id,
      name: plugin.metadata.name,
      description: plugin.metadata.description,
      icon: plugin.metadata.icon,
      defaultEnabled: plugin.metadata.defaultEnabled || false,
      defaultOpacity: plugin.metadata.defaultOpacity || 0.6,
      category: plugin.metadata.category || 'overlay',
      localOnly: plugin.metadata.localOnly || false,
      hook: plugin.useLayer
    }));
  
  return cachedLayers;
}

export function getLayerById(layerId) {
  const layers = getAllLayers();
  return layers.find(layer => layer.id === layerId) || null;
}
