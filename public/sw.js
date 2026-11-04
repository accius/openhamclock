/**
 * OpenHamClock service worker — offline mode / PWA support.
 *
 * This is a hand-rolled, dependency-free worker. It is a static file copied
 * verbatim by Vite; versioning comes from the registration URL query param:
 *
 *   navigator.serviceWorker.register('/sw.js?v=<version>-<buildstamp>')
 *
 * The app injects <version>-<buildstamp> at build time (see vite.config.mjs
 * `define` + src/pwa/registerServiceWorker.js). A new build produces a new
 * registration URL, which the browser treats as a new worker: it installs in
 * the background, and the app shows an "Update ready — Reload" toast.
 *
 * Strategies (decision logic lives in sw-policy.js, unit-tested via
 * src/utils/swPolicy.js):
 *   - navigations:        network-first, fall back to the cached app shell
 *   - /assets/* + static: cache-first, cache-on-fetch (hashed, immutable)
 *   - GET /api/*:         network-first with cached fallback — online
 *                         behavior is unchanged, offline panels get their
 *                         last-known data (marked X-OHC-Stale: 1 so the UI
 *                         can say "as of"). SSE streams are never touched.
 *   - offline-pack tiles: tiles from hosts whose terms allow offline area
 *                         packs, and from the operator's own tile server —
 *                         saved tiles straight from the pack, others from
 *                         the network, a scaled-up saved ancestor when the
 *                         network fails (over-zoom).
 *   - /vendor/*:          self-hosted Leaflet + fonts, or the CDN copy the
 *                         server redirects to — cached so the map starts
 *                         offline either way.
 *   - everything else:    bypassed (browser default), incl. cross-origin
 *
 * Escape hatch: loading the app with ?nosw unregisters this worker and
 * clears the versioned ohc-* caches (handled in
 * src/pwa/registerServiceWorker.js). Offline area packs are operator data
 * and are kept; delete them from the pack list.
 */
'use strict';

var RAW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';

// Same version token on the import keeps the policy file in lockstep with
// this worker across deploys (and past any HTTP cache).
importScripts('./sw-policy.js?v=' + encodeURIComponent(RAW_VERSION));

var POLICY = self.OHC_SW_POLICY;
var VERSION = POLICY.normalizeVersion(RAW_VERSION);
var CACHE = POLICY.cacheNames(VERSION);

/** Fixed cache key for the SPA shell — every navigation serves index.html. */
var SHELL_KEY = '/index.html';

// ── Install: precache the shell and the bundles it references ─────────────
// No build-time precache manifest: we fetch index.html and pull the
// /assets/* URLs out of it, so a single online visit is enough for the app
// to load offline afterwards. Lazily loaded chunks (3D globe, etc.) are
// picked up by the cache-on-fetch asset handler as they are used.
self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var cache = await caches.open(CACHE.app);
        var res = await fetch(SHELL_KEY, { cache: 'no-cache' });
        if (!res.ok) return;
        var html = await res.clone().text();
        await cache.put(SHELL_KEY, res);
        // Hashed bundles plus the self-hosted vendor files (Leaflet, fonts)
        // that index.html loads directly.
        var assetUrls = html.match(/\/(?:assets|vendor)\/[^"'\s>)]+/g) || [];
        var unique = Array.from(new Set(assetUrls));
        await Promise.all(
          unique.map(function (u) {
            return cache.add(u).catch(function () {
              // /vendor/* may 302 to a CDN without CORS headers: keep the
              // opaque copy so Leaflet still loads offline.
              if (u.indexOf('/vendor/') !== 0) return;
              return fetch(u, { mode: 'no-cors' })
                .then(function (r) {
                  if (POLICY.isCacheableVendorResponse(r)) return cache.put(u, r);
                })
                .catch(function () {});
            });
          }),
        );
      } catch (e) {
        // Offline or transient failure during install — the runtime
        // handlers will populate the cache on the next online visit.
      }
    })(),
  );
});

// ── Activate: drop caches from other versions, take control ───────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var names = await caches.keys();
      var stale = POLICY.staleCacheNames(names, VERSION);
      await Promise.all(
        stale.map(function (n) {
          return caches.delete(n);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

// ── Messages: the update toast asks the waiting worker to take over ───────
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Offline area packs or the user tile source changed: re-read routing.
  if (event.data && event.data.type === 'OHC_PACKS_CHANGED') {
    event.waitUntil(refreshTileRouting());
  }
});

// ── Offline area pack routing state ───────────────────────────────────────
// URL prefixes of operator-supplied tile sources (their own server, a LAN
// mbtiles server) and the pack manifests, both read from the pack cache.
// The worker is stopped and restarted often (always, when idle offline), so
// this reloads on every start; until it has loaded, image requests wait
// for it instead of slipping past (see the fetch handler).
var PACK_MANIFEST_KEY = '/__ohc-offline-packs/manifest.json';
var PACK_SOURCES_KEY = '/__ohc-offline-packs/sources.json';
var tileRouting = { prefixes: [], packs: [] };
var tileRoutingPending = true;
var tileRoutingReady = refreshTileRouting().then(function () {
  tileRoutingPending = false;
});

async function refreshTileRouting() {
  var next = { prefixes: [], packs: [] };
  try {
    var cache = await caches.open(POLICY.OFFLINE_PACK_CACHE);
    var m = await cache.match(PACK_MANIFEST_KEY);
    if (m) {
      var body = await m.json();
      next.packs = Array.isArray(body && body.packs) ? body.packs : [];
    }
    var src = await cache.match(PACK_SOURCES_KEY);
    var list = src ? (await src.json()).prefixes : [];
    if (Array.isArray(list)) next.prefixes = list.filter(Boolean);
    next.packs.forEach(function (p) {
      POLICY.tileUrlPrefixes(p && p.urlTemplate, p && p.subdomains).forEach(function (pre) {
        if (next.prefixes.indexOf(pre) === -1) next.prefixes.push(pre);
      });
    });
  } catch (e) {
    // No pack cache yet — built-in hosts only.
  }
  tileRouting = next;
}

function classify(req) {
  return POLICY.classifyRequest({
    url: req.url,
    method: req.method,
    mode: req.mode,
    origin: self.location.origin,
    accept: req.headers && req.headers.get ? req.headers.get('accept') : '',
    extraTilePrefixes: tileRouting.prefixes,
  });
}

// ── Fetch routing ─────────────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var decision = classify(req);

  // Just (re)started and the user tile sources are not loaded yet: hold an
  // image from a LAN/local host (where an operator's own tile server lives)
  // until they are, so an offline tile is not missed. Public hosts are never
  // held — they keep the browser's default handling.
  if (
    decision === 'bypass' &&
    tileRoutingPending &&
    req.method === 'GET' &&
    req.destination === 'image' &&
    POLICY.isLocalNetworkUrl(req.url, self.location.origin)
  ) {
    event.respondWith(
      tileRoutingReady.then(function () {
        return classify(req) === 'tile' ? handleTile(event, req) : fetch(req);
      }),
    );
    return;
  }

  if (decision === 'navigation') {
    event.respondWith(handleNavigation(req));
  } else if (decision === 'asset') {
    event.respondWith(handleAsset(req));
  } else if (decision === 'api') {
    event.respondWith(handleApi(event, req));
  } else if (decision === 'tile') {
    event.respondWith(handleTile(event, req));
  }
  // 'bypass' → no respondWith: streaming (SSE), non-GET, cross-origin, and
  // anything unrecognized goes straight to the network untouched.
});

/** Navigations: network-first so online users always get the newest HTML
 *  (which references the newest hashed bundles); cached shell offline. */
async function handleNavigation(req) {
  try {
    var res = await fetch(req);
    if (res.ok) {
      var cache = await caches.open(CACHE.app);
      cache.put(SHELL_KEY, res.clone());
    }
    return res;
  } catch (e) {
    var cached = await caches.match(SHELL_KEY);
    if (cached) return cached;
    throw e;
  }
}

/** Static assets: cache-first (hashed filenames are immutable), cached on
 *  first fetch — no precache manifest needed. */
async function handleAsset(req) {
  var cached = await caches.match(req);
  if (cached) return cached;
  var res;
  try {
    res = await fetch(req);
  } catch (e) {
    // Offline and never cached (a lazy chunk or font not used online yet):
    // answer with a plain 504 rather than rejecting the fetch event.
    return new Response('', { status: 504, statusText: 'Offline' });
  }
  // /vendor/* may be the CDN copy the server redirects to (installs without
  // self-hosted Leaflet): cache that too, even opaque, or the map cannot
  // start offline.
  var isVendor = new URL(req.url).pathname.indexOf('/vendor/') === 0;
  if (isVendor ? POLICY.isCacheableVendorResponse(res) : res.ok && res.status === 200 && res.type === 'basic') {
    var cache = await caches.open(CACHE.app);
    cache.put(req, res.clone()).catch(function () {});
  }
  return res;
}

/** GET /api/*: network-first with cached fallback. Online requests always
 *  hit the server (behavior unchanged); each good response refreshes the
 *  cache so offline panels show last-known data instead of hard errors. */
async function handleApi(event, req) {
  var cache = await caches.open(CACHE.api);
  try {
    var res = await fetch(req);
    if (
      POLICY.isCacheableApiResponse({
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
      })
    ) {
      await cache.put(req, res.clone());
      event.waitUntil(pruneApiCache(cache));
    }
    return res;
  } catch (e) {
    var cached = await cache.match(req);
    if (cached) return markStale(cached);
    return new Response(JSON.stringify({ error: 'offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Re-wrap a cached API response with X-OHC-Stale: 1 so panels can show
 *  an "as of" time (the original Date header is kept). */
function markStale(cached) {
  try {
    var headers = new Headers(cached.headers);
    headers.set('X-OHC-Stale', '1');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: headers });
  } catch (e) {
    return cached;
  }
}

/** Offline area pack tiles. A tile saved in a pack is served from the pack
 *  at once (cache-first); a background HEAD probe decides whether the page
 *  should show the subtle "offline tiles" badge (no answer within
 *  PACK_TILE_NETWORK_TIMEOUT_MS, or the browser reports offline). Tiles not
 *  in a pack go to the network as before. With no copy of that exact tile —
 *  zoomed in past the pack's top zoom, or a tile the server had no data
 *  for — the nearest saved ancestor is scaled up (over-zoom) rather than
 *  leaving a blank. Tiles are never written here; only the explicit
 *  "Download area" action fills the pack cache. */
async function handleTile(event, req) {
  var cache = null;
  var cached = null;
  try {
    cache = await caches.open(POLICY.OFFLINE_PACK_CACHE);
    cached = await cache.match(req.url, { ignoreVary: true });
  } catch (e) {
    cached = null;
  }

  // A saved tile is answered at once (cache-first). Basemap tiles change
  // rarely, and answering immediately matters: WebKit was seen replacing
  // the worker instance ~50 ms into a page load and abandoning fetch events
  // still waiting on the network, which left saved tiles blank. The
  // network is still tried in the background, only to decide whether the
  // map should show the OFFLINE TILES badge.
  if (cached) {
    if (self.navigator && self.navigator.onLine === false) {
      notifyPackTile(event);
    } else {
      event.waitUntil(
        withTimeout(
          fetch(req, { method: 'HEAD' }).then(
            function (r) {
              return !!r; // any HTTP answer means the server is reachable
            },
            function () {
              return false;
            },
          ),
          POLICY.PACK_TILE_NETWORK_TIMEOUT_MS,
        ).then(function (ok) {
          if (!ok) notifyPackTile(event);
        }),
      );
    }
    return cached;
  }

  // Network first, but only PACK_TILE_NETWORK_TIMEOUT_MS of patience while
  // a saved answer exists ("lie-fi", or a dead LAN server that never
  // refuses). Without an exact copy, a slow network still gets its chance
  // unless an over-zoomed ancestor can stand in.
  var network = fetch(req).then(
    function (r) {
      return r;
    },
    function () {
      return null;
    },
  );
  var res = await withTimeout(network, POLICY.PACK_TILE_NETWORK_TIMEOUT_MS);
  if (res && res.ok) return res;

  var scaled = cache ? await overzoomFromPacks(cache, req.url) : null;
  if (scaled) {
    notifyPackTile(event);
    return scaled;
  }
  if (res === undefined) res = await withTimeout(network, 26000); // still pending: keep waiting
  if (res) return res;
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** Resolve with the promise's value, or undefined after `ms`. */
function withTimeout(promise, ms) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      timer = setTimeout(resolve, ms);
    }),
  ]).then(function (v) {
    clearTimeout(timer);
    return v;
  });
}

/** Scale up the nearest saved ancestor of a tile URL, or null. */
async function overzoomFromPacks(cache, url) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  await tileRoutingReady;
  var packs = tileRouting.packs || [];
  for (var i = 0; i < packs.length; i++) {
    var p = packs[i];
    var tile = POLICY.parseTileUrl(p.urlTemplate, url);
    if (!tile || tile.z <= p.minZoom) continue;
    var top = Math.min(tile.z - 1, p.maxZoom);
    for (var z = top; z >= p.minZoom && tile.z - z <= POLICY.MAX_OVERZOOM_LEVELS; z--) {
      var src = POLICY.overzoomSource(tile, tile.z - z);
      if (!src) break;
      var parentUrl = POLICY.buildTileUrl(p.urlTemplate, src.tile, {
        subdomains: p.subdomains,
        retina: !!p.retina,
      });
      var parent = await cache.match(parentUrl, { ignoreVary: true });
      if (!parent) continue;
      try {
        return await scaleTile(parent, src);
      } catch (e) {
        return null; // undecodable or opaque — give up on this tile
      }
    }
  }
  return null;
}

// One scale-up at a time: a screenful of over-zoomed tiles decoding in
// parallel is heavy for a worker, and WebKit has been seen to drop the
// worker when several run at once.
var scaleQueue = Promise.resolve();
function scaleTile(parentRes, src) {
  var run = scaleQueue.then(function () {
    return scaleTileNow(parentRes, src);
  });
  scaleQueue = run.catch(function () {});
  return run;
}

async function scaleTileNow(parentRes, src) {
  var bmp = await createImageBitmap(await parentRes.blob());
  var k = bmp.width / 256; // 512 px (retina) tiles scale the source square too
  var canvas = new OffscreenCanvas(bmp.width, bmp.height);
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bmp, src.sx * k, src.sy * k, src.size * k, src.size * k, 0, 0, bmp.width, bmp.height);
  if (bmp.close) bmp.close();
  var blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Response(blob, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'X-OHC-Overzoom': String(src.tile.z) },
  });
}

/** Tell the page that tiles are coming from an offline pack — at most once
 *  every few seconds per client, not once per tile. */
var lastPackNotice = {};
function notifyPackTile(event) {
  var id = event.clientId || event.resultingClientId || '';
  var now = Date.now();
  if (lastPackNotice[id] && now - lastPackNotice[id] < 3000) return;
  lastPackNotice[id] = now;
  event.waitUntil(
    (async function () {
      try {
        var targets = id ? [await self.clients.get(id)] : await self.clients.matchAll({ type: 'window' });
        targets.forEach(function (c) {
          if (c) c.postMessage({ type: 'OHC_OFFLINE_PACK_TILE', at: now });
        });
      } catch (e) {
        // Best-effort UI hint.
      }
    })(),
  );
}

// ── Web Push: server-sent notifications (closed-browser alerts) ───────────
// The server (server/routes/push.js) sends a JSON payload:
//   { title, body, tag }
// Parsing is defensive — a malformed or empty payload still shows a generic
// notification, because Chrome punishes push events that show nothing.
self.addEventListener('push', function (event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      payload = { body: event.data.text() };
    } catch (e2) {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object') payload = {};
  var title = typeof payload.title === 'string' && payload.title ? payload.title : 'OpenHamClock';
  var options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    tag: typeof payload.tag === 'string' && payload.tag ? payload.tag : 'ohc-push',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an existing OpenHamClock tab/window if
// one is open, otherwise opens a fresh one.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    (async function () {
      var clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) {
          try {
            await clientList[i].focus();
            return;
          } catch (e) {
            // Fall through to the next client / openWindow.
          }
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow('/');
    })(),
  );
});

/** Keep the API cache bounded (oldest-first, cap in sw-policy.js). */
async function pruneApiCache(cache) {
  try {
    var keys = await cache.keys();
    var doomed = POLICY.keysToPrune(keys);
    await Promise.all(
      doomed.map(function (k) {
        return cache.delete(k);
      }),
    );
  } catch (e) {
    // Pruning is best-effort.
  }
}
