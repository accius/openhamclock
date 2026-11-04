import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateCustomTileSource,
  readCustomTileSource,
  writeCustomTileSource,
  customSourceToStyle,
  escapeAttribution,
  CUSTOM_TILE_SOURCE_KEY,
} from './customTileSource.js';
import {
  classifyRequest,
  tileUrlPrefix,
  tileUrlPrefixes,
  isLocalNetworkUrl,
  parseTileUrl,
  overzoomSource,
  isCacheableVendorResponse,
} from './swPolicy.js';
import { isOfflinePackStyle } from './offlineTiles.js';
import { applyCustomTileSource, MAP_STYLES_CHANGED_EVENT } from './mapStylesLive.js';
import { storageNotes, createPackManifest, isIncomplete } from './offlinePackManifest.js';

const LAN = 'http://192.168.1.5:8080/data/osm/{z}/{x}/{y}.png';

describe('validateCustomTileSource', () => {
  it('accepts a LAN or HTTPS server once the operator confirms', () => {
    const v = validateCustomTileSource({ url: LAN, name: ' Shack Pi ', maxZoom: '14', confirmed: true });
    expect(v).toMatchObject({ ok: true, source: { url: LAN, name: 'Shack Pi', maxZoom: 14, subdomains: 'abc' } });
    expect(validateCustomTileSource({ url: 'https://{s}.tiles.example.net/{z}/{x}/{y}.png', confirmed: true }).ok).toBe(
      true,
    );
  });

  it('rejects bad URLs, missing placeholders, and missing confirmation', () => {
    expect(validateCustomTileSource({ url: 'ftp://x/{z}/{x}/{y}', confirmed: true }).error).toBe('url');
    expect(validateCustomTileSource({ url: 'not a url', confirmed: true }).error).toBe('url');
    expect(validateCustomTileSource({ url: '{z}/{x}/{y}.png', confirmed: true }).error).toBe('url');
    expect(validateCustomTileSource({ url: 'https://t.example/{z}/{x}.png', confirmed: true }).error).toBe(
      'placeholders',
    );
    expect(validateCustomTileSource({ url: LAN }).error).toBe('confirm');
  });

  it('refuses public servers whose terms forbid offline download, even when confirmed', () => {
    for (const url of [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      'https://tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    ]) {
      expect(validateCustomTileSource({ url, confirmed: true }).error).toBe('forbidden');
    }
  });

  it('clamps zoom and cleans fields', () => {
    expect(validateCustomTileSource({ url: LAN, maxZoom: 99, confirmed: true }).source.maxZoom).toBe(20);
    expect(validateCustomTileSource({ url: LAN, maxZoom: 'x', confirmed: true }).source.maxZoom).toBe(18);
    expect(validateCustomTileSource({ url: LAN, subdomains: 'a-b;c', confirmed: true }).source.subdomains).toBe('abc');
  });
});

describe('stored source and MAP_STYLES entry', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage and ignores junk', () => {
    expect(readCustomTileSource()).toBeNull();
    const { source } = validateCustomTileSource({ url: LAN, confirmed: true, name: 'Pi' });
    writeCustomTileSource(source);
    expect(readCustomTileSource()).toEqual(source);
    localStorage.setItem(CUSTOM_TILE_SOURCE_KEY, '{"url":"https://tile.openstreetmap.org/{z}/{x}/{y}.png"}');
    expect(readCustomTileSource()).toBeNull();
    localStorage.setItem(CUSTOM_TILE_SOURCE_KEY, '{bad');
    expect(readCustomTileSource()).toBeNull();
    writeCustomTileSource(null);
    expect(localStorage.getItem(CUSTOM_TILE_SOURCE_KEY)).toBeNull();
  });

  it('becomes an offline-capable, regional style with escaped attribution', () => {
    const { source } = validateCustomTileSource({
      url: LAN,
      confirmed: true,
      maxZoom: 14,
      attribution: '<b>me</b> & OSM',
    });
    const style = customSourceToStyle(source);
    expect(isOfflinePackStyle(style)).toBe(true);
    expect(style).toMatchObject({ regional: true, userSupplied: true, maxNativeZoom: 14, offlineMaxZoom: 14 });
    expect(style.attribution).toBe('&lt;b&gt;me&lt;/b&gt; &amp; OSM');
    expect(escapeAttribution(`"'`)).toBe('&quot;&#39;');
  });
});

describe('policy helpers for custom sources and over-zoom', () => {
  const ORIGIN = 'https://openhamclock.com';
  const req = (url, extra = {}) => ({ url, method: 'GET', mode: 'cors', origin: ORIGIN, ...extra });

  it('tileUrlPrefix cuts at the first placeholder and needs a host', () => {
    expect(tileUrlPrefix(LAN)).toBe('http://192.168.1.5:8080/data/osm/');
    expect(tileUrlPrefix('https://{s}.tiles.example/{z}/{x}/{y}.png')).toBe('');
    expect(tileUrlPrefix('/tiles/{z}/{x}/{y}.png')).toBe('');
    expect(tileUrlPrefix('')).toBe('');
  });

  it('tileUrlPrefixes expands {s} into one prefix per subdomain', () => {
    expect(tileUrlPrefixes('https://{s}.t.example/osm/{z}/{x}/{y}.png', 'ab')).toEqual([
      'https://a.t.example/osm/',
      'https://b.t.example/osm/',
    ]);
    expect(tileUrlPrefixes(LAN)).toEqual(['http://192.168.1.5:8080/data/osm/']);
    expect(tileUrlPrefixes('')).toEqual([]);
  });

  it('isLocalNetworkUrl spots LAN tile servers only', () => {
    for (const u of [
      'http://localhost:3656/t/1/2/3.png',
      'http://192.168.1.5:8080/x.png',
      'http://10.0.0.2/x.png',
      'http://172.20.1.1/x.png',
      'http://pi.local/x.png',
      'http://shack.lan/x.png',
    ]) {
      expect(isLocalNetworkUrl(u, ORIGIN)).toBe(true);
    }
    for (const u of [
      'https://services.arcgisonline.com/x',
      'http://172.32.0.1/x.png',
      'http://8.8.8.8/x.png',
      `${ORIGIN}/assets/x.png`,
      'not a url',
    ]) {
      expect(isLocalNetworkUrl(u, ORIGIN)).toBe(false);
    }
  });

  it('classifies requests under a registered prefix as tiles, never the app API', () => {
    const prefixes = ['http://192.168.1.5:8080/data/osm/', `${ORIGIN}/`];
    expect(classifyRequest(req('http://192.168.1.5:8080/data/osm/3/1/2.png', { extraTilePrefixes: prefixes }))).toBe(
      'tile',
    );
    expect(classifyRequest(req(`${ORIGIN}/api/emcomm/alerts`, { extraTilePrefixes: prefixes }))).toBe('api');
    expect(
      classifyRequest(
        req('http://192.168.1.5:8080/data/osm/3/1/2.png', { extraTilePrefixes: prefixes, mode: 'navigate' }),
      ),
    ).toBe('bypass');
    expect(classifyRequest(req('http://192.168.1.5:8080/data/osm/3/1/2.png'))).toBe('bypass');
  });

  it('parses tile URLs back to z/x/y for every built-in template shape', () => {
    expect(
      parseTileUrl(
        'https://data.geopf.fr/wmts?SERVICE=WMTS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        'https://data.geopf.fr/wmts?SERVICE=WMTS&TILEMATRIX=14&TILEROW=5637&TILECOL=8300',
      ),
    ).toEqual({ z: 14, y: 5637, x: 8300 });
    expect(
      parseTileUrl(
        'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
        'https://cyberjapandata.gsi.go.jp/xyz/std/12/3638/1612.png',
      ),
    ).toEqual({ z: 12, x: 3638, y: 1612 });
    expect(parseTileUrl('https://{s}.t.example/{z}/{x}/{y}{r}.png', 'https://c.t.example/3/2/1@2x.png')).toEqual({
      z: 3,
      x: 2,
      y: 1,
    });
    expect(parseTileUrl('https://t.example/{z}/{x}/{y}.png', 'https://other.example/3/2/1.png')).toBeNull();
    expect(parseTileUrl('https://t.example/{z}/{x}.png', 'https://t.example/3/2.png')).toBeNull();
  });

  it('overzoomSource finds the ancestor and the square to scale', () => {
    expect(overzoomSource({ z: 13, x: 1701, y: 3100 }, 1)).toEqual({
      tile: { z: 12, x: 850, y: 1550 },
      sx: 128,
      sy: 0,
      size: 128,
    });
    expect(overzoomSource({ z: 20, x: 0, y: 0 }, 7)).toBeNull(); // past the 64× limit
    expect(overzoomSource({ z: 1, x: 0, y: 0 }, 2)).toBeNull();
    expect(overzoomSource({ z: 5, x: 0, y: 0 }, 0)).toBeNull();
  });

  it('caches vendor responses from the server or the CDN, never errors', () => {
    expect(isCacheableVendorResponse({ type: 'basic', ok: true, status: 200 })).toBe(true);
    expect(isCacheableVendorResponse({ type: 'cors', ok: true, status: 200 })).toBe(true);
    expect(isCacheableVendorResponse({ type: 'opaque', ok: false, status: 0 })).toBe(true);
    expect(isCacheableVendorResponse({ type: 'basic', ok: false, status: 404 })).toBe(false);
    expect(isCacheableVendorResponse({ type: 'error' })).toBe(false);
    expect(isCacheableVendorResponse(null)).toBe(false);
  });
});

describe('storageNotes', () => {
  const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

  it('warns about WebKit 7-day deletion in Safari and every iOS browser, unless installed', () => {
    expect(storageNotes({ ua: SAFARI_MAC, vendor: 'Apple Computer, Inc.' })).toEqual(['webkit-7day']);
    expect(storageNotes({ ua: IPHONE_CHROME, vendor: 'Apple Computer, Inc.' })).toEqual(['webkit-7day']);
    expect(storageNotes({ ua: SAFARI_MAC, vendor: 'Apple Computer, Inc.', standalone: true })).toEqual([]);
    expect(storageNotes({ ua: CHROME_MAC, vendor: 'Google Inc.' })).toEqual([]);
  });

  it('notes when persistent storage was not granted', () => {
    expect(storageNotes({ ua: CHROME_MAC, vendor: 'Google Inc.', persisted: false })).toEqual(['not-persistent']);
    expect(storageNotes({ ua: CHROME_MAC, vendor: 'Google Inc.', persisted: true })).toEqual([]);
  });
});

describe('manifest completeness', () => {
  const base = {
    id: 'p',
    styleId: 's',
    urlTemplate: 'https://t/{z}/{x}/{y}',
    bbox: { west: 0, south: 0, east: 1, north: 1 },
    minZoom: 1,
    maxZoom: 2,
  };
  it('defaults old manifests to complete and keeps an explicit false', () => {
    expect(createPackManifest(base).complete).toBe(true);
    expect(isIncomplete(createPackManifest({ ...base, complete: false }))).toBe(true);
    expect(createPackManifest({ ...base, tileCount: 7 }).totalTiles).toBe(7);
  });
});

describe('applyCustomTileSource', () => {
  it('adds, edits, and removes the custom basemap live and announces it', () => {
    const styles = {};
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener(MAP_STYLES_CHANGED_EVENT, on);
    const { source } = validateCustomTileSource({ url: LAN, confirmed: true, name: 'Pi' });
    applyCustomTileSource(source, styles);
    expect(styles.custom).toMatchObject({ name: 'Pi', url: LAN, offlinePack: true });
    applyCustomTileSource(null, styles);
    expect(styles.custom).toBeUndefined();
    window.removeEventListener(MAP_STYLES_CHANGED_EVENT, on);
    expect(seen).toEqual([
      { id: 'custom', removed: false },
      { id: 'custom', removed: true },
    ]);
  });
});
