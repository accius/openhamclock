import { describe, it, expect } from 'vitest';
import {
  parseControlCommand,
  parseLocation,
  sanitizeStateReport,
  isValidControlId,
  COMMAND_TYPES,
} from './controlCommands.js';

describe('isValidControlId', () => {
  it('accepts url-safe ids of 8..64 chars', () => {
    expect(isValidControlId('abcdefgh')).toBe(true);
    expect(isValidControlId('ohc_1234-ABCD')).toBe(true);
  });
  it('rejects short, long or unsafe ids', () => {
    expect(isValidControlId('abc')).toBe(false);
    expect(isValidControlId('a'.repeat(65))).toBe(false);
    expect(isValidControlId('has space!')).toBe(false);
    expect(isValidControlId(42)).toBe(false);
  });
});

describe('parseLocation', () => {
  it('converts a grid to its centre', () => {
    const r = parseLocation({ grid: 'FN20' });
    expect(r.ok).toBe(true);
    expect(r.grid).toBe('FN20');
    expect(r.lat).toBeCloseTo(40.5, 1);
    expect(r.lon).toBeCloseTo(-75, 1);
  });
  it('accepts lat/lon as numbers or numeric strings', () => {
    expect(parseLocation({ lat: '51.5', lon: '-0.1' })).toMatchObject({ ok: true, lat: 51.5, lon: -0.1 });
  });
  it('rejects 2-char grids and out-of-range coordinates', () => {
    expect(parseLocation({ grid: 'FN' }).ok).toBe(false);
    expect(parseLocation({ lat: 91, lon: 0 }).ok).toBe(false);
    expect(parseLocation({ lat: 0, lon: 181 }).ok).toBe(false);
    expect(parseLocation({}).ok).toBe(false);
  });
});

describe('parseControlCommand', () => {
  it('rejects unknown commands', () => {
    const r = parseControlCommand('reboot', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown command/);
  });

  it('exposes the command list', () => {
    expect(COMMAND_TYPES).toContain('de');
    expect(COMMAND_TYPES).toContain('capture');
  });

  it('de: grid + optional callsign', () => {
    const r = parseControlCommand('de', { grid: 'DM12kv', call: 'w6abc' });
    expect(r.ok).toBe(true);
    expect(r.command.type).toBe('de');
    expect(r.command.params.call).toBe('W6ABC');
    expect(r.command.params.grid).toBe('DM12KV');
    expect(r.command.params.lat).toBeCloseTo(32.9, 1);
  });

  it('de: rejects a bad callsign', () => {
    expect(parseControlCommand('de', { grid: 'DM12', call: 'not a call' }).ok).toBe(false);
  });

  it('dx: callsign alone is enough (browser resolves it)', () => {
    const r = parseControlCommand('dx', { call: 'JA1ABC' });
    expect(r.ok).toBe(true);
    expect(r.command.params).toEqual({ lat: null, lon: null, grid: null, call: 'JA1ABC' });
  });

  it('dx: requires something', () => {
    expect(parseControlCommand('dx', {}).ok).toBe(false);
  });

  it('layout: validates ids and dockable presets', () => {
    expect(parseControlCommand('layout', { layout: 'contest' }).ok).toBe(true);
    expect(parseControlCommand('layout', { layout: 'mobile' }).ok).toBe(true);
    expect(parseControlCommand('layout', { layout: 'dockable#night' }).ok).toBe(true);
    expect(parseControlCommand('layout', { layout: 'modern#x' }).ok).toBe(false);
    expect(parseControlCommand('layout', { layout: 'bogus' }).ok).toBe(false);
    expect(parseControlCommand('layout', {}).ok).toBe(false);
  });

  it('theme: lower-cases and validates', () => {
    expect(parseControlCommand('theme', { theme: 'Retro' }).command.params.theme).toBe('retro');
    expect(parseControlCommand('theme', { theme: 'neon' }).ok).toBe(false);
  });

  it('panels: add/remove/focus with dedupe and limits', () => {
    const r = parseControlCommand('panels', { add: ['dx-cluster', 'dx-cluster'], remove: ['pota'], focus: 'logbook' });
    expect(r.ok).toBe(true);
    expect(r.command.params).toEqual({ add: ['dx-cluster'], remove: ['pota'], focus: 'logbook' });
    expect(parseControlCommand('panels', {}).ok).toBe(false);
    expect(parseControlCommand('panels', { add: 'dx-cluster' }).ok).toBe(false);
    expect(parseControlCommand('panels', { add: Array.from({ length: 21 }, (_, i) => `p${i}`) }).ok).toBe(false);
    expect(parseControlCommand('panels', { add: ['<script>'] }).ok).toBe(false);
  });

  it('mapview: projection, basemap, layers, night, grid', () => {
    const r = parseControlCommand('mapview', {
      projection: 'Globe3D',
      basemap: 'dark',
      layers: { grayline: 'on', aurora: false },
      night: 1,
      grid: 'false',
    });
    expect(r.ok).toBe(true);
    expect(r.command.params).toEqual({
      projection: 'globe3d',
      basemap: 'dark',
      layers: { grayline: true, aurora: false },
      night: true,
      grid: false,
    });
    expect(parseControlCommand('mapview', {}).ok).toBe(false);
    expect(parseControlCommand('mapview', { projection: 'mollweide' }).ok).toBe(false);
    expect(parseControlCommand('mapview', { layers: { grayline: 'maybe' } }).ok).toBe(false);
  });

  it('satellite: name or none', () => {
    expect(parseControlCommand('satellite', { name: 'iss (zarya)' }).command.params.name).toBe('ISS (ZARYA)');
    expect(parseControlCommand('satellite', { name: 'none' }).command.params.name).toBe(null);
    expect(parseControlCommand('satellite', {}).command.params.name).toBe(null);
    expect(parseControlCommand('satellite', { name: '<b>' }).ok).toBe(false);
  });

  it('time: now, offset, iso', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(parseControlCommand('time', { time: 'now' }, { now }).command.params.offsetMs).toBe(0);
    expect(parseControlCommand('time', {}, { now }).command.params.offsetMs).toBe(0);
    expect(parseControlCommand('time', { offsetMs: -3600000 }, { now }).command.params.offsetMs).toBe(-3600000);
    expect(parseControlCommand('time', { iso: '2026-01-01T13:00:00Z' }, { now }).command.params.offsetMs).toBe(3600000);
    expect(parseControlCommand('time', { time: 'yesterday-ish' }, { now }).ok).toBe(false);
    expect(parseControlCommand('time', { offsetMs: 1e20 }, { now }).ok).toBe(false);
  });

  it('title: up to six titles, optional colours, null clears', () => {
    const r = parseControlCommand('title', { text: ' Field Day ; W1AW ', fg: '#fff', bg: 'black' });
    expect(r.ok).toBe(true);
    expect(r.command.params).toEqual({ text: 'Field Day;W1AW', fg: '#fff', bg: 'black' });
    expect(parseControlCommand('title', { text: null }).command.params.text).toBe(null);
    expect(parseControlCommand('title', { text: 'a;b;c;d;e;f;g' }).ok).toBe(false);
    expect(parseControlCommand('title', { text: 'x'.repeat(61) }).ok).toBe(false);
    expect(parseControlCommand('title', { text: 'ok', fg: 'url(evil)' }).ok).toBe(false);
  });

  it('alarm: HH:MM with kind/utc/armed', () => {
    const r = parseControlCommand('alarm', { kind: 'daily', time: '06:30', utc: true });
    expect(r.command.params).toEqual({ kind: 'daily', time: '06:30', utc: true, armed: true });
    expect(parseControlCommand('alarm', { time: '25:00' }).ok).toBe(false);
    expect(parseControlCommand('alarm', { kind: 'off' }).command.params.armed).toBe(false);
    expect(parseControlCommand('alarm', { armed: false }).command.params.kind).toBe('off');
  });

  it('stopwatch: actions and countdown minutes', () => {
    expect(parseControlCommand('stopwatch', { action: 'RUN' }).command.params).toEqual({
      action: 'run',
      minutes: null,
    });
    expect(parseControlCommand('stopwatch', { action: 'countdown', minutes: 5 }).command.params.minutes).toBe(5);
    expect(parseControlCommand('stopwatch', { action: 'countdown' }).ok).toBe(false);
    expect(parseControlCommand('stopwatch', { action: 'explode' }).ok).toBe(false);
  });

  it('rotator: az wraps, el bounded, stop wins', () => {
    expect(parseControlCommand('rotator', { az: 370 }).command.params.az).toBe(10);
    expect(parseControlCommand('rotator', { az: -90 }).command.params.az).toBe(270);
    expect(parseControlCommand('rotator', { el: 200 }).ok).toBe(false);
    expect(parseControlCommand('rotator', { stop: true, az: 90 }).command.params).toEqual({
      az: null,
      el: null,
      stop: true,
    });
    expect(parseControlCommand('rotator', {}).ok).toBe(false);
  });

  it('touch: integer coordinates', () => {
    expect(parseControlCommand('touch', { x: 10, y: 20 }).command.params).toEqual({ x: 10, y: 20 });
    expect(parseControlCommand('touch', { x: 1.5, y: 20 }).ok).toBe(false);
    expect(parseControlCommand('touch', { x: -1, y: 20 }).ok).toBe(false);
  });

  it('capture: takes no params', () => {
    expect(parseControlCommand('capture', null).command).toEqual({ type: 'capture', params: {} });
  });
});

describe('sanitizeStateReport', () => {
  it('keeps known fields, bounds lists and drops junk', () => {
    const s = sanitizeStateReport({
      callsign: 'K0CJH',
      de: { lat: 40, lon: -105, grid: 'DN70' },
      dx: { lat: 'x', lon: 139 },
      layout: 'dockable',
      theme: 'dark',
      layers: [{ id: 'grayline', name: 'Gray line', enabled: true }, { id: 'bad id' }, 'nope'],
      panels: ['dx-cluster', 42],
      satellites: Array.from({ length: 100 }, (_, i) => `SAT-${i}`),
      kioskLocked: 'yes',
      extra: 'dropped',
    });
    expect(s.callsign).toBe('K0CJH');
    expect(s.de).toEqual({ lat: 40, lon: -105, grid: 'DN70' });
    expect(s.dx).toEqual({ lat: null, lon: 139, grid: null });
    expect(s.layers).toEqual([{ id: 'grayline', name: 'Gray line', enabled: true }]);
    expect(s.panels).toEqual(['dx-cluster']);
    expect(s.satellites).toHaveLength(60);
    expect(s.kioskLocked).toBe(false);
    expect(s.timeOffsetMs).toBe(0);
    expect(s).not.toHaveProperty('extra');
  });
  it('returns null for non-objects', () => {
    expect(sanitizeStateReport(null)).toBe(null);
    expect(sanitizeStateReport([])).toBe(null);
    expect(sanitizeStateReport('x')).toBe(null);
  });
});
