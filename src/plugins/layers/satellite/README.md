🛰 Satellite Tracks Plugin
Version: 1.0.0

Last Updated: 2026-02-16

Category: Satellites

Contributor: Carl Reinemann, USRadioguy.com

Data Source: Internal TLE API / satellite.js

Overview
The Satellite Tracks plugin provides high-performance, real-time orbital tracking and visualization for the OpenHamClock interface. It uses on-device orbital propagation to calculate precise positions, helping operators predict passes and monitor satellite telemetry in a dedicated data window.

🌟 Features
Core Capabilities
Real-time Propagation: Calculates satellite positions locally using satellite.js and TLE data fetched every 60 seconds.

Orbital Predictions: Displays predicted future paths (Lead Tracks) and historical paths (Tail Tracks).

Dynamic Footprints: Renders real-time ground station line-of-sight footprints that change color based on visibility.

Interactive Tracking: Click any satellite icon to "pin" it, highlighting its specific orbit and opening the telemetry window.

Data Visualization
Floating Data Window: A dedicated UI displaying real-time Altitude, Azimuth, Elevation, Range, and Mode.

Visual Alerts: Satellites currently above the horizon feature a "Visible" blinking indicator.

Geo-Replication: Ensures tracks and markers render seamlessly across the international date line.

Dual Unit Support: Toggle between Imperial (miles) and Metric (kilometers) for all distance data.

📊 Data Details
Data Source
Provider: Internal API (/api/satellites/tle).

Propagation Library: satellite.js (SGP4/SDP4).

Update Frequency: TLE data and orbital paths refresh every 1 minute.

Visual Refresh: Dynamic rendering updates on every state or config change.

Technical Specs
Lead Time: Default 45-minute future prediction.

Tail Time: Default 15-minute historical path.

Z-Index: Prioritizes pinned satellites at 10,000 to stay above other map layers.

🎯 Use Cases
Pass Prediction: Use the yellow dashed lead tracks to visualize exactly where a satellite will be in the next 45 minutes.

Antenna Aiming: Monitor real-time Azimuth and Elevation in the floating window for precise ground station alignment.

Visual Observation: Identify "Visible" satellites that are currently above the horizon for optical tracking or radio contact.

Footprint Analysis: Determine if a specific location falls within a satellite's current reception footprint.

🔧 Usage
Enable Plugin: Open Settings → Map Layers and toggle 🛰 Satellite Tracks.

Pin a Satellite: Click on any satellite icon on the map to open the focused data window.

Configure Views: Use the config sliders to adjust Lead/Tail track lengths and toggle footprints.

Close Data Window: Click the red "×" in the telemetry window or click the satellite again to unpin.
