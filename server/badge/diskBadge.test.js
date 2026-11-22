import { describe, expect, it } from 'vitest';
import { formatIllumination, moonPhaseName, parsePlacement, parseWavelength, resolvePlacements } from './diskBadge.js';

const { buildBadgeModel, buildSolarBadgeSvg, svgToPng, renderDiskBadge, clearBadgeCache } = require('./solarBadge.js');

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
});
