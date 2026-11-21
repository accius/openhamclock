/**
 * Solar badge: PNG rendering, theme/field/variant fallbacks, and the catalog.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const {
  parseBadgeFields,
  parseBadgeVariant,
  buildBadgeModel,
  buildSolarBadgeSvg,
  clearBadgeCache,
  setRenderBudget,
} = require('../badge/solarBadge.js');
const { listBadgeThemes, resolveBadgeTheme } = require('../badge/themes.js');
const route = require('./badge.js');

const indices = {
  sfi: { current: 168, history: [{ value: 150 }, { value: 160 }, { value: 168 }] },
  ssn: { current: 142, history: [] },
  kp: { current: 5.4, history: [{ value: 2 }, { value: 4 }, { value: 5.4 }] },
  a: { current: 18 },
  timestamp: '2026-11-21T23:20:00.000Z',
};

function n0nbh() {
  return {
    data: {
      solarData: { aIndex: '18', kIndex: '4', xray: 'C2.4' },
      bandConditions: [
        { name: '80m-40m', time: 'day', condition: 'Good' },
        { name: '80m-40m', time: 'night', condition: 'Fair' },
        { name: '30m-20m', time: 'day', condition: 'Good' },
        { name: '30m-20m', time: 'night', condition: 'Poor' },
        { name: '17m-15m', time: 'day', condition: 'Fair' },
        { name: '17m-15m', time: 'night', condition: 'Good' },
        { name: '12m-10m', time: 'day', condition: 'Poor' },
        { name: '12m-10m', time: 'night', condition: 'Fair' },
      ],
    },
    timestamp: Date.now(),
  };
}

function pngSize(buf) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('badge query parsing', () => {
  it('defaults fields and ignores unknown names', () => {
    expect(parseBadgeFields(undefined)).toEqual(['sfi', 'ssn', 'kp', 'a', 'xray', 'bands', 'updated', 'trend']);
    expect(parseBadgeFields('')).toEqual(parseBadgeFields(undefined));
    expect(parseBadgeFields('bogus')).toEqual(parseBadgeFields(undefined));
    expect(parseBadgeFields('kp,sfi,nope')).toEqual(['sfi', 'kp']);
  });

  it('defaults an unknown variant', () => {
    expect(parseBadgeVariant('compact')).toBe('compact');
    expect(parseBadgeVariant('WIDE')).toBe('wide');
    expect(parseBadgeVariant('poster')).toBe('full');
    expect(parseBadgeVariant('')).toBe('full');
  });
});

describe('badge themes', () => {
  it('defaults to the OpenHamClock dark theme and keeps red', () => {
    expect(resolveBadgeTheme(undefined).id).toBe('dark');
    expect(resolveBadgeTheme('no-such-theme').id).toBe('dark');
    expect(resolveBadgeTheme('RED').id).toBe('red');
    expect(resolveBadgeTheme('8-bit').id).toBe('eightbit');
    expect(resolveBadgeTheme('dark').background).toBe('#0a0e14');
    const ids = listBadgeThemes().map((theme) => theme.id);
    expect(ids).toEqual(expect.arrayContaining(['dark', 'light', 'matrix', 'trek', 'red', 'neutral', 'neutral-light']));
    expect(ids).not.toContain('custom');
  });
});

describe('badge model', () => {
  it('draws semantic status, G-scale, bands, and a sparkline', () => {
    const model = buildBadgeModel({ indices, n0nbh: n0nbh(), theme: 'dark', fields: undefined, variant: 'full' });
    const svg = buildSolarBadgeSvg(model);
    expect(svg).toContain('168');
    expect(svg).toContain('Excellent');
    expect(svg).toContain('Storm G1');
    expect(svg).toContain('>C2.4<');
    expect(svg).toContain('HF BANDS');
    expect(svg).toContain('N0NBH');
    expect(svg).toContain('D Good');
    expect(svg).toContain('#e23b3b');
    expect(svg).toContain('2026-11-21 23:20 UTC');
    expect(svg).toContain('<path');
    expect(model.palette.accent).toBe('#ffb432');
  });

  it('omits sections that were not requested', () => {
    const model = buildBadgeModel({
      indices,
      n0nbh: n0nbh(),
      theme: 'red',
      fields: 'sfi,ssn',
      variant: 'compact',
    });
    const svg = buildSolarBadgeSvg(model);
    expect(svg).toContain('168');
    expect(svg).not.toContain('HF BANDS');
    expect(svg).not.toContain('X-ray');
    expect(svg).not.toContain('23:20');
    expect(svg).not.toContain('<path');
    expect(model.palette.accentBar).toBe('#e10600');
  });

  it('still describes a badge when upstream data is missing', () => {
    const model = buildBadgeModel({
      indices: null,
      n0nbh: { data: null, timestamp: 0 },
      theme: 'midnight',
      fields: undefined,
      variant: 'full',
    });
    const svg = buildSolarBadgeSvg(model);
    expect(svg).toContain('Data unavailable');
    expect(svg).toContain('HF bands unavailable');
    expect(svg).toContain('openhamclock.com');
  });
});

describe('GET /api/badge/solar.png', () => {
  let handlers;
  let calls;

  function mount(extra = {}) {
    handlers = {};
    calls = 0;
    const ctx = {
      logErrorOnce: () => {},
      getSolarIndices: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return indices;
      },
      getCachedXrayFlux: () => null,
      n0nbhCache: n0nbh(),
      ...extra,
    };
    route({ get: (path, fn) => (handlers[path] = fn) }, ctx);
  }

  async function run(query) {
    let body;
    let code = 200;
    const headers = {};
    const res = {
      set(key, value) {
        if (typeof key === 'object') Object.assign(headers, key);
        else headers[key] = value;
        return res;
      },
      status(next) {
        code = next;
        return res;
      },
      send(payload) {
        body = payload;
      },
      json(payload) {
        body = payload;
      },
    };
    await handlers[query?.path || '/api/badge/solar.png']({ query: query || {} }, res);
    return { body, code, headers };
  }

  beforeEach(() => {
    clearBadgeCache();
    mount();
  });

  it('returns a PNG with a public cache header', async () => {
    const { body, code, headers } = await run({});
    expect(code).toBe(200);
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['Cache-Control']).toBe('public, max-age=300');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(pngSize(body).width).toBe(760);
    expect(body.length).toBeGreaterThan(1000);
  });

  it('caches per theme and collapses concurrent renders', async () => {
    const [a, b] = await Promise.all([run({ theme: 'red' }), run({ theme: 'red' })]);
    expect(a.body.equals(b.body)).toBe(true);
    expect(calls).toBe(1);
    const blue = await run({ theme: 'blue' });
    expect(blue.body.equals(a.body)).toBe(false);
    expect(calls).toBe(2);
  });

  it('serves the default badge for uncached combinations once the render budget is spent', async () => {
    setRenderBudget(1);
    try {
      const red = await run({ theme: 'red' });
      const defaults = await run({});
      const blue = await run({ theme: 'blue' });
      expect(blue.code).toBe(200);
      expect(blue.body.equals(defaults.body)).toBe(true);
      expect(blue.body.equals(red.body)).toBe(false);
      // A cached combination is still served as itself.
      expect((await run({ theme: 'red' })).body.equals(red.body)).toBe(true);
    } finally {
      setRenderBudget(60);
    }
  });

  it('falls unknown themes and fields back to the defaults', async () => {
    const fallback = await run({ theme: 'nope', fields: 'not-a-field', variant: 'poster' });
    const defaults = await run({});
    expect(fallback.body.equals(defaults.body)).toBe(true);
    expect(calls).toBe(1);
  });

  it('uses a narrower canvas for the compact variant', async () => {
    const { body } = await run({ variant: 'compact', fields: 'sfi,kp' });
    expect(pngSize(body).width).toBe(580);
  });

  it('still returns a PNG when solar data is missing', async () => {
    clearBadgeCache();
    mount({
      getSolarIndices: async () => {
        throw new Error('noaa down');
      },
      n0nbhCache: { data: null, timestamp: 0 },
    });
    const { body, code, headers } = await run({});
    expect(code).toBe(200);
    expect(headers['Content-Type']).toBe('image/png');
    expect(pngSize(body).width).toBe(760);
  });

  it('lists themes as JSON', async () => {
    const { body } = await run({ path: '/api/badge/themes' });
    expect(body.default).toBe('dark');
    expect(body.defaultFields).toContain('bands');
    expect(body.themes.some((theme) => theme.id === 'red' && theme.group === 'color')).toBe(true);
    expect(body.themes.some((theme) => theme.id === 'trek' && theme.group === 'openhamclock')).toBe(true);
    expect(body.fields.map((field) => field.id)).toContain('xray');
    expect(body.variants.map((variant) => variant.id)).toEqual(['full', 'compact', 'wide']);
  });
});
