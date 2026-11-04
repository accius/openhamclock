import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseLatLon, parseJtwcRss, parseJtwcWarningText, basinFromProductId } from './jtwcWarning.js';

const fx = (name) => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

describe('parseLatLon', () => {
  it('handles both JTWC spellings and hemispheres', () => {
    expect(parseLatLon('22.7N 141.1E')).toEqual({ lat: 22.7, lon: 141.1 });
    expect(parseLatLon('23.4 N, 139.4 E')).toEqual({ lat: 23.4, lon: 139.4 });
    expect(parseLatLon('12.0S 65.5W')).toEqual({ lat: -12, lon: -65.5 });
    expect(parseLatLon('garbage')).toBeNull();
  });
});

describe('parseJtwcRss', () => {
  const storms = parseJtwcRss(fx('jtwc.rss'));

  it('lists every active system once with product links', () => {
    const ids = storms.map((s) => s.id);
    expect(ids).toContain('wp2826');
    expect(ids).toContain('wp2926');
    expect(ids).toContain('ep2126');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('extracts type, designation, name, warning number and links', () => {
    const s = storms.find((x) => x.id === 'wp2826');
    expect(s).toMatchObject({
      designation: '28W',
      name: 'Twentyeight',
      type: 'Tropical Depression',
      warningNum: 12,
      issued: '14/2100Z',
      basin: 'WP',
      textUrl: 'https://www.metoc.navy.mil/jtwc/products/wp2826web.txt',
      kmzUrl: 'https://www.metoc.navy.mil/jtwc/products/wp2826.kmz',
    });
    expect(s.region).toMatch(/Northwest Pacific/);
    const t = storms.find((x) => x.id === 'ep2126');
    expect(t).toMatchObject({ type: 'Tropical Storm', name: 'Trudy', basin: 'EP' });
  });

  it('returns [] for non-XML input', () => {
    expect(parseJtwcRss(null)).toEqual([]);
    expect(parseJtwcRss('<rss></rss>')).toEqual([]);
  });
});

describe('parseJtwcWarningText', () => {
  const w = parseJtwcWarningText(fx('jtwc-wp2826web.txt'));

  it('reads the warning position, time and movement', () => {
    expect(w.position).toEqual({ lat: 22.7, lon: 141.1 });
    expect(w.positionTime).toBe('141800Z');
    expect(w.movementDeg).toBe(305);
    expect(w.movementKt).toBe(12);
  });

  it('reads current winds and pressure', () => {
    expect(w.windKt).toBe(30);
    expect(w.gustKt).toBe(40);
    expect(w.pressureMb).toBe(1007);
    expect(w.header).toMatch(/TROPICAL DEPRESSION 28W/);
  });

  it('reads the forecast table', () => {
    expect(w.forecasts.map((f) => f.hours)).toEqual([12, 24, 36]);
    expect(w.forecasts[0]).toEqual({ hours: 12, validAt: '150600Z', lat: 23.4, lon: 139.4, windKt: 25, gustKt: 35 });
  });

  it('tolerates empty input', () => {
    expect(parseJtwcWarningText('').forecasts).toEqual([]);
    expect(parseJtwcWarningText(undefined).position).toBeNull();
  });
});

describe('basinFromProductId', () => {
  it('maps product prefixes', () => {
    expect(basinFromProductId('wp2826')).toBe('WP');
    expect(basinFromProductId('sh0526')).toBe('SH');
    expect(basinFromProductId('io0126')).toBe('IO');
  });
});
