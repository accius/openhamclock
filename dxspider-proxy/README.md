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

| Variable   | Default      | Description                       |
| ---------- | ------------ | --------------------------------- |
| `PORT`     | 3001         | HTTP server port                  |
| `CALLSIGN` | OPENHAMCLOCK | Callsign used for DX Spider login |

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
    { "index": 0, "name": "DX Spider UK", "host": "dxspider.co.uk", "port": 7300, "active": true },
    { "index": 1, "name": "W6KK", "host": "w6kk.no-ip.org", "port": 7300, "active": false }
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

```bash
docker build -t dxspider-proxy .
docker run -p 3001:3001 -e CALLSIGN=YOURCALL dxspider-proxy
```

### Local Development

```bash
npm install
CALLSIGN=YOURCALL npm start
```

## Using with OpenHamClock

Once deployed, update your OpenHamClock configuration to use this proxy as a DX cluster source:

```
https://your-proxy-url.railway.app/api/dxcluster/spots
```

## DX Spider Nodes

The proxy cycles through these nodes on failure:

1. dxspider.co.uk:7300 (UK)
2. w6kk.no-ip.org:7300 (California)
3. dxc.nc7j.com:7373 (NC7J)
4. dx.k3lr.com:7300 (K3LR)

## License

MIT
