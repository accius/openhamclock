import { describe, expect, it } from 'vitest';
import {
  emptyIncidentState,
  applyIncidentDelta,
  incidentEventList,
  incidentRosterList,
  mergeDisplayedRoster,
  diffRosterForPush,
  fieldReportForPush,
  shelterReportForPush,
  mergeFieldReports,
  mergeShelterReports,
  eventForPush,
  emptyOutbox,
  queueOutbox,
  outboxBatch,
  outboxSize,
  ackOutbox,
  dropOutboxDocs,
  messageHistoryFromEvents,
  mergeMessageHistory,
  annotateSharedEvents,
  sharedMsgLabel,
  buildJoinUrl,
  parseJoinUrl,
  formatCode,
  normaliseCode,
  stateForCache,
  MAX_CACHED_EVENTS,
} from './incidentSync.js';

const NOW = 1_700_000_000_000;

describe('applyIncidentDelta', () => {
  it('merges events by id so a replayed snapshot adds nothing', () => {
    const delta = {
      seq: 3,
      events: [
        { id: 'a', ts: 2, type: 'nws_alert', seq: 2 },
        { id: 'b', ts: 1, type: 'nws_alert', seq: 3 },
      ],
    };
    const s1 = applyIncidentDelta(emptyIncidentState(), delta);
    const s2 = applyIncidentDelta(s1, delta); // reconnect replays the same records
    expect(Object.keys(s2.events)).toHaveLength(2);
    expect(s2.events).toBe(s1.events); // no change → same identity
    expect(incidentEventList(s2).map((e) => e.id)).toEqual(['b', 'a']);
    expect(s2.seq).toBe(3);
  });

  it('keeps the newer roster entry and never moves seq backwards', () => {
    let s = applyIncidentDelta(emptyIncidentState(), {
      seq: 5,
      roster: [{ call: 'W1AW', status: 'new', updatedAt: 200 }],
    });
    s = applyIncidentDelta(s, { seq: 2, roster: [{ call: 'W1AW', status: 'old', updatedAt: 100 }] });
    expect(s.roster.W1AW.status).toBe('new');
    expect(s.seq).toBe(5);
    s = applyIncidentDelta(s, { seq: 6, roster: [{ call: 'W1AW', status: 'out', checkedOut: true, updatedAt: 300 }] });
    expect(s.roster.W1AW.checkedOut).toBe(true);
  });

  it('takes the board, participants and reports', () => {
    const s = applyIncidentDelta(emptyIncidentState(), {
      seq: 4,
      participants: 3,
      board: { name: 'Flood', seq: 4 },
      reports: [{ id: 'field-1', kind: 'field', timestamp: 1 }],
    });
    expect(s.board.name).toBe('Flood');
    expect(s.participants).toBe(3);
    expect(s.reports['field-1']).toBeTruthy();
    const older = applyIncidentDelta(s, { board: { name: 'Old', seq: 1 } });
    expect(older.board.name).toBe('Flood');
  });

  it('ignores junk', () => {
    const s = emptyIncidentState();
    expect(applyIncidentDelta(s, null)).toBe(s);
    expect(applyIncidentDelta(s, { events: [null, {}], roster: [{}] }).events).toEqual({});
  });

  it('trims the cached copy to the latest events', () => {
    const events = Array.from({ length: MAX_CACHED_EVENTS + 10 }, (_, i) => ({ id: `e${i}`, ts: i }));
    const s = applyIncidentDelta(emptyIncidentState(), { events });
    const cached = stateForCache(s);
    expect(Object.keys(cached.events)).toHaveLength(MAX_CACHED_EVENTS);
    expect(cached.events.e0).toBeUndefined();
    expect(cached.events[`e${MAX_CACHED_EVENTS + 9}`]).toBeTruthy();
  });
});

describe('edits, deletions, full snapshots and documents', () => {
  const seeded = () =>
    applyIncidentDelta(emptyIncidentState(), {
      seq: 5,
      events: [
        { id: 'a', ts: 1, type: 'incident_note', summary: 'typo' },
        { id: 'b', ts: 2, type: 'incident_note', summary: 'keep' },
      ],
      reports: [{ id: 'f1', kind: 'field', timestamp: 1, text: 'x' }],
    });

  it('an admin edit (higher rev) replaces the record; an equal rev replay does not', () => {
    const s = applyIncidentDelta(seeded(), {
      events: [{ id: 'a', ts: 1, type: 'incident_note', summary: 'fixed', rev: 1 }],
    });
    expect(s.events.a.summary).toBe('fixed');
    const replay = applyIncidentDelta(s, { events: [{ id: 'a', ts: 1, type: 'incident_note', summary: 'typo' }] });
    expect(replay.events.a.summary).toBe('fixed');
  });

  it('tombstones remove events and reports', () => {
    const s = applyIncidentDelta(seeded(), {
      seq: 7,
      deleted: [
        { kind: 'event', id: 'a', seq: 6 },
        { kind: 'report', id: 'f1', seq: 7 },
        { kind: 'event', id: 'missing', seq: 7 },
      ],
    });
    expect(Object.keys(s.events)).toEqual(['b']);
    expect(s.reports).toEqual({});
  });

  it('a full snapshot replaces everything, dropping records deleted while away', () => {
    const s = applyIncidentDelta(
      { ...seeded(), seq: 50, participants: 3, role: 'admin' },
      { full: true, seq: 9, events: [{ id: 'b', ts: 2, type: 'incident_note', summary: 'keep' }] },
    );
    expect(Object.keys(s.events)).toEqual(['b']);
    expect(s.reports).toEqual({});
    expect(s.seq).toBe(9);
    expect(s.role).toBe('admin');
    expect(s.participants).toBe(3);
  });

  it('orders shared documents by the server’s docRev, not client clocks, and takes the role', () => {
    let s = applyIncidentDelta(emptyIncidentState(), {
      role: 'operator',
      docs: [{ id: 'net-running', data: { name: 'B' }, docRev: 2, updatedAt: 1 }],
    });
    // an older server copy with a fast client clock does not win
    s = applyIncidentDelta(s, { docs: [{ id: 'net-running', data: { name: 'A' }, docRev: 1, updatedAt: 9e12 }] });
    expect(s.docs['net-running'].data.name).toBe('B');
    // a newer server copy wins although its client clock is behind
    s = applyIncidentDelta(s, { docs: [{ id: 'net-running', data: { name: 'C' }, docRev: 3, updatedAt: 0 }] });
    expect(s.docs['net-running'].data.name).toBe('C');
    // our optimistic copy (no docRev) gives way to the server's
    s = applyIncidentDelta(s, { docs: [{ id: 'net-running', data: { name: 'mine' }, updatedAt: 5 }] });
    expect(s.docs['net-running'].data.name).toBe('C');
    expect(s.role).toBe('operator');
  });
});

describe('message history from the shared log', () => {
  const events = [
    {
      id: '1',
      type: 'aprs_msg_rx',
      callsign: 'W1AW-9',
      summary: 'Message to K0CJH',
      details: 'hello',
      ts: 1000,
      site: 'EOC',
    },
    { id: '2', type: 'aprs_msg_sent', callsign: 'K1ABC', summary: 'Message to W1AW', details: 'reply', ts: 2000 },
    { id: '3', type: 'aprs_msg_rx', callsign: 'N0X', summary: 'Message to K0CJH', details: 'other', ts: 3000 },
    { id: '4', type: 'nws_alert', summary: 'x', ts: 4000 },
  ];

  it('collects both directions for a station, matching on the base call', () => {
    const out = messageHistoryFromEvents(events, 'W1AW');
    expect(out.map((m) => [m.direction, m.text])).toEqual([
      ['received', 'hello'],
      ['sent', 'reply'],
    ]);
    expect(out[0]).toMatchObject({ from: 'W1AW-9', to: 'K0CJH', source: 'incident', site: 'EOC' });
    expect(messageHistoryFromEvents(events, '')).toEqual([]);
  });

  it('merges lists without duplicates, newest first', () => {
    const server = [{ direction: 'received', text: 'hello', timestamp: 1000, source: 'server' }];
    const merged = mergeMessageHistory(server, messageHistoryFromEvents(events, 'W1AW'));
    expect(merged.map((m) => m.text)).toEqual(['reply', 'hello']);
    expect(merged[1].source).toBe('server');
  });
});

describe('roster display', () => {
  const state = applyIncidentDelta(emptyIncidentState(), {
    roster: [
      { call: 'K1ABC', status: 'At shelter', lastHeard: NOW - 20 * 60000, source: 'manual', updatedAt: 1 },
      { call: 'N0OUT', checkedOut: true, updatedAt: NOW },
      { call: 'W1AW', status: 'Remote status', lastHeard: NOW - 60000, source: 'aprs', updatedAt: 1, site: 'EOC' },
    ],
  });

  it('lists only active incident operators, manual check-ins never stale', () => {
    const list = incidentRosterList(state, NOW);
    expect(list.map((e) => e.call)).toEqual(['W1AW', 'K1ABC']);
    expect(list.find((e) => e.call === 'K1ABC')).toMatchObject({ age: 20, stale: false });
  });

  it('merges local and incident rosters without duplicates; incident check-out hides a stale local entry', () => {
    const local = [
      { call: 'W1AW', status: 'Checked in', checkinTime: NOW - 3600000, lat: 42, lon: -71, age: 0 },
      { call: 'N0OUT', checkinTime: NOW - 3600000, age: 5 },
      { call: 'KD0NEW', checkinTime: NOW, age: 0 },
    ];
    const merged = mergeDisplayedRoster(local, state, NOW);
    expect(merged.map((e) => e.call).sort()).toEqual(['K1ABC', 'KD0NEW', 'W1AW']);
    const w = merged.find((e) => e.call === 'W1AW');
    expect(w).toMatchObject({ status: 'Remote status', lat: 42, site: 'EOC' });
  });

  it('a local re-check-in after an incident check-out is shown', () => {
    const local = [{ call: 'N0OUT', checkinTime: NOW + 1000, age: 0 }];
    expect(mergeDisplayedRoster(local, state, NOW).map((e) => e.call)).toContain('N0OUT');
  });
});

describe('diffRosterForPush', () => {
  const op = { call: 'w1aw', netName: 'ARES', status: 'Checked in', checkinTime: NOW - 1000, lastHeard: NOW };

  it('first pass sends every entry with updatedAt = check-in time', () => {
    const { push, next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    expect(push).toHaveLength(1);
    expect(push[0]).toMatchObject({ call: 'W1AW', updatedAt: NOW - 1000, checkedOut: false });
    expect(next.entries.has('W1AW')).toBe(true);
  });

  it('sends nothing when nothing changed (lastHeard alone is not a change)', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    const { push } = diffRosterForPush(next, [{ ...op, lastHeard: NOW + 5000 }], emptyIncidentState(), NOW);
    expect(push).toEqual([]);
  });

  it('sends a status change stamped now', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    const { push } = diffRosterForPush(next, [{ ...op, status: 'Mobile' }], emptyIncidentState(), NOW + 10);
    expect(push[0]).toMatchObject({ status: 'Mobile', updatedAt: NOW + 10 });
  });

  it('does not resurrect an operator checked out elsewhere because of local beacon changes', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    const inc = applyIncidentDelta(emptyIncidentState(), {
      roster: [{ call: 'W1AW', checkedOut: true, updatedAt: NOW }],
    });
    const { push } = diffRosterForPush(next, [{ ...op, lat: 1, lon: 2 }], inc, NOW + 10);
    expect(push).toEqual([]);
  });

  it('sends a check-out when an operator leaves the local roster, once', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    const out = diffRosterForPush(next, [], emptyIncidentState(), NOW + 10);
    expect(out.push).toEqual([expect.objectContaining({ call: 'W1AW', checkedOut: true, updatedAt: NOW + 10 })]);
    const inc = applyIncidentDelta(emptyIncidentState(), {
      roster: [{ call: 'W1AW', checkedOut: true, updatedAt: 1 }],
    });
    expect(diffRosterForPush(next, [], inc, NOW).push).toEqual([]);
  });

  it('without a boot id, treats a roster that empties all at once as a server reset', () => {
    const two = [op, { ...op, call: 'K1ABC' }];
    const { next } = diffRosterForPush(null, two, emptyIncidentState(), NOW);
    expect(diffRosterForPush(next, [], emptyIncidentState(), NOW + 10).push).toEqual([]);
  });

  it('with a boot id, a restart is ignored but a real mass check-out on the same boot is sent', () => {
    const two = [op, { ...op, call: 'K1ABC' }];
    const { next } = diffRosterForPush(null, two, emptyIncidentState(), NOW, 'boot-a');
    expect(next.bootId).toBe('boot-a');
    // restart: new boot id, empty roster → nothing sent, re-baselined
    const restart = diffRosterForPush(next, [], emptyIncidentState(), NOW + 10, 'boot-b');
    expect(restart.push).toEqual([]);
    expect(restart.next.bootId).toBe('boot-b');
    // same boot, everyone gone → every station checked out
    const cleared = diffRosterForPush(next, [], emptyIncidentState(), NOW + 10, 'boot-a');
    expect(cleared.push.map((e) => [e.call, e.checkedOut])).toEqual([
      ['W1AW', true],
      ['K1ABC', true],
    ]);
  });

  it('after a restart, stations still present are not re-sent as new check-ins', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW, 'boot-a');
    const again = diffRosterForPush(next, [op], emptyIncidentState(), NOW + 10, 'boot-b');
    expect(again.push).toEqual([]);
  });

  it('a re-check-in (new check-in time) is sent as a fresh check-in', () => {
    const { next } = diffRosterForPush(null, [op], emptyIncidentState(), NOW);
    const { push } = diffRosterForPush(next, [{ ...op, checkinTime: NOW + 50 }], emptyIncidentState(), NOW + 60);
    expect(push[0]).toMatchObject({ updatedAt: NOW + 50 });
  });
});

describe('reports', () => {
  it('maps local field and shelter reports to stable incident ids', () => {
    expect(fieldReportForPush({ id: 'abc', callsign: 'W1AW', timestamp: 5 })).toMatchObject({
      id: 'field-abc',
      kind: 'field',
    });
    expect(shelterReportForPush({ from: 'K1ABC', timestamp: 7, text: 'open' })).toMatchObject({
      id: 'shelter-K1ABC-7',
      kind: 'shelter',
      callsign: 'K1ABC',
    });
  });

  it('merges incident reports into local lists without duplicating ones both sides have', () => {
    const state = applyIncidentDelta(emptyIncidentState(), {
      reports: [
        { id: 'field-abc', kind: 'field', callsign: 'W1AW', timestamp: NOW - 120000 },
        { id: 'field-remote', kind: 'field', callsign: 'K1ABC', timestamp: NOW - 60000 },
        { id: 'shelter-K1ABC-7', kind: 'shelter', callsign: 'K1ABC', timestamp: 7, text: 'open' },
        { id: 'shelter-N0X-9', kind: 'shelter', callsign: 'N0X', timestamp: 9, text: 'full', tokens: [] },
      ],
    });
    const fr = mergeFieldReports([{ id: 'abc', callsign: 'W1AW', timestamp: NOW - 120000, age: 2 }], state, NOW);
    expect(fr.map((r) => r.id)).toEqual(['field-remote', 'abc']);
    expect(fr[0].age).toBe(1);

    const sr = mergeShelterReports([{ from: 'K1ABC', timestamp: 7, text: 'open' }], state);
    expect(sr).toHaveLength(2);
    expect(sr[1]).toMatchObject({ from: 'N0X', source: 'incident' });
  });

  it('strips local-only fields from events', () => {
    const ev = eventForPush({ id: 'x', ts: 1, type: 'nws_alert', summary: 's', recordedAt: 5, dedupeKey: 'k' });
    expect(ev).toEqual({ id: 'x', ts: 1, type: 'nws_alert', callsign: '', summary: 's', details: '', dedupeKey: 'k' });
  });
});

describe('outbox', () => {
  it('queues, dedupes and keeps only the newest roster entry per call', () => {
    let o = queueOutbox(emptyOutbox(), {
      roster: [{ call: 'W1AW', updatedAt: 2, status: 'b' }],
      events: [{ id: 'e1', ts: 1 }],
    });
    o = queueOutbox(o, {
      roster: [{ call: 'W1AW', updatedAt: 1, status: 'older' }],
      events: [{ id: 'e1', ts: 1 }],
      reports: [{ id: 'r1', timestamp: 1 }],
    });
    expect(o.roster.W1AW.status).toBe('b');
    expect(outboxSize(o)).toBe(3);
  });

  it('acks only what was sent; items re-queued in flight survive', () => {
    let o = queueOutbox(emptyOutbox(), {
      roster: [{ call: 'W1AW', updatedAt: 1 }],
      events: [{ id: 'e1', ts: 1 }],
      board: { name: 'A', updatedAt: 1 },
    });
    const batch = outboxBatch(o);
    expect(batch.board.name).toBe('A');
    // while the POST is in flight:
    o = queueOutbox(o, { roster: [{ call: 'W1AW', updatedAt: 5 }], events: [{ id: 'e2', ts: 2 }] });
    o = ackOutbox(o, batch);
    expect(Object.keys(o.events)).toEqual(['e2']);
    expect(o.roster.W1AW.updatedAt).toBe(5);
    expect(o.board).toBeNull();
    expect(outboxBatch(ackOutbox(o, outboxBatch(o)))).toBeNull();
  });

  it('buffers only the newest copy of each shared document and acks it', () => {
    let o = queueOutbox(emptyOutbox(), { docs: [{ id: 'ics-drafts', data: { v: 2 }, updatedAt: 2 }] });
    o = queueOutbox(o, { docs: [{ id: 'ics-drafts', data: { v: 1 }, updatedAt: 1 }] });
    expect(o.docs['ics-drafts'].data.v).toBe(2);
    expect(outboxSize(o)).toBe(1);
    const batch = outboxBatch(o);
    expect(batch.docs).toHaveLength(1);
    expect(outboxSize(ackOutbox(o, batch))).toBe(0);
    expect(dropOutboxDocs(o).docs).toEqual({});
  });

  it('caps the buffer, dropping the oldest events', () => {
    const events = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, ts: i }));
    const o = queueOutbox(emptyOutbox(), { events });
    expect(Object.keys(o.events)).toHaveLength(500);
    expect(o.events.e0).toBeUndefined();
    expect(o.events.e599).toBeTruthy();
  });
});

describe('join link', () => {
  it('puts the key in the fragment and round-trips', () => {
    const url = buildJoinUrl('https://eoc.local:3000/', 'ABCDEFGH', 'JKMNPQRSTUVWXYZ2');
    expect(url).toBe('https://eoc.local:3000/#incident=ABCDEFGH&key=JKMNPQRSTUVWXYZ2');
    expect(parseJoinUrl(url)).toEqual({ id: 'ABCDEFGH', key: 'JKMNPQRSTUVWXYZ2' });
    expect(parseJoinUrl('#incident=abcd-efgh&key=jkmn-pqrs-tuvw-xyz2')).toEqual({
      id: 'ABCDEFGH',
      key: 'JKMNPQRSTUVWXYZ2',
    });
    expect(parseJoinUrl('#other=1')).toBeNull();
    expect(parseJoinUrl('')).toBeNull();
  });

  it('formats codes in groups of four', () => {
    expect(formatCode('jkmnpqrstuvwxyz2')).toBe('JKMN-PQRS-TUVW-XYZ2');
    expect(normaliseCode(' ab-cd ')).toBe('ABCD');
    expect(formatCode('')).toBe('');
  });
});

describe('event types', () => {
  it('the server accepts every Event Log type, so no local entry fails to sync', async () => {
    const { EVENT_TYPE_META } = await import('./emcommEventLog.js');
    const { EVENT_TYPES } = await import('../../server/utils/incidentStore.js');
    for (const type of Object.keys(EVENT_TYPE_META)) expect(EVENT_TYPES.has(type), type).toBe(true);
  });
});

describe('withdrawals and message numbers across sites', () => {
  // EOC North (this browser) and EOC South each number their own traffic from 1.
  const shared = [
    { id: 'n-1', ts: 100, type: 'net_checkin', callsign: 'KD0ABC', summary: 'in', site: 'North', msgNo: 1 },
    { id: 's-1', ts: 110, type: 'net_checkin', callsign: 'W1AW', summary: 'in', site: 'South', msgNo: 1 },
    {
      id: 'n-2',
      ts: 120,
      type: 'aprs_msg_sent',
      callsign: 'K0CJH',
      summary: 'Message to W1AW',
      details: 'hi',
      site: 'North',
      msgNo: 2,
    },
    {
      id: 's-2',
      ts: 130,
      type: 'aprs_msg_rx',
      callsign: 'W1AW',
      summary: 'Message to K1ABC',
      details: 'yo',
      site: 'South',
      msgNo: 2,
    },
    // South withdraws North's check-in (a Net Control correction made over there)
    {
      id: 's-w',
      ts: 140,
      type: 'net_withdrawn',
      callsign: 'KD0ABC',
      summary: 'Check-in withdrawn',
      ref: 'n-1',
      site: 'South',
    },
  ];
  const ownIds = new Set(['n-1', 'n-2']);

  it('mirrors msgNo and ref', () => {
    const out = eventForPush({ id: 'w', ts: 1, type: 'net_withdrawn', ref: 'n-1', msgNo: 4 });
    expect(out).toMatchObject({ ref: 'n-1', msgNo: 4 });
    expect('ref' in eventForPush({ id: 'x', ts: 1, type: 'nws_alert' })).toBe(false);
  });

  it('labels other sites’ numbers SITE:n and keeps our own plain', () => {
    const view = annotateSharedEvents(shared, ownIds);
    expect(view.map(sharedMsgLabel)).toEqual(['1', 'South:1', '2', 'South:2', '']);
    expect(view.find((e) => e.id === 'n-2').foreign).toBeUndefined();
    expect(annotateSharedEvents([{ id: 'z', type: 'aprs_msg_rx', msgNo: 3 }], [])[0].msgLabel).toBe('3');
  });

  it('a withdrawal logged at one site hides the entry in every site’s shared view', async () => {
    const { activeEvents } = await import('./emcommEventLog.js');
    for (const mine of [ownIds, new Set(['s-1', 's-2', 's-w'])]) {
      const ids = activeEvents(annotateSharedEvents(shared, mine)).map((e) => e.id);
      expect(ids).toEqual(['s-1', 'n-2', 's-2']);
    }
  });

  it('the ICS 309 numbers our own traffic with our numbers and shows other sites’ as SITE:n', async () => {
    const { ics309RowsFromEvents } = await import('./icsForms.js');
    const rows = ics309RowsFromEvents(annotateSharedEvents(shared, ownIds), { operatorCall: 'K0CJH' });
    const byId = Object.fromEntries(rows.map((r) => [r.eventId, r]));
    expect(byId['n-2'].fromMsg).toBe('2'); // ours, sent: our own number
    expect(byId['s-2'].toMsg).toBe('South:2'); // theirs, received there: their number, labelled
    expect(byId['s-1'].toMsg).toBe('South:1');
    expect(byId['n-1']).toBeUndefined(); // withdrawn
    // renumbering a period only renumbers our own traffic
    const renum = ics309RowsFromEvents(annotateSharedEvents(shared, ownIds), {
      operatorCall: 'K0CJH',
      startNumber: 50,
    });
    const r2 = Object.fromEntries(renum.map((r) => [r.eventId, r]));
    expect(r2['n-2'].fromMsg).toBe('50');
    expect(r2['s-2'].toMsg).toBe('South:2');
  });
});
