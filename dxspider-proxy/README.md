# DX Spider Telnet Proxy

A microservice that maintains a persistent telnet connection to DX Spider cluster nodes and exposes the spots via a simple HTTP REST API.

## Why This Exists

Many cloud hosting platforms (including Railway) don't support outbound telnet connections. This proxy service solves that by:

1. Maintaining a persistent telnet connection to DX Spider
2. Accumulating spots in memory (30-minute retention)
3. Exposing spots via HTTP API that any app can consume

## Features

- **Auto-reconnect** - Automatically reconnects on disconnect
- **Multi-node failover** - Cycles through multiple DX Spider nodes if one fails
- **Keepalive** - Sends periodic keepalive to maintain connection
- **Spot deduplication** - Prevents duplicate spots within 2-minute window
- **30-minute retention** - Accumulates spots for richer data
- **Mode detection** - Automatically detects CW, SSB, FT8, etc. from comments
- **CORS enabled** - Can be called from any frontend

## Environment Variables

| Variable             | Default                            | Description                                                         |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `PORT`               | 3001                               | HTTP server port                                                    |
| `CALLSIGN`           | K0CJH                              | Callsign for DX Spider login — **must be a valid amateur callsign** |
| `CLUSTER_STATUS_URL` | repo raw `cluster-status.json` URL | Remote kill-switch flag file (see below)                            |

> The proxy refuses to connect if `CALLSIGN` is not a valid amateur callsign
> (e.g. the old `OPENHAMCLOCK` default), rather than spamming nodes with junk logins.

## Remote Kill Switch

Before the first dial and every 15 minutes after, the proxy fetches
`cluster-status.json` from the OpenHamClock repo (Staging branch). Setting
`"enabled": false` — or raising `"minProxyVersion"` above this deployment's
version — makes every deployment disconnect and stop dialing cluster nodes
within one refresh interval. This exists because pre-v26.4 deployments hammered
NC7J for months with no way to reach them; from v1.1.0 on, the fleet can be
stopped remotely if a release misbehaves. The check **fails open**: an
unreachable flag file never disables anything.

## Stale-Client Nudge

Requests from OpenHamClock installs older than the good-neighbour fixes
(`User-Agent: OpenHamClock/<version>` below 26.5.1) get a synthetic
`UPDATE-OHC` spot prepended to spot responses, telling the operator to update —
rendered right in their DX cluster panel. `GET /api/clients` lists every client
seen in the last 7 days (IP, User-Agent, version, stale flag) so stale installs
can be counted and cross-referenced against sysop abuse reports.

## API Endpoints

### `GET /health`

Health check endpoint.

```json
{
  "status": "ok",
  "connected": true,
  "currentNode": "DX Spider UK",
  "spotsInMemory": 142,
  "totalSpotsReceived": 1847,
  "lastSpotTime": "2025-01-31T12:34:56.789Z",
  "connectionUptime": "3600s",
  "uptime": "7200s"
}
```

### `GET /api/spots`

Get accumulated spots with full details.

Query parameters:

- `limit` (default: 50, max: 200) - Number of spots to return
- `since` (timestamp) - Only return spots after this timestamp

```json
{
  "spots": [
    {
      "spotter": "W3ABC",
      "freq": "14.025",
      "freqKhz": 14025,
      "call": "JA1XYZ",
      "comment": "CW 599",
      "time": "12:34z",
      "mode": "CW",
      "timestamp": 1706704496789,
      "source": "DX Spider"
    }
  ],
  "total": 142,
  "connected": true,
  "source": "DX Spider UK",
  "timestamp": 1706704500000
}
```

### `GET /api/dxcluster/spots`

Get spots in simplified format (compatible with OpenHamClock).

Query parameters:

- `limit` (default: 25, max: 100)

```json
[
  {
    "spotter": "W3ABC",
    "freq": "14.025",
    "call": "JA1XYZ",
    "comment": "CW 599",
    "time": "12:34z",
    "mode": "CW",
    "source": "DX Spider Proxy"
  }
]
```

### `GET /api/stats`

Get statistics about spots.

```json
{
  "connected": true,
  "currentNode": "DX Spider UK",
  "totalSpots": 142,
  "totalReceived": 1847,
  "lastSpotTime": "2025-01-31T12:34:56.789Z",
  "retentionMinutes": 30,
  "bandCounts": {
    "20m": 45,
    "40m": 32,
    "15m": 28,
    "10m": 20
  },
  "modeCounts": {
    "FT8": 67,
    "CW": 35,
    "SSB": 25
  }
}
```

### `GET /api/nodes`

List available DX Spider nodes.

```json
{
  "nodes": [
    { "index": 0, "name": "DX Spider UK (G6NHU)", "host": "dxspider.co.uk", "port": 7300, "active": true },
    { "index": 1, "name": "AI9T", "host": "dxc.ai9t.com", "port": 7373, "active": false }
  ],
  "currentIndex": 0
}
```

### `POST /api/reconnect`

Force reconnection to current node.

### `POST /api/switch-node`

Switch to a different node.

```json
{ "index": 1 }
```

## Deployment

### Railway

1. Create a new project in Railway
2. Connect your GitHub repo or upload files
3. Set environment variable: `CALLSIGN=YOURCALL`
4. Deploy!

The service will automatically start and connect to DX Spider.

### Docker

#### Compose

When using a compose file for OpenHamClock, you can add it as an additional service:

```yaml
services:
  openhamclock: ...

  dxspider-proxy:
    build:
      context: ./dxspider-proxy # path to this subdirectory in the openhamclock repo
    image: ghcr.io/accius/dxspider-proxy:latest
    restart: unless-stopped
    container_name: dxspider-proxy
```

#### CLI

```bash
# Build
docker build -t dxspider-proxy .

# or Pull
docker pull ghcr.io/accius/dxspider-proxy:latest

# Run
docker run -p 3001:3001 -e CALLSIGN=YOURCALL ghcr.io/accius/dxspider-proxy:latest
```

### Local Development

```bash
npm install
CALLSIGN=YOURCALL npm start
```

## Using with OpenHamClock

If using docker, edit the `DXSPIDER_PROXY_URL` variable in your `.env` file

else, update your OpenHamClock configuration to use this proxy as a DX cluster source:

```text
https://your-proxy-url.railway.app/api/dxcluster/spots
```

## DX Spider Nodes

The proxy cycles through these nodes on failure:

1. dxspider.co.uk:7300 (DX Spider UK, G6NHU)
2. dxc.ai9t.com:7373 (AI9T)

> Note: `dxc.nc7j.com` (NC7J/NG7M, ArcConnect) was removed at the sysop's request —
> it rejects SSID logins and treated our reconnects as abuse. **Do not re-add it.**

## License

MIT
