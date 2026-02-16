# ⚡ Lightning Detection Plugin

**Version:** 1.1.0  
**Last Updated:** 2026-02-03  
**Category:** Weather  
**Data Source:** Simulated (designed for Blitzortung.org integration)

---

## Overview

The Lightning Detection plugin visualizes real-time lightning strikes on the map with **highly visible colored circle markers** and lightning bolt icons (⚡). Provides amateur radio operators with critical awareness of nearby electrical storm activity. Lightning can cause interference (QRM/QRN), damage equipment, and pose safety hazards during outdoor operations.

---

## 🌟 Features

### Core Capabilities
- **Real-time Lightning Strikes**: Visualize strikes with colored circle markers
- **Animated Strike Detection**: Flash animation highlights new strikes (0.8s)
- **Age-Based Color Coding**: Strikes fade from gold → orange → red → brown
- **Strike Intensity Display**: kA (kiloampere) current measurements
- **Polarity Indication**: Positive (+) and negative (-) strikes
- **Activity Statistics**: Live dashboard with minimizable panel
- **30-Second Updates**: Continuous real-time data refresh
- **High Visibility Icons**: Colored circles with white lightning bolt (⚡) symbols
- **Stable Positions**: Strikes stay at exact locations (no movement/drift)

### Visual Indicators
- **Colored Circle Markers**: Background color shows strike age (size 12-32px)
- **Lightning Bolt Icon**: White ⚡ symbol centered on circle
- **Flash Animation**: New strikes appear with bright gold glow (0.8s)
- **Pulse Ring**: Expanding 30km radius ring for new strikes (2s)
- **White Border**: 2px white border for contrast on all backgrounds
- **Box Shadow**: Depth effect for better visibility
- **🆕 Badge**: New strikes marked in popup

### Strike Age Colors
| Age | Color | Hex | Meaning | Icon Size |
|-----|-------|-----|---------|-----------|
| <1 min | 🟡 Gold | #FFD700 | Fresh strike | 12-32px |
| 1-5 min | 🟠 Orange | #FFA500 | Recent strike | 12-32px |
| 5-15 min | 🔴 Red | #FF6B6B | Aging strike | 12-32px |
| 15-30 min | 🔴 Dark Red | #CD5C5C | Old strike | 12-32px |
| >30 min | 🟤 Brown | #8B4513 | Very old strike | 12-32px |

---

## 📊 Data Details

### Data Source (Current: Simulated)
- **Provider**: Simulated lightning data (demo mode)
- **Update Frequency**: Every 30 seconds
- **Time Window**: Last 30 minutes
- **Coverage**: Global
- **Strike Count**: ~50 strikes per update

**Note**: This plugin is designed to integrate with real-time lightning networks like:
- Blitzortung.org (global, community-based)
- LightningMaps.org (visualization partner)
- NOAA GLM (Geostationary Lightning Mapper)
- Other regional networks

### Strike Properties
Each lightning strike includes:
- **Location**: Latitude, longitude (decimal degrees)
- **Timestamp**: UTC time of strike
- **Age**: Time since strike (seconds/minutes)
- **Intensity**: Peak current in kiloamperes (kA)
- **Polarity**: Positive (+) or negative (-) charge
- **Region**: Approximate location name

### Lightning Science
- **Positive Strikes (+)**: 10-15% of all strikes, more intense, typically 50-300 kA
- **Negative Strikes (-)**: 85-90% of all strikes, less intense, typically 20-100 kA
- **Cloud-to-Ground (CG)**: Most damaging and dangerous type
- **Typical Range**: Strike detected up to 300-500 km from detection network

---

## 🎯 Use Cases

### 1. **Safety Awareness**
Monitor nearby lightning to protect yourself and equipment.
- **Outdoor Operations**: Field Day, portable ops, antenna work
- **Storm Watch**: Track approaching thunderstorms
- **Lightning Distance**: Estimate strike proximity
- **Shelter Decision**: When to seek shelter (30/30 rule)

### 2. **QRM/QRN Source Identification**
Identify lightning as source of radio interference.
- **S9+40dB Crashes**: Lightning-induced noise
- **HF Noise**: Especially on low bands (160m, 80m, 40m)
- **VHF/UHF Impact**: Local static crashes
- **Correlation**: Match noise with strike times/locations

### 3. **Equipment Protection**
Safeguard station equipment from lightning damage.
- **Disconnect Antennas**: When nearby strikes detected
- **Ground Station**: Proper grounding practices
- **Surge Protection**: Monitor for risk periods
- **Insurance**: Document strike events near station

### 4. **Operating Decisions**
Plan radio activity around storm conditions.
- **Delay Operations**: Wait for storms to pass
- **Band Selection**: Avoid affected paths
- **Contest Strategy**: Pause during electrical activity
- **Emergency Comms**: EMCOMM safety protocols

### 5. **Meteorological Interest**
Track storm development and intensity.
- **Storm Tracking**: Follow storm movement
- **Intensity Assessment**: Strike rate indicates severity
- **Nowcasting**: Short-term weather prediction
- **Scientific Study**: Lightning distribution patterns

---

## 🔧 Usage

### Basic Setup

1. **Enable Plugin**
   - Open **Settings** → **Map Layers**
   - Toggle **⚡ Lightning Detection**
   - Strikes appear immediately on the map

2. **View Strike Details**
   - **Click any strike marker** to see popup with:
     - Region name
     - Timestamp and age
     - Intensity (kA)
     - Polarity (positive/negative)
     - Exact coordinates

3. **Monitor Statistics** (top-left panel)
   - **Fresh (<1 min)**: Just-detected strikes
   - **Recent (<5 min)**: Very recent activity
   - **Total (30 min)**: All displayed strikes
   - **Avg Intensity**: Mean strike strength
   - **Positive/Negative**: Strike polarity counts

4. **Adjust Opacity**
   - Use **Opacity** slider (0-100%)
   - Default: 90%
   - Higher = more visible strikes

### Interpreting the Display

#### Strike Markers
- **Size**: Larger circles = more intense strikes (5-20px)
- **Color**: Age-based fading (gold → brown over 30 minutes)
- **Border**: Thick white border on new strikes
- **Animation**: Flash + pulse ring for new strikes

#### Statistics Panel (Top-Left)
- **Real-time counts** by age category
- **Polarity breakdown** (positive vs. negative)
- **Average intensity** in kiloamperes
- **Updates every 30 seconds**

#### Safety Indicators
- **Gold strikes near your QTH**: Immediate danger zone
- **High strike count**: Active thunderstorm
- **Increasing fresh strikes**: Intensifying storm
- **Strikes moving toward you**: Approaching threat

---

## ⚙️ Configuration

### Default Settings
```javascript
{
  enabled: false,
  opacity: 0.9,  // 90%
  updateInterval: 30000,  // 30 seconds
  timeWindow: 1800000,  // 30 minutes
  maxStrikes: 50,
  showStatistics: true
}
```

### Animation Settings
```css
/* Flash animation (new strikes) */
.lightning-strike-new {
  animation: lightning-flash 0.8s ease-out;
  /* Scale 0 → 1.8 → 1.2 → 1 with brightness */
}

/* Pulse ring (new strikes) */
.lightning-pulse-ring {
  animation: lightning-pulse 2s ease-out;
  /* Expands from 1x to 4x, fades out */
}

/* Subtle pulse (all strikes) */
.lightning-strike {
  animation: lightning-subtle-pulse 3s ease-in-out infinite;
  /* Gentle scale 1.0 → 1.15 → 1.0 */
}
```

---

## 🧪 Technical Details

### Implementation
- **Marker Type**: Leaflet CircleMarker
- **Data Format**: JSON (timestamp, lat/lon, intensity, polarity)
- **Coordinate System**: WGS84 (EPSG:4326)
- **Popup**: Custom HTML with styled tables
- **Animation**: CSS keyframes + class toggling

### Performance
- **Typical Load**: 50 strikes per update
- **Marker Rendering**: <50ms for 50 strikes
- **Update Frequency**: 30 seconds (30,000ms)
- **Animation Impact**: Minimal (CSS-based, GPU-accelerated)
- **Memory**: ~1 MB for 50 strikes + animations

### Current Implementation: Simulated Data
```javascript
// Demo mode generates ~50 strikes globally
// Clustered around major cities (realistic storm patterns)
const stormCenters = [
  { lat: 28.5, lon: -81.5, name: 'Florida' },
  { lat: 40.7, lon: -74.0, name: 'New York' },
  { lat: 51.5, lon: -0.1, name: 'London' },
  // ... 8 global centers
];

// Each strike: random offset ±1° (~110 km)
// Age: random 0-30 minutes
// Intensity: random -50 to +150 kA
// Polarity: based on intensity sign
```

### Future: Real API Integration
When integrated with Blitzortung.org or similar:
```javascript
// Production implementation
const fetchLightning = async () => {
  const response = await fetch('/api/lightning/strikes?minutes=30&region=global');
  const data = await response.json();
  setLightningData(data.strikes);
};
```

**Required Backend Endpoint:**
- `GET /api/lightning/strikes`
- Query params: `minutes`, `region`, `minIntensity`
- Response: `{ strikes: [...], timestamp, source }`

---

## 🔍 Troubleshooting

### No Lightning Showing
1. **Demo mode**: Currently showing simulated data
2. **Opacity**: Increase opacity slider
3. **Zoom level**: Zoom in to see individual strikes
4. **Real data**: Backend API not yet implemented

### Animation Not Playing
- **First load**: Animation only for NEW strikes after plugin enabled
- **Refresh**: Toggle plugin off/on to reset "new" detection
- **Browser**: Use modern browser (Chrome, Firefox, Edge)

### Performance Issues
- **Many strikes**: If >200 strikes, map may slow down
- **Animation lag**: Reduce opacity or disable temporarily
- **Browser**: Close other tabs, restart browser

### Statistics Not Updating
- **Auto-refresh**: Stats update every 30 seconds automatically
- **Manual refresh**: Toggle plugin off/on
- **Data source**: Check if backend API is responding

---

## 🌐 External Links

- **Blitzortung.org**: https://www.blitzortung.org/
- **LightningMaps.org**: https://www.lightningmaps.org/
- **NOAA Lightning Data**: https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/geostationary-lightning-mapper-glm
- **Lightning Safety**: https://www.weather.gov/safety/lightning
- **30/30 Rule**: https://www.weather.gov/safety/lightning-30-30-rule

---

## 📝 Version History

### v1.0.0 (2026-02-03)
- Initial release with simulated data
- Real-time strike visualization
- Age-based color coding (gold → brown)
- Intensity and polarity display
- Flash animation for new strikes (0.8s)
- Pulse ring effect (2s, 30km radius)
- Continuous subtle pulse on all strikes
- Statistics panel (top-left)
- 30-second auto-refresh
- Designed for future Blitzortung.org integration

---

## 💡 Tips & Best Practices

### For Safety
1. **30/30 Rule**: Seek shelter if time between flash and thunder <30 seconds; wait 30 minutes after last strike
2. **6-Mile Rule**: Lightning can strike up to 10 miles from storm center
3. **Disconnect Antennas**: When nearby gold strikes appear
4. **Indoor Only**: Stay inside during electrical activity

### For Operations
1. **Monitor continuously**: Leave plugin enabled during outdoor ops
2. **Set opacity to 80-90%**: Clear visibility without overwhelming map
3. **Watch fresh count**: Rising fresh strikes = intensifying storm
4. **Compare with radar**: Use with Weather Radar plugin for full picture

### Animation Behavior
- **First enable**: No animations (all strikes treated as "existing")
- **After 30 sec**: New strikes detected since last refresh animate
- **Toggle off/on**: Resets "new" detection (next refresh animates all)
- **Best experience**: Keep plugin enabled continuously

### Common Workflows
- **Field Day**: Enable at start of event, monitor throughout
- **Antenna Work**: Check before climbing tower or touching antennas
- **Storm Watch**: Track approaching storms during severe weather
- **EMCOMM**: Safety monitor for outdoor emergency operations

### Combining with Other Plugins
- **Weather Radar + Lightning**: Complete storm visualization
- **WSPR + Lightning**: See lightning interference on propagation
- **Gray Line + Lightning**: Lightning activity often peaks at twilight
- **Earthquakes + Lightning**: (No correlation, but interesting overlay)

---

## 🏷️ Plugin Metadata

```javascript
{
  id: 'lightning',
  name: 'Lightning Detection',
  description: 'Real-time lightning strike detection and visualization',
  icon: '⚡',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0'
}
```

---

## 🚀 Future Enhancements

### Planned Features (v1.1.0+)
- **Real-Time Data Integration**: Blitzortung.org API connection
- **Alert Notifications**: Browser alerts for nearby strikes
- **Distance Rings**: Concentric circles around user location (5, 10, 20 miles)
- **Strike Sound**: Audio notification for new strikes
- **Heatmap Mode**: Density visualization of strike-prone regions
- **Historical Playback**: Replay past lightning events
- **Storm Tracking**: Automatic storm cell identification and tracking
- **Lightning Frequency**: Strikes per minute graph
- **Altitude Data**: Cloud-to-ground vs. intra-cloud detection

### Integration Options
- **Blitzortung.org**: Global community network (recommended)
- **NOAA GLM**: Geostationary Lightning Mapper (Western Hemisphere)
- **WWLLN**: World Wide Lightning Location Network
- **Regional Networks**: National and continental detection systems

---

## 📄 License & Attribution

**Current Data**: Simulated for demonstration purposes  
**Designed For**: Blitzortung.org network integration  
**Future Data License**: Blitzortung.org (non-commercial use)

**Blitzortung.org Policy:**
> The system is made for private and entertainment purposes. It is not an official information service for lightning data. A commercial use of our data is strongly prohibited.

---

## ⚠️ Safety Disclaimer

**IMPORTANT:** This plugin is for informational and educational purposes only. Do NOT rely solely on this data for lightning safety decisions. Always follow official weather service warnings and established lightning safety protocols.

- Lightning can strike 10+ miles from a storm
- No lightning detection system is 100% accurate
- Always err on the side of caution
- When in doubt, seek shelter indoors
- Disconnect all antennas and equipment during storms

**Your safety is YOUR responsibility.** This plugin supplements, but does not replace, proper lightning safety practices.

---

**73 de OpenHamClock** 📡⚡

*Stay aware, stay safe, and keep the static down!*
