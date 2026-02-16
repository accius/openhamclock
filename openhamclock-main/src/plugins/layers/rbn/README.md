# Reverse Beacon Network (RBN) Plugin

**Version:** 1.0.0  
**Category:** Propagation  
**Icon:** 📡  
**Author:** OpenHamClock Contributors  
**Last Updated:** 2026-02-03 (v1.0.0 Initial Release)

---

## Overview

The Reverse Beacon Network (RBN) Plugin shows **who's hearing YOUR signal** in real-time by connecting to the global network of automated CW and digital mode skimmers. Unlike other plugins that show propagation from others, RBN specifically tracks **your callsign** being heard around the world.

## What is RBN?

The Reverse Beacon Network is a worldwide network of automated receiving stations (skimmers) that continuously monitor amateur radio bands for CW and digital signals. When they hear your callsign, they automatically post a "spot" showing:
- Where you were heard (skimmer location)
- Signal strength (SNR in dB)
- Frequency and band
- Time of reception

This gives you **instant feedback** on your antenna performance, propagation conditions, and signal coverage.

---

## Features Implemented

### ✅ v1.0.0 - Initial Release (Latest)

#### **Real-Time Signal Monitoring**
- Shows all skimmers currently hearing your callsign
- Updates automatically every 2 minutes
- Configurable time window (10-120 minutes)
- Color-coded by signal strength (SNR)

#### **Visual Elements**
- **Circle Markers** at each skimmer location
  - Size scales with signal strength
  - Color indicates SNR level (Red=weak, Green=strong)
  - Click for detailed spot information
- **Great Circle Paths**
  - Dashed lines from your station to each skimmer
  - Optional show/hide toggle
  - Color matches signal strength
- **Interactive Control Panel**
  - Band selector (All, 160m-6m)
  - Time window slider (10-120 min)
  - Min SNR threshold (-30 to +30 dB)
  - Path visibility toggle
- **Statistics Display**
  - Total spots count
  - Unique skimmers count
  - Average SNR across all spots

#### **Signal Strength Color Coding**
SNR-based color scale:
- 🔴 **Red** (< 0 dB): Weak signal
- 🟠 **Orange** (0-10 dB): Fair signal
- 🟡 **Yellow** (10-20 dB): Good signal
- 🟢 **Light Green** (20-30 dB): Very good signal
- 💚 **Bright Green** (30+ dB): Excellent signal

#### **Marker Sizing**
- < 0 dB: 6px radius (smallest)
- 0-10 dB: 8px radius
- 10-20 dB: 10px radius
- 20-30 dB: 12px radius
- 30+ dB: 14px radius (largest)

#### **Interactive Popups**
Click any skimmer marker to see:
- Skimmer callsign
- Your callsign (being heard)
- Signal-to-noise ratio (SNR in dB)
- Band (160m, 80m, 40m, etc.)
- Frequency (kHz)
- Grid square
- Timestamp

#### **Performance Features**
- 2-minute caching to reduce API load
- Automatic cleanup of old layers
- Efficient great circle path calculations
- Limits to 100 most recent spots per fetch

---

## 📖 Usage Instructions

### Basic Setup

1. **Configure Your Callsign**
   - Open OpenHamClock settings
   - Set your callsign in the station configuration
   - The plugin uses YOUR callsign to query RBN

2. **Enable the Plugin**
   - Navigate to **Settings** (⚙️ icon)
   - Open **Map Layers** tab
   - Find "📡 Reverse Beacon Network" in the list
   - Toggle the switch to **ON**

3. **Adjust Settings**
   - Use the RBN control panel (appears in top-right)
   - Select band, time window, and SNR threshold
   - Toggle path visibility as desired

### Using the Control Panel

#### **Band Selector**
- **All Bands**: Shows spots from all bands (default)
- **Specific Band**: Filter to 160m, 80m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, or 6m
- Useful for checking propagation on contest bands

#### **Time Window Slider**
- **Range**: 10 to 120 minutes
- **Default**: 30 minutes
- **Purpose**: How far back to look for spots
- Longer windows show more spots but may include stale data

#### **Min SNR Threshold**
- **Range**: -30 to +30 dB
- **Default**: -10 dB
- **Purpose**: Filter out weak signals
- Increase to see only strong reports

#### **Show Paths Toggle**
- **ON**: Display dashed lines from your station to each skimmer
- **OFF**: Show only skimmer markers
- Useful for reducing map clutter

### Understanding the Statistics

**Spots**: Total number of times you've been heard  
**Skimmers**: Number of unique receiving stations  
**Avg SNR**: Average signal strength across all reports  

Higher SNR = stronger signal = better propagation!

---

## 📊 Data Details

- **Data Source**: Reverse Beacon Network (reversebeacon.net)
- **Update Interval**: 2 minutes
- **Cache Duration**: 2 minutes per callsign
- **Max Spots**: 100 most recent per fetch
- **Supported Modes**: CW, RTTY, PSK, and other digital modes
- **Supported Bands**: 160m - 6m (all HF bands)

---

## 🌐 Backend API

**Endpoint**: `/api/rbn`

**Query Parameters**:
- `callsign` (required): Your callsign (e.g., "VE3TOS", "K0CJH")
- `limit` (optional): Max spots to return (default: 100)

**Response Format**:
```json
[
  {
    "callsign": "DL1ABC",
    "frequency": 14025000,
    "band": "20m",
    "snr": 15,
    "mode": "CW",
    "grid": "JO60VR",
    "timestamp": "2026-02-03T20:15:30Z",
    "wpm": 25,
    "comment": null
  }
]
```

**Response Fields**:
- `callsign`: Skimmer that heard you
- `frequency`: Frequency in Hz
- `band`: Band (160m, 80m, etc.)
- `snr`: Signal-to-noise ratio in dB
- `mode`: Mode (CW, RTTY, PSK, etc.)
- `grid`: Skimmer's Maidenhead grid square
- `timestamp`: When you were heard (ISO 8601)
- `wpm`: CW speed (if applicable)
- `comment`: Additional info (if any)

---

## 🚀 Use Cases

### 1. **Antenna Testing**
- Make a quick CW/digital transmission
- Wait 2-5 minutes for plugin to update
- See where your signal is being heard
- Compare different antennas, power levels, or directions
- Track SNR improvements from antenna changes

### 2. **Propagation Checking**
- Quick "am I getting out?" check before contest
- See which bands are open in real-time
- Identify skip zones and dead spots
- Monitor propagation throughout the day

### 3. **Signal Reports**
- Get objective SNR measurements from skimmers
- Compare your signal strength to other stations
- Validate local noise issues (low SNR everywhere)
- Identify directional antenna patterns

### 4. **Contest Strategy**
- Check which bands are working to needed multipliers
- See signal strength to different continents
- Identify best times for specific paths
- Monitor band openings in real-time

### 5. **QRP Validation**
- Running QRP (low power)?
- RBN shows if anyone is hearing you
- Objective proof of propagation
- Track minimum power for specific paths

---

## 💡 Tips & Best Practices

### Getting the Best Results

1. **Make CQ Calls**
   - RBN skimmers hear your callsign when you transmit
   - Send "CQ CQ CQ de [YOUR CALL]" or similar
   - Or participate in contests/pile-ups

2. **Wait for Updates**
   - Plugin updates every 2 minutes
   - RBN skimmers report spots within seconds
   - Allow 2-5 minutes for spots to appear

3. **Use Appropriate Time Windows**
   - Short window (10-15 min): Current propagation
   - Medium window (30-60 min): Recent activity
   - Long window (90-120 min): Trends over time

4. **Filter by Band**
   - Select specific band when testing
   - Easier to see propagation on one band
   - Less clutter on the map

5. **Adjust SNR Threshold**
   - Start at -10 dB (default)
   - Increase to see only strong signals
   - Decrease to see all reports (even weak ones)

### Understanding SNR Values

- **30+ dB**: Exceptionally strong signal
- **20-30 dB**: Very strong, likely copyable under any conditions
- **10-20 dB**: Good signal, easily copyable
- **0-10 dB**: Fair signal, usually copyable
- **-10 to 0 dB**: Weak but detectable
- **< -10 dB**: Very weak, near noise floor

### Interpreting the Map

- **Many markers**: Good propagation, antenna working well
- **Few markers**: Poor propagation, antenna issues, or low power
- **Clustered markers**: Directional antenna pattern
- **Spread markers**: Omnidirectional coverage
- **No markers**: Not transmitting, or propagation very poor

### Comparing with Other Plugins

| Plugin | What It Shows | Use Case |
|--------|---------------|----------|
| **RBN** | Who hears YOU | Antenna testing, signal reports |
| **WSPR** | Global propagation | General band conditions |
| **PSKReporter** | Who you hear | Reception analysis |
| **DX Cluster** | Active DX stations | Chasing rare stations |

---

## 🎨 Technical Implementation

### File Structure
```
src/plugins/layers/
├── useRBN.js           # Main plugin file
└── rbn/
    └── README.md       # This file
```

### Architecture
- **React Hooks-based**: Uses `useState`, `useEffect`, `useRef`
- **Leaflet Integration**: Direct Leaflet.js API usage
- **Zero Core Changes**: Plugin is completely self-contained
- **Follows Plugin Pattern**: Matches existing plugins

### Key Functions
- `gridToLatLon(grid)`: Converts Maidenhead grid to coordinates
- `getSNRColor(snr)`: Maps SNR to color gradient
- `getMarkerSize(snr)`: Maps SNR to marker size
- `getGreatCirclePath()`: Calculates curved paths
- `freqToBand()`: Converts frequency to band name
- `useLayer()`: Main plugin hook

### Dependencies
- **React**: Component framework
- **Leaflet**: Map rendering (`L.circleMarker`, `L.polyline`)
- **Backend API**: `/api/rbn` endpoint

---

## 🐛 Troubleshooting

### Plugin Not Appearing
- Check that `RBNPlugin` is imported in `layerRegistry.js`
- Verify `metadata` export exists in `useRBN.js`
- Check browser console for import errors
- Rebuild: `npm run build`

### No Spots Displayed
- **Check your callsign**: Must be configured in settings
- **Default callsign**: "N0CALL" won't fetch data
- **Transmit**: RBN only hears you when you transmit
- **Wait**: Allow 2-5 minutes for updates
- **Check console**: Open DevTools → Console for errors

### Incorrect Marker Locations
- RBN provides grid squares for skimmer locations
- Grid-to-lat/lon conversion is approximate (±0.5°)
- This is normal and expected behavior

### API Errors
- RBN API may have rate limits
- 2-minute cache reduces load
- Try again in a few minutes
- Check `/api/rbn?callsign=YOURCALL` directly

### Performance Issues
- Reduce time window to 10-15 minutes
- Increase SNR threshold to filter weak spots
- Disable path lines (toggle off)
- Close other map layers

---

## 🚀 Future Enhancements (Roadmap)

### v1.1.0 - Enhanced Visualization (Planned)
- [ ] **Signal Strength Heatmap**: Density map of strong reports
- [ ] **Directional Pattern**: Polar plot showing signal distribution
- [ ] **Historical Tracking**: Time-slider to replay past spots
- [ ] **Best Reports Highlighting**: Auto-highlight strongest signals

### v1.2.0 - Advanced Filters (Planned)
- [ ] **Mode Filter**: Filter by CW, RTTY, PSK, etc.
- [ ] **Continent Filter**: Show only specific continents
- [ ] **Distance Filter**: Show skimmers within X km range
- [ ] **WPM Filter**: Filter CW by speed (for CW operators)

### v1.3.0 - Analytics (Planned)
- [ ] **Coverage Map**: Grid square coverage visualization
- [ ] **SNR Chart**: Historical SNR trends over time
- [ ] **Band Comparison**: Side-by-side band performance
- [ ] **Antenna Comparison**: Save/compare antenna configs

### v1.4.0 - Alerts & Notifications (Planned)
- [ ] **New Continent Alert**: Notify when heard on new continent
- [ ] **SNR Threshold Alert**: Alert when SNR exceeds threshold
- [ ] **Band Opening Alert**: Notify when specific band opens
- [ ] **Grid Square Alert**: Alert for new grid squares

---

## 🤝 Contributing

**Found a bug?** Open an issue on GitHub.  
**Have an enhancement idea?** Submit a pull request!  
**Want to help?** Pick an item from "Future Enhancements" above.

### Coding Standards
- Follow existing plugin patterns
- Keep code self-contained in plugin file
- Add comments for complex logic
- Test enable/disable/opacity changes
- Verify no memory leaks
- Test with different callsigns

---

## 📄 License

MIT License - Same as OpenHamClock project

---

## 🙏 Credits

- **Reverse Beacon Network**: DL7AN, W3LPL, and RBN volunteers
- **RBN API**: Reverse Beacon Network development team
- **OpenHamClock**: K0CJH and contributors
- **Plugin System**: OpenHamClock plugin architecture

---

## 📚 References

- [Reverse Beacon Network](https://reversebeacon.net/)
- [RBN Statistics](https://reversebeacon.net/main.php?zoom=1)
- [RBN Skimmer Locations](https://reversebeacon.net/pages/Beacons)
- [Maidenhead Grid System](https://en.wikipedia.org/wiki/Maidenhead_Locator_System)
- [Leaflet.js Docs](https://leafletjs.com/reference.html)
- [SNR Explained](https://en.wikipedia.org/wiki/Signal-to-noise_ratio)

---

## 📖 Frequently Asked Questions (FAQ)

### Q: Why don't I see any spots?
**A:** You must be transmitting for RBN skimmers to hear you. Make some CQ calls or participate in a contest, then wait 2-5 minutes for the plugin to update.

### Q: Do I need to register with RBN?
**A:** No registration required! RBN automatically detects and reports all amateur radio callsigns.

### Q: What modes does RBN support?
**A:** CW (Morse code), RTTY, PSK31, PSK63, FT8, FT4, and other digital modes. Check reversebeacon.net for the full list.

### Q: Why are some markers far from their actual location?
**A:** RBN provides grid squares (e.g., "FN31"), which are converted to approximate lat/lon. This is accurate to within about 70km.

### Q: Can I see spots from multiple callsigns?
**A:** Currently, the plugin shows spots for your configured callsign only. Multi-callsign support may be added in future versions.

### Q: How accurate is the SNR measurement?
**A:** SNR is measured by the skimmer's receiver and is quite accurate. However, different skimmers may use slightly different measurement methods.

### Q: Does this work for all bands?
**A:** Yes! RBN covers all HF bands from 160m to 6m. Most activity is on CW contest bands (160m, 80m, 40m, 20m, 15m, 10m).

### Q: Can I use this to find my signal reports?
**A:** Yes! RBN provides objective signal reports in dB. This is more accurate than the traditional RST system.

### Q: Why do paths look curved?
**A:** Paths use great circle routes (shortest distance on a sphere), which appear curved on a flat map projection.

### Q: How often does RBN update?
**A:** The plugin checks for new spots every 2 minutes. RBN skimmers report spots in real-time (within seconds of hearing you).

---

**Last Updated**: 2026-02-03  
**Plugin Version**: 1.0.0  
**OpenHamClock Version**: 3.12.0+

---

*73 de OpenHamClock Contributors! 📡*

*"See your signal around the world!"* 🌍
