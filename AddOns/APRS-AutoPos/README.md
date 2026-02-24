# APRS Auto-Position for OpenHamClock

Automatically updates your station's geographic position and Maidenhead locator in OpenHamClock based on your APRS beacons from **aprs.fi**. Perfect for mobile or portable operations (e.g., in a car or while hiking).

## Features

- **Dynamic Updates**: Periodically fetches the latest coordinates for a specific SSID.
- **Maidenhead Conversion**: Automatically calculates and updates your 6-digit Grid Square (Locator).
- **Live UI Refresh**: Triggers an internal OpenHamClock refresh so the map and all distance calculations update instantly.
- **Smart Filtering**: Only updates if the position has changed by more than ~50 meters to reduce noise.
- **Drawer Integration**: Accessible via the **📍 icon** in the shared 🧩 AddOn menu.
- **Persistence**: Remembers your preferred SSID and update interval.

## Requirements

1. **aprs.fi API Key**: Required to fetch data. (Shared with the APRS Newsfeed AddOn).
2. **Tracked SSID**: The SSID you want to follow (e.g., `-9` for your car, `-7` for your handheld).

## Installation

1. Install a Userscript Manager (e.g., Tampermonkey or Greasemonkey).
2. Install the script: [aprs_autopos.user.js](./aprs_autopos.user.js).
3. Open OpenHamClock and click the 🧩 icon, then the 📍 icon.
4. Open the settings (🔧) and enter your **aprs.fi API Key** and the **SSID** to track.

## How it works

The script polls the `aprs.fi` API at the configured interval. If a new position is found, it updates the `openhamclock_config` in your browser's local storage and broadcasts a change event. The app then re-centers your station marker and re-calculates all propagation paths.

---

_Developed by DO3EET_
