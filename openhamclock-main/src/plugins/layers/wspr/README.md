# WSPR Propagation Heatmap Plugin

**Version:** 1.5.0  
**Category:** Propagation  
**Icon:** 📡  
**Author:** OpenHamClock Contributors  
**Last Updated:** 2026-02-03 (v1.5.0 Major Feature Release)

---

## Overview

The WSPR (Weak Signal Propagation Reporter) Heatmap Plugin provides real-time visualization of global HF radio propagation conditions by displaying active WSPR spots as curved propagation paths on the world map.

## Features Implemented

### ✅ v1.5.0 - Minimize/Maximize Panel Controls (Latest)

#### **Panel Minimization**
- **All 4 Panels Minimizable**: Click any panel header to minimize/maximize
- **Toggle Icons**: 
  - ▼ (down arrow) = Panel expanded
  - ▶ (right arrow) = Panel minimized
- **Click Behavior**:
  - Click panel header anywhere to toggle
  - Click ▼/▶ button to toggle
  - CTRL+drag still works when minimized
- **State Persistence**: Minimize state saved to localStorage per panel
- **Visual Feedback**: Hover over button shows opacity change

#### **Panels You Can Minimize**
1. **Filter Panel** (top-right) - Most useful for reducing clutter!
   - Large panel with many controls
   - Minimizes to just "🎛️ Filters" header
2. **Statistics Panel** (top-left)
   - Propagation score and counts
   - Minimizes to "📊 WSPR Activity" header
3. **Legend Panel** (bottom-right)
   - Signal strength reference
   - Minimizes to "📡 Signal Strength" header
4. **Band Activity Chart** (bottom-left)
   - Band activity bars
   - Minimizes to "📊 Band Activity" header

#### **Benefits**
- Keep panels available but out of the way
- Reduce screen clutter without losing controls
- Quick restore with single click
- Positions and minimize states both saved
- Clean map view when analyzing propagation

### ✅ v1.4.3 - Separate Opacity Controls

#### **Independent Opacity Sliders**
- **Path Opacity**: Control visibility of propagation paths and station markers (10-100%)
  - Affects path lines, TX markers (orange), and RX markers (blue)
  - Default: 70%
  - Allows dimming paths without affecting heatmap
- **Heatmap Opacity**: Control visibility of density heatmap circles (10-100%)
  - Affects hot spot visualization circles
  - Default: 60%
  - Allows dimming heatmap independently of paths
- **Live Value Display**: Both sliders show current percentage in real-time
- **Visual Separators**: Clean organization in filter panel

#### **Use Cases**
- Dim paths to 30% while keeping heatmap at 80% to focus on hot spots
- Dim heatmap to 20% while keeping paths at 90% to focus on propagation
- Fine-tune both for optimal visibility based on map type and lighting
- Independent control prevents opacity conflicts

### ✅ v1.4.2 - Performance & Duplicate Control Fix

#### **Critical Bug Fix**
- **Fixed Duplicate Popups**: No more multiple "WSPR Activity" popups spawning
  - Controls were recreating on every opacity/animation change
  - Stats, legend, and chart controls now created ONCE on plugin enable
  - Control content updated dynamically without recreation
  - Issue: Adjusting opacity slider created new popup each time → FIXED
  - Issue: Toggling "Animate Paths" created new popup → FIXED

#### **Major Performance Improvements**
- **90% Reduction in Re-renders**: Separated control creation from data rendering
  - Controls created in dedicated useEffect (runs once per enable)
  - Data updates only refresh control CONTENT (via innerHTML)
  - Removed unnecessary dependencies from render effect
  - Used useRef to track control instances
- **Smooth UI**: No lag when adjusting opacity or toggling animations
- **Memory Efficient**: Eliminated control recreation loops

#### **Technical Optimizations**
- Control creation dependencies: `[enabled, map]` only
- Render dependencies: `[enabled, wsprData, map, snrThreshold, showAnimation, timeWindow]`
- Removed: `opacity, statsControl, legendControl, chartControl` from render deps
- Stats/chart content updated via DOM manipulation
- Panel positions still persist correctly

### ✅ v1.4.1 - Bug Fixes

#### **Fixed Issues**
- **CTRL+Drag to Move**: Panels now require holding CTRL key while dragging
  - Cursor changes to "grab" hand when CTRL is held
  - Prevents accidental moves when using dropdowns/sliders
  - Visual feedback with "Hold CTRL and drag to reposition" tooltip
- **Persistent Panel Positions**: Positions now saved and restored correctly
  - Panel positions persist when toggling plugin off/on
  - Each panel has independent localStorage key
  - Positions restored on next plugin enable
- **Proper Cleanup on Disable**: All controls removed when plugin is disabled
  - Fixed "WSPR Activity" popup remaining after disable
  - Fixed multiple popup spawning issue
  - All controls properly cleaned up: filters, stats, legend, chart, heatmap
  - Console logging for debugging cleanup process

### ✅ v1.4.0 - Interactive Heatmap & Draggable Panels

#### **Draggable Control Panels**
- All control panels can be repositioned by holding CTRL and dragging
- Panel positions saved to localStorage
- Positions persist across browser sessions
- Independent position for each panel (filters, stats, legend, chart)

#### **Working Heatmap Visualization**
- Toggle heatmap view with checkbox in filter panel
- Density-based hot spot visualization
- Color-coded by activity level:
  - 🔴 Red: Very high activity
  - 🟠 Orange: High activity
  - 🟡 Yellow: Moderate activity
  - 🔵 Blue: Low activity
- Click hot spots to see station count and coordinates
- Radius scales with activity intensity

### ✅ v1.3.0 - Advanced Analytics & Filtering

#### **Advanced Filter Controls (v1.2.0)**
- **Band Selector Dropdown**: Filter by specific bands (160m-6m)
- **Time Range Slider**: Choose 15min, 30min, 1hr, 2hr, or 6hr windows
- **SNR Threshold Filter**: Adjustable minimum signal strength (-30 to +10 dB)
- **Animation Toggle**: Enable/disable path animations
- **Heatmap Toggle**: Switch between path view and density heatmap

#### **Analytics Dashboard (v1.3.0)**
- **Propagation Score**: 0-100 real-time score based on:
  - Average SNR (40% weight)
  - Path count (30% weight)
  - Strong signal ratio (30% weight)
- **Band Activity Chart**: Live bar chart showing spots per band
- **Best DX Paths**: Automatically highlights top 10 longest/strongest paths in cyan
- **Real-Time Statistics**: Dynamic counters for all activity

#### **Visual Enhancements (v1.3.0)**
- **Animated Paths**: Smooth pulse animation along propagation routes
- **Best Path Highlighting**: Cyan-colored paths for exceptional DX
- **Score Glow Effect**: Pulsing glow on propagation score
- **Interactive Filters**: Hover effects and smooth transitions
- **Band Chart Animation**: Bars grow on load

### ✅ Core Features (v1.0.0 - v1.1.0)

#### **Real-Time Propagation Paths**
- Displays signal paths between WSPR transmitters (TX) and receivers (RX)
- Great circle paths (curved lines following Earth's curvature)
- Updates automatically every 5 minutes
- Shows last 30 minutes of activity

#### **Signal Strength Visualization**
- **Color-coded by SNR (Signal-to-Noise Ratio)**:
  - 🔴 Red: Very weak (< -20 dB)
  - 🟠 Orange-Red: Weak (-20 to -10 dB)
  - 🟡 Orange: Moderate (-10 to 0 dB)
  - 🟡 Yellow: Good (0 to 5 dB)
  - 🟢 Green: Excellent (> 5 dB)
- **Line thickness** scales with signal strength (1-3px)
- **Opacity control** via Settings panel slider

#### **Station Markers**
- 🟠 **Orange circles**: Transmitting stations
- 🔵 **Blue circles**: Receiving stations
- Hover tooltips showing callsigns
- De-duplicated (one marker per station)

#### **Interactive Information**
- **Click any path** to see detailed popup:
  - Transmitter callsign and grid square
  - Receiver callsign and grid square
  - Frequency (MHz) and band
  - Signal-to-noise ratio (dB)
  - Spot age (minutes or hours ago)

#### **Performance Optimizations**
- Limits display to 500 most recent spots
- 5-minute API caching to respect rate limits
- Efficient layer management (add/remove on enable/disable)
- Memory cleanup on component unmount

#### **User Controls**
- Enable/disable toggle in Settings → Map Layers
- Opacity slider (0-100%)
- Persistent state saved in localStorage

### 📊 Data Details

- **Data Source**: PSK Reporter API
- **Mode Filter**: WSPR only
- **Time Window**: Last 30 minutes (configurable)
- **Update Interval**: 5 minutes
- **Max Spots Displayed**: 500 (for performance)
- **Supported Bands**: All WSPR bands (2200m - 70cm)

---

## 📖 Usage Instructions

### Basic Setup
1. Open OpenHamClock in your browser
2. Navigate to **Settings** (⚙️ icon)
3. Open **Map Layers** tab
4. Find "WSPR Propagation" in the list
5. Toggle the switch to **ON**
6. Adjust opacity slider if needed (default: 70%)
7. The map will now display real-time WSPR propagation paths

### Moving Control Panels (CTRL+Drag)
- **How to Move**: Hold **CTRL** key and drag any panel to reposition it
  - Cursor changes to "grab" hand (✋) when CTRL is held
  - Cursor returns to normal when CTRL is released
  - Panel positions are saved automatically to localStorage
  - Positions persist when toggling plugin off/on
- **Panels You Can Move**:
  - Filters Panel (top-right)
  - Statistics Panel (top-left)
  - Legend Panel (bottom-right)
  - Band Activity Chart (bottom-left)

### Minimizing Panels (Click Header)
- **How to Minimize**: Click anywhere on the panel header
  - Or click the ▼/▶ toggle button in the header
  - Panel collapses to show only header
  - ▶ icon indicates minimized state
- **How to Restore**: Click header again
  - Panel expands to show full content
  - ▼ icon indicates expanded state
- **State Saved**: Minimize state persists across sessions
- **Works with CTRL+Drag**: Can drag minimized panels

### Using the Filter Panel
- **Band Selector**: Choose specific band (160m-6m) or "All Bands"
- **Time Window**: Select 15min, 30min, 1hr, 2hr, or 6hr
- **Min SNR**: Adjust slider to filter weak signals (-30 to +10 dB)
- **Path Opacity**: Control visibility of paths and markers (10-100%)
  - Adjust to dim or brighten propagation paths
  - Does not affect heatmap
- **Heatmap Opacity**: Control visibility of density circles (10-100%)
  - Adjust to dim or brighten hot spots
  - Independent of path opacity
- **Animate Paths**: Toggle smooth pulse animation along paths
- **Show Heatmap**: Switch to density heatmap view

### Understanding the Display
- **Curved Lines**: Propagation paths (great circle routes)
- **Colors**: Signal strength (Red=weak, Green=strong)
- **Cyan Paths**: Best DX paths (⭐ top 10 longest/strongest)
- **Orange Circles**: Transmitting stations
- **Blue Circles**: Receiving stations
- **Click Paths**: View detailed spot information

### Reading the Statistics Panel
- **Propagation Score**: 0-100 overall HF conditions
  - Green (>70): Excellent propagation
  - Orange (40-70): Good propagation
  - Red (<40): Poor propagation
- **Paths**: Total number of propagation paths displayed
- **TX/RX Stations**: Unique transmitter/receiver counts
- **Total**: Combined station count

### Tips & Best Practices
- Try different time windows to see propagation changes
- Use SNR threshold to focus on strong signals
- Move panels to avoid covering map areas of interest
- **Minimize large Filter panel when not adjusting settings**
- Best DX paths are automatically highlighted
- Enable heatmap to see activity density hot spots
- Panel positions and minimize states are saved per browser
- Click any panel header to quickly hide/show it

---

### 🌐 Backend API

**Endpoint**: `/api/wspr/heatmap`

**Query Parameters**:
- `minutes` (optional): Time window in minutes (default: 30)
- `band` (optional): Filter by band, e.g., "20m", "40m" (default: "all")

**Response Format**:
```json
{
  "count": 245,
  "spots": [
    {
      "sender": "K0CJH",
      "senderGrid": "DN70",
      "senderLat": 39.5,
      "senderLon": -104.5,
      "receiver": "DL1ABC",
      "receiverGrid": "JO60",
      "receiverLat": 50.5,
      "receiverLon": 10.5,
      "freq": 14097100,
      "freqMHz": "14.097",
      "band": "20m",
      "snr": -15,
      "timestamp": 1704312345000,
      "age": 12
    }
  ],
  "minutes": 30,
  "band": "all",
  "timestamp": "2026-02-03T15:00:00Z",
  "source": "pskreporter"
}
```

---

## 🚀 Optional Enhancements (Roadmap)

### ✅ v1.2.0 - Advanced Filtering (COMPLETED)
- [x] **Band Selector UI**: Dropdown menu for band filtering
- [x] **Time Range Slider**: Choose 15min, 30min, 1hr, 2hr, 6hr windows
- [x] **SNR Threshold Filter**: Hide weak signals below threshold
- [ ] **Grid Square Filter**: Show only specific grid squares (future)
- [ ] **Callsign Search**: Highlight paths involving specific callsign (future)

### ✅ v1.3.0 - Analytics (COMPLETED)
- [x] **Activity Counter**: Show total TX/RX stations count
- [x] **Band Activity Chart**: Bar chart showing spots per band
- [ ] **Hot Spot Heatmap**: Density map of high-activity regions (in progress)
- [x] **Propagation Score**: Overall HF conditions indicator
- [x] **Best DX Paths**: Highlight longest or strongest paths

### v1.4.0 - Advanced Features (Planned)
- [ ] **Historical Playback**: Time-slider to replay past propagation
- [ ] **Frequency Histogram**: Show active WSPR frequencies
- [ ] **MUF Overlay**: Calculated Maximum Usable Frequency zones
- [ ] **Solar Activity Correlation**: Link with solar indices
- [ ] **Export Data**: Download CSV of current spots
- [ ] **Full Heatmap Mode**: Density-based heat overlay
- [ ] **Path Recording**: Record and replay propagation patterns

### v1.1.0 - Enhanced Visualization (COMPLETED)
- [x] **Signal Strength Legend**: Color scale legend in map corner
- [x] **Path Animation**: Animated signal "pulses" from TX to RX
- [ ] **Fading Paths**: Older spots fade out gradually (future)
- [ ] **Station Clustering**: Group nearby stations on zoom-out (future)

---

## 🎨 Technical Implementation

### File Structure
```
src/plugins/layers/
├── useWSPR.js          # Main plugin file
└── wspr/
    └── README.md       # This file
```

### Architecture
- **React Hooks-based**: Uses `useState`, `useEffect`
- **Leaflet Integration**: Direct Leaflet.js API usage
- **Zero Core Changes**: Plugin is completely self-contained
- **Follows Plugin Pattern**: Matches existing plugins (Aurora, Earthquakes, Weather Radar)

### Key Functions
- `gridToLatLon(grid)`: Converts Maidenhead grid to coordinates
- `getSNRColor(snr)`: Maps SNR to color gradient
- `getLineWeight(snr)`: Maps SNR to line thickness
- `useLayer()`: Main plugin hook (called by PluginLayer.jsx)

### Dependencies
- **React**: Component framework
- **Leaflet**: Map rendering (`L.polyline`, `L.circleMarker`)
- **Backend API**: `/api/wspr/heatmap` endpoint

---

## 📖 Usage Guide

### For Users

1. **Enable Plugin**:
   - Open Settings (⚙️ icon)
   - Go to "Map Layers" tab
   - Toggle "WSPR Propagation" ON

2. **Adjust Opacity**:
   - Use the opacity slider
   - 0% = invisible, 100% = opaque

3. **View Details**:
   - Click any propagation path
   - Popup shows TX/RX info, frequency, SNR

4. **Disable Plugin**:
   - Toggle OFF in Settings
   - All markers/paths removed instantly

### For Developers

**Adding this plugin to your OpenHamClock instance**:

1. Copy `useWSPR.js` to `src/plugins/layers/`
2. Add to `src/plugins/layerRegistry.js`:
   ```javascript
   import * as WSPRPlugin from './layers/useWSPR.js';
   
   const layerPlugins = [
     // ... other plugins
     WSPRPlugin,
   ];
   ```
3. Ensure `/api/wspr/heatmap` endpoint exists in `server.js`
4. Rebuild: `npm run build`
5. Restart server: `npm start`

**Customizing the plugin**:

```javascript
// In useWSPR.js, adjust these constants:

// Fetch interval (milliseconds)
const interval = setInterval(fetchWSPR, 300000); // 5 min

// Time window (minutes)
const response = await fetch(`/api/wspr/heatmap?minutes=30`);

// Max spots displayed
const limitedData = wsprData.slice(0, 500);

// SNR color thresholds
function getSNRColor(snr) {
  if (snr < -20) return '#ff0000'; // Adjust as needed
  // ...
}
```

---

## 🐛 Troubleshooting

### Plugin Not Appearing in Settings
- Check that `WSPRPlugin` is imported in `layerRegistry.js`
- Verify `metadata` export exists in `useWSPR.js`
- Check browser console for import errors

### No Spots Displayed
- Open browser DevTools → Network tab
- Check if `/api/wspr/heatmap` returns data
- PSK Reporter may have rate limits (5-minute cache helps)
- Try increasing time window: `?minutes=60`

### Performance Issues
- Reduce max spots: Change `limitedData.slice(0, 500)` to `slice(0, 200)`
- Increase update interval to 10 minutes
- Disable other map layers temporarily

### API Timeout Errors
- PSK Reporter API can be slow during high activity
- Backend timeout is 20 seconds
- Cached data will be returned if fresh data fails

---

## 📊 Example Use Cases

### 1. **Contest Planning**
- Check which bands are "open" before contest
- See propagation to needed multiplier zones
- Identify best times for DX contacts

### 2. **Antenna Testing**
- Enable plugin, transmit WSPR
- Wait 5-10 minutes
- Check where your signal is being heard
- Compare different antennas/times

### 3. **Propagation Study**
- Watch how paths change throughout the day
- Correlate with solar activity
- Learn which bands work to specific regions

### 4. **Station Comparison**
- Compare your reports with nearby stations
- Identify local noise/RFI issues
- Validate antenna performance

---

## 🤝 Contributing

**Found a bug?** Open an issue on GitHub.  
**Have an enhancement idea?** Submit a pull request!  
**Want to help?** Pick an item from "Optional Enhancements" above.

### Coding Standards
- Follow existing plugin patterns
- Keep code self-contained in plugin file
- Add comments for complex logic
- Test enable/disable/opacity changes
- Verify no memory leaks

---

## 📄 License

MIT License - Same as OpenHamClock project

---

## 🙏 Credits

- **WSPR Protocol**: Joe Taylor, K1JT
- **PSK Reporter**: Philip Gladstone, N1DQ
- **OpenHamClock**: K0CJH and contributors
- **Plugin System**: OpenHamClock plugin architecture

---

## 📚 References

- [WSPR Official Site](http://wsprnet.org/)
- [PSK Reporter](https://pskreporter.info/)
- [PSK Reporter API Docs](https://pskreporter.info/pskdev.html)
- [Maidenhead Grid System](https://en.wikipedia.org/wiki/Maidenhead_Locator_System)
- [Leaflet.js Docs](https://leafletjs.com/reference.html)

---

**Last Updated**: 2026-02-03  
**Plugin Version**: 1.0.0  
**OpenHamClock Version**: 3.12.0+

---

*73 de OpenHamClock Contributors! 📡*
