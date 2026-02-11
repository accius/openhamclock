/**
 * PluginLayer Component
 * Renders a single plugin layer using its hook.
 * All plugin hooks use the standard object-based signature: ({ map, enabled, opacity, ... })
 */
import React from 'react';

export const PluginLayer = ({ plugin, enabled, opacity, map, callsign, locator, lowMemoryMode }) => {
  
  const layerFunc = plugin.useLayer || plugin.hook;

  if (typeof layerFunc === 'function') {
    layerFunc({ map, enabled, opacity, callsign, locator, lowMemoryMode });
  }

  return null;
};

export default PluginLayer;
