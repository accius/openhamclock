# ☁️ Global Clouds Plugin

**Version:** 2.0.0  
**Last Updated:** 2026-02-07  
**Category:** Weather  
**Contributor:** Carl Reinemann, USRadioguy.com
**Data Source:** OpenWeatherMap (OWM)

---

## Overview

The Global Clouds plugin provides a real-time satellite-derived cloud cover overlay for the entire world. It allows operators to visualize current atmospheric conditions, helping to bridge the gap between historical weather research and modern radio operations.

---

## 🌟 Features

### Core Capabilities

- **Real-time Cloud Overlay**: High-resolution global cloud imagery updated every 10–15 minutes.
- **Global Coverage**: Seamless cloud data for all continents and oceans.
- **Transparency Control**: Adjustable opacity (0-100%) to view underlying satellite imagery or map features.
- **API Integration**: Securely utilizes your personal **OpenWeatherMap API key** from the `.env` configuration.

### Data Visualization

- **Cloud Density**: Translucent white overlays representing current cloud formations.
- **Integration**: Designed to overlay perfectly on top of **MODIS Terra** or **Dark** map styles.
- **Dynamic UI**: Toggle visibility directly from the **Map Layers** settings.

---

## 📊 Data Details

### Data Source

- **Provider**: OpenWeatherMap (OWM)
- **Service**: Weather Maps 1.0
- **URL**: `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png`
- **Update Frequency**: Approximately every 10 minutes.
- **Data Latency**: Near real-time satellite processing.

### Cloud Product

- **Product Code**: `clouds_new` (Modern Tiled API)
- **Resolution**: Global tiled coverage.
- **Z-Index**: 1000 (Placed above base maps, below markers and terminator).

---

## 🎯 Use Cases

1. **Atmospheric Monitoring**: Observe moving weather systems that may impact local operating conditions or boat tours.
2. **Propagation Prediction**: Analyze thick cloud cover or weather fronts that can influence VHF/UHF propagation.
3. **Historical Comparison**: Compare current moisture levels with historical "low water" data found in the **Rich Brothers** ledgers.
4. **Satellite Tracking Context**: See if visual satellite passes (like the ISS) will be obscured by local cloud cover.

---

## 🔧 Usage

### Basic Setup

1. **Configure API Key**: Ensure `VITE_OPENWEATHER_API_KEY=` is set in your `.env` file. Same as your standard OPEN Weather API KEY
2. **Enable Plugin**: Open **Settings** → **Map Layers** and toggle **☁️ Global Clouds**.
3. **Adjust Opacity**: Use the **Opacity** slider to find the right balance (Default: 50%).

---

## ⚙️ Configuration

### Default Settings

```json
{
  "id": "owm-clouds",
  "enabled": false,
  "opacity": 0.5,
  "category": "weather",
  "zIndex": 1000
}
```
