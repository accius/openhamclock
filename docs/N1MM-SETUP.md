# N1MM+ Integration with OpenHamClock

OpenHamClock can receive live QSO data from N1MM+ (and DXLog) during contests. Each contact you log appears on the map in real time as a great-circle arc from your station to the worked station, color-coded by band — giving you a live visual picture of your contest activity.

## How It Works

N1MM+ has a built-in feature that broadcasts UDP packets every time you log a contact. OpenHamClock listens for these broadcasts and plots each QSO on the map with band-colored arcs.

```text
N1MM+  ──── UDP (port 12060) ────▶  OpenHamClock Server
                                          │
                                          ▼
                                    Contest QSOs Layer
                                    (map arcs + stats)
```

## Quick Start

### Step 1: Enable in OpenHamClock

Add these to your `.env` file (or `.env.local`):

```env
N1MM_UDP_ENABLED=true
N1MM_UDP_PORT=12060
```

If you're using Docker, the port is already mapped in `docker-compose.yml`. Just set the env vars and restart.

If you're running directly with Node, restart the server after changing your `.env`.

### Step 2: Configure N1MM+

1. Open N1MM+ and go to **Config → Configure Ports, Mode Control, Audio, Other...**
2. Click the **Broadcast Data** tab
3. Check **Contact** (this sends a UDP packet on every logged QSO)
4. Set the **Radio Nr** to match your station
5. In the broadcast address list, add the IP address of the machine running OpenHamClock:
   - If N1MM+ and OpenHamClock are on the **same machine**: use `127.0.0.1:12060`
   - If they're on **different machines** on your LAN: use the OpenHamClock machine's local IP, e.g. `192.168.1.100:12060`
6. Click **OK** to save

> **Tip:** N1MM+ can broadcast to multiple addresses. If you already have other software listening (like DXKeeper), just add OpenHamClock's address as an additional entry.

### Step 3: Enable the Map Layer

1. In OpenHamClock, open **Settings** (gear icon)
2. Go to the **Map Layers** tab
3. Find **Contest QSOs** under the Amateur category and enable it
4. Log a contact in N1MM+ — you should see it appear on the map within a few seconds

## Configuration Options

All settings go in your `.env` or `.env.local` file:

| Variable                   | Default | Description                                             |
| -------------------------- | ------- | ------------------------------------------------------- |
| `N1MM_UDP_ENABLED`         | `false` | Set to `true` to enable the UDP listener                |
| `N1MM_UDP_PORT`            | `12060` | UDP port to listen on (must match N1MM+ config)         |
| `N1MM_MAX_QSOS`            | `200`   | Maximum QSOs to keep in memory                          |
| `N1MM_QSO_MAX_AGE_MINUTES` | `360`   | QSOs older than this (6 hours) are pruned automatically |

## Docker Users

The default `docker-compose.yml` already maps the UDP port:

```yaml
ports:
  - '12060:12060/udp'
```

Just make sure your `.env` has `N1MM_UDP_ENABLED=true` and restart the container:

```bash
docker compose down && docker compose up -d
```

If N1MM+ is running on the Docker host machine, it should broadcast to `127.0.0.1:12060` and Docker will forward it into the container. If N1MM+ is on a different machine, use the Docker host's LAN IP.

## Firewall Notes

- The UDP port (default 12060) must be open on the OpenHamClock machine's firewall
- **Windows**: You may get a Windows Firewall prompt — click **Allow**
- **Linux**: `sudo ufw allow 12060/udp` (if using ufw)
- **macOS**: Usually works without changes on a local network

## Troubleshooting

**No QSOs appearing on the map:**

1. Check the server logs — you should see `[N1MM] UDP listener on 0.0.0.0:12060` at startup. If you don't, verify `N1MM_UDP_ENABLED=true` in your `.env` and restart.
2. In N1MM+, verify the **Contact** checkbox is checked in Broadcast Data settings.
3. Make sure the broadcast IP and port in N1MM+ match your OpenHamClock setup.
4. Check that no firewall is blocking UDP port 12060.

**Map layer not visible:**

- Make sure the **Contest QSOs** layer is enabled in Settings → Map Layers.

**Testing without a live contest:**

You can send a test QSO via the HTTP API to verify everything is working:

```bash
curl -X POST http://localhost:3000/api/contest/qsos \
  -H "Content-Type: application/json" \
  -d '[{
    "call": "W1AW",
    "freq": 14.250,
    "mode": "SSB",
    "timestamp": "2025-01-01T12:00:00Z",
    "grid": "FN31",
    "exchange": "599 CT"
  }]'
```

> **Note:** The POST endpoint requires write authentication if you have `OHC_WRITE_KEY` set in your environment.

## Also Works With

- **DXLog** — uses the same N1MM+ UDP broadcast format; configure the same way
- **HTTP API** — any logger can POST JSON to `/api/contest/qsos` for integration without UDP
