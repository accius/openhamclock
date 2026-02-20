# OpenHamClock WSJT-X Relay Agent

Bridges your local WSJT-X instance to a remote OpenHamClock server.

WSJT-X sends decoded FT8/FT4/JT65/WSPR messages via UDP, which only works on the local network. This relay agent captures those UDP packets on your machine and forwards them to your cloud-hosted OpenHamClock instance (e.g. openhamclock.com) over HTTPS.

## How It Works

```
WSJT-X  ──UDP──►  relay.js (your PC)  ──HTTPS──►  openhamclock.com
                   port 2237                        /api/wsjtx/relay
```

## Quick Start

### 1. Get Your Relay Key

On your OpenHamClock server, set the `WSJTX_RELAY_KEY` environment variable:

```bash
# In .env file or docker-compose environment:
WSJTX_RELAY_KEY=your-secret-key-here
```

Pick any strong random string. This authenticates the relay so only your agent can push decodes to your server.

### 2. Run the Relay

On the machine running WSJT-X:

```bash
# Download just this folder (or copy it from the repo)
node relay.js --url https://openhamclock.com --key your-secret-key-here
```

Or with environment variables:

```bash
export OPENHAMCLOCK_URL=https://openhamclock.com
export RELAY_KEY=your-secret-key-here
node relay.js
```

### 3. Configure WSJT-X

In WSJT-X:

1. Go to **Settings → Reporting**
2. Under **UDP Server**:
   - Address: `127.0.0.1`
   - Port: `2237`
   - ☑ Accept UDP requests

That's it. The relay will show decoded messages as they come in.

## Requirements

- **Node.js 14+** (no npm install needed — zero dependencies)
- WSJT-X, JTDX, or any software that speaks the WSJT-X UDP protocol
- Network access to your OpenHamClock server

## Options

| Flag         | Env Variable       | Default | Description               |
| ------------ | ------------------ | ------- | ------------------------- |
| `--url`      | `OPENHAMCLOCK_URL` | —       | Server URL (required)     |
| `--key`      | `RELAY_KEY`        | —       | Auth key (required)       |
| `--port`     | `WSJTX_UDP_PORT`   | `2237`  | Local UDP port            |
| `--interval` | `BATCH_INTERVAL`   | `2000`  | Batch send interval (ms)  |
| `--verbose`  | `VERBOSE=true`     | off     | Show all decoded messages |

## Running as a Service

### Linux (systemd)

```ini
# /etc/systemd/system/wsjtx-relay.service
[Unit]
Description=OpenHamClock WSJT-X Relay
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/relay.js
Environment=OPENHAMCLOCK_URL=https://openhamclock.com
Environment=RELAY_KEY=your-secret-key
Restart=always
RestartSec=5
User=your-username

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now wsjtx-relay
```

### Windows (Task Scheduler)

Create a batch file `start-relay.bat`:

```batch
@echo off
set OPENHAMCLOCK_URL=https://openhamclock.com
set RELAY_KEY=your-secret-key
node C:\path\to\relay.js
```

Add it to Task Scheduler to run at login.

## Troubleshooting

**Port already in use**: Another program is listening on 2237. Use `--port 2238` and update WSJT-X to match.

**Authentication failed**: Double-check that `WSJTX_RELAY_KEY` in your server .env matches the `--key` you're passing to the relay.

**Connection errors**: The relay automatically retries with backoff. Check that your server URL is correct and accessible.

**No decodes showing**: Make sure WSJT-X is set to UDP address `127.0.0.1` port `2237`, and that the "Accept UDP requests" checkbox is enabled.
