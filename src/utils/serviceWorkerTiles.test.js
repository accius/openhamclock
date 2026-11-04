/**
 * Runs the real public/sw.js in a stub worker scope to check the offline
 * area pack tile route and the stale marker on API fallbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../../public/sw-policy.js';

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const TILE = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/9/193/106';
const ORIGIN = 'https://openhamclock.com';

function loadWorker({ fetchImpl, packTiles = {}, packDocs = {}, apiCache = {}, onLine = true, canvas = null }) {
  const listeners = {};
  const posted = [];
  const stores = {
    'ohc-offline-packs': new Map([
      ...Object.entries(packTiles),
      ...Object.entries(packDocs).map(([k, v]) => [
        k,
        new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }),
      ]),
    ]),
  };
  const caches = {
    open: async (name) => {
      if (!stores[name]) stores[name] = new Map(name.endsWith('-api') ? Object.entries(apiCache) : []);
      const m = stores[name];
      return {
        match: async (key) => {
          const k = typeof key === 'string' ? key : key.url;
          return m.has(k) ? m.get(k).clone() : undefined;
        },
        put: async (key, res) => m.set(typeof key === 'string' ? key : key.url, res),
        add: async (url) => m.set(url, await fetchImpl(url)),
        keys: async () => [...m.keys()],
        delete: async (k) => m.delete(k),
      };
    },
    match: async () => undefined,
    keys: async () => Object.keys(stores),
  };
  const client = { postMessage: (msg) => posted.push(msg) };
  const self = {
    location: { href: `${ORIGIN}/sw.js?v=test`, origin: ORIGIN },
    navigator: { onLine },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    clients: { get: async () => client, matchAll: async () => [client], claim: async () => {} },
    registration: {},
    OHC_SW_POLICY: globalThis.OHC_SW_POLICY,
  };
  const run = new Function(
    'self',
    'importScripts',
    'caches',
    'fetch',
    'OffscreenCanvas',
    'createImageBitmap',
    SW_SOURCE,
  );
  run(self, () => {}, caches, fetchImpl, canvas?.OffscreenCanvas, canvas?.createImageBitmap);

  const dispatchFetch = async (request) => {
    await new Promise((r) => setTimeout(r, 0)); // let routing load from the pack cache
    let responded = null;
    const waits = [];
    const event = {
      request: { method: 'GET', mode: 'cors', ...request },
      clientId: 'c1',
      respondWith: (p) => {
        responded = p;
      },
      waitUntil: (p) => waits.push(p),
    };
    listeners.fetch(event);
    const res = responded ? await responded : undefined;
    await Promise.all(waits);
    return res;
  };
  const dispatchInstall = async () => {
    const waits = [];
    listeners.install({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { dispatchFetch, dispatchInstall, posted, stores };
}

const img = (body = 'pack') => new Response(body, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });

describe('service worker: offline pack tiles', () => {
  beforeEach(() => vi.useRealTimers());

  it('goes to the network when no pack holds the tile', async () => {
    const fetchImpl = vi.fn(async () => img('net'));
    const { dispatchFetch, posted } = loadWorker({ fetchImpl });
    const res = await dispatchFetch({ url: TILE });
    expect(await res.text()).toBe('net');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([]);
  });

  it('serves a saved tile from the pack at once; no badge while the server answers', async () => {
    const fetchImpl = vi.fn(async () => img('net'));
    const { dispatchFetch, posted } = loadWorker({ fetchImpl, packTiles: { [TILE]: img('pack') } });
    expect(await (await dispatchFetch({ url: TILE })).text()).toBe('pack');
    expect(fetchImpl).toHaveBeenCalledWith(expect.anything(), { method: 'HEAD' }); // background reachability probe only
    expect(posted).toEqual([]);
  });

  it('answers a saved tile even while the network hangs, and shows the badge once the probe times out', async () => {
    const hung = vi.fn(() => new Promise(() => {}));
    const { dispatchFetch, posted } = loadWorker({ fetchImpl: hung, packTiles: { [TILE]: img('pack') } });
    const res = await dispatchFetch({ url: TILE }); // resolves after the probe's 4 s waitUntil
    expect(await res.text()).toBe('pack');
    expect(posted.map((m) => m.type)).toEqual(['OHC_OFFLINE_PACK_TILE']);
  }, 10000);

  it('serves the pack copy when the network fails and tells the page', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { dispatchFetch, posted } = loadWorker({ fetchImpl, packTiles: { [TILE]: img('pack') } });
    expect(await (await dispatchFetch({ url: TILE })).text()).toBe('pack');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('OHC_OFFLINE_PACK_TILE');
  });

  it('serves the pack copy without touching the network when the browser is offline', async () => {
    const fetchImpl = vi.fn();
    const { dispatchFetch } = loadWorker({ fetchImpl, onLine: false, packTiles: { [TILE]: img('pack') } });
    expect(await (await dispatchFetch({ url: TILE })).text()).toBe('pack');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the pack copy on an error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 502 }));
    const { dispatchFetch } = loadWorker({ fetchImpl, packTiles: { [TILE]: img('pack') } });
    expect(await (await dispatchFetch({ url: TILE })).text()).toBe('pack');
  });

  it('leaves other cross-origin tile servers alone', async () => {
    const fetchImpl = vi.fn();
    const { dispatchFetch } = loadWorker({ fetchImpl });
    const res = await dispatchFetch({ url: 'https://tile.openstreetmap.org/1/0/0.png' });
    expect(res).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('service worker: API fallback is marked stale', () => {
  it('adds X-OHC-Stale and keeps the original Date', async () => {
    const url = `${ORIGIN}/api/emcomm/alerts?lat=1&lon=2`;
    const cached = new Response('[1]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', Date: 'Thu, 15 Oct 2026 14:32:00 GMT' },
    });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { dispatchFetch } = loadWorker({ fetchImpl, apiCache: { [url]: cached } });
    const res = await dispatchFetch({ url, mode: 'same-origin' });
    expect(res.headers.get('x-ohc-stale')).toBe('1');
    expect(res.headers.get('date')).toBe('Thu, 15 Oct 2026 14:32:00 GMT');
    expect(await res.json()).toEqual([1]);
  });
});

describe('service worker: install precache', () => {
  it('precaches the self-hosted Leaflet and fonts along with the bundles', async () => {
    const html =
      '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css" /><script src="/vendor/leaflet/leaflet.js"></script>' +
      '<script type="module" src="/assets/index-abc.js"></script>';
    const fetchImpl = vi.fn(async (url) =>
      url === '/index.html' ? new Response(html, { headers: { 'Content-Type': 'text/html' } }) : new Response('x'),
    );
    const { dispatchInstall, stores } = loadWorker({ fetchImpl });
    await dispatchInstall();
    const app = stores['ohc-test-app'];
    expect([...app.keys()].sort()).toEqual([
      '/assets/index-abc.js',
      '/index.html',
      '/vendor/leaflet/leaflet.css',
      '/vendor/leaflet/leaflet.js',
    ]);
  });
});

const PACK = {
  id: 'p1',
  urlTemplate: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  subdomains: 'abc',
  minZoom: 6,
  maxZoom: 12,
};
const usgs = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${z}/${y}/${x}`;

function fakeCanvas() {
  const draws = [];
  class OffscreenCanvas {
    constructor(w, h) {
      this.w = w;
      this.h = h;
    }
    getContext() {
      return { drawImage: (...args) => draws.push(args), set imageSmoothingEnabled(v) {} };
    }
    async convertToBlob() {
      return new TextEncoder().encode('scaled'); // body stand-in (jsdom Blob is not undici's)
    }
  }
  const createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  return { OffscreenCanvas, createImageBitmap, draws };
}

describe('service worker: over-zoom from a pack', () => {
  const offline = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });

  it('scales up the saved parent when zoomed past the pack', async () => {
    const canvas = fakeCanvas();
    const { dispatchFetch, posted } = loadWorker({
      fetchImpl: offline,
      canvas,
      packTiles: { [usgs(12, 850, 1550)]: img('parent') },
      packDocs: { '/__ohc-offline-packs/manifest.json': { packs: [PACK] } },
    });
    // z14 tile (3401, 6202) sits in z12 parent (850, 1550) at column 1, row 2 of 4
    const res = await dispatchFetch({ url: usgs(14, 3401, 6202), destination: 'image' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ohc-overzoom')).toBe('12');
    expect(await res.text()).toBe('scaled');
    expect(canvas.draws[0].slice(1)).toEqual([64, 128, 64, 64, 0, 0, 256, 256]);
    expect(posted[0].type).toBe('OHC_OFFLINE_PACK_TILE');
  });

  it('does not wait out a hung network when an over-zoom stand-in exists', async () => {
    const canvas = fakeCanvas();
    const hung = vi.fn(() => new Promise(() => {})); // a LAN server that never answers
    const { dispatchFetch } = loadWorker({
      fetchImpl: hung,
      canvas,
      packTiles: { [usgs(12, 850, 1550)]: img('parent') },
      packDocs: { '/__ohc-offline-packs/manifest.json': { packs: [PACK] } },
    });
    const t0 = Date.now();
    const res = await dispatchFetch({ url: usgs(13, 1700, 3100), destination: 'image' });
    expect(res.headers.get('x-ohc-overzoom')).toBe('12');
    expect(Date.now() - t0).toBeLessThan(6000);
  }, 10000);

  it('gives up beyond the over-zoom limit or without a parent', async () => {
    const canvas = fakeCanvas();
    const { dispatchFetch } = loadWorker({
      fetchImpl: offline,
      canvas,
      packTiles: { [usgs(12, 850, 1550)]: img('parent') },
      packDocs: { '/__ohc-offline-packs/manifest.json': { packs: [PACK] } },
    });
    expect((await dispatchFetch({ url: usgs(19, 850 * 128, 1550 * 128) })).status).toBe(504);
    expect((await dispatchFetch({ url: usgs(14, 0, 0) })).status).toBe(504);
  });

  it('serves a blank 504 (not a crash) where OffscreenCanvas is missing', async () => {
    const { dispatchFetch } = loadWorker({
      fetchImpl: offline,
      packTiles: { [usgs(12, 850, 1550)]: img('parent') },
      packDocs: { '/__ohc-offline-packs/manifest.json': { packs: [PACK] } },
    });
    expect((await dispatchFetch({ url: usgs(13, 1700, 3100) })).status).toBe(504);
  });
});

describe('service worker: operator tile source', () => {
  const LAN = 'http://192.168.1.5:8080/data/osm/12/850/1550.png';

  it('routes a registered source through the pack cache', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { dispatchFetch } = loadWorker({
      fetchImpl,
      packTiles: { [LAN]: img('lan') },
      packDocs: { '/__ohc-offline-packs/sources.json': { prefixes: ['http://192.168.1.5:8080/data/osm/'] } },
    });
    expect(await (await dispatchFetch({ url: LAN, destination: 'image' })).text()).toBe('lan');
  });

  it('routes the source of a saved area even after the source setting is removed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { dispatchFetch } = loadWorker({
      fetchImpl,
      packTiles: { [LAN]: img('lan') },
      packDocs: {
        '/__ohc-offline-packs/manifest.json': {
          packs: [{ ...PACK, urlTemplate: 'http://192.168.1.5:8080/data/osm/{z}/{x}/{y}.png' }],
        },
      },
    });
    expect(await (await dispatchFetch({ url: LAN, destination: 'image' })).text()).toBe('lan');
  });

  it('leaves unregistered hosts alone', async () => {
    const fetchImpl = vi.fn();
    const { dispatchFetch } = loadWorker({ fetchImpl });
    expect(await dispatchFetch({ url: 'http://10.0.0.9/tiles/1/0/0.png', destination: 'image' })).toBeUndefined();
  });
});

describe('service worker: /vendor via CDN redirect', () => {
  it('caches an opaque CDN copy of Leaflet and serves it offline', async () => {
    let online = true;
    const opaque = { type: 'opaque', ok: false, status: 0, clone: () => opaque };
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return opaque;
    });
    const { dispatchFetch, stores } = loadWorker({ fetchImpl });
    const url = `${ORIGIN}/vendor/leaflet/leaflet.js`;
    expect(await dispatchFetch({ url, mode: 'no-cors', destination: 'script' })).toBe(opaque);
    await new Promise((r) => setTimeout(r, 0));
    expect(stores['ohc-test-app'].get(url)).toBe(opaque);
  });

  it('install falls back to a no-cors fetch when the CDN copy has no CORS headers', async () => {
    const html = '<script src="/vendor/leaflet/leaflet.js"></script>';
    const opaque = { type: 'opaque', ok: false, status: 0 };
    const fetchImpl = vi.fn(async (url, init) => {
      if (url === '/index.html') return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      if (init?.mode === 'no-cors') return opaque;
      throw new TypeError('CORS');
    });
    const { dispatchInstall, stores } = loadWorker({ fetchImpl });
    await dispatchInstall();
    expect(stores['ohc-test-app'].get('/vendor/leaflet/leaflet.js')).toBe(opaque);
  });
});
