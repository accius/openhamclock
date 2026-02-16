# 🌌 Aurora Forecast Plugin

**Version:** 2.0.0  
**Last Updated:** 2026-02-03  
**Category:** Space Weather  
**Data Source:** NOAA SWPC OVATION Aurora Model

---

## Overview

The Aurora Forecast plugin visualizes real-time aurora probability forecasts from NOAA's OVATION (Oval Variation, Assessment, Tracking, Intensity, and Online Nowcasting) model. It displays the 30-minute aurora forecast as a color-coded overlay on the map, helping operators identify potential HF propagation disturbances and VHF/UHF aurora openings.

---

## 🌟 Features

### Core Capabilities
- **30-Minute Aurora Forecast**: NOAA OVATION model prediction
- **Global Coverage**: Full Northern and Southern hemisphere visualization
- **Color-Coded Probability**: Green → Yellow → Orange → Red (4-100%)
- **High Resolution**: 1° latitude/longitude grid (360×181 points)
- **Real-time Updates**: Refreshes every 10 minutes
- **Smooth Rendering**: Anti-aliased interpolation for visual quality

### Aurora Visualization
- **Color Ramp** (matches NOAA official):
  - **Dark Green** (4-25%): Low probability
  - **Green** (25-40%): Moderate probability
  - **Yellow-Green** (40-55%): Good probability
  - **Yellow-Orange** (55-75%): High probability
  - **Orange-Red** (75-90%): Very high probability
  - **Red** (90-100%): Extreme probability

- **Transparency**: Values <4% are transparent (noise filtering)
- **Opacity Control**: Adjustable 0-100% (default 60%)

---

## 📊 Data Details

### Data Source
- **Model**: NOAA OVATION Aurora Forecast
- **Provider**: NOAA Space Weather Prediction Center (SWPC)
- **API Endpoint**: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json
- **Update Frequency**: Every 10 minutes
- **Forecast Horizon**: 30 minutes ahead
- **Resolution**: 1° latitude × 1° longitude
- **Data Points**: ~65,000 grid cells (360×181)

### Data Format
```json
{
  "Forecast Time": "2026-02-03 16:45:00",
  "coordinates": [
    [longitude, latitude, probability],
    [0, 65, 42],    // 42% chance at 65°N, 0°E
    [90, 70, 78],   // 78% chance at 70°N, 90°E
    ...
  ]
}
```

### Model Details
- **Physics-Based**: Uses real-time solar wind data
- **Input Data**: ACE/DSCOVR satellite observations
- **Propagation Time**: ~1 hour from L1 point to Earth
- **Auroral Oval**: Dynamically calculated based on geomagnetic activity
- **Kp Index Correlation**: Higher Kp = larger/brighter aurora

---

## 🎯 Use Cases

### 1. **HF Propagation Monitoring**
Aurora can disrupt HF radio propagation, especially on polar paths.
- **High aurora probability** = increased absorption on high-latitude paths
- **Monitor 20m-160m bands** for impact
- **Avoid gray-line paths** through active aurora zones

### 2. **VHF/UHF Aurora Scatter**
Strong aurora enables long-distance VHF/UHF contacts via aurora scatter.
- **50 MHz (6m)**: 500-1500 km contacts possible
- **144 MHz (2m)**: 500-1200 km contacts possible
- **432 MHz (70cm)**: 300-800 km contacts possible
- **Look for red/orange zones** in your region

### 3. **Contest/DXpedition Planning**
Plan operating strategy around aurora conditions.
- **High aurora**: Focus on mid-latitude paths
- **Low aurora**: High-latitude paths open
- **Aurora openings**: VHF/UHF operators activate

### 4. **Space Weather Awareness**
General situational awareness of geomagnetic conditions.
- **Correlates with Kp index**
- **Indicates solar storm effects**
- **Helps predict propagation changes**

### 5. **Visual Aurora Prediction**
Plan aurora photography/viewing (requires clear skies).
- **Red zones (>75%)**: Excellent chance of visible aurora
- **Yellow zones (40-75%)**: Good chance with dark skies
- **Green zones (4-40%)**: Possible with very dark skies

---

## 🔧 Usage

### Basic Setup

1. **Enable Plugin**
   - Open **Settings** → **Map Layers**
   - Toggle **🌌 Aurora Forecast**
   - Forecast overlay appears immediately

2. **Adjust Opacity**
   - Use the **Opacity** slider (0-100%)
   - Default: 60%
   - Higher opacity = more visible aurora zones
   - Lower opacity = see underlying map better

3. **Interpret Colors**
   - **Green**: Low to moderate probability
   - **Yellow**: Good probability
   - **Orange**: High probability
   - **Red**: Very high/extreme probability

### Reading the Forecast

#### For HF Operators
- **Green aurora near your path**: Minimal impact
- **Yellow/orange aurora on path**: Possible degradation
- **Red aurora on path**: Significant absorption likely
- **Aurora equatorward of your location**: Possible propagation enhancement on east-west paths

#### For VHF/UHF Operators
- **Your location in red zone**: Excellent aurora scatter potential
- **Your location in orange zone**: Good aurora scatter potential
- **Your location in yellow zone**: Possible weak aurora scatter
- **Beam toward aurora**: Point antenna toward auroral oval (usually north in Northern Hemisphere)

#### Timing
- **Forecast**: 30 minutes ahead (use current conditions for immediate assessment)
- **Update frequency**: Every 10 minutes (real-time tracking)
- **Best accuracy**: Within 1-2 hours of major geomagnetic events

---

## ⚙️ Configuration

### Default Settings
```javascript
{
  enabled: false,
  opacity: 0.6,  // 60%
  updateInterval: 600000,  // 10 minutes
  minProbability: 4,  // Filter <4%
  resolution: '1°',
  colorScheme: 'NOAA Official'
}
```

### Color Mapping Algorithm
```javascript
// Probability 4-100 mapped to color ramp
function auroraCmap(probability) {
  if (probability < 4) return null;  // Transparent
  
  const t = (probability - 4) / 80;  // Normalize to 0-1
  
  // Green → Yellow → Orange → Red gradient
  // Alpha increases with probability (0.3 → 1.0)
}
```

---

## 🧪 Technical Details

### Implementation
- **Technology**: Leaflet ImageOverlay
- **Canvas Rendering**: HTML5 Canvas API
- **Resolution**: 360×181 grid upscaled to 720×362 with anti-aliasing
- **Projection**: Equirectangular (matches NOAA grid)
- **Longitude Shift**: Corrected for -180° to +180° map coordinates

### Performance
- **Data Size**: ~200 KB JSON per fetch
- **Render Time**: <200ms for canvas generation
- **Canvas Size**: 720×362 pixels (smoothed 2× upscale)
- **Memory**: ~2 MB for overlay layer
- **Network**: Fetches every 10 minutes

### Data Flow
```
NOAA OVATION Model → SWPC JSON API → OpenHamClock Proxy → Canvas Rendering → Map Overlay
   (real-time)         (10 min cache)    (fetch on demand)    (<200ms)       (instant)
```

### Coordinate Transformation
```javascript
// NOAA grid: lon 0-359°, lat -90° to +90°
// Leaflet: lon -180° to +180°, lat -90° to +90°

// Shift longitudes for map alignment
x = (lon >= 180) ? lon - 180 : lon + 180;

// Flip latitudes for canvas (top = north)
y = 90 - lat;
```

---

## 🔍 Troubleshooting

### No Aurora Overlay Showing
1. **Check internet connection**: Requires live NOAA data
2. **Opacity**: Increase opacity slider
3. **Low activity**: During solar minimum, aurora may be weak/absent
4. **Browser cache**: Clear cache and reload (Ctrl+F5)

### Overlay Looks Pixelated
- **This is normal**: 1° resolution grid (111 km at equator)
- **Upscaling applied**: 2× smoothing with anti-aliasing
- **Physics limitation**: Model resolution is 1°

### Data Not Updating
- **Auto-refresh**: Plugin refreshes every 10 minutes automatically
- **Manual refresh**: Toggle plugin off/on to force refresh
- **NOAA SWPC**: Check https://www.swpc.noaa.gov for service status

### Color Too Dim/Bright
- **Adjust opacity**: Use slider (try 50-80%)
- **Low probability**: Green colors are subtle by design
- **High probability**: Red colors are vivid (rare during low activity)

---

## 🌐 External Links

- **NOAA SWPC**: https://www.swpc.noaa.gov
- **OVATION Model**: https://www.swpc.noaa.gov/products/aurora-30-minute-forecast
- **Aurora Tutorial**: https://www.swpc.noaa.gov/content/tips-viewing-aurora
- **Current Conditions**: https://www.swpc.noaa.gov/communities/radio-communications
- **Kp Index**: https://www.swpc.noaa.gov/products/planetary-k-index

---

## 📝 Version History

### v2.0.0 (2026-02-03)
- High-resolution 1° grid (360×181 points)
- NOAA official color ramp (green → red)
- Smooth rendering with 2× anti-aliasing
- Proper longitude shift for map alignment
- Optimized canvas generation (<200ms)
- 10-minute auto-refresh
- Probability filtering (<4% transparent)

### v1.0.0 (Initial Release)
- Basic OVATION aurora forecast
- Simple overlay rendering
- Manual refresh only

---

## 💡 Tips & Best Practices

### For HF Operators
1. **Compare with WSPR**: Check if high-latitude WSPR paths are weak/absent
2. **Gray line awareness**: Combine with Gray Line plugin to see aurora impact on terminator paths
3. **Band selection**: Lower bands (80m, 160m) more affected than higher bands (15m, 10m)
4. **Alternate paths**: Route around aurora (use mid-latitude paths)

### For VHF/UHF Operators
1. **Red zones = activate**: Strong aurora = excellent scatter potential
2. **CW mode**: Aurora scatter sounds "raspy" or "hissy"
3. **SSB challenges**: Aurora Doppler spreading makes SSB difficult
4. **Digital modes**: FT8/MSK144 work better than SSB
5. **Beam north**: Point antenna toward auroral oval

### Common Workflows
- **Daily Check**: Enable at start of operating session
- **Storm Watch**: Monitor during solar storm events (CME arrivals)
- **Contest**: Leave enabled to track propagation changes
- **Aurora Chase**: VHF/UHF operators watch for red zones in their region

### Combining with Other Plugins
- **WSPR + Aurora**: Identify absorption on high-latitude paths
- **Gray Line + Aurora**: See aurora interference on terminator paths
- **Earthquakes + Aurora**: Both can affect ionosphere (different mechanisms)

---

## 🏷️ Plugin Metadata

```javascript
{
  id: 'aurora',
  name: 'Aurora Forecast',
  description: 'NOAA OVATION aurora probability forecast (30-min)',
  icon: '🌌',
  category: 'space-weather',
  defaultEnabled: false,
  defaultOpacity: 0.6,
  version: '2.0.0'
}
```

---

## 📄 License & Attribution

**Data Source**: NOAA Space Weather Prediction Center (SWPC)  
**Model**: OVATION (Oval Variation, Assessment, Tracking, Intensity, and Online Nowcasting)  
**Data License**: Public Domain (U.S. Government)

---

**73 de OpenHamClock** 📡🌌

*Auroral awareness for the prepared operator*
