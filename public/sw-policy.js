/**
 * Service-worker caching policy — pure decision logic, no side effects on
 * the network or caches. This file is the single source of truth:
 *
 *   - public/sw.js loads it via importScripts('/sw-policy.js?v=...')
 *   - src/utils/swPolicy.js imports it (side-effect) and re-exports the
 *     functions so vitest can unit-test the exact code the worker runs.
 *
 * It is written as a classic script (no import/export syntax) that attaches
 * a single object to the global, which is valid both as an importScripts
 * target and as an ES module with a side effect. Keep it dependency-free.
 */
(function (global) {
  'use strict';

  /**
   * Streaming endpoints that must never be intercepted or cached (SSE, and
   * the Decoder panel's endless KiwiSDR audio body — caching it would hold
   * the response forever).
   */
  var STREAMING_API_PATHS = ['/api/pskreporter/stream', '/api/rig-bridge/relay/stream', '/api/rig-bridge/relay/audio'];

  /**
   * Same-origin static content that is safe to serve cache-first within a
   * single deployed version (the whole cache is dropped on version change).
   * /assets/* files carry content hashes and are truly immutable.
   * /vendor/* is the self-hosted Leaflet + fonts (scripts/vendor-download.sh):
   * without it cached, an offline load has no map library at all.
   */
  var STATIC_ASSET_PREFIXES = ['/assets/', '/icons/', '/geo/', '/models/', '/wasm/', '/vendor/'];
  var STATIC_ASSET_FILES = ['/favicon.ico', '/favicon-32x32.png', '/manifest.json'];

  /** Cap on the runtime API cache (simple oldest-first pruning). */
  var API_CACHE_MAX_ENTRIES = 150;

  /**
   * Offline map area packs (Settings → Map Layers → Offline map areas).
   * The operator downloads basemap tiles plus an EmComm data snapshot into
   * this cache ahead of time. Unlike the versioned app/api caches it must
   * survive deploys, so it is never treated as stale (see staleCacheNames).
   */
  var OFFLINE_PACK_CACHE = 'ohc-offline-packs';
  var PERSISTENT_CACHE_PREFIX = 'ohc-offline-';

  /**
   * Cross-origin tile hosts whose basemap terms allow downloading an area
   * for offline use. Requests to these hosts are routed through the worker
   * so a pack can answer them when the network is gone; every other
   * cross-origin request stays bypassed. Keep in lockstep with the
   * `offlinePack: true` styles in src/utils/config.js MAP_STYLES (a unit
   * test enforces it).
   */
  var OFFLINE_TILE_HOSTS = [
    'basemap.nationalmap.gov', // USGS Topo (United States)
    'data.geopf.fr', // IGN Plan IGN v2 (France)
    'cyberjapandata.gsi.go.jp', // GSI standard map (Japan)
    'cache.kartverket.no', // Kartverket topo (Norway)
    'services.ga.gov.au', // Geoscience Australia National Base Map
  ];

  /** Deepest over-zoom: a pack tile is scaled up at most 2^6 = 64×. */
  var MAX_OVERZOOM_LEVELS = 6;

  /**
   * How long a tile request may wait on the network before an offline pack
   * copy is served instead ("lie-fi": connected but nothing comes back).
   */
  var PACK_TILE_NETWORK_TIMEOUT_MS = 4000;

  /**
   * Normalize a version token (from the ?v= registration query param) into
   * something safe to embed in a Cache Storage name.
   */
  function normalizeVersion(raw) {
    var v = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9._-]/g, '_');
    return v || 'dev';
  }

  /** Cache names for a given version token. */
  function cacheNames(version) {
    var v = normalizeVersion(version);
    return {
      app: 'ohc-' + v + '-app', // shell + static assets
      api: 'ohc-' + v + '-api', // runtime /api/* GET responses
    };
  }

  /**
   * True for caches that hold operator-created data (offline area packs)
   * and must outlive version changes and the ?nosw cache sweep.
   */
  function isPersistentCacheName(name) {
    return typeof name === 'string' && name.indexOf(PERSISTENT_CACHE_PREFIX) === 0;
  }

  /**
   * Given every Cache Storage name present, return the ohc-* caches that
   * belong to a different version and should be deleted on activate.
   * Non-ohc caches (other apps on the origin, future features) and the
   * persistent offline-pack cache are left alone.
   */
  function staleCacheNames(allNames, version) {
    var names = cacheNames(version);
    var keep = [names.app, names.api];
    return (allNames || []).filter(function (n) {
      return typeof n === 'string' && n.indexOf('ohc-') === 0 && keep.indexOf(n) === -1 && !isPersistentCacheName(n);
    });
  }

  /** True when a URL points at a tile host that offline packs may cover. */
  function isOfflineTileHost(hostname) {
    return OFFLINE_TILE_HOSTS.indexOf(String(hostname || '').toLowerCase()) !== -1;
  }

  /** True for API paths that stream (SSE, live audio) and must be left to the browser. */
  function isStreamingApiPath(pathname) {
    if (STREAMING_API_PATHS.indexOf(pathname) !== -1) return true;
    // Defensive: any /api/**/stream endpoint (also /stream/<id>, e.g. the
    // per-callsign PSK Reporter feed) is assumed to be SSE.
    return pathname.indexOf('/api/') === 0 && /\/stream(\/|$)/.test(pathname);
  }

  /**
   * Classify a fetch-event request into a handling strategy.
   *
   * @param {{url: string, method: string, mode?: string, origin: string, extraTilePrefixes?: string[]}} req
   *   url    - absolute or origin-relative request URL
   *   method - HTTP method
   *   mode   - Request.mode ('navigate' for top-level navigations)
   *   origin - the service worker's own origin (self.location.origin)
   *   extraTilePrefixes - URL prefixes of operator-supplied tile sources
   *   accept - the request's Accept header (EventSource: text/event-stream)
   * @returns {'navigation'|'asset'|'api'|'tile'|'bypass'}
   *   navigation - network-first with cached-shell fallback
   *   asset      - cache-first, cache-on-fetch
   *   api        - network-first with cached fallback (offline resilience)
   *   tile       - basemap tile an offline pack may hold: network when it
   *                works, the pack copy when offline or the network fails
   *   bypass     - do not call respondWith; browser default behavior
   */
  function classifyRequest(req) {
    if (!req || req.method !== 'GET') return 'bypass';
    // EventSource requests announce themselves. A stream answered through
    // the worker keeps that request in flight for as long as the stream
    // lives — and Chromium will not activate an updated worker while the
    // old one has requests in flight, so an update could wait forever.
    if (String(req.accept || '').indexOf('text/event-stream') !== -1) return 'bypass';
    var u;
    try {
      u = new URL(req.url, req.origin);
    } catch (e) {
      return 'bypass';
    }
    // Operator-supplied tile sources (their own tile server, a LAN mbtiles
    // server) registered with the worker by URL prefix — see
    // tileUrlPrefix(). Never matches the app's own /api/ or a navigation.
    if (req.mode !== 'navigate' && matchesTilePrefix(u, req.extraTilePrefixes, req.origin)) return 'tile';
    if (u.origin !== req.origin) {
      // Cross-origin is left to the browser (CDNs, most tile servers), except
      // tile hosts an offline area pack can stand in for.
      if (req.mode !== 'navigate' && isOfflineTileHost(u.hostname)) return 'tile';
      return 'bypass';
    }
    if (req.mode === 'navigate') return 'navigation';
    var p = u.pathname;
    if (p.indexOf('/api/') === 0) {
      return isStreamingApiPath(p) ? 'bypass' : 'api';
    }
    for (var i = 0; i < STATIC_ASSET_PREFIXES.length; i++) {
      if (p.indexOf(STATIC_ASSET_PREFIXES[i]) === 0) return 'asset';
    }
    if (STATIC_ASSET_FILES.indexOf(p) !== -1) return 'asset';
    return 'bypass';
  }

  function matchesTilePrefix(u, prefixes, origin) {
    if (!prefixes || !prefixes.length) return false;
    if (u.origin === origin && u.pathname.indexOf('/api/') === 0) return false;
    var href = u.href;
    for (var i = 0; i < prefixes.length; i++) {
      if (typeof prefixes[i] === 'string' && prefixes[i] && href.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }

  /**
   * True for a cross-origin URL on a local/LAN host — localhost, a private
   * IPv4 address, or a .local/.lan/.home.arpa name — where an operator's
   * own tile server typically runs.
   */
  function isLocalNetworkUrl(url, origin) {
    var u;
    try {
      u = new URL(url, origin);
    } catch (e) {
      return false;
    }
    if (u.origin === origin) return false;
    var h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '[::1]' || /\.(local|lan|home\.arpa|internal)$/.test(h)) return true;
    var m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
    if (!m) return false;
    var a = +m[1];
    var b = +m[2];
    return (
      a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
    );
  }

  /**
   * The fixed part of a tile URL template, up to its first placeholder —
   * what the worker matches requests against for a user-supplied source.
   * Returns '' when the template has no usable fixed scheme+host part.
   * 'https://tiles.example.net/osm/{z}/{x}/{y}.png' → 'https://tiles.example.net/osm/'
   */
  function tileUrlPrefix(template) {
    var t = String(template || '');
    var cut = t.indexOf('{');
    var prefix = cut === -1 ? t : t.slice(0, cut);
    var m = /^https?:\/\/[^/{}?#]+\//i.exec(prefix);
    if (!m) return '';
    return prefix;
  }

  /**
   * Turn a Leaflet URL template into a parser for concrete tile URLs:
   * returns { z, x, y } or null. {s} matches any subdomain, {r} an
   * optional "@2x", other placeholders (e.g. {lang}) anything up to the
   * next fixed character.
   */
  function parseTileUrl(template, url) {
    if (!template || !url) return null;
    var order = [];
    var re = '';
    var parts = String(template).split(/(\{ *[\w_-]+ *\})/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var ph = /^\{ *([\w_-]+) *\}$/.exec(part);
      if (!ph) {
        re += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else if (ph[1] === 'z' || ph[1] === 'x' || ph[1] === 'y') {
        order.push(ph[1]);
        re += '(\\d+)';
      } else if (ph[1] === 'r') {
        re += '(?:@2x)?';
      } else {
        re += '[^/?&#]*';
      }
    }
    var m;
    try {
      m = new RegExp('^' + re + '$').exec(url);
    } catch (e) {
      return null;
    }
    if (!m || order.length !== 3) return null;
    var out = {};
    for (var j = 0; j < order.length; j++) out[order[j]] = parseInt(m[j + 1], 10);
    return out;
  }

  /**
   * Every fixed URL prefix a template can produce: one per subdomain when
   * the host contains {s} ('https://{s}.t.example/{z}/…' with 'abc' gives
   * three), otherwise just tileUrlPrefix(template).
   */
  function tileUrlPrefixes(template, subdomains) {
    var t = String(template || '');
    if (!/\{ *s *\}/.test(t)) {
      var one = tileUrlPrefix(t);
      return one ? [one] : [];
    }
    var list = subdomains == null ? 'abc' : subdomains;
    if (typeof list === 'string') list = list.split('');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var pre = tileUrlPrefix(t.replace(/\{ *s *\}/g, list[i]));
      if (pre && out.indexOf(pre) === -1) out.push(pre);
    }
    return out;
  }

  /**
   * Subdomain Leaflet picks for a tile — the same formula as
   * L.TileLayer._getSubdomain — so pack URLs match the map's requests
   * byte-for-byte.
   */
  function subdomainFor(x, y, subdomains) {
    var list = subdomains == null ? 'abc' : subdomains;
    if (typeof list === 'string') list = list.split('');
    if (!list || list.length === 0) return '';
    return list[Math.abs(x + y) % list.length];
  }

  /**
   * Fill a Leaflet URL template ({s} {z} {x} {y} {r} {lang}) for one tile.
   * Unknown {placeholders} are left as-is so a mistake shows up in the URL
   * rather than silently fetching the wrong tile.
   */
  function buildTileUrl(template, tile, opts) {
    if (!template || !tile) return '';
    var o = opts || {};
    var values = {
      s: subdomainFor(tile.x, tile.y, o.subdomains),
      z: tile.z,
      x: tile.x,
      y: tile.y,
      r: o.retina ? '@2x' : '',
      lang: o.lang || 'en',
    };
    return String(template).replace(/\{ *([\w_-]+) *\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m;
    });
  }

  /**
   * Over-zoom: where tile z/x/y sits inside its ancestor `dz` levels up.
   * Returns { tile: {z,x,y}, sx, sy, size } — the source square (in 256 px
   * tile pixels) of the ancestor to scale up to a full tile — or null.
   */
  function overzoomSource(tile, dz, tileSize) {
    var ts = tileSize || 256;
    if (!tile || !(dz >= 1) || dz > MAX_OVERZOOM_LEVELS || tile.z - dz < 0) return null;
    var f = Math.pow(2, dz);
    var size = ts / f;
    return {
      tile: { z: tile.z - dz, x: Math.floor(tile.x / f), y: Math.floor(tile.y / f) },
      sx: (tile.x % f) * size,
      sy: (tile.y % f) * size,
      size: size,
    };
  }

  /**
   * Whether a same-origin /vendor/* response (self-hosted Leaflet, fonts —
   * or the CDN copy the server redirects to when it has none) may be
   * cached: a same-origin answer, a CORS answer from the CDN, or an opaque
   * one (a no-cors <script>/<link> following the redirect). Errors never.
   */
  function isCacheableVendorResponse(res) {
    if (!res) return false;
    if (res.type === 'opaque') return true;
    return !!res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'cors' || res.type === 'default');
  }

  /**
   * Whether an API response is safe to store. Rejects errors, partial
   * content, and anything that identifies as an event stream (a streaming
   * endpoint we did not know about by path).
   */
  function isCacheableApiResponse(res) {
    if (!res || !res.ok || res.status === 206) return false;
    var ct = (res.contentType || '').toLowerCase();
    if (ct.indexOf('text/event-stream') !== -1) return false;
    return true;
  }

  /**
   * Oldest-first prune: given cache keys in insertion order, return the
   * entries to delete so at most `max` remain.
   */
  function keysToPrune(keys, max) {
    var limit = typeof max === 'number' ? max : API_CACHE_MAX_ENTRIES;
    if (!keys || keys.length <= limit) return [];
    return keys.slice(0, keys.length - limit);
  }

  global.OHC_SW_POLICY = {
    API_CACHE_MAX_ENTRIES: API_CACHE_MAX_ENTRIES,
    OFFLINE_PACK_CACHE: OFFLINE_PACK_CACHE,
    OFFLINE_TILE_HOSTS: OFFLINE_TILE_HOSTS,
    PACK_TILE_NETWORK_TIMEOUT_MS: PACK_TILE_NETWORK_TIMEOUT_MS,
    isPersistentCacheName: isPersistentCacheName,
    isOfflineTileHost: isOfflineTileHost,
    MAX_OVERZOOM_LEVELS: MAX_OVERZOOM_LEVELS,
    tileUrlPrefix: tileUrlPrefix,
    tileUrlPrefixes: tileUrlPrefixes,
    isLocalNetworkUrl: isLocalNetworkUrl,
    parseTileUrl: parseTileUrl,
    subdomainFor: subdomainFor,
    buildTileUrl: buildTileUrl,
    overzoomSource: overzoomSource,
    isCacheableVendorResponse: isCacheableVendorResponse,
    normalizeVersion: normalizeVersion,
    cacheNames: cacheNames,
    staleCacheNames: staleCacheNames,
    isStreamingApiPath: isStreamingApiPath,
    classifyRequest: classifyRequest,
    isCacheableApiResponse: isCacheableApiResponse,
    keysToPrune: keysToPrune,
  };
})(typeof self !== 'undefined' ? self : globalThis);
