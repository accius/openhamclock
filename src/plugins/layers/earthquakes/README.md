# 🌊 Earthquakes Plugin

**Version:** 1.2.0  
**Last Updated:** 2026-02-03  
**Category:** Geology  
**Data Source:** USGS (United States Geological Survey)

---

## Overview

The Earthquakes plugin displays live seismic activity data from the USGS Earthquake Catalog with **highly visible colored circle markers** featuring custom seismograph wave icons. Visualizes recent earthquakes (M2.5+ from the last hour) with **magnitude-based sizing and color gradients** for instant visual assessment of earthquake strength.

---

## 🌟 Features

### Core Capabilities
- **Live Earthquake Data**: USGS M2.5+ earthquakes from the last hour
- **Animated New Quake Detection**: Flash animation highlights newly detected earthquakes
- **Magnitude-Based Sizing**: Larger circles for stronger quakes (16px–40px)
- **Color-Coded Severity**: Green → Yellow → Orange → Red gradient based on magnitude
- **Detailed Popups**: Click any earthquake for comprehensive information
- **Real-time Updates**: Refreshes every 5 minutes automatically
- **High Visibility Icons**: Colored circles with white seismograph wave symbols
- **Stable Positions**: Earthquakes stay at exact locations (no movement/drift)

### Visual Indicators (v1.2.0)
- **Colored Circle Markers**: Background color shows magnitude severity
- **Seismograph Wave Icon**: Custom SVG with zigzag waves, epicenter dot, and ground triangle
- **Flash Animation (New Quakes)**: 
  - Bright flash effect with glow (0.8s duration)
  - Expanding ring (50km radius, 3s duration)
  - 🆕 Badge in popup
  - Automatically highlights fresh seismic events
- **White Border**: 2px white border for contrast on all backgrounds
- **Box Shadow**: Depth effect for better visibility

### Magnitude Categories (Enhanced v1.2.0)
| Magnitude | Size | Color | Hex | Classification |
|-----------|------|-------|-----|----------------|
| M1.0-2.0 | 16px | 🟢 Light Green | #90EE90 | Micro |
| M2.0-3.0 | 16-20px | 🟡 Yellow | #FFEB3B | Minor |
| M3.0-4.0 | 20-24px | 🟠 Orange | #FFA500 | Light |
| M4.0-5.0 | 24-28px | 🟠 Deep Orange | #FF6600 | Moderate |
| M5.0-6.0 | 28-32px | 🔴 Red | #FF3300 | Strong |
| M6.0-7.0 | 32-36px | 🔴 Dark Red | #CC0000 | Major |
| M7.0+ | 36-40px | 🔴 Very Dark Red | #8B0000 | Great |

---

## 📊 Data Details

### Data Source
- **Provider**: USGS Earthquake Hazards Program
- **Feed**: GeoJSON All Earthquakes (Last Hour) **[Updated v1.2.0]**
- **URL**: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson
- **Update Frequency**: Every 5 minutes
- **Minimum Magnitude**: 1.0+ (shows all detected quakes)
- **Time Window**: Last hour (more responsive to new activity)

### Earthquake Properties
Each earthquake includes:
- **Location**: Geographic description (e.g., "8 km NW of Palm Springs, CA")
- **Magnitude**: Richter/Moment magnitude scale
- **Depth**: Kilometers below surface
- **Time**: UTC timestamp
- **Status**: automatic, reviewed, or deleted
- **Tsunami Warning**: If applicable
- **Event ID**: Unique USGS identifier
- **Coordinates**: Latitude, Longitude
- **Detail URL**: Link to full USGS event page

---

## 🎯 Use Cases

### 1. **Seismic Activity Monitoring**
Track global earthquake activity in real-time, especially in tectonically active regions.

### 2. **Ionospheric Disturbance Awareness**
Large earthquakes (M6+) can potentially affect ionospheric conditions and radio propagation.

### 3. **Regional Safety**
Monitor seismic activity near your QTH (location) or planned DXpedition sites.

### 4. **Emergency Communications**
Quick situational awareness during seismic events for EMCOMM (emergency communications) operations.

### 5. **Scientific Interest**
Educational visualization of global tectonic plate boundaries and seismic patterns.

---

## 🔧 Usage

### Basic Setup

1. **Enable Plugin**
   - Open **Settings** → **Map Layers**
   - Toggle **🌋 Earthquakes**
   - Recent earthquakes appear immediately

2. **View Earthquake Details**
   - **Click any circle** to open detailed popup
   - Information includes:
     - Magnitude and classification
     - Location description
     - Time and age (e.g., "45 min ago")
     - Depth (km)
     - Status (automatic/reviewed)
     - Tsunami warning (if any)
     - Link to USGS details page

3. **Adjust Opacity**
   - Use the **Opacity** slider (0-100%)
   - Default: 90%
   - Useful for overlaying with other data layers

### Understanding the Display

#### Circle Size
- **Larger circles** = Stronger earthquakes
- **Smaller circles** = Weaker earthquakes
- Size scales with magnitude (M2.5 = 8px, M7+ = 40px)

#### New Earthquake Animation (v1.1.0)
- **Growing dot**: Earthquake marker animates from small to full size (0.6 seconds)
- **Pulse ring**: Expanding circular ring (50km radius, 3 seconds)
- **🆕 Badge**: New earthquakes show "🆕" in popup for easy identification
- **Auto-dismiss**: Animation plays once, then marker remains static

#### Color Interpretation
- **Yellow**: Minor quakes, little concern (M2.5-3.0)
- **Orange**: Light to moderate, noticeable (M3.0-5.0)
- **Red shades**: Strong to great, potentially destructive (M5.0+)

---

## ⚙️ Configuration

### Default Settings
```javascript
{
  enabled: false,
  opacity: 0.9,  // 90%
  updateInterval: 300000,  // 5 minutes
  minMagnitude: 2.5,
  timeWindow: '1 day'
}
```

### Animation Settings (v1.1.0)
```css
/* Pulse ring animation */
.earthquake-pulse-ring {
  animation: earthquake-pulse 3s ease-out;
  /* Expands from 0 to 50km radius */
}

/* Growing dot animation */
.earthquake-pulse-new {
  animation: earthquake-grow 0.6s ease-out;
  /* Scales from 0.5x to 1x size */
}
```

---

## 🧪 Technical Details

### Implementation
- **Marker Type**: Leaflet CircleMarker
- **Data Format**: GeoJSON
- **Coordinate System**: WGS84 (EPSG:4326)
- **Popup**: Custom HTML with styled table
- **Animation**: CSS keyframes + Leaflet interaction

### Performance
- **Typical Load**: 50-200 earthquakes per day
- **Marker Rendering**: <50ms for typical dataset
- **Update Frequency**: 5 minutes (300,000ms)
- **Animation Impact**: Minimal (CSS-based)

### Animation Technical Details (v1.1.0)
```javascript
// Track previously seen earthquake IDs
const previousQuakeIds = useRef(new Set());

// Detect new earthquakes
const isNew = !previousQuakeIds.current.has(quakeId);

// Apply animation classes
className: isNew ? 'earthquake-pulse-new' : 'earthquake-marker'

// Create pulse ring for new quakes
if (isNew) {
  const pulseRing = L.circle([lat, lon], {
    radius: 50000,  // 50km in meters
    className: 'earthquake-pulse-ring'
  });
  
  // Auto-remove after animation completes
  setTimeout(() => map.removeLayer(pulseRing), 3000);
}
```

### Data Flow
```
USGS Seismic Network → GeoJSON API → OpenHamClock → Animated Map Display
      (real-time)        (5 min delay)    (5 min refresh)    (instant)
```

---

## 🔍 Troubleshooting

### No Earthquakes Showing
1. **Check time period**: Only M2.5+ from last 24 hours
2. **Zoom level**: Zoom in if markers are clustered
3. **Opacity**: Increase opacity slider
4. **Global coverage**: Earthquakes occur worldwide, may not be local

### Animation Not Playing
- **First load**: Animation only plays for NEW earthquakes detected after plugin is enabled
- **Refresh required**: Toggle plugin off/on to reset "new" detection
- **Cache**: Clear browser cache if animations appear stuck

### Performance Issues
- **Many earthquakes**: If 200+ quakes, consider zooming in
- **Animation lag**: Disable and re-enable plugin to reset
- **Browser**: Use modern browser (Chrome, Firefox, Edge)

---

## 🌐 External Links

- **USGS Earthquake Catalog**: https://earthquake.usgs.gov/earthquakes/
- **Real-time Feeds**: https://earthquake.usgs.gov/earthquakes/feed/
- **Earthquake Glossary**: https://www.usgs.gov/programs/earthquake-hazards/glossary
- **ShakeMap**: https://earthquake.usgs.gov/data/shakemap/

---

## 📝 Version History

### v1.1.0 (2026-02-03)
- **NEW**: Animated new earthquake detection
- Growing dot animation (0.6s)
- Pulse ring effect (3s, 50km radius)
- 🆕 badge in popups for new quakes
- CSS keyframe animations
- Updated description and documentation

### v1.0.0 (Initial Release)
- Live USGS earthquake data (M2.5+, 24hr)
- Magnitude-based sizing (8-40px)
- Color-coded by magnitude (6 categories)
- Detailed popups with location, time, depth
- 5-minute auto-refresh
- Opacity control

---

## 💡 Tips & Best Practices

### For Best Results
1. **Leave enabled overnight** to catch new seismic events with animation
2. **Set opacity to 80-90%** for clear visibility
3. **Click for details** - popups contain valuable information
4. **Check tsunami warnings** - red text indicates potential hazard
5. **Cross-reference with USGS** using detail links for official reports

### Animation Behavior
- **First enable**: No animations (all quakes treated as "existing")
- **After 5 min**: New quakes detected since last refresh animate
- **Toggle off/on**: Resets "new" detection (all quakes animate next refresh)
- **Best experience**: Keep plugin enabled continuously

### Common Workflows
- **Daily Monitoring**: Enable at start of day, check periodically
- **Event Tracking**: After major quake, monitor aftershocks
- **Regional Focus**: Zoom to area of interest (e.g., Pacific Ring of Fire)
- **Propagation Study**: Compare with Gray Line and WSPR for ionospheric effects

---

## 🏷️ Plugin Metadata

```javascript
{
  id: 'earthquakes',
  name: 'Earthquakes',
  description: 'Live USGS earthquake data (M2.5+ from last 24 hours) with animated detection',
  icon: '🌋',
  category: 'geology',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.1.0'
}
```

---

## 📄 License & Attribution

**Data Source**: United States Geological Survey (USGS)  
**Data License**: Public Domain (U.S. Government)  
**API**: USGS Earthquake Hazards Program GeoJSON Feed

---

**73 de OpenHamClock** 📡🌋

*Seismic awareness for the radio amateur*
