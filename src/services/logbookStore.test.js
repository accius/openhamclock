/**
 * logbookStore tests — exercise the in-memory adapter (jsdom has no
 * indexedDB, so the store's auto-fallback picks it, which is exactly the
 * behavior we want to pin down for indexedDB-less environments).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetLogbookForTests,
  add,
  addMany,
  clear,
  consumePendingPrefill,
  count,
  dedupKey,
  getAll,
  hasMountedPanel,
  init,
  registerPanelMount,
  remove,
  requestLogQso,
  setTunedSpot,
  subscribe,
  subscribePrefill,
  tunedSpotForRig,
  tunedSpotPrefill,
  unregisterPanelMount,
  update,
} from './logbookStore.js';

const sampleQso = (over = {}) => ({
  call: 'OZ1ABC',
  qso_date: '20260815',
  time_on: '142530',
  band: '20m',
  mode: 'SSB',
  freq: 14.25,
  rst_sent: '59',
  rst_rcvd: '57',
  extras: {},
  ...over,
});

beforeEach(() => {
  __resetLogbookForTests();
});

describe('init / adapter fallback', () => {
  it('initializes with an empty log when no indexedDB exists', async () => {
    await init();
    expect(getAll()).toEqual([]);
    expect(count()).toBe(0);
  });

  it('is idempotent', async () => {
    await Promise.all([init(), init()]);
    await add(sampleQso());
    await init();
    expect(count()).toBe(1);
  });
});

describe('CRUD', () => {
  it('add assigns an id and stores the record', async () => {
    const rec = await add(sampleQso());
    expect(rec.id).toBeTruthy();
    expect(getAll()).toHaveLength(1);
    expect(getAll()[0].call).toBe('OZ1ABC');
  });

  it('update merges fields and keeps the id', async () => {
    const rec = await add(sampleQso());
    const updated = await update(rec.id, { rst_rcvd: '55', name: 'Lars' });
    expect(updated.id).toBe(rec.id);
    expect(updated.rst_rcvd).toBe('55');
    expect(updated.call).toBe('OZ1ABC');
    expect(getAll()).toHaveLength(1);
  });

  it('update returns null for an unknown id', async () => {
    expect(await update('nope', { name: 'x' })).toBe(null);
  });

  it('remove deletes by id and reports whether it removed anything', async () => {
    const rec = await add(sampleQso());
    expect(await remove(rec.id)).toBe(true);
    expect(await remove(rec.id)).toBe(false);
    expect(count()).toBe(0);
  });

  it('clear wipes the log', async () => {
    await add(sampleQso());
    await add(sampleQso({ call: 'W1AW' }));
    await clear();
    expect(getAll()).toEqual([]);
  });
});

describe('dedupKey', () => {
  it('matches on call + date + minute + band, ignoring seconds and case', () => {
    const a = dedupKey(sampleQso({ time_on: '142530' }));
    const b = dedupKey(sampleQso({ time_on: '142559', call: 'oz1abc', band: '20M' }));
    expect(a).toBe(b);
  });

  it('differs across band, date, minute, and call', () => {
    const base = dedupKey(sampleQso());
    expect(dedupKey(sampleQso({ band: '40m' }))).not.toBe(base);
    expect(dedupKey(sampleQso({ qso_date: '20260816' }))).not.toBe(base);
    expect(dedupKey(sampleQso({ time_on: '142630' }))).not.toBe(base);
    expect(dedupKey(sampleQso({ call: 'W1AW' }))).not.toBe(base);
  });
});

describe('addMany (import)', () => {
  it('imports fresh records and skips dupes of existing QSOs', async () => {
    await add(sampleQso());
    const result = await addMany([
      sampleQso({ time_on: '142545' }), // same minute — dupe
      sampleQso({ call: 'W1AW' }), // fresh
    ]);
    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(count()).toBe(2);
  });

  it('dedups within the same batch and skips call-less records', async () => {
    const result = await addMany([
      sampleQso(),
      sampleQso({ time_on: '142501' }), // same minute as previous batch row
      { qso_date: '20260815' }, // no call
      null,
    ]);
    expect(result).toEqual({ imported: 1, skipped: 3 });
    expect(count()).toBe(1);
  });

  it('handles a non-array gracefully', async () => {
    expect(await addMany(null)).toEqual({ imported: 0, skipped: 0 });
  });
});

describe('subscribers', () => {
  it('notifies on every mutation with a fresh array identity', async () => {
    await init();
    const seen = [];
    const unsub = subscribe((qsos) => seen.push(qsos));
    const before = seen.length;
    const rec = await add(sampleQso());
    await update(rec.id, { name: 'Lars' });
    await remove(rec.id);
    expect(seen.length).toBe(before + 3);
    expect(seen[seen.length - 1]).toEqual([]);
    expect(seen[seen.length - 2]).not.toBe(seen[seen.length - 1]);
    unsub();
    await add(sampleQso());
    expect(seen.length).toBe(before + 3); // no more notifications after unsubscribe
  });

  it('delivers the current log to late subscribers', async () => {
    await add(sampleQso());
    const cb = vi.fn();
    subscribe(cb);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('log-from-spot prefill hand-off', () => {
  it('stores a pending prefill until consumed (panel not mounted yet)', () => {
    requestLogQso({ call: 'ZL1XYZ', freq: 21.2, mode: 'SSB' });
    const p = consumePendingPrefill();
    expect(p.call).toBe('ZL1XYZ');
    expect(p.freq).toBe(21.2);
    expect(consumePendingPrefill()).toBe(null); // consumed
  });

  it('notifies live prefill subscribers', () => {
    const cb = vi.fn();
    const unsub = subscribePrefill(cb);
    requestLogQso({ call: 'JA1XYZ', freq: 7.03, mode: 'CW' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].call).toBe('JA1XYZ');
    unsub();
    requestLogQso({ call: 'W1AW' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores prefills without a call', () => {
    requestLogQso(null);
    requestLogQso({ freq: 14.2 });
    expect(consumePendingPrefill()).toBe(null);
  });
});

describe('tuned-spot prefill for +QSO', () => {
  it('offers the call while the rig is within 3 kHz of the spot', () => {
    setTunedSpot({ call: 'zl1xyz', freqHz: 14025000, gridsquare: 'RF73' });
    expect(tunedSpotPrefill(14025000)).toEqual({ call: 'ZL1XYZ', gridsquare: 'RF73' });
    expect(tunedSpotPrefill(14025600)).toEqual({ call: 'ZL1XYZ', gridsquare: 'RF73' });
    expect(tunedSpotPrefill(14022000)).toEqual({ call: 'ZL1XYZ', gridsquare: 'RF73' });
  });

  it('offers nothing once the dial has moved away', () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000 });
    expect(tunedSpotPrefill(14030000)).toBe(null);
    expect(tunedSpotPrefill(7025000)).toBe(null);
  });

  it('offers nothing without a rig reading or without a tuned spot', () => {
    expect(tunedSpotPrefill(14025000)).toBe(null);
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000 });
    expect(tunedSpotPrefill(null)).toBe(null);
    expect(tunedSpotPrefill(0)).toBe(null);
  });

  it('leaves gridsquare out when the spot had none', () => {
    setTunedSpot({ call: 'W1AW', freqHz: 7030000 });
    expect(tunedSpotPrefill(7030000)).toEqual({ call: 'W1AW' });
  });

  it('ignores spots without a call or frequency', () => {
    setTunedSpot({ call: '', freqHz: 14025000 });
    setTunedSpot({ call: 'W1AW', freqHz: 0 });
    setTunedSpot(null);
    expect(tunedSpotPrefill(14025000)).toBe(null);
  });

  it('forgets the call once a QSO with it is saved (any letter case)', async () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000 });
    await add(sampleQso({ call: 'zl1xyz' }));
    expect(tunedSpotPrefill(14025000)).toBe(null);
  });

  it('tells the Rig button whether the rig is still near the spot', () => {
    expect(tunedSpotForRig(14025000)).toBe(null); // nothing remembered
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000, gridsquare: 'RF73' });
    expect(tunedSpotForRig(14026000)).toEqual({ call: 'ZL1XYZ', gridsquare: 'RF73', near: true });
    expect(tunedSpotForRig(14040000)).toEqual({ call: 'ZL1XYZ', gridsquare: 'RF73', near: false });
    expect(tunedSpotForRig(null)).toBe(null); // no rig reading
  });

  it('keeps the call when a QSO with another station is saved', async () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000 });
    await add(sampleQso({ call: 'OZ1ABC' }));
    expect(tunedSpotPrefill(14025000)).toEqual({ call: 'ZL1XYZ' });
  });
});

describe('logbook panel mount tracking', () => {
  it('reports no mounted panel initially', () => {
    expect(hasMountedPanel()).toBe(false);
  });

  it('refcounts multiple mounted panels', () => {
    registerPanelMount();
    registerPanelMount();
    expect(hasMountedPanel()).toBe(true);
    unregisterPanelMount();
    expect(hasMountedPanel()).toBe(true); // one panel still mounted
    unregisterPanelMount();
    expect(hasMountedPanel()).toBe(false);
  });

  it('never goes negative on unbalanced unregisters', () => {
    unregisterPanelMount();
    unregisterPanelMount();
    expect(hasMountedPanel()).toBe(false);
    registerPanelMount();
    expect(hasMountedPanel()).toBe(true);
  });
});
