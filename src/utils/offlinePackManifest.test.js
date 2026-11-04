import { describe, it, expect } from 'vitest';
import {
  MANIFEST_VERSION,
  newPackId,
  defaultPackName,
  createPackManifest,
  isValidManifest,
  parseManifestList,
  upsertPack,
  removePackById,
  totalPackBytes,
  packsCoveringLocation,
  pickPackForLocation,
  tileSharedWithOtherPacks,
  checkBudget,
  chooseOfflineSource,
  relocateRepeaters,
  formatAsOf,
} from './offlinePackManifest.js';
import { bboxAroundPoint } from './offlineTiles.js';

const TEMPLATE = 'https://tiles.example/{z}/{y}/{x}';
const boulder = bboxAroundPoint(40.015, -105.27, 50);
const pack = (over = {}) =>
  createPackManifest({
    id: 'p1',
    name: 'Boulder',
    styleId: 'usgsTopo',
    urlTemplate: TEMPLATE,
    bbox: boulder,
    minZoom: 6,
    maxZoom: 12,
    tileCount: 300,
    bytes: 8_000_000,
    createdAt: 1_000,
    ...over,
  });

describe('ids and names', () => {
  it('makes short unique-looking ids', () => {
    expect(newPackId(0, () => 0)).toBe('p00000');
    expect(newPackId(1_700_000_000_000, () => 0.5)).toMatch(/^p[0-9a-z]+$/);
    expect(newPackId(1, () => 0.1)).not.toBe(newPackId(1, () => 0.2));
  });

  it('default names describe the area', () => {
    expect(defaultPackName({ mode: 'radius', radiusKm: 50, locator: 'dn70ma' })).toBe('50 km around DN70');
    expect(defaultPackName({ mode: 'view', center: { lat: 40.04, lon: -105.27 } })).toBe('Map view near 40.0, -105.3');
    expect(defaultPackName({ mode: 'view' })).toBe('Map view near DE');
  });
});

describe('manifest validation', () => {
  it('creates valid manifests with defaults', () => {
    const m = pack({ name: '  ' });
    expect(m.v).toBe(MANIFEST_VERSION);
    expect(m.name).toBe('Offline area');
    expect(m.subdomains).toBe('abc');
    expect(m.center.lat).toBeCloseTo(40.015, 3);
    expect(m.radiusKm).toBeNull();
    expect(isValidManifest(m)).toBe(true);
  });

  it('rejects broken manifests', () => {
    expect(isValidManifest(null)).toBe(false);
    expect(isValidManifest({ ...pack(), v: 99 })).toBe(false);
    expect(isValidManifest({ ...pack(), bbox: null })).toBe(false);
    expect(isValidManifest({ ...pack(), minZoom: 9, maxZoom: 3 })).toBe(false);
    expect(isValidManifest({ ...pack(), urlTemplate: '' })).toBe(false);
  });

  it('parses stored lists defensively', () => {
    const good = pack();
    expect(parseManifestList(JSON.stringify({ packs: [good, { junk: 1 }, good] }))).toEqual([good]);
    expect(parseManifestList([good])).toEqual([good]);
    expect(parseManifestList('not json')).toEqual([]);
    expect(parseManifestList({ nope: true })).toEqual([]);
  });
});

describe('list operations', () => {
  it('upserts newest first and removes by id', () => {
    const a = pack({ id: 'a', createdAt: 1 });
    const b = pack({ id: 'b', createdAt: 2 });
    let list = upsertPack(upsertPack([], a), b);
    expect(list.map((m) => m.id)).toEqual(['b', 'a']);
    list = upsertPack(list, { ...a, name: 'renamed' });
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.id === 'a').name).toBe('renamed');
    expect(removePackById(list, 'b').map((m) => m.id)).toEqual(['a']);
    expect(totalPackBytes(list)).toBe(16_000_000);
  });

  it('finds packs covering a location, newest first, with data of a kind', () => {
    const older = pack({ id: 'old', createdAt: 1, data: { alerts: { fetchedAt: 5, count: 1 } } });
    const newer = pack({ id: 'new', createdAt: 2, data: { shelters: { fetchedAt: 6, count: 2 } } });
    const elsewhere = pack({ id: 'far', createdAt: 3, bbox: bboxAroundPoint(51.5, -0.1, 25) });
    const list = [older, newer, elsewhere];
    expect(packsCoveringLocation(list, 40.0, -105.3).map((m) => m.id)).toEqual(['new', 'old']);
    expect(pickPackForLocation(list, 40.0, -105.3).id).toBe('new');
    expect(pickPackForLocation(list, 40.0, -105.3, 'alerts').id).toBe('old');
    expect(pickPackForLocation(list, 40.0, -105.3, 'repeaters')).toBeNull();
    expect(pickPackForLocation(list, 0, 0)).toBeNull();
  });

  it('knows when a tile is still needed by another pack of the same source', () => {
    const a = pack({ id: 'a' });
    const b = pack({ id: 'b', minZoom: 6, maxZoom: 8 });
    const otherSource = pack({ id: 'c', urlTemplate: 'https://other/{z}/{x}/{y}' });
    const tileZ7 = { z: 7, x: 26, y: 48 }; // Boulder at z7
    const tileZ12 = { z: 12, x: 850, y: 1550 };
    expect(tileSharedWithOtherPacks(tileZ7, a, [a, b])).toBe(true);
    expect(tileSharedWithOtherPacks(tileZ12, a, [a, b])).toBe(false); // b stops at z8
    expect(tileSharedWithOtherPacks(tileZ7, a, [a, otherSource])).toBe(false);
  });
});

describe('checkBudget', () => {
  const MB = 1024 * 1024;
  it('passes a normal download', () => {
    expect(
      checkBudget({ estimateBytes: 10 * MB, packsBytes: 0, budgetBytes: 250 * MB, tileCount: 400, maxTiles: 10000 }),
    ).toEqual({
      level: 'ok',
      reasons: [],
    });
  });

  it('blocks empty, oversized, and over-budget packs', () => {
    expect(checkBudget({ tileCount: 0 }).reasons).toEqual(['empty']);
    expect(checkBudget({ tileCount: 20000, maxTiles: 10000 }).level).toBe('block');
    const over = checkBudget({ estimateBytes: 60 * MB, packsBytes: 200 * MB, budgetBytes: 250 * MB });
    expect(over).toEqual({ level: 'block', reasons: ['over-budget'] });
  });

  it('warns near the browser quota and blocks when full', () => {
    expect(checkBudget({ estimateBytes: 10, usage: 80, quota: 100 })).toEqual({
      level: 'warn',
      reasons: ['quota-near'],
    });
    expect(checkBudget({ estimateBytes: 10, usage: 90, quota: 100 })).toEqual({
      level: 'block',
      reasons: ['quota-full'],
    });
    // Unknown quota (no navigator.storage) is not an error
    expect(checkBudget({ estimateBytes: 10, usage: null, quota: null }).level).toBe('ok');
  });
});

describe('chooseOfflineSource', () => {
  it('prefers the newer copy', () => {
    const stale = { data: [1], fetchedAt: 100 };
    const pk = { data: [2], fetchedAt: 200 };
    expect(chooseOfflineSource(stale, pk)).toMatchObject({ source: 'pack', data: [2] });
    expect(chooseOfflineSource({ ...stale, fetchedAt: 300 }, pk)).toMatchObject({ source: 'cache', data: [1] });
    expect(chooseOfflineSource(stale, null)).toMatchObject({ source: 'cache' });
    expect(chooseOfflineSource(null, pk)).toMatchObject({ source: 'pack' });
    expect(chooseOfflineSource(null, null)).toBeNull();
    expect(chooseOfflineSource({ data: null }, null)).toBeNull();
  });
});

describe('relocateRepeaters', () => {
  const reps = [
    { callsign: 'FAR', lat: 41.5, lon: -105.27, km: 1, bearing: 0 },
    { callsign: 'NEAR', lat: 40.1, lon: -105.27, km: 99, bearing: 99 },
    { callsign: 'BAD', lat: null, lon: 1 },
  ];
  it('recomputes distance from DE, filters by radius, nearest first', () => {
    const out = relocateRepeaters(reps, 40.015, -105.27, 50);
    expect(out.map((r) => r.callsign)).toEqual(['NEAR']);
    expect(out[0].km).toBeCloseTo(9.5, 0);
    expect(out[0].bearing).toBeCloseTo(0, 0);
    expect(relocateRepeaters(reps, 40.015, -105.27, 500).map((r) => r.callsign)).toEqual(['NEAR', 'FAR']);
    expect(relocateRepeaters(null, 0, 0, 10)).toEqual([]);
  });
});

describe('formatAsOf', () => {
  const now = Date.UTC(2026, 9, 15, 18, 0);
  it('shows time today and date+time otherwise (UTC)', () => {
    expect(formatAsOf(Date.UTC(2026, 9, 15, 14, 32), now)).toBe('14:32Z');
    expect(formatAsOf(Date.UTC(2026, 9, 14, 9, 5), now)).toBe('Oct 14 09:05Z');
    expect(formatAsOf(null, now)).toBe('');
  });
});
