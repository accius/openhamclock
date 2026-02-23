# APRS Newsfeed (Inbox) for OpenHamClock

A real-time message inbox for OpenHamClock that fetches your latest APRS text messages from **aprs.fi**.

## Features

- **Automated Fetching**: Retrieves the 10 latest messages sent to your configured callsign.
- **New Message Notification**: A red badge appears on the toggle button when new messages arrive.
- **Multi-language Support**: Supports English, German, and Japanese.
- **Theme Integrated**: Styles automatically match OpenHamClock's theme (Dark, Light, Legacy, Retro).
- **Secure API Storage**: Your aprs.fi API key is stored locally in your browser's `localStorage`.
- **Draggable UI**: Place the message window anywhere on your dashboard.

## Requirements

1. **aprs.fi API Key**: You need a free API key from [aprs.fi](https://aprs.fi/page/api).
2. **Callsign**: Ensure your callsign is correctly configured in OpenHamClock settings.

## Installation

1. Install a Userscript Manager (e.g., Tampermonkey or Greasemonkey).
2. Install the script: [aprs_newsfeed.user.js](./aprs_newsfeed.user.js).
3. Open OpenHamClock and click the 📩 icon at the bottom right.
4. Enter your **aprs.fi API Key** in the settings area at the bottom of the window and click **Save**.

## API Limits

This tool polls the aprs.fi API every 5 minutes to respect their rate limits. Clicking the toggle button also triggers a manual refresh.

---
*Developed by DO3EET*
