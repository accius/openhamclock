import { describe, it, expect } from 'vitest';
import {
  API_CACHE_MAX_ENTRIES,
  OFFLINE_PACK_CACHE,
  OFFLINE_TILE_HOSTS,
  isPersistentCacheName,
  isOfflineTileHost,
  normalizeVersion,
  cacheNames,
  staleCacheNames,
  isStreamingApiPath,
  classifyRequest,
  isCacheableApiResponse,
  keysToPrune,
} from './swPolicy';
import { MAP_STYLES } from './config.js';
import { offlinePackStyleIds } from './offlineTiles.js';

const ORIGIN = 'https://openhamclock.com';
const req = (over = {}) => ({
  url: `${ORIGIN}/`,
  method: 'GET',
  mode: 'no-cors',
  origin: ORIGIN,
  ...over,
});

describe('classifyRequest', () => {
  it('classifies top-level navigations', () => {
    expect(classifyRequest(req({ url: `${ORIGIN}/`, mode: 'navigate' }))).toBe('navigation');
    expect(classifyRequest(req({ url: `${ORIGIN}/some/spa/route`, mode: 'navigate' }))).toBe('navigation');
  });

  it('classifies hashed bundles and static content as assets', () => {
    expect(classifyRequest(req({ url: `${ORIGIN}/assets/index-Ck2f9a.js` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/assets/vendor-abc123.css` }))).toBe('asset');
    // Self-hosted Leaflet + fonts: the map cannot start offline without them
    expect(classifyRequest(req({ url: `${ORIGIN}/vendor/leaflet/leaflet.js` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/vendor/fonts/fonts.css` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/icons/icon-192.png` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/wasm/p533.wasm` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/geo/cq-zones.geojson` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/models/iss.glb` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/manifest.json` }))).toBe('asset');
    expect(classifyRequest(req({ url: `${ORIGIN}/favicon.ico` }))).toBe('asset');
  });

  it('classifies same-origin GET /api/* as api', () => {
    expect(classifyRequest(req({ url: `${ORIGIN}/api/solar` }))).toBe('api');
    expect(classifyRequest(req({ url: `${ORIGIN}/api/dxcluster/spots?band=20m` }))).toBe('api');
  });

  it('bypasses streaming API endpoints', () => {
    expect(classifyRequest(req({ url: `${ORIGIN}/api/pskreporter/stream` }))).toBe('bypass');
    expect(classifyRequest(req({ url: `${ORIGIN}/api/rig-bridge/relay/stream` }))).toBe('bypass');
    // Defensive: any future /api/**/stream endpoint is treated as SSE too.
    expect(classifyRequest(req({ url: `${ORIGIN}/api/future-thing/stream` }))).toBe('bypass');
    expect(classifyRequest(req({ url: `${ORIGIN}/api/pskreporter/stream?since=5` }))).toBe('bypass');
  });

  it('never intercepts non-GET methods', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(classifyRequest(req({ url: `${ORIGIN}/api/config`, method }))).toBe('bypass');
    }
  });

  it('bypasses cross-origin requests (tiles, CDNs)', () => {
    expect(classifyRequest(req({ url: 'https://tile.openstreetmap.org/3/4/2.png' }))).toBe('bypass');
    expect(classifyRequest(req({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' }))).toBe('bypass');
  });

  it('bypasses unrecognized same-origin paths and junk input', () => {
    expect(classifyRequest(req({ url: `${ORIGIN}/vendors.txt` }))).toBe('bypass');
    expect(classifyRequest(req({ url: `${ORIGIN}/metrics` }))).toBe('bypass');
    expect(classifyRequest(null)).toBe('bypass');
    expect(classifyRequest(req({ url: 'not a url', origin: undefined }))).toBe('bypass');
  });

  it('does not misclassify /api-lookalike paths', () => {
    // /apiary is not /api/
    expect(classifyRequest(req({ url: `${ORIGIN}/apiary` }))).toBe('bypass');
  });
});

describe('isStreamingApiPath', () => {
  it('matches the known SSE endpoints and generic /api/**/stream', () => {
    expect(isStreamingApiPath('/api/pskreporter/stream')).toBe(true);
    expect(isStreamingApiPath('/api/rig-bridge/relay/stream')).toBe(true);
    // Decoder panel: KiwiSDR audio through the Cloud Relay never ends
    expect(isStreamingApiPath('/api/rig-bridge/relay/audio')).toBe(true);
    expect(isStreamingApiPath('/api/foo/stream')).toBe(true);
    expect(isStreamingApiPath('/api/foo/stream/')).toBe(true);
    expect(isStreamingApiPath('/api/solar')).toBe(false);
    expect(isStreamingApiPath('/api/streamlined')).toBe(false);
  });
});

describe('cache naming and version pruning', () => {
  it('builds versioned ohc-* cache names', () => {
    expect(cacheNames('26.6.0-abc123')).toEqual({
      app: 'ohc-26.6.0-abc123-app',
      api: 'ohc-26.6.0-abc123-api',
    });
  });

  it('normalizes unsafe version tokens', () => {
    expect(normalizeVersion('26.6.0-k9')).toBe('26.6.0-k9');
    expect(normalizeVersion('a b/c?')).toBe('a_b_c_');
    expect(normalizeVersion('')).toBe('dev');
    expect(normalizeVersion(null)).toBe('dev');
  });

  it('selects only stale ohc-* caches for deletion', () => {
    const all = [
      'ohc-26.5.0-old1-app',
      'ohc-26.5.0-old1-api',
      'ohc-26.6.0-new-app',
      'ohc-26.6.0-new-api',
      'workbox-precache-v2', // not ours — must survive
      'some-other-app',
    ];
    expect(staleCacheNames(all, '26.6.0-new')).toEqual(['ohc-26.5.0-old1-app', 'ohc-26.5.0-old1-api']);
  });

  it('handles empty cache listings', () => {
    expect(staleCacheNames([], '26.6.0-x')).toEqual([]);
    expect(staleCacheNames(undefined, '26.6.0-x')).toEqual([]);
  });
});

describe('isCacheableApiResponse', () => {
  it('accepts ordinary successful JSON responses', () => {
    expect(isCacheableApiResponse({ ok: true, status: 200, contentType: 'application/json' })).toBe(true);
    expect(isCacheableApiResponse({ ok: true, status: 200, contentType: '' })).toBe(true);
  });

  it('rejects event streams even when path-based exclusion missed them', () => {
    expect(
      isCacheableApiResponse({
        ok: true,
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
      }),
    ).toBe(false);
  });

  it('rejects errors and partial content', () => {
    expect(isCacheableApiResponse({ ok: false, status: 500, contentType: '' })).toBe(false);
    expect(isCacheableApiResponse({ ok: false, status: 404, contentType: '' })).toBe(false);
    expect(isCacheableApiResponse({ ok: true, status: 206, contentType: '' })).toBe(false);
    expect(isCacheableApiResponse(null)).toBe(false);
  });
});

describe('keysToPrune', () => {
  it('returns nothing under the cap', () => {
    expect(keysToPrune(['a', 'b', 'c'], 5)).toEqual([]);
    expect(keysToPrune([], 5)).toEqual([]);
    expect(keysToPrune(undefined, 5)).toEqual([]);
  });

  it('prunes oldest-first down to the cap', () => {
    expect(keysToPrune(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b']);
  });

  it('defaults to the shared API cap', () => {
    const keys = Array.from({ length: API_CACHE_MAX_ENTRIES + 10 }, (_, i) => `k${i}`);
    const pruned = keysToPrune(keys);
    expect(pruned).toHaveLength(10);
    expect(pruned[0]).toBe('k0');
  });
});

describe('offline area packs', () => {
  const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/9/193/106';

  it('routes tiles from offline-pack hosts through the worker', () => {
    expect(classifyRequest(req({ url: USGS, mode: 'cors' }))).toBe('tile');
    expect(classifyRequest(req({ url: USGS, mode: 'no-cors' }))).toBe('tile');
  });

  it('still bypasses every other cross-origin request, navigations, and non-GET', () => {
    expect(
      classifyRequest(req({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/x/MapServer/tile/1/0/0' })),
    ).toBe('bypass');
    expect(classifyRequest(req({ url: 'https://tile.openstreetmap.org/1/0/0.png' }))).toBe('bypass');
    expect(classifyRequest(req({ url: USGS, mode: 'navigate' }))).toBe('bypass');
    expect(classifyRequest(req({ url: USGS, method: 'POST' }))).toBe('bypass');
  });

  it('host matching is exact (no suffix tricks)', () => {
    expect(isOfflineTileHost('basemap.nationalmap.gov')).toBe(true);
    expect(isOfflineTileHost('BASEMAP.NATIONALMAP.GOV')).toBe(true);
    expect(isOfflineTileHost('evil.basemap.nationalmap.gov.example')).toBe(false);
    expect(isOfflineTileHost('')).toBe(false);
  });

  it('the pack cache survives version changes', () => {
    expect(isPersistentCacheName(OFFLINE_PACK_CACHE)).toBe(true);
    expect(isPersistentCacheName('ohc-26.5.0-x-app')).toBe(false);
    const all = ['ohc-26.5.0-old-app', 'ohc-26.5.0-old-api', OFFLINE_PACK_CACHE];
    expect(staleCacheNames(all, '26.6.0-new')).toEqual(['ohc-26.5.0-old-app', 'ohc-26.5.0-old-api']);
  });

  it('every offline-pack basemap is served by a host the worker routes', () => {
    const ids = offlinePackStyleIds(MAP_STYLES);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const host = new URL(MAP_STYLES[id].url.replace(/\{[^}]+\}/g, '0')).hostname;
      expect(OFFLINE_TILE_HOSTS).toContain(host);
    }
  });

  it('no style from a provider that forbids bulk/offline download is flagged', () => {
    for (const id of offlinePackStyleIds(MAP_STYLES)) {
      expect(MAP_STYLES[id].url).not.toMatch(/arcgisonline\.com|google\.com|cartocdn\.com|tile\.openstreetmap\.org/);
    }
  });
});

describe('server-sent event streams are never intercepted', () => {
  const ORIGIN2 = 'https://openhamclock.com';
  it('bypasses EventSource requests by Accept header and /stream/<id> paths', () => {
    const base = { method: 'GET', mode: 'cors', origin: ORIGIN2 };
    expect(
      classifyRequest({ ...base, url: `${ORIGIN2}/api/logsync/wavelog/events`, accept: 'text/event-stream' }),
    ).toBe('bypass');
    expect(classifyRequest({ ...base, url: `${ORIGIN2}/api/pskreporter/stream/K0CJH` })).toBe('bypass');
    expect(classifyRequest({ ...base, url: `${ORIGIN2}/api/incident/abc/stream?x=1` })).toBe('bypass');
    expect(classifyRequest({ ...base, url: `${ORIGIN2}/api/logsync/wavelog/events`, accept: 'application/json' })).toBe(
      'api',
    );
  });
});
