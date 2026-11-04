import { describe, it, expect } from 'vitest';
import {
  GUARD_DEFAULTS,
  TRIGGER_WINDOW_MS,
  normalizeGuardSettings,
  exitRadii,
  haversineKm,
  bearingDeg,
  destinationPoint,
  cardinal,
  addStrikes,
  evaluateGuard,
  transitionKind,
  relayDemand,
  nextOverride,
  formatDistance,
  describeStrike,
  shouldRealert,
  GuardRunner,
  REALERT_MIN_GAP_MS,
} from './lightningGuard.js';

const DE = { lat: 40.015, lon: -105.2705 }; // Boulder, CO
const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;
const S = normalizeGuardSettings({ enabled: true }); // 50 km warn / 25 km alarm / 30 min / 20 %

let seq = 0;
/** A raw feed strike `km` from DE on `brg`, `ago` ms before `now`. */
const strikeAt = (km, brg, ts) => {
  const p = destinationPoint(DE.lat, DE.lon, km, brg);
  return { id: `t${++seq}`, lat: p.lat, lon: p.lon, timestamp: ts };
};

/** Run a timeline: [{ t, strikes: [[km, brg]] }] → levels after each step. */
function run(steps, settings = S) {
  let list = [];
  let level = 'clear';
  const out = [];
  for (const step of steps) {
    const batch = (step.strikes || []).map(([km, brg]) => strikeAt(km, brg ?? 0, step.t));
    list = addStrikes(list, batch, DE, settings, step.t);
    const st = evaluateGuard(level, list, settings, step.t);
    level = st.level;
    out.push(st);
  }
  return out;
}

describe('geometry', () => {
  it('haversine distance matches known values', () => {
    // 1° of latitude ≈ 111.2 km
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
    // Boulder → Denver ≈ 39 km
    expect(haversineKm(40.015, -105.2705, 39.7392, -104.9903)).toBeGreaterThan(36);
    expect(haversineKm(40.015, -105.2705, 39.7392, -104.9903)).toBeLessThan(41);
    expect(haversineKm(10, 20, 10, 20)).toBe(0);
  });

  it('bearing and cardinal points', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 5);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 5);
    expect(cardinal(0)).toBe('N');
    expect(cardinal(44)).toBe('NE');
    expect(cardinal(359)).toBe('N');
    expect(cardinal(-90)).toBe('W');
    expect(cardinal(225, { words: true })).toBe('south-west');
    expect(cardinal(NaN)).toBe('');
  });

  it('destinationPoint round-trips distance and bearing', () => {
    for (const [km, brg] of [
      [10, 45],
      [24.9, 200],
      [60, 300],
    ]) {
      const p = destinationPoint(DE.lat, DE.lon, km, brg);
      expect(haversineKm(DE.lat, DE.lon, p.lat, p.lon)).toBeCloseTo(km, 3);
      expect(bearingDeg(DE.lat, DE.lon, p.lat, p.lon)).toBeCloseTo(brg, 1);
    }
    // wraps across the antimeridian
    expect(destinationPoint(0, 179.9, 50, 90).lon).toBeLessThan(-179);
  });
});

describe('settings', () => {
  it('defaults: 50 km warn, 25 km alarm, 30 min all-clear', () => {
    const s = normalizeGuardSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.warnKm).toBe(50);
    expect(s.alarmKm).toBe(25);
    expect(s.allClearMin).toBe(30);
    expect(s.relay).toEqual({ enabled: false, on: 'alarm' });
    expect(s.channels).toEqual(GUARD_DEFAULTS.channels);
  });

  it('clamps and keeps alarm inside warn', () => {
    const s = normalizeGuardSettings({
      warnKm: '20',
      alarmKm: 80,
      allClearMin: 0,
      minStrikes: 'x',
      relay: { on: 'warn' },
    });
    expect(s.warnKm).toBe(20);
    expect(s.alarmKm).toBe(20);
    expect(s.allClearMin).toBe(1);
    expect(s.minStrikes).toBe(1);
    expect(s.relay.on).toBe('warn');
    expect(exitRadii(S)).toEqual({ warnExitKm: 60, alarmExitKm: 30 });
  });
});

describe('addStrikes', () => {
  it('measures, filters to the warning exit radius, dedupes and sorts', () => {
    const near = strikeAt(10, 90, T0 - MIN);
    const far = strikeAt(100, 90, T0);
    const edge = strikeAt(55, 0, T0 - 2 * MIN); // between 50 and 60 km — kept for hysteresis
    let list = addStrikes([], [near, far, edge, near], DE, S, T0);
    expect(list.map((s) => s.id)).toEqual([edge.id, near.id]);
    expect(list[1].distanceKm).toBeCloseTo(10, 3);
    expect(list[1].bearingDeg).toBeCloseTo(90, 1);
    // Old strikes age out (older than max(all-clear, trigger window))
    list = addStrikes(list, [], DE, S, T0 + 31 * MIN);
    expect(list).toEqual([]);
  });

  it('ignores everything without a valid DE', () => {
    expect(addStrikes([], [strikeAt(5, 0, T0)], { lat: NaN, lon: 0 }, S, T0)).toEqual([]);
  });
});

describe('state machine', () => {
  it('stays clear with no strikes, or strikes outside the warning radius', () => {
    const r = run([{ t: T0 }, { t: T0 + MIN, strikes: [[80, 0]] }]);
    expect(r.map((x) => x.level)).toEqual(['clear', 'clear']);
    expect(r[1].nearest).toBeNull();
  });

  it('warn → alarm → (held) → warn → all-clear on the timer', () => {
    const r = run([
      { t: T0, strikes: [[40, 270]] }, // inside 50 km
      { t: T0 + 5 * MIN, strikes: [[20, 270]] }, // inside 25 km
      { t: T0 + 20 * MIN }, // still within 30 min of the 20 km strike
      { t: T0 + 34 * MIN }, // 29 min after the alarm strike: still alarm
      { t: T0 + 35 * MIN + 1 }, // 30 min since the last alarm-zone strike…
      { t: T0 + 66 * MIN }, // …and 30 min since anything inside 60 km
    ]);
    expect(r.map((x) => x.level)).toEqual(['warn', 'alarm', 'alarm', 'alarm', 'clear', 'clear']);
    expect(r[1].nearest.distanceKm).toBeCloseTo(20, 2);
    expect(r[1].alarmCount).toBe(1);
    expect(r[1].warnCount).toBe(2);
    expect(r[2].clearAt).toBe(T0 + 5 * MIN + 30 * MIN);
  });

  it('alarm drops to warn while warning-zone strikes are still recent', () => {
    const r = run([
      { t: T0, strikes: [[10, 0]] },
      { t: T0 + 25 * MIN, strikes: [[45, 0]] }, // warn-zone strike keeps warn alive
      { t: T0 + 30 * MIN + 1 }, // alarm-zone strike now > 30 min old
      { t: T0 + 55 * MIN + 1 }, // 30 min after the 45 km strike
    ]);
    expect(r.map((x) => x.level)).toEqual(['alarm', 'alarm', 'warn', 'clear']);
    expect(r[2].clearAt).toBe(T0 + 25 * MIN + 30 * MIN);
  });

  it('hysteresis: boundary strikes hold a level but cannot start it', () => {
    const r = run([
      { t: T0, strikes: [[28, 90]] }, // between alarm (25) and alarm exit (30): warn only
      { t: T0 + MIN, strikes: [[24, 90]] }, // inside 25 km: alarm
      { t: T0 + 20 * MIN, strikes: [[28, 90]] }, // 28 km keeps the alarm alive
      { t: T0 + 45 * MIN }, // 25 min after that: still held
      { t: T0 + 50 * MIN + 1 }, // 30 min after the 28 km strike: alarm lapses
    ]);
    expect(r.map((x) => x.level)).toEqual(['warn', 'alarm', 'alarm', 'alarm', 'clear']);

    // From clear, a strike at 55 km (inside the 60 km warn exit, outside 50 km) does nothing
    const c = run([{ t: T0, strikes: [[55, 0]] }]);
    expect(c[0].level).toBe('clear');
    // …but holds an existing warning
    const w = run([{ t: T0, strikes: [[45, 0]] }, { t: T0 + 25 * MIN, strikes: [[55, 0]] }, { t: T0 + 40 * MIN }]);
    expect(w.map((x) => x.level)).toEqual(['warn', 'warn', 'warn']);
  });

  it('a strike moving away cannot hold the alarm past the exit radius', () => {
    const r = run([
      { t: T0, strikes: [[20, 0]] },
      { t: T0 + 20 * MIN, strikes: [[35, 0]] }, // outside alarm exit (30): only warn-relevant
      { t: T0 + 30 * MIN + 1 },
    ]);
    expect(r.map((x) => x.level)).toEqual(['alarm', 'alarm', 'warn']);
  });

  it('minStrikes needs several strikes inside the trigger window', () => {
    const s = normalizeGuardSettings({ enabled: true, minStrikes: 3 });
    const r = run(
      [
        { t: T0, strikes: [[10, 0]] },
        { t: T0 + MIN, strikes: [[12, 0]] },
        { t: T0 + 2 * MIN, strikes: [[40, 0]] },
        { t: T0 + 3 * MIN, strikes: [[15, 0]] },
      ],
      s,
    );
    expect(r.map((x) => x.level)).toEqual(['clear', 'clear', 'warn', 'alarm']);
    // Strikes older than the trigger window do not count toward escalation
    const late = run(
      [
        {
          t: T0,
          strikes: [
            [10, 0],
            [10, 10],
          ],
        },
        { t: T0 + TRIGGER_WINDOW_MS + MIN, strikes: [[10, 20]] },
      ],
      s,
    );
    expect(late.map((x) => x.level)).toEqual(['clear', 'clear']);
  });

  it('a short all-clear time also shortens the escalation window', () => {
    const s = normalizeGuardSettings({ enabled: true, allClearMin: 5 });
    const r = run(
      [
        { t: T0, strikes: [[10, 0]] },
        { t: T0 + 5 * MIN + 1 }, // 5 quiet minutes: all clear, the 10 km strike no longer escalates
      ],
      s,
    );
    expect(r.map((x) => x.level)).toEqual(['alarm', 'clear']);
    expect(r[1].windowMin).toBe(5);
  });

  it('rates are strikes per minute over the trigger window', () => {
    const r = run([
      {
        t: T0,
        strikes: [
          [10, 0],
          [11, 0],
          [40, 0],
          [45, 0],
          [70, 0],
        ],
      },
    ]);
    expect(r[0].alarmCount).toBe(2);
    expect(r[0].warnCount).toBe(4);
    expect(r[0].warnRate).toBeCloseTo(0.4, 5);
    expect(r[0].last).toBeTruthy();
  });

  it('transitionKind', () => {
    expect(transitionKind('clear', 'warn')).toBe('escalate');
    expect(transitionKind('warn', 'alarm')).toBe('escalate');
    expect(transitionKind('alarm', 'clear')).toBe('deescalate');
    expect(transitionKind('off', 'clear')).toBe('escalate');
    expect(transitionKind('warn', 'warn')).toBeNull();
  });
});

describe('relay', () => {
  const on = normalizeGuardSettings({ enabled: true, relay: { enabled: true } });
  it('not reported unless the guard and relay are enabled', () => {
    expect(relayDemand({ settings: S, level: 'alarm' })).toBeNull();
    expect(relayDemand({ settings: { ...on, enabled: false }, level: 'alarm' })).toBeNull();
  });
  it('engages at alarm (or warn when configured), auto-clears with the level', () => {
    expect(relayDemand({ settings: on, level: 'alarm' })).toBe(true);
    expect(relayDemand({ settings: on, level: 'warn' })).toBe(false);
    expect(relayDemand({ settings: on, level: 'clear' })).toBe(false);
    const atWarn = { ...on, relay: { enabled: true, on: 'warn' } };
    expect(relayDemand({ settings: atWarn, level: 'warn' })).toBe(true);
  });
  it('manual override forces on/off; forced-off lapses at all-clear', () => {
    expect(relayDemand({ settings: on, level: 'clear', override: 'on' })).toBe(true);
    expect(relayDemand({ settings: on, level: 'alarm', override: 'off' })).toBe(false);
    expect(nextOverride('off', 'alarm')).toBe('off');
    expect(nextOverride('off', 'clear')).toBe('auto');
    expect(nextOverride('on', 'clear')).toBe('on');
  });
});

describe('presentation', () => {
  it('formats distances in the station units', () => {
    expect(formatDistance(12.345)).toEqual({ value: '12', unit: 'km' });
    expect(formatDistance(4.26)).toEqual({ value: '4.3', unit: 'km' });
    expect(formatDistance(25, true)).toEqual({ value: '16', unit: 'mi' });
    expect(describeStrike({ distanceKm: 18, bearingDeg: 50 })).toBe('18 km NE');
    expect(describeStrike(null)).toBe('');
  });
});

describe('repeat alerts while in alarm', () => {
  it('shouldRealert: halving the distance or crossing 10 km, throttled', () => {
    const base = { lastAt: T0, now: T0 + REALERT_MIN_GAP_MS };
    expect(shouldRealert({ ...base, lastKm: 20, nearestKm: 10 })).toBe(true); // halved
    expect(shouldRealert({ ...base, lastKm: 20, nearestKm: 11 })).toBe(false);
    expect(shouldRealert({ ...base, lastKm: 14, nearestKm: 9.9 })).toBe(true); // crossed 10 km
    expect(shouldRealert({ ...base, lastKm: 8, nearestKm: 6 })).toBe(false); // already inside 10 km, not halved
    expect(shouldRealert({ ...base, lastKm: 8, nearestKm: 4 })).toBe(true);
    expect(shouldRealert({ lastKm: 20, nearestKm: 5, lastAt: T0, now: T0 + 60000 })).toBe(false); // too soon
    expect(shouldRealert({ ...base, lastKm: null, nearestKm: 5 })).toBe(false);
  });

  it('GuardRunner reports transitions and closer re-alerts (and can be switched off)', () => {
    const r = new GuardRunner({ enabled: true });
    expect(r.step([strikeAt(20, 0, T0)], DE, T0)).toMatchObject({ transition: 'escalate', closer: false });
    expect(r.level).toBe('alarm');
    // 15 km a minute later: not halved, not inside 10 km
    expect(r.step([strikeAt(15, 0, T0 + MIN)], DE, T0 + MIN).closer).toBe(false);
    // 8 km but only 90 s after the alarm: throttled
    expect(r.step([strikeAt(8, 0, T0 + 1.5 * MIN)], DE, T0 + 1.5 * MIN).closer).toBe(false);
    // next evaluation past the gap: nearest is still 8 km → closer
    const c = r.step([], DE, T0 + 2 * MIN);
    expect(c.closer).toBe(true);
    expect(c.status.nearest.distanceKm).toBeCloseTo(8, 1);
    expect(r.step([], DE, T0 + 5 * MIN).closer).toBe(false); // remembered 8 km
    expect(r.step([strikeAt(3, 0, T0 + 6 * MIN)], DE, T0 + 6 * MIN).closer).toBe(true);

    const off = new GuardRunner({ enabled: true, repeatCloser: false });
    off.step([strikeAt(20, 0, T0)], DE, T0);
    expect(off.step([strikeAt(3, 0, T0 + 5 * MIN)], DE, T0 + 5 * MIN).closer).toBe(false);
  });
});
