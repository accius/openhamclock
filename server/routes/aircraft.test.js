/**
 * Tests for server/routes/aircraft.js — adsb.lol proxy (#1284: adsb.lol now
 * refuses radii over 250 NM, so queries are per 0.5° cell around a point).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./aircraft.js');
const { cellFor, RADIUS_NM } = route;

const plane = (hex, lat, lon) => ({ hex, flight: `${hex} `, lat, lon, alt_baro: 35000, gs: 450, track: 90 });

describe('cellFor', () => {
  it('snaps to the 0.5° cell centre', () => {
    expect(cellFor(44.93, -93.24)).toMatchObject({ lat: 45, lon: -93, key: '45.0,-93.0' });
    expect(cellFor(-33.8, 151.2)).toMatchObject({ lat: -34, lon: 151 });
    expect(cellFor('40.26', '-74.26')).toMatchObject({ lat: 40.5, lon: -74.5 });
  });

  it('wraps longitude and keeps the antimeridian on one key', () => {
    expect(cellFor(10, 179.9).key).toBe('10.0,-180.0');
    expect(cellFor(10, -179.9).key).toBe('10.0,-180.0');
    expect(cellFor(10, 360 + 5).key).toBe('10.0,5.0');
  });

  it('rejects missing or invalid positions', () => {
    expect(cellFor(undefined, undefined)).toBeNull();
    expect(cellFor('abc', 1)).toBeNull();
    expect(cellFor(91, 0)).toBeNull();
  });
});

describe('GET /api/aircraft', () => {
  let handler;
  let ctx;
  const stubApp = { get: (_path, fn) => (handler = fn) };
  const run = async (query) => {
    let body;
    let code = 200;
    const res = {
      json: (b) => (body = b),
      status: (c) => {
        code = c;
        return res;
      },
      set: () => res,
    };
    await handler({ query }, res);
    return { body, code };
  };
  const ok = (ac) => ({ ok: true, json: () => Promise.resolve({ ac }) });

  beforeEach(() => {
    ctx = { fetch: vi.fn(), APP_VERSION: 'test', logDebug: () => {}, logErrorOnce: () => {} };
    route(stubApp, ctx);
  });

  it('asks adsb.lol for 250 NM around the cell, never the whole world', async () => {
    ctx.fetch.mockResolvedValue(ok([plane('a1', 45.1, -93.2), { hex: 'nopos' }]));
    const { body, code } = await run({ lat: '44.93', lon: '-93.24' });
    expect(code).toBe(200);
    expect(ctx.fetch.mock.calls[0][0]).toBe(`https://api.adsb.lol/v2/lat/45/lon/-93/dist/${RADIUS_NM}`);
    expect(RADIUS_NM).toBeLessThanOrEqual(250);
    expect(body.aircraft).toHaveLength(1);
    expect(body.aircraft[0]).toMatchObject({ id: 'a1', call: 'a1', alt_ft: 35000, speed_kn: 450 });
    expect(body.center).toEqual({ lat: 45, lon: -93 });
  });

  it('shares one upstream pull per cell and caches it', async () => {
    ctx.fetch.mockResolvedValue(ok([plane('a1', 45, -93)]));
    await Promise.all([run({ lat: 45.1, lon: -93.1 }), run({ lat: 44.9, lon: -92.9 })]);
    await run({ lat: 45, lon: -93 });
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
    await run({ lat: 51.5, lon: -0.1 });
    expect(ctx.fetch).toHaveBeenCalledTimes(2);
  });

  it('400s without a location (pre-#1284 clients)', async () => {
    const { body, code } = await run({});
    expect(code).toBe(400);
    expect(body.aircraft).toEqual([]);
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('503s with the upstream reason when adsb.lol refuses and nothing is cached', async () => {
    ctx.fetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('radius exceeds 250 NM') });
    const { body, code } = await run({ lat: 10, lon: 10 });
    expect(code).toBe(503);
    expect(body.reason).toMatch(/403: radius exceeds 250 NM/);
  });

  it('caps upstream pulls per minute across cells', async () => {
    ctx.fetch.mockResolvedValue(ok([]));
    const codes = [];
    for (let i = 0; i < 45; i++) codes.push((await run({ lat: 0, lon: i })).code);
    expect(codes.filter((c) => c === 200)).toHaveLength(40);
    expect(codes.filter((c) => c === 503)).toHaveLength(5);
  });
});
