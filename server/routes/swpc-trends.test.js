/**
 * Tests for server/routes/swpc-trends.js — the SWPC trend-series proxy.
 * Unit-tests the binning/slimming transforms and exercises the route with
 * a stubbed ctx.fetch: partial upstream failure, total failure, caching.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./swpc-trends.js');
const { binSeries, slimWind, slimMag, slimProtons, slimElectrons, latestValue } = route;

describe('binSeries', () => {
  it('averages numeric fields into 10-minute bins, skipping nulls per-field', () => {
    const t0 = Date.parse('2026-08-28T12:00:00Z');
    const out = binSeries(
      [
        { t: t0, speed: 400, density: 10 },
        { t: t0 + 60_000, speed: 500, density: null },
        { t: t0 + 11 * 60_000, speed: 600, density: 20 },
      ],
      ['speed', 'density'],
    );
    expect(out).toHaveLength(2);
    expect(out[0].speed).toBe(450);
    expect(out[0].density).toBe(10); // null skipped, not averaged as 0
    expect(out[1].speed).toBe(600);
  });

  it('drops records with invalid timestamps', () => {
    expect(binSeries([{ t: NaN, speed: 1 }], ['speed'])).toEqual([]);
  });
});

describe('slim transforms', () => {
  const now = Date.parse('2026-08-28T12:00:00Z');

  it('slimWind parses zone-less SWPC time tags as UTC and windows to 24 h', () => {
    const out = slimWind(
      [
        { time_tag: '2026-08-28T11:00:00', proton_speed: 358.29, proton_density: 19.94 },
        { time_tag: '2026-08-26T11:00:00', proton_speed: 999, proton_density: 99 }, // too old
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].speed).toBe(358.29);
  });

  it('slimMag extracts bt and bz_gsm', () => {
    const out = slimMag([{ time_tag: '2026-08-28T11:30:00', bt: 10.73, bz_gsm: -5.2 }], now);
    expect(out[0].bt).toBe(10.73);
    expect(out[0].bz).toBe(-5.2);
  });

  it('slimProtons keeps only the >=10 MeV channel', () => {
    const out = slimProtons(
      [
        { time_tag: '2026-08-28T11:30:00Z', flux: 25.3, energy: '>=1 MeV' },
        { time_tag: '2026-08-28T11:30:00Z', flux: 0.23, energy: '>=10 MeV' },
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].flux).toBe(0.23);
  });

  it('slimElectrons keeps the >=2 MeV channel and bins it', () => {
    const out = slimElectrons(
      [
        { time_tag: '2026-08-28T11:30:00Z', flux: 150.5, energy: '>=2 MeV' },
        { time_tag: '2026-08-28T11:35:00Z', flux: 250.5, energy: '>=2 MeV' },
        { time_tag: '2026-08-28T11:35:00Z', flux: 9999, energy: '>=0.8 MeV' },
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].flux).toBe(200.5);
  });
});

describe('latestValue', () => {
  it('walks back past trailing nulls', () => {
    expect(latestValue([{ v: 1 }, { v: 2 }, { v: null }], 'v')).toBe(2);
    expect(latestValue([], 'v')).toBe(null);
  });
});

describe('GET /api/swpc/trends (route)', () => {
  let handler;
  let ctx;
  const stubApp = { get: (path, fn) => (handler = fn) };
  const runRequest = async () => {
    let body;
    let code = 200;
    const res = {
      json: (b) => (body = b),
      status: (c) => {
        code = c;
        return res;
      },
    };
    await handler({}, res);
    return { body, code };
  };
  const recentTag = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19);

  beforeEach(() => {
    ctx = {
      fetch: vi.fn(),
      upstream: { fetch: (key, fn) => fn() },
      APP_VERSION: 'test',
      logDebug: () => {},
      logErrorOnce: () => {},
    };
  });

  it('serves combined series and caches; a dead feed degrades to empty', async () => {
    ctx.fetch.mockImplementation((url) => {
      if (url.includes('rtsw_wind')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ time_tag: recentTag, proton_speed: 400, proton_density: 5 }]),
        });
      }
      if (url.includes('rtsw_mag')) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ time_tag: recentTag + 'Z', flux: 0.5, energy: '>=10 MeV' }]),
      });
    });
    route(stubApp, ctx);

    const { body } = await runRequest();
    expect(body.wind).toHaveLength(1);
    expect(body.mag).toEqual([]); // failed feed degrades, doesn't 502
    expect(body.protons).toHaveLength(1);
    expect(body.latest.speed).toBe(400);
    expect(body.latest.proton10).toBe(0.5);

    await runRequest();
    expect(ctx.fetch).toHaveBeenCalledTimes(4); // second hit from cache
  });

  it('502s when every feed fails and no cache exists', async () => {
    ctx.fetch.mockRejectedValue(new Error('down'));
    route(stubApp, ctx);
    const { code, body } = await runRequest();
    expect(code).toBe(502);
    expect(body.error).toBeTruthy();
  });
});
