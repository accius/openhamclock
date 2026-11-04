import { describe, it, expect } from 'vitest';
import {
  shortestDelta,
  longPathAz,
  clampStep,
  pathCrossesStop,
  decideFlip,
  toRotatorCoords,
  planRotatorCommand,
  satelliteTarget,
} from './rotatorTrack.js';

describe('angles', () => {
  it('shortest signed delta wraps correctly', () => {
    expect(shortestDelta(350, 10)).toBe(20);
    expect(shortestDelta(10, 350)).toBe(-20);
    expect(shortestDelta(0, 180)).toBe(-180);
    expect(shortestDelta(90, 90)).toBe(0);
  });
  it('long path is the reciprocal', () => {
    expect(longPathAz(45)).toBe(225);
    expect(longPathAz(300)).toBe(120);
  });
  it('clamps the step', () => {
    expect(clampStep(undefined)).toBe(2);
    expect(clampStep(0)).toBe(2);
    expect(clampStep(0.1)).toBe(0.5);
    expect(clampStep(99)).toBe(15);
    expect(clampStep(3)).toBe(3);
  });
});

describe('stop crossing and flip', () => {
  it('detects a pass that sweeps through north with a north stop', () => {
    expect(pathCrossesStop([300, 330, 355, 5, 30], 0)).toBe(true);
    expect(pathCrossesStop([200, 230, 260, 290, 320], 0)).toBe(false);
  });
  it('respects a south stop', () => {
    expect(pathCrossesStop([150, 170, 185, 200], 180)).toBe(true);
    expect(pathCrossesStop([300, 330, 355, 5, 30], 180)).toBe(false);
  });
  it('ignores degenerate input', () => {
    expect(pathCrossesStop([], 0)).toBe(false);
    expect(pathCrossesStop([10], 0)).toBe(false);
    expect(pathCrossesStop(['x', null], 0)).toBe(false);
  });
  it('flips only when the pass crosses the stop AND the rotator can go over the top', () => {
    expect(decideFlip({ azimuths: [330, 10, 40], stopAz: 0, maxEl: 180 })).toEqual({ flip: true, crossesStop: true });
    expect(decideFlip({ azimuths: [330, 10, 40], stopAz: 0, maxEl: 90 })).toEqual({ flip: false, crossesStop: true });
    expect(decideFlip({ azimuths: [100, 140, 180], stopAz: 0, maxEl: 180 })).toEqual({
      flip: false,
      crossesStop: false,
    });
  });
  it('flip mirrors the geometry', () => {
    expect(toRotatorCoords(10, 30, false)).toEqual({ az: 10, el: 30 });
    expect(toRotatorCoords(10, 30, true)).toEqual({ az: 190, el: 150 });
    expect(toRotatorCoords(350, 0, true)).toEqual({ az: 170, el: 180 });
    expect(toRotatorCoords(90, -3, false).el).toBe(0);
  });
  it('a flipped north-crossing pass never wraps the rotator azimuth', () => {
    const pass = [330, 345, 359, 5, 20, 40]; // crosses north
    const { flip } = decideFlip({ azimuths: pass, stopAz: 0, maxEl: 180 });
    const rotatorAz = pass.map((az) => toRotatorCoords(az, 45, flip).az);
    expect(pathCrossesStop(rotatorAz, 0)).toBe(false);
  });
});

describe('planRotatorCommand', () => {
  const base = { stepDeg: 2, minIntervalMs: 1000, now: 10_000, lastSentAt: 0 };
  it('sends immediately when nothing is known', () => {
    expect(planRotatorCommand({ ...base, target: { az: 100, el: 10 } })).toEqual({ send: true, reason: 'first' });
  });
  it('refuses without a target and under the rate limit', () => {
    expect(planRotatorCommand({ ...base, target: null }).send).toBe(false);
    expect(planRotatorCommand({ ...base, target: { az: 1 }, lastSentAt: 9_500 }).reason).toBe('rate-limit');
  });
  it('ignores moves below the step relative to the rotator position', () => {
    const r = planRotatorCommand({ ...base, target: { az: 101, el: 10 }, current: { az: 100, el: 10 } });
    expect(r.send).toBe(false);
    expect(r.reason).toBe('within-step');
  });
  it('sends when azimuth or elevation moved beyond the step', () => {
    expect(planRotatorCommand({ ...base, target: { az: 103, el: 10 }, current: { az: 100, el: 10 } }).send).toBe(true);
    expect(planRotatorCommand({ ...base, target: { az: 100, el: 13 }, current: { az: 100, el: 10 } }).send).toBe(true);
  });
  it('does not repeat an identical command while the rotator is still travelling', () => {
    const r = planRotatorCommand({
      ...base,
      target: { az: 120, el: 20 },
      lastCommand: { az: 120, el: 20 },
      current: { az: 100, el: 10 },
    });
    expect(r).toEqual({ send: false, reason: 'same-command' });
  });
  it('handles azimuth-only rotators (no elevation known)', () => {
    expect(planRotatorCommand({ ...base, target: { az: 100, el: 40 }, current: { az: 100, el: null } }).send).toBe(
      false,
    );
    expect(planRotatorCommand({ ...base, target: { az: 105 }, current: { az: 100 } }).send).toBe(true);
  });
});

describe('satelliteTarget', () => {
  const now = 1_000_000;
  it('tracks when above the horizon', () => {
    const t = satelliteTarget({ look: { azimuth: 45, elevation: 20 }, now });
    expect(t).toEqual({ az: 45, el: 20, phase: 'tracking' });
  });
  it('pre-positions to the AOS azimuth inside the window', () => {
    const t = satelliteTarget({
      look: { azimuth: 200, elevation: -10 },
      nextPass: { aosMs: now + 5 * 60_000, aosAz: 310 },
      now,
      prepositionMins: 10,
    });
    expect(t).toEqual({ az: 310, el: 0, phase: 'preposition' });
  });
  it('idles outside the pre-position window', () => {
    expect(
      satelliteTarget({
        look: { azimuth: 200, elevation: -10 },
        nextPass: { aosMs: now + 30 * 60_000, aosAz: 310 },
        now,
        prepositionMins: 10,
      }),
    ).toBeNull();
    expect(satelliteTarget({ look: null, nextPass: null, now })).toBeNull();
  });
  it('applies flip to both phases', () => {
    expect(satelliteTarget({ look: { azimuth: 10, elevation: 30 }, now, flip: true })).toEqual({
      az: 190,
      el: 150,
      phase: 'tracking',
    });
    expect(
      satelliteTarget({
        look: { azimuth: 0, elevation: -5 },
        nextPass: { aosMs: now + 60_000, aosAz: 340 },
        now,
        flip: true,
      }),
    ).toEqual({ az: 160, el: 180, phase: 'preposition' });
  });
});
