# HFJ-350M Antenna Calculator

A portable antenna calculator specifically designed for the **Comet HFJ-350M** multi-band antenna. This tool helps you find the correct coil setup, jumper settings, and precise telescope length for any frequency within the supported amateur radio bands.

## Features

- **Multi-band Support**: Covers all bands supported by the HFJ-350M (160m to 6m).
- **Precise Calculation**: Input a specific frequency (e.g., `7.150` or `14.200`) to get the exact telescope length in millimeters.
- **Visual Feedback**: Progress bars show the relative telescope extension.
- **Setup Guidance**: Displays the required coil combinations and jumper terminals for each band.
- **Persistence**: Remembers your last used frequency or band across sessions.
- **Theme Support**: Automatically adapts to OpenHamClock's Dark, Light, Legacy, and Retro themes.
- **Draggable Interface**: Move the calculator window anywhere on your screen.

## Supported Bands & Data

The calculator includes data derived from the official manual for:
- **160m**: Requires 3.5 + 1.8 coil.
- **80m**: Requires 3.5 coil.
- **40m**: Standard base coil.
- **30m - 6m**: Various jumper terminal settings.

## How to Use

1. **Install a Userscript Manager**: See the installation guides for [Firefox](./docs/Firefox_Installation.md), [Chrome](./docs/Chrome_Installation.md), [Brave](./docs/Brave_Installation.md), or [Opera](./docs/Opera_Installation.md).
2. **Install the Script**: Load [hfj350m_calculator.user.js](../hfj350m_calculator.user.js) into your manager.
3. **Open the Calculator**: Click the 📡 icon at the bottom right of your OpenHamClock.
4. **Input**: Type a band (e.g., `20m`) or a frequency in MHz (e.g., `14.074`).
5. **Adjust**: The tool will show you exactly how many millimeters to extend the telescope.

## Sensitivity

The tool also displays the **Sensitivity** (kHz/cm) for each band, helping you understand how much a small change in length affects your SWR.

---
*Developed by DO3EET*
