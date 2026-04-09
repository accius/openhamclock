# Docker Deployment Guide

## Quick Start (Zero Config)

```bash
git clone https://github.com/OpenHamClock/openhamclock.git
cd openhamclock
docker compose up -d
```

Open **<http://localhost:3000>** — that's it. OpenHamClock runs with sensible defaults.

## Customize Your Station

Copy the quick-start env file and edit it:

```bash
cp stack.env.example stack.env
```

Set your callsign, grid square, and timezone:

```env
CALLSIGN=K0CJH
LOCATOR=FN20
TZ=America/New_York
```

Restart to apply:

```bash
docker compose down && docker compose up -d
```

> **Tip:** `stack.env` contains only the essentials. For the full list of 50+ options (WSJT-X, N1MM, weather APIs, DX cluster, propagation, etc.), see `.env.example`.

## Portainer / Stacks

If deploying via Portainer:

1. Paste the `docker-compose.yml` contents into a new Stack
2. Use the **Environment** tab to add variables from `stack.env.example`
3. Or upload `stack.env` in the **env file** section

The compose file loads both `stack.env` and `.env` automatically (both optional).

## Ports

| Port  | Protocol | Service                     |
| ----- | -------- | --------------------------- |
| 3000  | TCP      | Web UI                      |
| 2237  | UDP      | WSJT-X / JTDX               |
| 12060 | UDP      | N1MM / DXLog contest logger |

To change the web UI port on the host:

```yaml
ports:
  - '8080:3000' # Access at http://localhost:8080
```

## Reverse Proxy

If running behind nginx/Caddy/Traefik, you may want to override the health check endpoint:

```env
HEALTH_ENDPOINT=http://localhost:3000/api/health
```

## Volumes (Optional)

To persist stats and settings across container rebuilds:

```yaml
services:
  openhamclock:
    volumes:
      - ohc-data:/data
volumes:
  ohc-data:
```

## Updating

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

## Configuration Priority

OpenHamClock reads configuration from multiple sources. Later sources override earlier ones:

1. **Built-in defaults** (in `config.js` and `server.js`)
2. **`stack.env`** file (loaded by docker-compose, optional)
3. **`.env`** file (loaded by docker-compose, optional)
4. **`environment:`** block in `docker-compose.yml`
5. **UI settings** (saved in browser or via Settings Sync)

## Environment Variable Reference

See `.env.example` for the complete list with descriptions. Key sections:

- **Station Info** — `CALLSIGN`, `LOCATOR`, `LATITUDE`, `LONGITUDE`
- **Display** — `THEME`, `UNITS`, `TIME_FORMAT`, `LAYOUT`
- **Features** — `SHOW_POTA`, `SHOW_SATELLITES`, `SHOW_DX_PATHS`
- **DX Cluster** — `DX_CLUSTER_SOURCE`, `SPOT_RETENTION_MINUTES`
- **WSJT-X** — `WSJTX_ENABLED`, `WSJTX_UDP_PORT`, `WSJTX_RELAY_KEY`
- **N1MM** — `N1MM_UDP_ENABLED`, `N1MM_UDP_PORT`
- **Weather** — `OPENWEATHER_API_KEY`, `VITE_AMBIENT_*`
- **Advanced** — `ITURHFPROP_URL`, `HEALTH_ENDPOINT`, `CORS_ORIGINS`
