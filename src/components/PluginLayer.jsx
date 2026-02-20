/**
 * PluginLayer Component
 * Renders a single plugin layer using its hook.
 */
import React from 'react';

export const PluginLayer = ({
  plugin,
  enabled,
  opacity,
  map,
  mapBandFilter,
  callsign,
  locator,
  lowMemoryMode,
  satellites,
  units,
  config,
}) => {
  const layerFunc = plugin.useLayer || plugin.hook;

  if (typeof layerFunc === 'function') {
    layerFunc({
      map,
      enabled,
      opacity,
      callsign,
      locator,
      mapBandFilter,
      lowMemoryMode,
      satellites,
      units,
      config,
    });
  }

  return null;
};

export default PluginLayer;
