import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { slimLaunch, slimLaunches, groupByPad } from './spaceLaunches.js';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'space-weather', 'll2-upcoming.json'), 'utf8'),
);

describe('slimLaunch', () => {
  it('keeps the display fields and parses pad coordinates to numbers', () => {
    const l = slimLaunch(fixture.results[1]);
    expect(l.name).toBe('Falcon 9 Block 5 | USSF-481');
    expect(l.net).toBe('2026-10-15T23:44:00Z');
    expect(l.status).toBe('Go');
    expect(l.provider).toBe('SpaceX');
    expect(l.rocket).toBe('Falcon 9 Block 5');
    expect(l.mission).toBe('USSF-481');
    expect(l.orbit).toBe('PO');
    expect(l.pad).toBe('Space Launch Complex 4E');
    expect(l.location).toBe('Vandenberg SFB, CA, USA');
    expect(l.country).toBe('USA');
    expect(l.lat).toBeCloseTo(34.632, 3);
    expect(l.lon).toBeCloseTo(-120.611, 3);
    expect(l.description.length).toBeLessThanOrEqual(280);
  });

  it('returns null for records missing the essentials', () => {
    expect(slimLaunch(null)).toBeNull();
    expect(slimLaunch({ id: 'x', name: 'y' })).toBeNull();
  });

  it('nulls a missing pad coordinate instead of producing NaN', () => {
    const l = slimLaunch(fixture.results[2]);
    expect(l.lat).toBeNull();
    expect(l.lon).toBeCloseTo(-80.577, 2);
  });
});

describe('slimLaunches', () => {
  it('sorts by NET ascending and tolerates a bad payload', () => {
    const out = slimLaunches(fixture);
    expect(out.map((l) => l.net)).toEqual([...out.map((l) => l.net)].sort());
    expect(out).toHaveLength(3);
    expect(slimLaunches(null)).toEqual([]);
    expect(slimLaunches({ results: 'nope' })).toEqual([]);
  });
});

describe('groupByPad', () => {
  it('groups launches per pad and drops those without coordinates', () => {
    const pads = groupByPad(slimLaunches(fixture));
    expect(pads).toHaveLength(2);
    const slc4e = pads.find((p) => p.pad === 'Space Launch Complex 4E');
    expect(slc4e.launches).toHaveLength(1);
    expect(slc4e.lat).toBeCloseTo(34.632, 3);
  });
});
