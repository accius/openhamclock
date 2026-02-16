# ☁️ Weather Radar Plugin

**Version:** 1.0.0  
**Last Updated:** 2026-02-03  
**Category:** Weather  
**Data Source:** Iowa State University Mesonet (NEXRAD)

---

## Overview

The Weather Radar plugin provides real-time NEXRAD (Next Generation Radar) weather radar overlay for North America. It displays precipitation intensity, storm cells, and severe weather systems directly on the map.

---

## 🌟 Features

### Core Capabilities
- **NEXRAD Radar Overlay**: High-resolution weather radar imagery
- **Real-time Updates**: Auto-refresh every 2 minutes
- **Coverage**: Complete North America (USA, Canada, Mexico)
- **Transparency Control**: Adjustable opacity (0-100%)
- **WMS Integration**: Uses Weather Map Service (WMS) for efficient loading

### Data Visualization
- **Precipitation Intensity**: Color-coded radar returns
  - Light: Green
  - Moderate: Yellow
  - Heavy: Orange/Red
  - Severe: Dark Red/Purple
- **Storm Tracking**: Identify active weather systems
- **Coverage Area**: Continental USA, Alaska, Hawaii, Puerto Rico, Canada

---

## 📊 Data Details

### Data Source
- **Provider**: Iowa State University Mesonet
- **Service**: NEXRAD WMS (n0r product)
- **URL**: https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi
- **Update Frequency**: Every 2 minutes (automatic)
- **Data Latency**: ~5-10 minutes from radar scan

### Radar Product
- **Product Code**: N0R (Base Reflectivity)
- **Resolution**: ~1 km at radar site
- **Range**: ~230 miles (370 km) from radar
- **Elevation**: Lowest scan angle (0.5°)

---

## 🎯 Use Cases

### 1. **Weather Monitoring**
Monitor local weather conditions and precipitation in real-time.

### 2. **Storm Tracking**
Track approaching storms, severe weather, and precipitation systems.

### 3. **Operating Conditions**
Assess weather impact on outdoor antenna installations and operations.

### 4. **Propagation Analysis**
Identify weather fronts that can affect radio wave propagation (especially VHF/UHF).

### 5. **Safety Planning**
Monitor severe weather before outdoor activities or antenna work.

---

## 🔧 Usage

### Basic Setup

1. **Enable Plugin**
   - Open **Settings** → **Map Layers**
   - Toggle **☁️ Weather Radar**
   - Radar overlay will appear immediately

2. **Adjust Opacity**
   - Use the **Opacity** slider (0-100%)
   - Default: 60%
   - Higher opacity = more visible radar
   - Lower opacity = see map features better

3. **Position**
   - Radar automatically overlays on the map
   - No additional controls needed

### Interpreting Radar

#### Precipitation Colors
- **Green**: Light rain/drizzle
- **Yellow**: Moderate rain
- **Orange**: Heavy rain
- **Red**: Very heavy rain/hail
- **Purple**: Extreme precipitation/hail

#### Coverage Gaps
- **Dark spots**: Areas between radar sites (blind spots)
- **Circular patterns**: Individual radar site coverage
- **Mountains**: Terrain can block radar beams

---

## ⚙️ Configuration

### Default Settings
```javascript
{
  enabled: false,
  opacity: 0.6,  // 60%
  updateInterval: 120000,  // 2 minutes
  layer: 'nexrad-n0r-900913'
}
```

### WMS Parameters
- **Service**: WMS (OGC Web Map Service)
- **Version**: 1.3.0
- **Format**: PNG with transparency
- **CRS**: EPSG:3857 (Web Mercator)
- **Layer**: nexrad-n0r-900913

---

## 🧪 Technical Details

### Implementation
- **Technology**: Leaflet WMS TileLayer
- **Projection**: Web Mercator (EPSG:3857)
- **Tile Size**: 256x256 pixels
- **Z-Index**: 200 (above base map, below markers)

### Performance
- **Tile Caching**: Browser caches tiles automatically
- **Refresh**: Forced redraw every 2 minutes
- **Network**: ~50-200 KB per map view
- **Render Time**: <100ms for tile display

### Data Flow
```
NEXRAD Radars → IEM Processing → WMS Server → OpenHamClock → Map Display
    (~5 min)        (real-time)      (on-demand)     (2 min refresh)
```

---

## 🔍 Troubleshooting

### Radar Not Showing
1. **Check internet connection**: WMS requires live internet
2. **Zoom level**: Zoom in if radar is too faint
3. **Opacity**: Increase opacity slider
4. **Clear browser cache**: Force reload (Ctrl+F5)

### Outdated Data
- **Auto-refresh**: Plugin refreshes every 2 minutes automatically
- **Manual refresh**: Toggle plugin off/on to force refresh
- **IEM Service**: Check https://mesonet.agron.iastate.edu for service status

### Performance Issues
- **Lower opacity**: Reduce to 40-50%
- **Zoom in**: Less tiles to load
- **Disable when not needed**: Toggle off to reduce network usage

---

## 🌐 External Links

- **IEM NEXRAD WMS**: https://mesonet.agron.iastate.edu/ogc/
- **NEXRAD Network**: https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar
- **Weather Radar Info**: https://www.weather.gov/radar

---

## 📝 Version History

### v1.0.0 (2026-02-03)
- Initial release
- NEXRAD N0R base reflectivity overlay
- Auto-refresh every 2 minutes
- Opacity control
- North America coverage

---

## 💡 Tips & Best Practices

### For Best Results
1. **Set opacity to 50-70%** for balanced view
2. **Use with other layers** (e.g., Gray Line, WSPR) for context
3. **Monitor regularly** during weather events
4. **Check multiple zoom levels** for detail vs overview

### Common Workflows
- **Storm Monitoring**: Enable radar + adjust opacity to 80-90%
- **Casual Check**: Quick toggle on/off to see current conditions
- **Propagation Study**: Compare with WSPR propagation paths
- **Safety**: Check before outdoor antenna work

---

## 🏷️ Plugin Metadata

```javascript
{
  id: 'wxradar',
  name: 'Weather Radar',
  description: 'NEXRAD weather radar overlay for North America',
  icon: '☁️',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.6,
  version: '1.0.0'
}
```

---

## 📄 License & Attribution

**Data Attribution**: Weather data © Iowa State University Mesonet  
**Radar Network**: NOAA National Weather Service NEXRAD  
**Service**: Iowa Environmental Mesonet (IEM)

---

**73 de OpenHamClock** 📡☁️

*Real-time weather awareness for radio operators*
