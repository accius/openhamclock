# OpenHamClock Map Layer Plugin System

**Complete Developer Guide**

Version 1.0.0 | February 2, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Creating Your First Plugin](#creating-your-first-plugin)
5. [Plugin Types & Examples](#plugin-types--examples)
6. [Best Practices](#best-practices)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)
9. [Advanced Features](#advanced-features)
10. [API Reference](#api-reference)

---

## Overview

The OpenHamClock plugin system allows developers to easily add custom map layers without modifying core application code. Plugins are self-contained modules that handle their own data fetching, rendering, and lifecycle management.

### Key Features

- ✅ **Zero Core Modification** - Add layers without touching WorldMap.jsx
- ✅ **Hot Reload** - Changes appear immediately during development
- ✅ **Persistent Settings** - User preferences saved in localStorage
- ✅ **React Hooks Based** - Modern, clean API
- ✅ **Full Leaflet Access** - Direct access to map instance
- ✅ **Category Organization** - Group related plugins
- ✅ **Opacity Control** - Built-in transparency slider
- ✅ **Enable/Disable Toggle** - Easy on/off switching

---

## Architecture

### System Components

```
src/plugins/
├── layerRegistry.js          # Central plugin registration
├── layers/                   # Individual plugin implementations
│   ├── useWXRadar.js        # Weather radar example
│   ├── useEarthquakes.js    # Earthquake data example
│   └── useYourPlugin.js     # Your custom plugin
├── README.md                 # Documentation
└── QUICKSTART.md            # Quick reference guide

src/components/
├── WorldMap.jsx              # Minimal plugin integration (3 additions)
├── PluginLayer.jsx          # React wrapper for plugin hooks
└── SettingsPanel.jsx        # UI controls for plugins
```

### Data Flow

```
User toggles layer in Settings
         ↓
Settings updates localStorage
         ↓
WorldMap reads localStorage → updates pluginLayerStates
         ↓
PluginLayer component renders with new state
         ↓
Plugin's useLayer hook called with {enabled, opacity, map}
         ↓
Plugin adds/removes/updates Leaflet layers on map
```

### Integration Points

**WorldMap.jsx** (3 small additions):
1. Import `getAllLayers` from registry
2. Add `pluginLayersRef` and `pluginLayerStates` state
3. Render `<PluginLayer>` components in JSX

**No other core files modified!**

---

## Quick Start

### 5-Minute Plugin Creation

#### Step 1: Create Plugin File

Create `src/plugins/layers/useMyLayer.js`:

```javascript
import { useState, useEffect } from 'react';

export const metadata = {
  id: 'mylayer',
  name: 'My Custom Layer',
  description: 'Brief description of what this layer shows',
  icon: '🎨',
  category: 'custom',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0'
};

export function useLayer({ enabled, opacity, map }) {
  const [layerRef, setLayerRef] = useState(null);

  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    if (enabled && !layerRef) {
      // Add your layer
      const layer = L.tileLayer('https://example.com/{z}/{x}/{y}.png', {
        opacity: opacity
      });
      layer.addTo(map);
      setLayerRef(layer);
    } else if (!enabled && layerRef) {
      // Remove layer
      map.removeLayer(layerRef);
      setLayerRef(null);
    } else if (layerRef) {
      // Update opacity
      layerRef.setOpacity(opacity);
    }

    return () => {
      if (layerRef) map.removeLayer(layerRef);
    };
  }, [enabled, opacity, map]);

  return { layer: layerRef };
}
```

#### Step 2: Register Plugin

Edit `src/plugins/layerRegistry.js`:

```javascript
import * as MyLayerPlugin from './layers/useMyLayer.js';

const layerPlugins = [
  WXRadarPlugin,
  EarthquakesPlugin,
  MyLayerPlugin,  // ← Add your plugin here
];
```

#### Step 3: Test

```bash
npm run dev
```

Open **Settings → Map Layers** and toggle your layer!

---

## Creating Your First Plugin

### Complete Example: Lightning Strikes

Let's build a plugin that shows recent lightning strikes:

```javascript
/**
 * Lightning Strikes Plugin
 * Shows real-time lightning strike data
 */
import { useState, useEffect } from 'react';

export const metadata = {
  id: 'lightning',
  name: 'Lightning Strikes',
  description: 'Real-time lightning detection (last 30 minutes)',
  icon: '⚡',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.8,
  version: '1.0.0'
};

export function useLayer({ enabled = false, opacity = 0.8, map = null }) {
  const [markers, setMarkers] = useState([]);
  const [strikes, setStrikes] = useState([]);

  // Fetch lightning data
  useEffect(() => {
    if (!enabled) return;

    const fetchStrikes = async () => {
      try {
        const response = await fetch(
          'https://api.example.com/lightning?minutes=30'
        );
        const data = await response.json();
        setStrikes(data.strikes || []);
      } catch (err) {
        console.error('Lightning data error:', err);
      }
    };

    fetchStrikes();
    
    // Refresh every 1 minute
    const interval = setInterval(fetchStrikes, 60000);
    return () => clearInterval(interval);
  }, [enabled]);

  // Render markers
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    markers.forEach(m => {
      try {
        map.removeLayer(m);
      } catch (e) {
        // Already removed
      }
    });
    setMarkers([]);

    if (!enabled || strikes.length === 0) return;

    const newMarkers = [];

    strikes.forEach(strike => {
      // Create marker
      const marker = L.circleMarker([strike.lat, strike.lon], {
        radius: 6,
        fillColor: '#ffff00',
        color: '#ff6600',
        weight: 2,
        fillOpacity: opacity,
        opacity: opacity
      });

      // Add popup
      const time = new Date(strike.timestamp);
      marker.bindPopup(`
        <b>⚡ Lightning Strike</b><br>
        Time: ${time.toLocaleTimeString()}<br>
        Intensity: ${strike.intensity} kA
      `);

      marker.addTo(map);
      newMarkers.push(marker);
    });

    setMarkers(newMarkers);

    return () => {
      newMarkers.forEach(m => {
        try {
          map.removeLayer(m);
        } catch (e) {
          // Already removed
        }
      });
    };
  }, [enabled, strikes, map, opacity]);

  return {
    markers,
    strikeCount: strikes.length
  };
}
```

### What's Happening?

1. **Metadata Export** - Defines plugin properties for UI
2. **useLayer Hook** - Main logic, receives {enabled, opacity, map}
3. **Data Fetching** - useEffect fetches when enabled, refreshes periodically
4. **Rendering** - useEffect adds/removes markers based on state
5. **Cleanup** - Return functions remove layers when unmounting

---

## Plugin Types & Examples

### Type 1: Tile Layer (Raster Overlay)

**Use for:** Weather radar, satellite imagery, heat maps

```javascript
export function useLayer({ enabled, opacity, map }) {
  const [layerRef, setLayerRef] = useState(null);

  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    if (enabled && !layerRef) {
      // WMS tile layer
      const layer = L.tileLayer.wms(
        'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi',
        {
          layers: 'nexrad-n0r-900913',
          format: 'image/png',
          transparent: true,
          opacity: opacity,
          zIndex: 200,
          attribution: '© Data Provider'
        }
      );
      layer.addTo(map);
      setLayerRef(layer);
    } else if (!enabled && layerRef) {
      map.removeLayer(layerRef);
      setLayerRef(null);
    } else if (layerRef) {
      layerRef.setOpacity(opacity);
    }

    return () => {
      if (layerRef && map) {
        try {
          map.removeLayer(layerRef);
        } catch (e) {}
      }
    };
  }, [enabled, opacity, map]);

  return { layer: layerRef };
}
```

### Type 2: Marker Layer (Point Data)

**Use for:** Earthquakes, stations, events, POIs

```javascript
export function useLayer({ enabled, opacity, map }) {
  const [markers, setMarkers] = useState([]);
  const [data, setData] = useState([]);

  // Fetch data
  useEffect(() => {
    if (!enabled) return;

    const fetchData = async () => {
      try {
        const response = await fetch('https://api.example.com/points');
        const json = await response.json();
        setData(json.features || []);
      } catch (err) {
        console.error('Fetch error:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000); // 5 min
    return () => clearInterval(interval);
  }, [enabled]);

  // Render markers
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old
    markers.forEach(m => map.removeLayer(m));
    setMarkers([]);

    if (!enabled || data.length === 0) return;

    const newMarkers = [];

    data.forEach(point => {
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 8,
        fillColor: point.color || '#ff0000',
        color: '#fff',
        weight: 2,
        fillOpacity: opacity,
        opacity: opacity
      });

      marker.bindPopup(`
        <b>${point.name}</b><br>
        ${point.description}
      `);

      marker.addTo(map);
      newMarkers.push(marker);
    });

    setMarkers(newMarkers);

    return () => {
      newMarkers.forEach(m => map.removeLayer(m));
    };
  }, [enabled, data, map, opacity]);

  return { markers, count: data.length };
}
```

### Type 3: Vector Layer (Lines/Polygons)

**Use for:** Boundaries, routes, zones, areas

```javascript
export function useLayer({ enabled, opacity, map }) {
  const [layerRef, setLayerRef] = useState(null);
  const [geoData, setGeoData] = useState(null);

  // Fetch GeoJSON
  useEffect(() => {
    if (!enabled) return;

    fetch('https://api.example.com/boundaries.geojson')
      .then(r => r.json())
      .then(setGeoData);
  }, [enabled]);

  // Render GeoJSON
  useEffect(() => {
    if (!map || typeof L === 'undefined' || !geoData) return;

    if (layerRef) {
      map.removeLayer(layerRef);
    }

    if (enabled) {
      const layer = L.geoJSON(geoData, {
        style: {
          color: '#0000ff',
          weight: 2,
          opacity: opacity,
          fillOpacity: opacity * 0.3
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.name) {
            layer.bindPopup(`<b>${feature.properties.name}</b>`);
          }
        }
      });
      layer.addTo(map);
      setLayerRef(layer);
    } else {
      setLayerRef(null);
    }

    return () => {
      if (layerRef) map.removeLayer(layerRef);
    };
  }, [enabled, geoData, map, opacity]);

  return { layer: layerRef };
}
```

---

## Best Practices

### 1. Always Check Dependencies

```javascript
useEffect(() => {
  // ✅ GOOD: Check before using
  if (!map || typeof L === 'undefined') return;
  
  // Now safe to use map and L
  const layer = L.marker([...]).addTo(map);
}, [map]);
```

```javascript
useEffect(() => {
  // ❌ BAD: No checks, will crash
  const layer = L.marker([...]).addTo(map);
}, [map]);
```

### 2. Proper Cleanup

```javascript
useEffect(() => {
  const layer = L.marker([...]).addTo(map);
  
  // ✅ GOOD: Cleanup function
  return () => {
    if (layer && map) {
      try {
        map.removeLayer(layer);
      } catch (e) {
        // Layer may already be removed
      }
    }
  };
}, [map]);
```

### 3. Error Handling

```javascript
useEffect(() => {
  const fetchData = async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed');
      const data = await response.json();
      setData(data);
    } catch (err) {
      // ✅ GOOD: Log errors, don't crash
      console.error('Plugin data error:', err);
    }
  };
  
  if (enabled) fetchData();
}, [enabled]);
```

### 4. Memory Management

```javascript
useEffect(() => {
  if (!enabled) return;
  
  const interval = setInterval(fetchData, 60000);
  const markers = [];
  
  // ✅ GOOD: Clean up intervals and markers
  return () => {
    clearInterval(interval);
    markers.forEach(m => map.removeLayer(m));
  };
}, [enabled]);
```

### 5. Performance Optimization

```javascript
// ✅ GOOD: Reasonable refresh interval
const interval = setInterval(fetchData, 300000); // 5 minutes

// ❌ BAD: Too frequent, wastes resources
const interval = setInterval(fetchData, 1000); // 1 second
```

```javascript
// ✅ GOOD: Limit marker count
const limitedData = data.slice(0, 1000);

// ❌ BAD: Render thousands of markers
const markers = data.map(createMarker); // data has 50000 items
```

---

## Testing

### Manual Testing Checklist

- [ ] **Enable layer** - Appears on map correctly
- [ ] **Disable layer** - Completely removed from map
- [ ] **Adjust opacity** - Changes transparency in real-time
- [ ] **Page refresh** - Settings persist (stays enabled/disabled)
- [ ] **Rapid toggle** - No errors when toggling quickly
- [ ] **Console clean** - No React warnings or errors
- [ ] **Popup functionality** - Clicking markers shows info
- [ ] **Data refresh** - Auto-updates if applicable
- [ ] **Multiple plugins** - Works alongside other layers

### Browser Console Debugging

```javascript
// Check plugin registration
window.hamclockLayerControls.layers

// Check localStorage
JSON.parse(localStorage.getItem('openhamclock_mapSettings')).layers

// Manually toggle (for debugging)
window.hamclockLayerControls.toggleLayer('mylayer', true)

// Check layer state
window.hamclockLayerControls.layers.find(l => l.id === 'mylayer')
```

### Common Test Scenarios

**Test 1: Fresh Install**
1. Clear localStorage: `localStorage.clear()`
2. Refresh page
3. Plugin should be at defaultEnabled state
4. Toggle on/off should work

**Test 2: State Persistence**
1. Enable plugin, set opacity to 50%
2. Refresh page (F5)
3. Plugin should still be enabled at 50% opacity

**Test 3: Multiple Plugins**
1. Enable weather radar
2. Enable earthquakes
3. Both should display simultaneously
4. Toggling one shouldn't affect the other

---

## Troubleshooting

### Problem: Layer doesn't appear when enabled

**Possible Causes:**
- Map instance not ready
- Leaflet not loaded
- API/data fetch failed
- Invalid coordinates

**Solution:**
```javascript
useEffect(() => {
  // Add debug logging
  console.log('Plugin state:', { enabled, map, data: data.length });
  
  if (!map) {
    console.warn('Map not ready');
    return;
  }
  
  if (typeof L === 'undefined') {
    console.error('Leaflet not loaded');
    return;
  }
  
  if (data.length === 0) {
    console.warn('No data to display');
    return;
  }
  
  // Continue with rendering...
}, [enabled, map, data]);
```

### Problem: Layer shows when disabled

**Cause:** Missing cleanup or not checking enabled state

**Solution:**
```javascript
useEffect(() => {
  if (!map) return;
  
  // Remove layer if disabled
  if (!enabled && layerRef) {
    map.removeLayer(layerRef);
    setLayerRef(null);
    return; // Exit early
  }
  
  // Only add if enabled
  if (enabled && !layerRef) {
    const layer = createLayer();
    setLayerRef(layer);
  }
}, [enabled, map]);
```

### Problem: Settings don't persist after refresh

**Cause:** localStorage not saving correctly

**Solution:**
```javascript
// Check if data is being saved
window.hamclockLayerControls.toggleLayer('mylayer', true);

// Then check localStorage
console.log(
  JSON.parse(localStorage.getItem('openhamclock_mapSettings')).layers
);

// Should show: { mylayer: { enabled: true, opacity: 0.7 } }
```

### Problem: Plugin not in Settings panel

**Causes:**
1. Not registered in layerRegistry.js
2. Missing metadata export
3. Syntax error in plugin file

**Solution:**
```bash
# Check for syntax errors
npm run dev
# Look for errors in console

# Verify registration
grep -n "MyLayerPlugin" src/plugins/layerRegistry.js

# Verify metadata
grep -n "export const metadata" src/plugins/layers/useMyLayer.js
```

### Problem: React warning "Cannot update during render"

**Cause:** Calling state setter during render

**Solution:**
```javascript
// ❌ BAD: State update during render
if (enabled && !layerRef) {
  const layer = createLayer();
  setLayerRef(layer); // Called during render!
}

// ✅ GOOD: State update in useEffect
useEffect(() => {
  if (enabled && !layerRef) {
    const layer = createLayer();
    setLayerRef(layer); // Called in effect
  }
}, [enabled]);
```

---

## Advanced Features

### Custom Map Controls

Add interactive buttons to the map:

```javascript
export function useLayer({ enabled, opacity, map }) {
  useEffect(() => {
    if (!enabled || !map) return;

    // Create custom control
    const RefreshControl = L.Control.extend({
      options: { position: 'topright' },
      
      onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar');
        const button = L.DomUtil.create('a', '', container);
        button.innerHTML = '🔄';
        button.title = 'Refresh Data';
        button.style.cursor = 'pointer';
        button.style.padding = '5px 10px';
        button.style.background = '#fff';
        
        button.onclick = function(e) {
          e.preventDefault();
          fetchData(); // Trigger refresh
        };
        
        return container;
      }
    });

    const control = new RefreshControl();
    map.addControl(control);

    return () => {
      map.removeControl(control);
    };
  }, [enabled, map]);
}
```

### Custom Marker Icons

Create styled markers:

```javascript
const createCustomIcon = (color, label) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background: ${color};
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        font-family: monospace;
        font-weight: bold;
        white-space: nowrap;
      ">
        ${label}
      </div>
    `,
    iconSize: null,
    iconAnchor: [0, 0]
  });
};

// Usage
const marker = L.marker([lat, lon], {
  icon: createCustomIcon('#ff0000', 'ALERT')
});
```

### Animated Layers

Fade in/out effect:

```javascript
export function useLayer({ enabled, opacity, map }) {
  const [layerRef, setLayerRef] = useState(null);
  const [currentOpacity, setCurrentOpacity] = useState(0);

  // Animate opacity changes
  useEffect(() => {
    if (!layerRef) return;

    let animationFrame;
    const targetOpacity = enabled ? opacity : 0;
    
    const animate = () => {
      setCurrentOpacity(prev => {
        const diff = targetOpacity - prev;
        if (Math.abs(diff) < 0.01) return targetOpacity;
        return prev + diff * 0.1; // Ease towards target
      });
      
      if (Math.abs(currentOpacity - targetOpacity) > 0.01) {
        animationFrame = requestAnimationFrame(animate);
      }
    };
    
    animate();
    
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [enabled, opacity, layerRef]);

  // Apply animated opacity
  useEffect(() => {
    if (layerRef) {
      layerRef.setOpacity(currentOpacity);
    }
  }, [currentOpacity, layerRef]);

  // ... rest of plugin
}
```

---

## API Reference

### Metadata Object

```typescript
export const metadata: {
  id: string;              // Unique identifier (lowercase, no spaces)
  name: string;            // Display name in UI
  description: string;     // Brief description (shown in Settings)
  icon: string;            // Emoji icon (single character)
  category: string;        // Category for grouping (weather, geology, etc.)
  defaultEnabled: boolean; // Initial enabled state
  defaultOpacity: number;  // Initial opacity (0.0 to 1.0)
  version: string;         // Plugin version (semver)
};
```

### useLayer Hook

```typescript
export function useLayer(params: {
  enabled: boolean;   // Current enabled state
  opacity: number;    // Current opacity (0.0 to 1.0)
  map: L.Map | null;  // Leaflet map instance (may be null initially)
}): any;              // Optional return value (for debugging/monitoring)
```

**Parameters:**
- `enabled` - Boolean indicating if layer should be visible
- `opacity` - Number from 0.0 (transparent) to 1.0 (opaque)
- `map` - Leaflet map instance or null if not ready

**Return Value (Optional):**
Return any data you want for debugging. Common returns:
- `{ layer: layerRef }` - Reference to Leaflet layer
- `{ markers: markersArray }` - Array of markers
- `{ count: dataLength }` - Number of items displayed

### Available React Hooks

```javascript
import { useState, useEffect, useRef, useCallback } from 'react';

// useState - Manage component state
const [value, setValue] = useState(initialValue);

// useEffect - Side effects (fetch, render, cleanup)
useEffect(() => {
  // Effect logic
  return () => {
    // Cleanup logic
  };
}, [dependencies]);

// useRef - Mutable reference
const ref = useRef(initialValue);

// useCallback - Memoized function
const memoizedFn = useCallback(() => {
  // Function logic
}, [dependencies]);
```

### Leaflet API Essentials

**Map Methods:**
```javascript
map.addLayer(layer)          // Add layer to map
map.removeLayer(layer)       // Remove layer from map
map.hasLayer(layer)          // Check if layer exists
map.getCenter()              // Get center [lat, lon]
map.getZoom()                // Get zoom level
map.getBounds()              // Get visible bounds
map.panTo([lat, lon])        // Pan to coordinates
map.setView([lat, lon], zoom) // Set center and zoom
```

**Layer Types:**
```javascript
// Tile layer
L.tileLayer(url, options)
L.tileLayer.wms(url, options)

// Markers
L.marker([lat, lon], options)
L.circleMarker([lat, lon], options)

// Shapes
L.circle([lat, lon], options)
L.polygon(latlngs, options)
L.polyline(latlngs, options)

// GeoJSON
L.geoJSON(geojsonData, options)

// Layer groups
L.layerGroup(layers)
L.featureGroup(layers)
```

**Popup/Tooltip:**
```javascript
marker.bindPopup(content, options)
marker.bindTooltip(content, options)
marker.openPopup()
marker.closePopup()
```

### Fetch API

```javascript
// GET request
const response = await fetch(url);
const data = await response.json();

// With options
const response = await fetch(url, {
  method: 'GET',
  headers: {
    'Accept': 'application/json'
  }
});

// Error handling
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Fetch failed');
  const data = await response.json();
} catch (err) {
  console.error('Error:', err);
}
```

---

## Example Plugins Walkthrough

### Example 1: Weather Radar (WMS Tile Layer)

**File:** `src/plugins/layers/useWXRadar.js`

**Features:**
- WMS tile overlay
- Auto-refresh every 2 minutes
- Opacity control
- NEXRAD radar data

**Key Code:**
```javascript
const layer = L.tileLayer.wms(
  'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi',
  {
    layers: 'nexrad-n0r-900913',
    format: 'image/png',
    transparent: true,
    opacity: opacity,
    zIndex: 200
  }
);
```

**Learn From:**
- Simple tile layer implementation
- Auto-refresh pattern
- WMS configuration

### Example 2: Earthquakes (Marker Layer)

**File:** `src/plugins/layers/useEarthquakes.js`

**Features:**
- USGS GeoJSON API
- Circle markers scaled by magnitude
- Color-coded by severity
- Detailed popups
- Auto-refresh every 5 minutes

**Key Code:**
```javascript
const size = Math.min(Math.max(mag * 4, 8), 40);

const marker = L.circleMarker([lat, lon], {
  radius: size / 2,
  fillColor: color,
  color: '#fff',
  weight: 2,
  fillOpacity: opacity
});

marker.bindPopup(`
  <b>M${mag} Earthquake</b><br>
  ${location}<br>
  ${timeStr}
`);
```

**Learn From:**
- API data fetching
- Dynamic marker sizing
- Color-coding logic
- Popup formatting

---

## Plugin Ideas

### Beginner Level

1. **ISS Tracker** - Show International Space Station position
2. **Sun/Moon Position** - Mark subsolar/sublunar points
3. **Timezone Boundaries** - Display timezone polygons
4. **City Labels** - Show major city names
5. **Country Borders** - Highlight country boundaries

### Intermediate Level

1. **Hurricane Tracker** - Current tropical storms
2. **Wildfire Map** - Active fire perimeters
3. **Air Quality Index** - AQI data by location
4. **Flight Tracker** - Live aircraft positions
5. **Ship Tracker** - AIS maritime data

### Advanced Level

1. **Satellite Footprints** - Amateur radio satellite coverage
2. **Propagation Map** - HF band propagation predictions
3. **Solar Wind** - Geomagnetic storm visualization
4. **Meteor Showers** - Radiant points during meteor events
5. **Aurora Oval** - Current aurora visibility prediction

---

## Resources

### Data Sources

**Weather:**
- NOAA NEXRAD Radar: https://mesonet.agron.iastate.edu/
- OpenWeatherMap: https://openweathermap.org/api
- Weather.gov API: https://www.weather.gov/documentation/services-web-api

**Geology:**
- USGS Earthquakes: https://earthquake.usgs.gov/fdsnws/event/1/
- USGS Volcanoes: https://volcanoes.usgs.gov/vhp/data_api.html

**Astronomy:**
- NASA APIs: https://api.nasa.gov/
- Space Weather: https://services.swpc.noaa.gov/

**Amateur Radio:**
- Reverse Beacon Network: https://www.reversebeacon.net/
- PSK Reporter: https://pskreporter.info/
- APRS-IS: http://www.aprs-is.net/

**General:**
- OpenStreetMap: https://wiki.openstreetmap.org/wiki/API
- Natural Earth Data: https://www.naturalearthdata.com/

### Libraries

**Leaflet Plugins:**
- Marker Clustering: https://github.com/Leaflet/Leaflet.markercluster
- Heatmaps: https://github.com/Leaflet/Leaflet.heat
- Animated Markers: https://github.com/openplans/Leaflet.AnimatedMarker
- Draw Tools: https://github.com/Leaflet/Leaflet.draw

**React Resources:**
- React Hooks Docs: https://react.dev/reference/react
- useEffect Guide: https://react.dev/reference/react/useEffect

### Documentation

- **Leaflet Docs:** https://leafletjs.com/reference.html
- **React Docs:** https://react.dev/
- **MDN Web Docs:** https://developer.mozilla.org/

---

## Contributing

### Submitting Your Plugin

1. **Test thoroughly** - Follow testing checklist
2. **Document data sources** - Include attribution
3. **Add comments** - Explain complex logic
4. **Include example screenshot** - Visual preview
5. **Update CHANGELOG** - Note new plugin
6. **Submit PR** - Pull request to main repo

### Code Style

- Use ES6+ syntax (const/let, arrow functions, async/await)
- Include JSDoc comments for exported functions
- Follow existing plugin structure
- Use descriptive variable names
- Handle errors gracefully

### Plugin Checklist

Before submitting:

- [ ] Metadata complete and accurate
- [ ] useLayer hook properly implemented
- [ ] Cleanup functions included
- [ ] Error handling added
- [ ] Attribution included
- [ ] Comments added for complex logic
- [ ] Tested enable/disable
- [ ] Tested opacity changes
- [ ] Tested page refresh (persistence)
- [ ] No console errors
- [ ] README updated if needed

---

## Support

**Questions? Issues? Ideas?**

- **GitHub Issues:** https://github.com/yourusername/openhamclock/issues
- **Documentation:** https://github.com/yourusername/openhamclock/wiki
- **Example Plugins:** `src/plugins/layers/`

**Community:**

- Share your plugins in GitHub Discussions
- Help other developers in Issues
- Contribute improvements via Pull Requests

---

## Changelog

### Version 1.0.0 (February 2026)

- Initial plugin system release
- Weather radar plugin
- Earthquake data plugin
- Settings panel integration
- Persistent state management
- Comprehensive documentation

---

**Happy Plugin Development! 🚀**

Questions? Found a bug? Have an idea? Open an issue on GitHub!

---

*Last Updated: February 2, 2026*