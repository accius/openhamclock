/**
 * Layout Store - Manages dockable panel layout state
 * Uses flexlayout-react for panel resizing, docking, and tabs
 */

// Default layout configuration with individual dockable panels
export const DEFAULT_LAYOUT = {
  global: {
    tabEnableFloat: false,
    tabSetMinWidth: 200,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 6,
    tabEnableClose: true,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    tabSetEnableDrag: true,
    tabSetEnableTabStrip: true,
  },
  borders: [
    {
      type: 'border',
      location: 'left',
      id: 'left-border-tabset',
      children: [
        {
          type: 'tab',
          name: 'Layout',
          component: 'layout',
          id: 'layout-tab',
          enableClose: false,
        },
      ],
    },
  ],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 22,
        children: [
          {
            type: 'tabset',
            weight: 50,
            id: 'left-top-tabset',
            children: [
              { type: 'tab', name: 'DE Location', component: 'de-location', id: 'de-location-tab' },
              { type: 'tab', name: 'DX Target', component: 'dx-location', id: 'dx-location-tab' },
            ],
          },
          {
            type: 'tabset',
            weight: 50,
            id: 'left-bottom-tabset',
            children: [
              { type: 'tab', name: 'Solar', component: 'solar', id: 'solar-tab' },
              { type: 'tab', name: 'Propagation', component: 'propagation', id: 'propagation-tab' },
              { type: 'tab', name: 'Ambient', component: 'ambient', id: 'ambient-tab' },
              { type: 'tab', name: 'Band Health', component: 'band-health', id: 'band-health-tab' },
            ],
          },
        ],
      },
      {
        type: 'tabset',
        weight: 56,
        id: 'center-tabset',
        children: [{ type: 'tab', name: 'World Map', component: 'world-map', id: 'map-tab' }],
      },
      {
        type: 'row',
        weight: 22,
        children: [
          {
            type: 'tabset',
            weight: 60,
            id: 'right-top-tabset',
            children: [
              { type: 'tab', name: 'DX Cluster', component: 'dx-cluster', id: 'dx-cluster-tab' },
              { type: 'tab', name: 'PSK Reporter', component: 'psk-reporter', id: 'psk-reporter-tab' },
            ],
          },
          {
            type: 'tabset',
            weight: 40,
            id: 'right-bottom-tabset',
            children: [
              { type: 'tab', name: 'DXpeditions', component: 'dxpeditions', id: 'dxpeditions-tab' },
              { type: 'tab', name: 'POTA', component: 'pota', id: 'pota-tab' },
              { type: 'tab', name: 'SOTA', component: 'sota', id: 'sota-tab' },
              { type: 'tab', name: 'Contests', component: 'contests', id: 'contests-tab' },
            ],
          },
        ],
      },
    ],
  },
};

// Panel definitions for the panel picker
export const PANEL_DEFINITIONS = {
  'de-location': { name: 'DE Location', icon: '📍', description: 'Your station location and weather' },
  'dx-location': { name: 'DX Target', icon: '🎯', description: 'Target location for DXing' },
  solar: { name: 'Solar', icon: '☀️', description: 'Sunspot numbers and solar flux' },
  propagation: { name: 'Propagation', icon: '📡', description: 'Band conditions and forecasts' },
  ambient: { name: 'Ambient Weather', icon: '🌦️', description: 'AmbientWeather.net station data' },
  'band-health': { name: 'HF Band Health', icon: '📶', description: 'Observed band usability from DX cluster spots' },
  'dx-cluster': { name: 'DX Cluster', icon: '📻', description: 'Live DX spots from cluster' },
  'psk-reporter': { name: 'PSK Reporter', icon: '📡', description: 'Digital mode spots and WSJT-X' },
  dxpeditions: { name: 'DXpeditions', icon: '🏝️', description: 'Upcoming DXpeditions' },
  pota: { name: 'POTA', icon: '🏕️', description: 'Parks on the Air activators' },
  sota: { name: 'SOTA', icon: '⛰️', description: 'Summits on the Air activators' },
  wwbota: { name: 'WWBOTA', icon: '☢️', description: 'World Wide Bunker On The Air activators' },
  contests: { name: 'Contests', icon: '🏆', description: 'Upcoming and active contests' },
  'id-timer': { name: 'ID Timer', icon: '📢', description: '10-minute station identification reminder' },
  'world-map': { name: 'World Map', icon: '🗺️', description: 'Interactive world map' },
  'rig-control': { name: 'Rig Control', icon: '📻', description: 'Transceiver control and feedback' },
  'on-air': { name: 'On Air', icon: '🔴', description: 'Large TX status indicator' },
  layout: { name: 'Layout', icon: '📐', description: 'Layout controls' },
};

// Load layout from localStorage
export const loadLayout = () => {
  try {
    const stored = localStorage.getItem('openhamclock_dockLayout');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate basic structure
      if (parsed.global && parsed.layout && parsed.borders) {
        // Use of the Left Border in the dockable layout has been added
        // if the user does not have the defined border saved, add the default
        if (parsed.borders.length === 0) {
          parsed.borders = DEFAULT_LAYOUT.borders;
          saveLayout(parsed);
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load layout from localStorage:', e);
  }
  return DEFAULT_LAYOUT;
};

// Save layout to localStorage
export const saveLayout = (layout) => {
  try {
    localStorage.setItem('openhamclock_dockLayout', JSON.stringify(layout));
    // Lazy import to avoid circular dependency
    import('../utils/config.js').then((m) => m.syncAllSettingsToServer());
  } catch (e) {
    console.error('Failed to save layout:', e);
  }
};

// Reset layout to default
export const resetLayout = () => {
  try {
    localStorage.removeItem('openhamclock_dockLayout');
  } catch (e) {
    console.error('Failed to reset layout:', e);
  }
  return DEFAULT_LAYOUT;
};
