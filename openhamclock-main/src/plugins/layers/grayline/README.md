# ⏰ Gray Line Propagation Overlay Plugin

**Version:** 1.0.2  
**Last Updated:** 2026-02-03  
**Category:** Propagation  
**Calculation:** Client-side astronomical algorithms

---

## Overview

The Gray Line (Solar Terminator) Propagation Overlay plugin visualizes the boundary between day and night on Earth, also known as the "gray line" or solar terminator. This is one of the most important propagation phenomena for long-distance HF communications, as signals can travel extraordinary distances along this twilight zone with minimal attenuation.

---

## 🌟 Features

### Core Capabilities
- **Real-time Solar Terminator**: Live day/night boundary calculation
- **Enhanced DX Zone**: Highlight ±5° region around terminator (peak propagation)
- **Three Twilight Zones**: 
  - Civil Twilight (-6° solar altitude)
  - Nautical Twilight (-12° solar altitude)
  - Astronomical Twilight (-18° solar altitude)
- **Live Animation**: Updates every 60 seconds to show Earth's rotation
- **UTC Time Display**: Shows current UTC time in control panel
- **Draggable Control Panel**: CTRL+drag to reposition (position persists)
- **Minimizable Panel**: Click header or toggle icon to minimize

### Visual Components
- **Terminator Line**: Orange dashed line (solar altitude = 0°)
- **Enhanced DX Zone**: Yellow shaded band (±5° from terminator)
- **Twilight Zones**: Blue-purple gradient overlays (adjustable opacity 20-100%)
- **Real-time Updates**: Smooth movement showing Earth's rotation

---

## 📊 The Science of Gray Line Propagation

### Why Gray Line Matters

The gray line is the transition zone between day and night. During this period:

1. **D-Layer Absorption Reduces**: 
   - D-layer (60-90 km altitude) absorbs HF signals during the day
   - At twilight, D-layer weakens rapidly while F-layer remains ionized
   - Result: Signals can propagate long distances with less attenuation

2. **F-Layer Remains Active**:
   - F-layer (150-400 km altitude) provides refraction for HF signals
   - Takes hours to fully recombine after sunset
   - Stays active during twilight period

3. **Extended Range**:
   - Signals can travel 2-3x normal distance
   - Multi-hop propagation becomes more efficient
   - Lower power can achieve DX contacts

4. **Hours of Propagation**:
   - Sunrise gray line: ~30-90 minutes
   - Sunset gray line: ~30-90 minutes
   - Duration depends on latitude and season

### Propagation Characteristics

| Frequency Band | Gray Line Effect | Typical DX Range |
|----------------|------------------|------------------|
| 160m (1.8 MHz) | Excellent | 2000-5000 km |
| 80m (3.5 MHz) | Excellent | 2000-6000 km |
| 40m (7 MHz) | Very Good | 3000-8000 km |
| 30m (10 MHz) | Good | 4000-10000 km |
| 20m (14 MHz) | Good | 5000-12000 km |
| 17m (18 MHz) | Moderate | 5000-10000 km |
| 15m (21 MHz) | Moderate | 6000-10000 km |
| 12m (24 MHz) | Fair | 6000-8000 km |
| 10m (28 MHz) | Fair | 6000-8000 km |

### Best Times for Gray Line DX

**1. Sunrise Enhancement (Local)**
- **When**: 30 minutes before to 30 minutes after local sunrise
- **Direction**: West to East paths
- **Bands**: 80m, 40m, 30m excellent; 20m-10m good
- **Why**: Your D-layer weakening, F-layer still strong

**2. Sunset Enhancement (Local)**
- **When**: 30 minutes before to 30 minutes after local sunset
- **Direction**: East to West paths
- **Bands**: 80m, 40m, 30m excellent; 20m-10m good
- **Why**: Your D-layer weakening, F-layer still strong

**3. Cross-Terminator Paths**
- **When**: Your location and DX location both on gray line
- **Direction**: Any direction along terminator
- **Bands**: All HF bands (especially low bands)
- **Why**: Both ends have optimal propagation conditions

**Peak Enhancement**: ±30 minutes from actual sunrise/sunset

---

## 🎯 Use Cases

### 1. **Long-Distance DX Contacts**
Identify optimal times for working rare DX stations.
- **Example**: West Coast USA to Europe on 80m at sunrise
- **Strategy**: Watch for when both locations are on terminator

### 2. **Contest Operating**
Maximize QSO rates during gray line openings.
- **Peak times**: Sunrise and sunset periods
- **Focus**: Low bands (80m, 40m) during twilight
- **Multiply contacts**: Work multiple continents during peak

### 3. **DXpedition Planning**
Plan operating schedule around gray line windows.
- **Identify**: Best times for target regions
- **Coordinate**: With other operators in different time zones
- **Optimize**: Antenna patterns for gray line directions

### 4. **Propagation Learning**
Understand day/night transition effects on propagation.
- **Visual**: See terminator move in real-time
- **Compare**: With actual propagation (use WSPR plugin)
- **Learn**: Correlation between gray line and enhanced propagation

### 5. **Operating Strategy**
Plan band and direction changes based on terminator position.
- **Morning**: Work west on 80m/40m as sun rises
- **Evening**: Work east on 80m/40m as sun sets
- **Night**: Follow terminator around the globe on 160m

---

## 🔧 Usage

### Basic Setup

1. **Enable Plugin**
   - Open **Settings** → **Map Layers**
   - Toggle **⏰ Gray Line Propagation**
   - Terminator line appears immediately
   - Updates every 60 seconds

2. **Control Panel** (top-right, draggable)
   - **UTC Time**: Current UTC time (updates every second)
   - **Show Twilight Zones**: Toggle civil/nautical/astronomical twilight
   - **Show Enhanced DX Zone**: Toggle ±5° band around terminator
   - **Twilight Opacity**: Adjust twilight visibility (20-100%, default 50%)
   - **Minimize Button** (▼/▶): Click to collapse/expand panel
   - **CTRL+Drag**: Hold CTRL and drag header to reposition

3. **Adjust Opacity** (main layer)
   - Use the **Opacity** slider in Settings (0-100%)
   - Default: 70%
   - Controls terminator line and enhanced DX zone opacity

### Interpreting the Display

#### Terminator Line (Orange Dashed)
- **Solar Altitude**: Exactly 0°
- **Day/Night**: Left side is day, right side is night (varies by direction)
- **Sine Wave**: Amplitude = solar declination (~23.5° max)

#### Enhanced DX Zone (Yellow Band)
- **Region**: ±5° around terminator (solar altitude -5° to +5°)
- **Peak Propagation**: Best DX conditions in this zone
- **Width**: ~550 km (340 miles) total width

#### Twilight Zones (Blue-Purple Gradient)
- **Civil Twilight**: Sun -6° below horizon (brightest twilight)
- **Nautical Twilight**: Sun -12° below horizon (darker)
- **Astronomical Twilight**: Sun -18° below horizon (darkest before true night)
- **Propagation**: Twilight zones show extended D-layer weakening

#### Real-Time Animation
- **Update**: Every 60 seconds
- **Movement**: Terminator moves westward (~15° per hour)
- **Earth Rotation**: Terminator is fixed in space; Earth rotates beneath it

---

## ⚙️ Configuration

### Default Settings
```javascript
{
  enabled: false,
  opacity: 0.7,  // 70%
  updateInterval: 60000,  // 60 seconds
  showTwilight: true,
  showEnhancedDX: true,
  twilightOpacity: 0.5,  // 50%
  lineColor: '#FFA500',  // Orange
  dxZoneColor: '#FFFF00',  // Yellow
  twilightColor: '#8B7FFF'  // Blue-purple
}
```

### Twilight Opacity Range (v1.0.2)
- **Minimum**: 20%
- **Maximum**: 100%
- **Default**: 50%
- **Step**: 5%
- **Use Case**: 
  - 20-30%: Subtle overlay, casual viewing
  - 50-70%: Balanced visibility, general use
  - 80-100%: Maximum visibility, analysis/study

---

## 🧪 Technical Details

### Astronomical Calculations

#### Solar Position
```javascript
// Calculate solar declination
const N = dayOfYear(date);
const L = (280.460 + 0.9856474 * N) % 360;
const g = (357.528 + 0.9856003 * N) % 360;
const eclipticLon = L + 1.915 * sin(g) + 0.020 * sin(2 * g);
const declination = asin(sin(eclipticLon) * sin(23.439));

// Calculate hour angle
const solarTime = ut + longitude / 15;
const hourAngle = (solarTime - 12) * 15;

// Calculate solar altitude
const altitude = asin(
  sin(latitude) * sin(declination) + 
  cos(latitude) * cos(declination) * cos(hourAngle)
);
```

#### Terminator Line (Solar Altitude = 0°)
```javascript
// For each longitude, solve for latitude where altitude = 0
// sin(0) = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(HA)
// 0 = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(HA)
// tan(lat) = -cos(HA) / tan(dec)

const latitude = atan(-cos(hourAngle) / tan(declination));
```

#### Twilight Zones (Solar Altitude < 0°)
Uses Newton-Raphson iteration to solve:
```javascript
// For target altitude (e.g., -6°, -12°, -18°)
// Iteratively solve: f(lat) = altitude - target = 0
// Using Newton-Raphson: lat_new = lat - f(lat) / f'(lat)
// Converges in ~5 iterations
```

### Performance
- **Update Frequency**: 60 seconds
- **Calculation Time**: <10ms per update
- **Points Generated**: 360 points per line (1° resolution)
- **Total Lines**: 1 terminator + 6 twilight (3 north + 3 south) + 2 DX zone = 9 lines
- **Memory**: ~500 KB for all layers

### Data Flow
```
System Clock → UTC Time → Solar Position → Terminator Calculation → Map Rendering
   (1 sec)      (instant)    (<5ms)          (<5ms)                  (<10ms)
```

---

## 🔍 Troubleshooting

### Terminator Not Showing
1. **Check opacity**: Increase main opacity slider
2. **Zoom level**: Zoom in to see line detail
3. **Toggle off/on**: Refresh the plugin
4. **Browser**: Use modern browser (Chrome, Firefox, Edge)

### Line Not Smooth / Looks Jagged
- **This is normal**: 360 points (1° resolution) is a good balance
- **Map projection**: Mercator distortion near poles
- **Zoom in**: Line appears smoother at higher zoom

### Line Not Moving
- **60-second updates**: Movement is slow (Earth rotates 15°/hour = 0.25°/minute)
- **Wait 5 minutes**: You should see noticeable shift
- **Check UTC time**: If time not updating, refresh page

### Control Panel Won't Drag
- **CTRL key**: Must hold CTRL while dragging
- **Click header**: Drag the dark header bar, not the controls
- **Cursor**: Should change to grab cursor when CTRL held

---

## 🌐 External Links

- **Gray Line Propagation**: https://en.wikipedia.org/wiki/Greyline
- **Solar Terminator**: https://en.wikipedia.org/wiki/Terminator_(solar)
- **HF Propagation**: https://www.arrl.org/hf-propagation
- **Sunrise/Sunset Calculator**: https://www.timeanddate.com/sun/

---

## 📝 Version History

### v1.0.2 (2026-02-03)
- Changed twilight opacity range to 20-100% (was 10-70%)
- Increased default twilight opacity to 50% (was 30%)
- Improved visibility for twilight zones

### v1.0.1 (2026-02-03)
- Fixed terminator calculation for proper sine wave shape
- Corrected spherical trigonometry formula
- Improved twilight zone calculation with Newton-Raphson iteration
- Better edge case handling (equinox, poles)

### v1.0.0 (2026-02-03)
- Initial release
- Real-time solar terminator calculation
- Three twilight zones (civil, nautical, astronomical)
- Enhanced DX zone (±5° band)
- Draggable/minimizable control panel
- 60-second auto-update
- UTC time display

---

## 💡 Tips & Best Practices

### For Best Results
1. **Leave enabled overnight**: Watch terminator sweep across the globe
2. **Combine with WSPR**: See correlation between gray line and enhanced propagation
3. **Set twilight opacity to 30-50%**: Balanced view without overwhelming the map
4. **Use Enhanced DX Zone**: Yellow band shows peak propagation region
5. **Check 30 minutes before/after sunrise/sunset**: Prime operating times

### Gray Line Operating Strategy

#### Morning (Local Sunrise)
1. **30 min before sunrise**: Start on 80m or 40m
2. **Point west**: Work stations in your sunset
3. **Listen east**: Work stations in their sunrise
4. **As sun rises**: Move to higher bands (20m, 15m)

#### Evening (Local Sunset)
1. **30 min before sunset**: Start on 80m or 40m
2. **Point east**: Work stations in their sunrise
3. **Listen west**: Work stations in their sunset
4. **After sunset**: Stay on low bands for best DX

#### Cross-Terminator Magic
- **Both on gray line**: Maximum propagation enhancement
- **Check map**: See when your QTH and target are both on terminator
- **Plan ahead**: Use time zones to calculate optimal times

### Common Workflows
- **Morning Routine**: Enable plugin, check terminator position, select band/direction
- **Contest**: Monitor terminator movement to anticipate band openings
- **DX Chase**: Use terminator to predict when rare DX will be workable
- **Learning**: Compare gray line with actual propagation (WSPR plugin)

### Combining with Other Plugins
- **WSPR + Gray Line**: See enhanced propagation along terminator paths
- **Aurora + Gray Line**: Identify aurora interference on twilight paths
- **Earthquakes + Gray Line**: (No direct correlation, but interesting overlay)

---

## 🏷️ Plugin Metadata

```javascript
{
  id: 'grayline',
  name: 'Gray Line Propagation',
  description: 'Real-time solar terminator and twilight zones for HF DX',
  icon: '⏰',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.2'
}
```

---

## 📄 License & Attribution

**Calculation**: Astronomical algorithms (public domain)  
**Implementation**: OpenHamClock project  
**Science**: Solar position calculations based on standard astronomical formulas

---

**73 de OpenHamClock** 📡⏰

*Ride the gray line to DX glory!*
