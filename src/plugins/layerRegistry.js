/**
 * Layer Plugin Registry
 *
 * Built-in plugins are imported statically below.
 * Local/custom plugins are auto-discovered from ./local/*.js via Vite's
 * import.meta.glob — no registration needed, and they survive git updates.
 */

import * as N3FJPLoggedQSOsPlugin from './layers/useN3FJPLoggedQSOs.js';
import * as WXRadarPlugin from './layers/useWXRadar.js';
import * as OWMCloudsPlugin from './layers/useOWMClouds.js';
import * as CityLightsPlugin from './layers/useCityLights.js';
import * as EarthquakesPlugin from './layers/useEarthquakes.js';
import * as WildfiresPlugin from './layers/useWildfires.js';
import * as FloodsPlugin from './layers/useFloods.js';
import * as TornadoWarningsPlugin from './layers/useTornadoWarnings.js';
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
import * as MeshtasticPlugin from './layers/useMeshtastic.js';
import * as ActiveUsersPlugin from './layers/useActiveUsers.js';
import * as IBPLayerPlugin from './layers/useIBPLayer.js';
import * as WinlinkGatewaysPlugin from './layers/useWinlinkGateways.js';

// Auto-discover local/custom plugins (gitignored — survive updates)
const localPluginModules = import.meta.glob('./local/*.js', { eager: true });
const localPlugins = Object.entries(localPluginModules)
  .map(([path, mod]) => {
    if (mod.metadata && mod.useLayer) return mod;
    console.warn(`[Plugins] Skipping ${path} — missing metadata or useLayer export`);
    return null;
  })
  .filter(Boolean);

if (localPlugins.length > 0) {
  console.log(
    `[Plugins] Loaded ${localPlugins.length} local plugin(s):`,
    localPlugins.map((p) => p.metadata.id).join(', '),
  );
}

const layerPlugins = [
  OWMCloudsPlugin,
  CityLightsPlugin,
  SatellitePlugin,
  WXRadarPlugin,
  EarthquakesPlugin,
  WildfiresPlugin,
  FloodsPlugin,
  TornadoWarningsPlugin,
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
  MeshtasticPlugin,
  ActiveUsersPlugin,
  IBPLayerPlugin,
  WinlinkGatewaysPlugin,
  ...localPlugins,
];

// Memoize the layer list - it never changes at runtime
let cachedLayers = null;

// Pinned keyboard shortcuts for layer toggling.
// Keys here won't reshuffle when layers are added/removed/renamed.
// Layers without a pinned shortcut get auto-assigned (first unique letter).
const PINNED_SHORTCUTS = {
  grayline: 'g',
  citylights: 'c',
  satellites: 's',
  wxradar: 'w',
  earthquakes: 'e',
  wildfires: 'f',
  lightning: 'l',
  aurora: 'a',
  rbn: 'r',
  'voacap-heatmap': 'v',
  'muf-map': 'm',
  'great-circle': 'd',
  'owm-clouds': 'o',
  'tornado-warnings': 't',
  contest_qsos: 'q',
  n3fjp_logged_qsos: 'n',
  wspr: 'p',
  floods: 'i',
  'active-users': 'u',
  'winlink-gateways': 'k',
};

export function getAllLayers() {
  if (cachedLayers) return cachedLayers;

  cachedLayers = layerPlugins
    .filter((plugin) => plugin.metadata && plugin.useLayer)
    .map((plugin) => ({
      id: plugin.metadata.id,
      name: plugin.metadata.name,
      description: plugin.metadata.description,
      icon: plugin.metadata.icon,
      defaultEnabled: plugin.metadata.defaultEnabled || false,
      defaultOpacity: plugin.metadata.defaultOpacity || 0.6,
      category: plugin.metadata.category || 'overlay',
      localOnly: plugin.metadata.localOnly || false,
      shortcut: PINNED_SHORTCUTS[plugin.metadata.id] || null,
      hook: plugin.useLayer,
    }));

  return cachedLayers;
}

export function getLayerById(layerId) {
  const layers = getAllLayers();
  return layers.find((layer) => layer.id === layerId) || null;
}
