# OpenHamClock Rig Control Daemon

This standalone Node.js service acts as a bridge between the OpenHamClock web application and your local radio control software. It exposes a simple HTTP JSON API that the frontend consumes.

> 📖 **New to Rig Control?** Check out the step-by-step [User Guide](./UserGuide.md) for easy setup instructions!

## Features

- **Unified API**: Abstracts differences between `rigctld` (HAMlib) and `flrig`.
- **Lightweight**: Minimal dependencies, runs anywhere Node.js runs.
- **PTT Support**: Can trigger PTT transmission.
- **Polling**: Automatically polls the radio for Frequency, Mode, and PTT status updates.
- **Auto-Tune**: Supports delayed antenna tuning commands (flrig only).

## Supported Backends

1.  **rigctld** (HAMlib): Uses the TCP text protocol (Default port 4532).
2.  **flrig**: Uses XML-RPC (Default port 12345).
3.  **mock**: Simulation mode (logs to console, no hardware needed).

## Installation

```bash
cd rig-control
npm install
```

## Configuration

Configuration is loaded from `rig-config.json`. On first run, this file is automatically created from `rig-config.json.example`:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5555,
    "cors": "*"
  },
  "radio": {
    "type": "flrig", // Options: "rigctld" or "flrig"
    "host": "127.0.0.1",
    "port": 12345, // rigctld default: 4532, flrig default: 12345
    "pollInterval": 1000, // How often to poll the radio (ms)
    "pttEnabled": false // Set to true to allow PTT commands
  }
}
```

**Important:** Your `rig-config.json` customizations are preserved during updates. The file is excluded from git tracking, so your local changes won't be overwritten when pulling new versions.

### Configuration Options

- **server.host**: IP to bind to (default 0.0.0.0)
- **server.port**: Port to listen on (default 5555)
- **radio.type**: `rigctld` (Hamlib) or `flrig`
- **radio.host**: Hostname/IP of the rig control software
- **radio.port**: Port of the rig control software
- **radio.pttEnabled**: Set to `true` to allow PTT commands. Defaults to `false` for safety.

### Remote Access

By default, the daemon binds to `0.0.0.0`, meaning it is accessible from other machines on your network.

- **Firewall**: Ensure port `5555` is open.
- **Connect**: In OpenHamClock Settings, use the daemon's IP (e.g., `http://192.168.1.50:5555`).

## Usage

### Start with Config File (Recommended)

```bash
node rig-daemon.js
```

### Start with CLI Arguments (Overrides Config)

You can override specific settings using CLI flags:

**For rigctld (Default port 4532):**

```bash
node rig-daemon.js --type rigctld --rig-port 4532
```

**For flrig (Default port 12345):**

```bash
node rig-daemon.js --type flrig
```

**For Simulation Mode:**

```bash
node rig-daemon.js --type mock
```

## API Endpoints

The daemon listens on port `5555` (configurable) and provides the following endpoints:

| Method | Endpoint  | Description                                                         |
| :----- | :-------- | :------------------------------------------------------------------ |
| `GET`  | `/status` | Returns JSON object with `freq`, `mode`, `ptt`, `connected` status. |
| `POST` | `/freq`   | Sets frequency. Body: `{ "freq": 14074000, "tune": true }` (Hz)     |
| `POST` | `/mode`   | Sets mode. Body: `{ "mode": "USB" }`                                |
| `POST` | `/ptt`    | Sets PTT. Body: `{ "ptt": true }`                                   |

## Troubleshooting

- **Check Connection**: Ensure `rigctld` or `flrig` is running and accessible.
- **CORS Errors**: The daemon enables CORS for all origins by default (`*`) to allow local development.
- **Port Conflicts**: If port 5555 is in use, change `server.port` in `rig-config.json`.

### Mixed Content Issues (HTTPS → HTTP)

**Problem:** If OpenHamClock is accessed via **HTTPS** (e.g., `https://yourdomain.com` or `https://openhamclock.com`), browsers will block HTTP requests to the rig daemon (`http://localhost:5555`) due to **Mixed Content** security policies.

**Browser Behavior:**

| Browser | Behavior | Workaround |
|---------|----------|------------|
| **Safari (macOS/iOS)** | ❌ **Strictly blocks** all mixed content. No override option. | No workaround available. Use Chrome/Firefox/Edge or run OpenHamClock locally via HTTP. |
| **Chrome** | ⚠️ Blocks by default. Shows shield icon in address bar to allow insecure content. | Click shield icon → "Load unsafe scripts" |
| **Firefox** | ⚠️ Blocks by default. Shows shield icon in address bar. | Click shield icon → "Disable protection for this session" |
| **Edge** | ⚠️ Blocks by default. Similar to Chrome. | Click shield icon → Allow |

**Recommendation:** For the best experience, run OpenHamClock locally using HTTP (e.g., `http://localhost:3000`) to avoid mixed content issues entirely. See the [User Guide](./UserGuide.md) for detailed setup instructions.



## Experimental Scripts

The `scripts/` folder contains experimental installation and utility scripts. These are currently **in testing** and may not function properly on all systems. Use them with caution.
