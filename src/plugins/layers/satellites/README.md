🛰️ Satellite Tracks Plugin
Version: 1.5.1

Last Updated: 2026-02-14

Category: Satellites

Contributor: Carl Reinemann, USRadioguy.com

Data Source: Internal API / TLE Derived Positions

Overview
The Satellite Tracks plugin is a powerful situational awareness tool that renders real-time orbital positions, visibility footprints, and predicted ground tracks directly onto the map. This plugin transforms OpenHamClock into a dedicated tracking station, allowing operators to anticipate passes for amateur radio satellites, weather satellites (NOAA/Meteor), and the ISS.

🌟 Features
Core Capabilities
Real-time Orbital Positioning: Dynamic satellite markers that update positions every minute.

Visual Footprints: Circular "visibility" overlays indicating the ground area where the satellite is currently above the horizon.

Predicted Ground Tracks: Dashed path lines showing the orbital trajectory (Lead Time) to help plan for upcoming passes.

Automatic Unit Scaling: Seamlessly switches between Imperial (mi) and Metric (km) for altitude and range calculations.

Data Visualization
Interactive Popups: Click any satellite to view a high-fidelity telemetry card including:

Alt/Range: Current height and distance from your station.

Az/El: Precise Azimuth and Elevation for antenna pointing.

Status: Visual indicator for "Visible" vs "Below Horizon" status.

Sub-Layer Toggles: Independently enable or disable tracks and footprints without hiding the satellite itself.

📊 Data Details
Data Source
Provider: Internal API (/api/satellites/positions).

Update Frequency: Position rendering updates every 60 seconds.

Prediction Logic: Utilizes a 45-minute lead-time window for path projection.

Visualization Specs
Track Style: Cyan (#00ffff) dashed polyline with adjustable opacity.

Footprint Style: Yellow-bordered circles with cyan fill at 10% base opacity.

Marker Design: Monospace callsign labels with glow effects for high visibility against dark map themes.

🎯 Use Cases
Pass Planning: Use the Lead Time track lines to see exactly when a satellite will enter your local footprint.

Antenna Pointing: Real-time Azimuth and Elevation data in popups provides the necessary coordinates for manual or automated antenna rotors.

Visual Observation: Coordinate with the Global Clouds plugin to determine if a passing satellite (like the ISS) will be visible from your location or obscured by weather.

Field Operations: Quickly identify which satellites are currently "in view" for portable weak-signal work.

🔧 Usage
Basic Setup
Enable Plugin: Open Settings → Satellites and toggle Satellite Tracks.

Select Satellites: Use the search box or "Select All" button in the Satellites tab to choose which birds to track.

Customize Display: Toggle Track Lines or Footprints on/off to reduce map clutter.

⚙️ Configuration
Default Settings
JSON
{
  "id": "satellites",
  "enabled": true,
  "opacity": 1.0,
  "category": "satellites",
  "config": {
    "leadTimeMins": 45,
    "tailTimeMins": 15,
    "showTracks": true,
    "showFootprints": true
  }
}
