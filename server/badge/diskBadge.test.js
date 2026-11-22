import { describe, expect, it } from 'vitest';
import { formatIllumination, moonPhaseName, parsePlacement, parseWavelength, resolvePlacements } from './diskBadge.js';

const {
  buildBadgeModel,
  buildSolarBadgeSvg,
  svgToPng,
  renderDiskBadge,
  clearBadgeCache,
  setRenderBudget,
} = require('./solarBadge.js');

describe('sun and moon badge options', () => {
  it('defaults wavelength and accepts the SDO set', () => {
    expect(parseWavelength(undefined)).toBe('0193');
    expect(parseWavelength('nope')).toBe('0193');
    expect(parseWavelength('0304')).toBe('0304');
    expect(parseWavelength('hmiic')).toBe('HMIIC');
  });

  it('places sun and moon on opposite sides when they collide', () => {
    expect(parsePlacement('LEFT')).toBe('left');
    expect(parsePlacement('middle')).toBeNull();
    expect(resolvePlacements('left', undefined)).toEqual({ sun: 'left', moon: null });
    expect(resolvePlacements('left', 'left')).toEqual({ sun: 'left', moon: 'right' });
    expect(resolvePlacements('right', 'right')).toEqual({ sun: 'right', moon: 'left' });
    expect(resolvePlacements('left', 'right')).toEqual({ sun: 'left', moon: 'right' });
  });

  it('names the moon phase from age and illumination', () => {
    expect(moonPhaseName(0, 0.2)).toBe('New Moon');
    expect(moonPhaseName(40, 5)).toBe('Waxing Crescent');
    expect(moonPhaseName(99, 14.5)).toBe('Full Moon');
    expect(moonPhaseName(30, 26)).toBe('Waning Crescent');
    expect(moonPhaseName(10, null)).toBe('Crescent');
    expect(moonPhaseName(null, null)).toBeNull();
    expect(formatIllumination(78.2)).toBe('78% illuminated');
    expect(formatIllumination(null)).toBeNull();
  });

  it('renders a sun frame and a wider conditions badge when a photo is on the side', async () => {
    const photo = await svgToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#ffcc33"/></svg>',
      '#000000',
    );
    clearBadgeCache();
    const moon = await renderDiskBadge('moon', {
      theme: 'light',
      ctx: {
        getMoonSnapshot: async () => ({
          buffer: photo,
          contentType: 'image/png',
          phase: 78,
          age: 10,
          timestamp: Date.parse('2026-11-21T23:20:00Z'),
        }),
      },
    });
    expect(moon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(moon.readUInt32BE(16)).toBe(440);

    const model = buildBadgeModel({
      indices: {
        sfi: { current: 168 },
        ssn: { current: 120 },
        kp: { current: 2 },
        a: { current: 4 },
        timestamp: '2026-11-21T23:20:00.000Z',
      },
      n0nbh: null,
      theme: 'dark',
      fields: 'sfi,kp,updated',
      variant: 'compact',
    });
    const plain = await svgToPng(buildSolarBadgeSvg(model), model.palette.background);
    const { toDataUri } = require('./diskBadge.js');
    const uri = toDataUri(photo, 'image/png');
    model.left = { href: uri, caption: 'AIA 193 Å', missing: 'Sun' };
    model.right = { href: uri, caption: 'Waxing Gibbous', missing: 'Moon' };
    const sided = buildSolarBadgeSvg(model);
    expect(sided).toContain('data:image/png;base64,');
    const both = await svgToPng(sided, model.palette.background);
    expect(both.readUInt32BE(16)).toBeGreaterThan(plain.readUInt32BE(16));
  });

  it('uses the moon photo for the moon badge and keeps every conditions section beside both disks', async () => {
    const sunPhoto = await svgToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#ffaa22"/></svg>',
      '#000000',
    );
    const moonPhoto = await svgToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#d0d4dc"/></svg>',
      '#111111',
    );
    clearBadgeCache();
    const sunBadge = await renderDiskBadge('sun', {
      theme: 'red',
      ctx: {
        getSolarImage: async () => ({
          buffer: sunPhoto,
          contentType: 'image/png',
          source: 'SDO',
          timestamp: Date.parse('2026-11-21T23:20:00Z'),
        }),
      },
    });
    const moonBadge = await renderDiskBadge('moon', {
      theme: 'red',
      ctx: {
        getMoonSnapshot: async () => ({
          buffer: moonPhoto,
          contentType: 'image/png',
          phase: 78,
          age: 10.2,
          timestamp: Date.parse('2026-11-21T23:20:00Z'),
        }),
      },
    });
    expect(sunBadge.equals(moonBadge)).toBe(false);

    const { parseBadgeFields } = require('./solarBadge.js');
    expect(parseBadgeFields('all')).toEqual(parseBadgeFields(undefined));
    const model = buildBadgeModel({
      indices: {
        sfi: { current: 168, history: [{ value: 150 }, { value: 168 }] },
        ssn: { current: 142 },
        kp: { current: 3.3, history: [{ value: 2 }, { value: 3.3 }] },
        a: { current: 12 },
        timestamp: '2026-11-21T23:20:00.000Z',
      },
      n0nbh: {
        data: {
          solarData: { xray: 'C2.4' },
          bandConditions: [
            { name: '80m-40m', time: 'day', condition: 'Good' },
            { name: '80m-40m', time: 'night', condition: 'Fair' },
            { name: '30m-20m', time: 'day', condition: 'Good' },
            { name: '30m-20m', time: 'night', condition: 'Good' },
            { name: '17m-15m', time: 'day', condition: 'Fair' },
            { name: '17m-15m', time: 'night', condition: 'Poor' },
            { name: '12m-10m', time: 'day', condition: 'Poor' },
            { name: '12m-10m', time: 'night', condition: 'Fair' },
          ],
        },
        timestamp: Date.now(),
      },
      theme: 'red',
      fields: 'all',
      variant: 'full',
    });
    model.left = { href: 'data:image/png;base64,SUN', caption: 'AIA 193 Å', missing: 'Sun' };
    model.right = { href: 'data:image/png;base64,MOON', caption: 'Waxing Gibbous', missing: 'Moon' };
    const svg = buildSolarBadgeSvg(model);
    expect(svg).toContain('X-ray');
    expect(svg).toContain('HF BANDS');
    expect(svg).toContain('<path');
    expect(svg).toContain('data:image/png;base64,SUN');
    expect(svg).toContain('data:image/png;base64,MOON');
  });

  it('serves the default sun badge for uncached combinations once the render budget is spent', async () => {
    const photo = await svgToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#ffaa22"/></svg>',
      '#000000',
    );
    const ctx = {
      getSolarImage: async () => ({ buffer: photo, contentType: 'image/png', source: 'SDO', timestamp: 0 }),
    };
    clearBadgeCache();
    setRenderBudget(1);
    try {
      const defaults = await renderDiskBadge('sun', { ctx });
      const red = await renderDiskBadge('sun', { theme: 'red', ctx });
      expect(red.equals(defaults)).toBe(true);
    } finally {
      setRenderBudget(60);
      clearBadgeCache();
    }
  });
});
