/**
 * PluginLayer Component
 * Renders a single plugin layer using its hook, wrapped in an error boundary.
 *
 * Validates the Leaflet map instance before passing it to hooks.
 * A map whose container has been removed from the DOM (or whose panes
 * are gone after map.remove()) will cause getPane().appendChild errors.
 *
 * The error boundary catches crashes from both render and useEffect
 * phases so a single broken plugin never takes down the whole dashboard.
 */
import React, { useRef, useEffect } from 'react';

function isMapAlive(map) {
  if (!map) return false;
  try {
    // map._container is null after map.remove(); _panes is cleared too
    return !!(map._container && map._panes && map._panes.mapPane);
  } catch {
    return false;
  }
}

// Inner functional component that calls the hook
const PluginLayerInner = ({
  plugin,
  enabled,
  opacity,
  map,
  onDXChange,
  mapBandFilter,
  callsign,
  locator,
  deLat,
  deLon,
  lowMemoryMode,
  satellites,
  allUnits,
  config,
}) => {
  const layerFunc = plugin.useLayer || plugin.hook;
  const safeMap = isMapAlive(map) ? map : null;

  if (typeof layerFunc === 'function') {
    layerFunc({
      map: safeMap,
      enabled,
      opacity,
      onDXChange,
      callsign,
      locator,
      deLat,
      deLon,
      mapBandFilter,
      lowMemoryMode,
      satellites,
      allUnits,
      config,
    });
  }
  return null;
};

// Error boundary that catches render AND effect errors from plugin hooks.
// A crashed plugin is silently disabled rather than crashing the dashboard.
class PluginErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error(`[PluginLayer:${this.props.pluginId}] Crashed:`, error, info);
  }
  componentDidUpdate(prevProps) {
    // Reset the boundary when the map changes (projection switch) so the
    // plugin gets another chance with the new map instance.
    if (this.state.hasError && prevProps.map !== this.props.map) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export const PluginLayer = (props) => (
  <PluginErrorBoundary pluginId={props.plugin?.id} map={props.map}>
    <PluginLayerInner {...props} />
  </PluginErrorBoundary>
);

export default PluginLayer;
