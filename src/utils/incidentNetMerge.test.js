import { describe, expect, it } from 'vitest';
import {
  reconcileNet,
  mergeNets,
  netTag,
  sameNetContent,
  orderStations,
  conflictRecord,
  mergeConflictRecords,
  removeConflictEntry,
  applyMineStation,
  applyMineField,
  theirsWins,
  mergeHistory,
} from './incidentNetMerge.js';

const st = (call, extra = {}) => ({ call, flags: [], checkinTime: 1, checkoutTime: null, ...extra });
const base = {
  id: 'n1',
  name: 'ARES',
  frequency: '146.52',
  stations: [st('W1AW'), st('K1ABC')],
  rev: 10,
  updatedAt: 100,
};
const history = new Map([['10:100', base]]);
const doc = (net, parentTag, rev = 11, updatedAt = 200) => ({
  kind: 'net-control',
  net,
  rev,
  updatedAt,
  tag: `${rev}:${updatedAt}`,
  parentTag,
});

describe('reconcileNet (shared net across sites)', () => {
  it('two sites checking in different stations both survive', () => {
    const mine = { ...base, stations: [st('KD0ABC'), ...base.stations], rev: 11, updatedAt: 150 };
    const theirs = { ...base, stations: [st('N0XYZ'), ...base.stations] };
    const r = reconcileNet({ head: '11:150', history, local: mine, remote: doc(theirs, '10:100') });
    expect(r.action).toBe('merge');
    expect(r.net.stations.map((s) => s.call).sort()).toEqual(['K1ABC', 'KD0ABC', 'N0XYZ', 'W1AW']);
  });

  it('a flag on one line here and a check-out on another there both survive', () => {
    const mine = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], rev: 11, updatedAt: 150 };
    const theirs = { ...base, stations: [st('W1AW'), st('K1ABC', { checkoutTime: 5 })] };
    const r = reconcileNet({ head: '11:150', history, local: mine, remote: doc(theirs, '10:100') });
    expect(r.action).toBe('merge');
    expect(r.net.stations.find((s) => s.call === 'W1AW').flags).toEqual(['T']);
    expect(r.net.stations.find((s) => s.call === 'K1ABC').checkoutTime).toBe(5);
  });

  it('a removal here survives an unrelated change there', () => {
    const mine = { ...base, stations: [st('W1AW')], rev: 11, updatedAt: 150 };
    const theirs = { ...base, frequency: '147.00' };
    const r = reconcileNet({ head: '11:150', history, local: mine, remote: doc(theirs, '10:100') });
    expect(r.action).toBe('merge');
    expect(r.net.stations.map((s) => s.call)).toEqual(['W1AW']);
    expect(r.net.frequency).toBe('147.00');
  });

  it('the same station changed at both sites is a conflict naming the call; theirs is taken', () => {
    const mine = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], rev: 11, updatedAt: 150 };
    const theirs = { ...base, stations: [st('W1AW', { flags: ['M'] }), st('K1ABC')] };
    const r = reconcileNet({ head: '11:150', history, local: mine, remote: doc(theirs, '10:100') });
    expect(r).toMatchObject({ action: 'conflict', calls: ['W1AW'], net: theirs });
  });

  it('in a conflict both sites keep the later change: the earlier site takes it, the later keeps its own', () => {
    const early = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], rev: 11, updatedAt: 150 };
    const late = { ...base, stations: [st('W1AW', { flags: ['M'] }), st('K1ABC')], rev: 11, updatedAt: 180 };
    // at the early site, the late state arrives: take it (and show "your change")
    expect(
      reconcileNet({ head: netTag(early), history, local: early, remote: doc(late, '10:100', 11, 180) }),
    ).toMatchObject({ action: 'conflict', calls: ['W1AW'] });
    // at the late site, the early state arrives: keep ours (and republish it on top)
    expect(
      reconcileNet({ head: netTag(late), history, local: late, remote: doc(early, '10:100', 11, 150) }),
    ).toMatchObject({
      action: 'keep',
      calls: ['W1AW'],
    });
  });

  it('the same field set differently at both sites is a conflict; the same value is not', () => {
    const mine = { ...base, frequency: '147.00', rev: 11, updatedAt: 150 };
    expect(
      reconcileNet({ head: '11:150', history, local: mine, remote: doc({ ...base, frequency: '145.00' }, '10:100') }),
    ).toMatchObject({ action: 'conflict', fields: ['frequency'] });
    const sameLine = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], frequency: '147.00' };
    const mine2 = { ...sameLine, rev: 11, updatedAt: 150 };
    expect(
      reconcileNet({ head: '11:150', history, local: mine2, remote: doc({ ...sameLine, name: 'ARES 2' }, '10:100') })
        .action,
    ).toBe('merge');
  });

  it('a state made from ours that overrode our change in a conflict is our loss, not a plain update', () => {
    const ours = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], rev: 11, updatedAt: 150 };
    const theirs = { ...base, stations: [st('W1AW', { flags: ['M'] }), st('K1ABC')] };
    const remote = { ...doc(theirs, '11:150', 11, 180), overrode: { tag: '11:150', calls: ['W1AW'], fields: [] } };
    expect(reconcileNet({ head: '11:150', history, local: ours, remote })).toMatchObject({
      action: 'conflict',
      calls: ['W1AW'],
      net: theirs,
    });
  });

  it('fast-forwards when theirs was made from what we have', () => {
    const theirs = { ...base, stations: [st('N0XYZ'), ...base.stations] };
    expect(reconcileNet({ head: '10:100', history, local: base, remote: doc(theirs, '10:100') })).toMatchObject({
      action: 'adopt',
      net: theirs,
    });
  });

  it('ignores its own state, notes an equal one, falls back without an ancestor', () => {
    expect(reconcileNet({ head: '11:200', history, local: base, remote: doc(base, '10:100') }).action).toBe('ignore');
    const same = { ...base, rev: 12, updatedAt: 999 };
    expect(reconcileNet({ head: '11:150', history, local: base, remote: doc(same, '10:100', 12, 300) }).action).toBe(
      'same',
    );
    const other = { ...base, stations: [] };
    expect(reconcileNet({ head: 'x', history, local: base, remote: doc(other, 'unknown') }).action).toBe('legacy');
    expect(reconcileNet({ head: 'x', history, local: null, remote: doc(other, '10:100') }).action).toBe('legacy');
    expect(
      reconcileNet({ head: 'x', history, local: base, remote: doc({ ...other, id: 'n2' }, '10:100') }).action,
    ).toBe('legacy');
  });

  it('converges at once: both sites hold the same stations in the same order', () => {
    const a = { ...base, stations: [st('KD0ABC', { checkinTime: 5 }), ...base.stations], rev: 11, updatedAt: 150 };
    const b = { ...base, stations: [st('N0XYZ', { checkinTime: 5 }), ...base.stations], rev: 11, updatedAt: 160 };
    const atA = reconcileNet({ head: netTag(a), history, local: a, remote: doc(b, '10:100', 11, 160) }).net;
    const atB = reconcileNet({ head: netTag(b), history, local: b, remote: doc(a, '10:100', 11, 150) }).net;
    expect(atA.stations.map((s) => s.call)).toEqual(atB.stations.map((s) => s.call));
    expect(atA.stations.map((s) => s.call)).toEqual(['KD0ABC', 'N0XYZ', 'K1ABC', 'W1AW']); // newest first, then call
    expect(sameNetContent(atA, atB)).toBe(true);
  });

  it('keeps our losing version for "apply mine", per net', () => {
    const mine = { ...base, frequency: '147.00', stations: [st('W1AW', { flags: ['T'] })] };
    const rec = conflictRecord(mine, { calls: ['W1AW', 'K1ABC'], fields: ['frequency'] }, 'South', 9);
    expect(rec).toEqual({
      netId: 'n1',
      calls: {
        W1AW: { mine: st('W1AW', { flags: ['T'] }), site: 'South', at: 9 },
        K1ABC: { mine: null, site: 'South', at: 9 },
      },
      fields: { frequency: { mine: '147.00', site: 'South', at: 9 } },
    });
    const later = conflictRecord(mine, { calls: ['N0XYZ'] }, 'East', 10);
    expect(Object.keys(mergeConflictRecords(rec, later).calls)).toEqual(['W1AW', 'K1ABC', 'N0XYZ']);
    expect(mergeConflictRecords(rec, { ...later, netId: 'other' }).netId).toBe('other');
    let left = removeConflictEntry(rec, 'call', 'W1AW');
    left = removeConflictEntry(left, 'call', 'K1ABC');
    expect(removeConflictEntry(left, 'field', 'frequency')).toBeNull();
  });

  it('apply mine puts our station line or field back (or removes the station)', () => {
    const theirs = { ...base, stations: [st('W1AW', { flags: ['M'] }), st('K1ABC')] };
    const fixed = applyMineStation(theirs, 'W1AW', st('W1AW', { flags: ['T'] }));
    expect(fixed.stations.map((s) => [s.call, s.flags])).toEqual([
      ['W1AW', ['T']],
      ['K1ABC', []],
    ]);
    expect(applyMineStation(theirs, 'K1ABC', null).stations.map((s) => s.call)).toEqual(['W1AW']);
    expect(applyMineStation(theirs, 'N0NEW', st('N0NEW')).stations[0].call).toBe('N0NEW');
    expect(applyMineField(theirs, 'frequency', '147.00').frequency).toBe('147.00');
  });

  it('orderStations: newest check-in first, ties by callsign', () => {
    const out = orderStations([
      st('W1AW', { checkinTime: 1 }),
      st('K1ABC', { checkinTime: 3 }),
      st('AA1A', { checkinTime: 3 }),
    ]);
    expect(out.map((s) => s.call)).toEqual(['AA1A', 'K1ABC', 'W1AW']);
  });

  it('mergeNets keeps theirs where mine did not change anything (in merged order)', () => {
    const theirs = { ...base, name: 'X' };
    expect(sameNetContent(mergeNets(base, base, theirs), { ...theirs, stations: orderStations(theirs.stations) })).toBe(
      true,
    );
  });

  it('server receipt order decides, not clocks; commit time only without a server sequence', () => {
    const local = { updatedAt: 10 * 60e3 + 1000 }; // this site's clock is 10 minutes fast
    const remote = { updatedAt: 2000, tag: '5:2000' };
    expect(theirsWins(local, remote)).toBe(false); // clock rule: ours "later"
    expect(theirsWins(local, remote, { local: 4, remote: 5 })).toBe(true); // server got theirs later
    expect(theirsWins(local, remote, { local: 6, remote: 5 })).toBe(false);
    expect(theirsWins(local, remote, { local: undefined, remote: 5 })).toBe(false); // ours not there yet: ours is later
    const ours = { ...base, stations: [st('W1AW', { flags: ['T'] }), st('K1ABC')], rev: 11, updatedAt: 9e12 };
    const theirs = { ...base, stations: [st('W1AW', { flags: ['M'] }), st('K1ABC')] };
    const r = reconcileNet({
      head: '11:9000000000000',
      history,
      local: ours,
      remote: doc(theirs, '10:100'),
      order: { local: 4, remote: 5 },
    });
    expect(r.action).toBe('conflict');
  });

  it('mergeHistory: both sites’ closed nets survive; a delete on our side stays deleted', () => {
    const n = (id, endTime) => ({ id, name: id, stations: [], endTime });
    const base = [n('a', 1), n('b', 2)];
    const mine = [n('mine', 5), n('a', 1)]; // closed "mine", deleted "b"
    const theirs = [n('theirs', 4), n('b', 2), n('a', 1)]; // closed "theirs"
    expect(mergeHistory(base, mine, theirs).map((x) => x.id)).toEqual(['mine', 'theirs', 'a']);
    expect(mergeHistory([], [n('x', 1)], [n('x', 1)]).map((x) => x.id)).toEqual(['x']); // no duplicates
    expect(
      mergeHistory(
        [],
        Array.from({ length: 60 }, (_, i) => n(`m${i}`, i)),
        [],
      ).length,
    ).toBe(50);
  });
});
