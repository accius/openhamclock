/**
 * Tests for server/utils/incidentStore.js — shared incident state model.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const { createIncidentStore, IncidentError, LIMITS, idleLimitFor } = require('./incidentStore.js');

describe('incidentStore', () => {
  let clock;
  let store;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    store = createIncidentStore({ now });
  });

  const make = (input = {}) => store.create({ name: 'Flood 2026', ic: 'K0CJH', netFreq: '146.520', ...input });

  describe('create / verify', () => {
    it('creates an incident with a random id and a one-time join key', () => {
      const { incident, joinKey } = make();
      expect(incident.id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(joinKey).toHaveLength(16);
      expect(incident.board).toMatchObject({ name: 'Flood 2026', ic: 'K0CJH', netFreq: '146.520' });
      expect(incident.participants).toBe(0);
      expect(incident.counts).toEqual({ roster: 0, events: 0, reports: 0 });
      expect(store.size).toBe(1);
    });

    it('verifies the join key (case/separator tolerant) and rejects wrong keys and ids', () => {
      const { incident, joinKey } = make();
      expect(store.verify(incident.id, joinKey)).not.toBeNull();
      expect(store.verify(incident.id.toLowerCase(), joinKey.toLowerCase())).not.toBeNull();
      expect(store.verify(incident.id, 'WRONGKEYWRONGKEY')).toBeNull();
      expect(store.verify('NOPENOPE', joinKey)).toBeNull();
    });

    it('never persists the join key, only its salted hash', () => {
      const { joinKey } = make();
      expect(JSON.stringify(store.serialise())).not.toContain(joinKey);
    });

    it('caps the number of incidents', () => {
      const small = createIncidentStore({ now, limits: { maxIncidents: 2 } });
      small.create({});
      small.create({});
      expect(() => small.create({})).toThrow(IncidentError);
      try {
        small.create({});
      } catch (e) {
        expect(e.status).toBe(503);
      }
    });

    it('at the cap, evicts the longest-idle unattended incident but never an active one', () => {
      const small = createIncidentStore({ now, limits: { maxIncidents: 2 } });
      const { incident: a } = small.create({});
      const { incident: b } = small.create({});
      small.touchParticipant(a.id, 'client-a');
      expect(() => small.create({})).toThrow(/limit/); // both fresh
      clock += 5 * 60 * 1000;
      expect(() => small.create({})).toThrow(/limit/); // b only 5 min idle — still kept
      clock += 2 * 60 * 60 * 1000;
      small.touchParticipant(a.id, 'client-a'); // a is attended
      const { incident: c } = small.create({});
      expect(small.has(a.id)).toBe(true);
      expect(small.has(b.id)).toBe(false);
      expect(small.has(c.id)).toBe(true);
    });

    it('uses tighter limits when hosted', () => {
      const hosted = createIncidentStore({ hosted: true });
      expect(hosted.limits).toEqual(LIMITS.hosted);
      expect(hosted.limits.maxIncidents).toBeLessThan(LIMITS.local.maxIncidents);
    });
  });

  describe('apply — roster', () => {
    it('adds entries keyed by callsign and reports only what changed', () => {
      const { incident } = make();
      const r = store.apply(incident.id, {
        roster: [
          { call: 'w1aw', netName: 'ARES', status: 'At EOC', checkinTime: clock - 1000 },
          { call: 'K1ABC', netName: 'ARES' },
          { call: '' },
        ],
      });
      expect(r.changed).toBe(true);
      expect(r.changes.roster.map((e) => e.call)).toEqual(['W1AW', 'K1ABC']);
      expect(r.changes.roster[1].status).toBe('Checked in');
      expect(store.snapshot(incident.id).roster).toHaveLength(2);
    });

    it('is idempotent for an unchanged entry and newest updatedAt wins', () => {
      const { incident } = make();
      const base = { call: 'W1AW', netName: 'ARES', status: 'At EOC', checkinTime: clock, updatedAt: clock };
      const first = store.apply(incident.id, { roster: [base] });
      const again = store.apply(incident.id, { roster: [base] });
      expect(again.changed).toBe(false);
      expect(again.seq).toBe(first.seq);

      const stale = store.apply(incident.id, { roster: [{ ...base, status: 'Old', updatedAt: clock - 5000 }] });
      expect(stale.changed).toBe(false);

      const newer = store.apply(incident.id, {
        roster: [{ ...base, status: 'Checked out', checkedOut: true, updatedAt: clock + 5000 }],
      });
      expect(newer.changes.roster[0]).toMatchObject({ call: 'W1AW', checkedOut: true });
      expect(store.snapshot(incident.id).counts.roster).toBe(0); // checked-out not counted as active
    });

    it('treats a replay without timestamps as unchanged', () => {
      const { incident } = make();
      store.apply(incident.id, { roster: [{ call: 'W1AW', netName: 'ARES', status: 'At EOC' }] });
      clock += 60000;
      const again = store.apply(incident.id, { roster: [{ call: 'W1AW', netName: 'ARES', status: 'At EOC' }] });
      expect(again.changed).toBe(false);
    });

    it('caps the roster, dropping checked-out operators first', () => {
      const small = createIncidentStore({ now, limits: { maxRoster: 3 } });
      const { incident } = small.create({});
      small.apply(incident.id, {
        roster: [
          { call: 'A1A', updatedAt: clock },
          { call: 'B1B', updatedAt: clock + 1, checkedOut: true },
          { call: 'C1C', updatedAt: clock + 2 },
          { call: 'D1D', updatedAt: clock + 3 },
        ],
      });
      const calls = small
        .snapshot(incident.id)
        .roster.map((e) => e.call)
        .sort();
      expect(calls).toEqual(['A1A', 'C1C', 'D1D']);
    });

    it('sanitises tokens and coordinates', () => {
      const { incident } = make();
      const r = store.apply(incident.id, {
        roster: [
          {
            call: 'W1AW',
            lat: 95,
            lon: -71.1,
            tokens: [{ key: 'Beds', current: 30, max: 100 }, { nope: 1 }, 'x'],
          },
        ],
      });
      expect(r.changes.roster[0]).toMatchObject({
        lat: null,
        lon: -71.1,
        tokens: [{ key: 'Beds', type: 'text', current: 30, max: 100 }],
      });
    });
  });

  describe('apply — events', () => {
    it('dedupes by id and by type:dedupeKey across browsers', () => {
      const { incident } = make();
      const a = store.apply(incident.id, {
        events: [{ id: 'b1-1', type: 'net_checkin', callsign: 'W1AW', summary: 'in', dedupeKey: 'W1AW-1' }],
      });
      expect(a.changes.events).toHaveLength(1);
      const b = store.apply(incident.id, {
        events: [
          { id: 'b1-1', type: 'net_checkin', callsign: 'W1AW', summary: 'in' }, // same id
          { id: 'b2-9', type: 'net_checkin', callsign: 'W1AW', summary: 'in', dedupeKey: 'W1AW-1' }, // same real event, other browser
          { id: 'b2-10', type: 'bogus', summary: 'x' }, // unknown type
          { id: 'b2-11', type: 'aprs_msg_rx', callsign: 'K1ABC', summary: 'Message to W1AW', details: 'hi' },
        ],
      });
      expect(b.changes.events.map((e) => e.id)).toEqual(['b2-11']);
      expect(store.snapshot(incident.id).events).toHaveLength(2);
    });

    it('keeps a Net Control withdrawal and the id it withdraws', () => {
      const { incident } = make();
      const r = store.apply(incident.id, {
        events: [
          { id: 'c1', type: 'net_checkin', callsign: 'W1AW', summary: 'in' },
          { id: 'w1', type: 'net_withdrawn', callsign: 'W1AW', summary: 'Check-in withdrawn', ref: 'c1' },
        ],
      });
      expect(r.changes.events.map((e) => e.id)).toEqual(['c1', 'w1']);
      expect(store.snapshot(incident.id).events.find((e) => e.id === 'w1').ref).toBe('c1');
      expect(store.snapshot(incident.id).events.find((e) => e.id === 'c1').ref).toBeUndefined();
    });

    it('keeps each station’s own message number, and drops junk numbers', () => {
      const { incident } = make();
      store.apply(
        incident.id,
        {
          events: [
            { id: 'm1', type: 'aprs_msg_sent', callsign: 'K0CJH', summary: 'Message to W1AW', msgNo: 7 },
            { id: 'm2', type: 'aprs_msg_rx', callsign: 'W1AW', summary: 'Message to K0CJH', msgNo: '8' },
            { id: 'm3', type: 'aprs_msg_rx', callsign: 'W1AW', summary: 'x', msgNo: -1 },
            { id: 'm4', type: 'aprs_msg_rx', callsign: 'W1AW', summary: 'y', msgNo: 'abc' },
          ],
        },
        { site: 'EOC' },
      );
      const evs = store.snapshot(incident.id).events;
      expect(evs.map((e) => [e.id, e.msgNo, e.site])).toEqual([
        ['m1', 7, 'EOC'],
        ['m2', 8, 'EOC'],
        ['m3', undefined, 'EOC'],
        ['m4', undefined, 'EOC'],
      ]);
      const restored = createIncidentStore({ now });
      restored.hydrate(JSON.parse(JSON.stringify(store.serialise())));
      expect(restored.snapshot(incident.id).events.find((e) => e.id === 'm1').msgNo).toBe(7);
    });

    it('returns events oldest first in snapshots and caps the log by timestamp', () => {
      const small = createIncidentStore({ now, limits: { maxEvents: 3 } });
      const { incident } = small.create({});
      small.apply(incident.id, {
        events: [
          { id: 'e3', type: 'nws_alert', ts: 3, summary: 'three' },
          { id: 'e1', type: 'nws_alert', ts: 1, summary: 'one' },
          { id: 'e4', type: 'nws_alert', ts: 4, summary: 'four' },
          { id: 'e2', type: 'nws_alert', ts: 2, summary: 'two' },
        ],
      });
      expect(small.snapshot(incident.id).events.map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
    });

    it('stamps the origin site when the record has none', () => {
      const { incident } = make();
      const r = store.apply(
        incident.id,
        { events: [{ id: 'x', type: 'incident_note', summary: 'note' }] },
        { site: 'EOC-North' },
      );
      expect(r.changes.events[0].site).toBe('EOC-North');
    });
  });

  describe('apply — reports and board', () => {
    it('accepts field and shelter reports by id and rejects unknown kinds', () => {
      const { incident } = make();
      const r = store.apply(incident.id, {
        reports: [
          { id: 'f1', kind: 'field', callsign: 'W1AW', formType: 'FSR', text: 'Bridge out', lat: 42.1, lon: -71.2 },
          {
            id: 's1',
            kind: 'shelter',
            callsign: 'K1ABC',
            text: 'Shelter open',
            tokens: [{ key: 'Beds', type: 'capacity', current: 30, max: 100 }],
          },
          { id: 'f1', kind: 'field', callsign: 'W1AW', text: 'dup' },
          { id: 'z1', kind: 'other', text: 'no' },
          { id: 'z2', kind: 'field' }, // empty
        ],
      });
      expect(r.changes.reports.map((x) => x.id)).toEqual(['f1', 's1']);
      expect(r.changes.reports[1].tokens).toEqual([{ key: 'Beds', type: 'capacity', current: 30, max: 100 }]);
    });

    it('updates the board only from an admin, only when newer, and ignores no-op rewrites', () => {
      const { incident } = make();
      const admin = { role: 'admin' };
      const old = store.apply(incident.id, { board: { name: 'Older', updatedAt: clock - 10 } }, admin);
      expect(old.changed).toBe(false);
      const same = store.apply(
        incident.id,
        { board: { name: 'Flood 2026', ic: 'K0CJH', netFreq: '146.520', notes: '', updatedAt: clock + 10 } },
        admin,
      );
      expect(same.changed).toBe(false);
      const board = {
        name: 'Flood 2026',
        ic: 'K0CJH',
        netFreq: '146.520',
        notes: 'Shelter at HS',
        updatedAt: clock + 20,
      };
      const byOperator = store.apply(incident.id, { board }, { role: 'operator' });
      expect(byOperator.changed).toBe(false);
      expect(byOperator.denied).toEqual(['board']);
      const newer = store.apply(incident.id, { board }, admin);
      expect(newer.changed).toBe(true);
      expect(newer.changes.board.notes).toBe('Shelter at HS');
      expect(store.snapshot(incident.id).board.notes).toBe('Shelter at HS');
    });

    it('throws 404 for an unknown incident', () => {
      expect(() => store.apply('NOPENOPE', {})).toThrow(/Unknown or expired/);
    });
  });

  describe('snapshot cursor', () => {
    it('returns only records stamped after `since`', () => {
      const { incident } = make();
      const a = store.apply(incident.id, { events: [{ id: 'e1', type: 'nws_alert', summary: 'one' }] });
      store.apply(incident.id, {
        events: [{ id: 'e2', type: 'nws_alert', summary: 'two' }],
        roster: [{ call: 'W1AW' }],
      });
      const delta = store.snapshot(incident.id, a.seq);
      expect(delta.events.map((e) => e.id)).toEqual(['e2']);
      expect(delta.roster.map((e) => e.call)).toEqual(['W1AW']);
      expect(delta.board).toBeNull(); // unchanged since cursor
      expect(store.snapshot(incident.id, 0).board).not.toBeNull();
    });
  });

  describe('participants', () => {
    it('counts recently-seen clients and forgets them after the TTL', () => {
      const { incident } = make();
      expect(store.touchParticipant(incident.id, 'c1', 'W1AW')).toBe(1);
      expect(store.touchParticipant(incident.id, 'c2', 'K1ABC')).toBe(2);
      expect(store.touchParticipant(incident.id, 'c1', 'W1AW')).toBe(2);
      clock += 10 * 60 * 1000;
      expect(store.meta(incident.id).participants).toBe(0);
      expect(store.touchParticipant(incident.id, 'c3')).toBe(1);
      expect(store.removeParticipant(incident.id, 'c3')).toBe(0);
    });

    it('bounds the participant map', () => {
      const small = createIncidentStore({ now, limits: { maxParticipants: 2 } });
      const { incident } = small.create({});
      small.touchParticipant(incident.id, 'a');
      clock += 1;
      small.touchParticipant(incident.id, 'b');
      clock += 1;
      expect(small.touchParticipant(incident.id, 'c')).toBe(2);
    });
  });

  describe('expiry and persistence', () => {
    it('expires incidents idle for longer than idleMs', () => {
      const s = createIncidentStore({ now, idleMs: 1000 });
      const { incident: a } = s.create({});
      clock += 500;
      const { incident: b } = s.create({});
      clock += 600;
      expect(s.expire()).toBe(1);
      expect(s.has(a.id)).toBe(false);
      expect(s.has(b.id)).toBe(true);
    });

    it('activity refreshes the idle clock', () => {
      const s = createIncidentStore({ now, idleMs: 1000 });
      const { incident } = s.create({});
      clock += 900;
      s.apply(incident.id, { events: [{ id: 'e', type: 'incident_note', summary: 'still here' }] });
      clock += 900;
      expect(s.expire()).toBe(0);
    });

    it('round-trips through serialise/hydrate with keys still valid and seq preserved', () => {
      const { incident, joinKey } = make();
      store.apply(incident.id, {
        roster: [{ call: 'W1AW', netName: 'ARES' }],
        events: [{ id: 'e1', type: 'net_checkin', callsign: 'W1AW', summary: 'in', dedupeKey: 'W1AW-x' }],
        reports: [{ id: 'f1', kind: 'field', callsign: 'W1AW', text: 'ok' }],
      });
      const before = store.snapshot(incident.id);
      const json = JSON.parse(JSON.stringify(store.serialise()));

      const restored = createIncidentStore({ now });
      expect(restored.hydrate(json)).toBe(1);
      expect(restored.verify(incident.id, joinKey)).not.toBeNull();
      const after = restored.snapshot(incident.id);
      expect(after.seq).toBe(before.seq);
      expect(after.roster).toEqual(before.roster);
      expect(after.events).toEqual(before.events);
      expect(after.reports).toEqual(before.reports);
      expect(after.board).toEqual(before.board);
      // dedupe index rebuilt from the loaded log
      const dup = restored.apply(incident.id, {
        events: [{ id: 'e9', type: 'net_checkin', callsign: 'W1AW', summary: 'in', dedupeKey: 'W1AW-x' }],
      });
      expect(dup.changed).toBe(false);
    });

    it('skips malformed persisted entries and respects the incident cap on load', () => {
      const small = createIncidentStore({ now, limits: { maxIncidents: 1 } });
      const good = store.serialise();
      make();
      const two = store.serialise();
      expect(small.hydrate([null, { id: 'x' }, ...two])).toBe(1);
      expect(small.hydrate('nope')).toBe(0);
      expect(good).toHaveLength(0);
    });
  });

  describe('roles', () => {
    it('hands out a separate admin key and tells the two roles apart', () => {
      const { incident, joinKey, adminKey } = make();
      expect(adminKey).toHaveLength(16);
      expect(adminKey).not.toBe(joinKey);
      expect(store.verify(incident.id, joinKey).role).toBe('operator');
      expect(store.verify(incident.id, adminKey).role).toBe('admin');
      expect(store.verify(incident.id, 'WRONGWRONGWRONG2')).toBeNull();
      expect(JSON.stringify(store.serialise())).not.toContain(adminKey);
    });

    it('rotating the join key locks out the old key, keeps the admin key, and bumps keyGen', () => {
      const { incident, joinKey, adminKey } = make();
      const { joinKey: fresh, keyGen } = store.rotateJoinKey(incident.id);
      expect(keyGen).toBe(2);
      expect(store.verify(incident.id, joinKey)).toBeNull();
      expect(store.verify(incident.id, fresh).role).toBe('operator');
      expect(store.verify(incident.id, adminKey).role).toBe('admin');
      expect(store.keyGenOf(incident.id)).toBe(2);
    });
  });

  describe('admin edit / delete', () => {
    const seed = () => {
      const { incident } = make();
      store.apply(incident.id, {
        events: [
          { id: 'e1', type: 'incident_note', summary: 'typo', dedupeKey: 'k1' },
          { id: 'e2', type: 'incident_note', summary: 'keep' },
        ],
        reports: [{ id: 'f1', kind: 'field', callsign: 'W1AW', text: 'Bridge out' }],
      });
      return incident.id;
    };

    it('edits an event in place with a higher rev, keeping id, type and site', () => {
      const id = seed();
      const before = store.snapshot(id).seq;
      const r = store.adminChange(id, { edit: { events: [{ id: 'e1', summary: 'fixed', type: 'nws_alert' }] } });
      expect(r.changes.events[0]).toMatchObject({ id: 'e1', summary: 'fixed', type: 'nws_alert', rev: 1 });
      expect(store.snapshot(id, before).events.map((e) => e.id)).toEqual(['e1']);
      const again = store.adminChange(id, { edit: { events: [{ id: 'e1', summary: 'again' }] } });
      expect(again.changes.events[0].rev).toBe(2);
      expect(store.adminChange(id, { edit: { events: [{ id: 'nope', summary: 'x' }] } }).changed).toBe(false);
    });

    it('deletes events and reports with tombstones that deltas carry and full snapshots omit', () => {
      const id = seed();
      const before = store.snapshot(id).seq;
      const r = store.adminChange(id, { delete: { events: ['e1'], reports: ['f1', 'missing'] } });
      expect(r.changes.deleted.map((d) => `${d.kind}:${d.id}`)).toEqual(['event:e1', 'report:f1']);
      const delta = store.snapshot(id, before);
      expect(delta.full).toBe(false);
      expect(delta.deleted.map((d) => d.id)).toEqual(['e1', 'f1']);
      const full = store.snapshot(id, 0);
      expect(full.full).toBe(true);
      expect(full.events.map((e) => e.id)).toEqual(['e2']);
      expect(full.reports).toEqual([]);
      expect(full.deleted).toEqual([]);
    });

    it('a deleted record is not resurrected by a replay, and its dedupe key is released', () => {
      const id = seed();
      store.adminChange(id, { delete: { events: ['e1'], reports: ['f1'] } });
      const replay = store.apply(id, {
        events: [{ id: 'e1', type: 'incident_note', summary: 'typo', dedupeKey: 'k1' }],
        reports: [{ id: 'f1', kind: 'field', callsign: 'W1AW', text: 'Bridge out' }],
      });
      expect(replay.changed).toBe(false);
      const fresh = store.apply(id, { events: [{ id: 'e9', type: 'incident_note', summary: 'n', dedupeKey: 'k1' }] });
      expect(fresh.changes.events.map((e) => e.id)).toEqual(['e9']);
    });

    it('clears the board', () => {
      const id = seed();
      const r = store.adminChange(id, { delete: { board: true } });
      expect(r.changes.board).toMatchObject({ name: '', ic: '', netFreq: '', notes: '' });
    });

    it('a cursor older than pruned tombstones gets a full snapshot', () => {
      const id = seed();
      const old = store.snapshot(id).seq;
      const evs = Array.from({ length: 1005 }, (_, i) => ({ id: `x${i}`, type: 'incident_note', summary: `${i}` }));
      for (let i = 0; i < evs.length; i += 200) store.apply(id, { events: evs.slice(i, i + 200) });
      store.adminChange(id, { delete: { events: evs.slice(0, 200).map((e) => e.id) } });
      for (let i = 200; i < evs.length; i += 200)
        store.adminChange(id, { delete: { events: evs.slice(i, i + 200).map((e) => e.id) } });
      expect(store.snapshot(id, old).full).toBe(true);
    });
  });

  describe('shared documents', () => {
    it('stores known docs, ignores unknown ids and no-op rewrites', () => {
      const { incident } = make();
      const a = store.apply(incident.id, {
        docs: [
          { id: 'net-running', data: { name: 'ARES', stations: [] }, updatedAt: clock, by: 'w1aw' },
          { id: 'bogus', data: {} },
        ],
      });
      expect(a.changes.docs).toEqual([
        expect.objectContaining({ id: 'net-running', by: 'W1AW', docRev: 1, receivedAt: clock }),
      ]);
      expect(
        store.apply(incident.id, { docs: [{ id: 'net-running', data: { name: 'ARES', stations: [] } }] }).changed,
      ).toBe(false);
      const closed = store.apply(incident.id, { docs: [{ id: 'net-running', data: null, updatedAt: clock + 1 }] });
      expect(closed.changes.docs[0]).toMatchObject({ data: null, docRev: 2 });
      expect(store.snapshot(incident.id).docs).toHaveLength(1);
    });

    it('refuses a draft made from an older revision (an hour-old offline edit), keeping the newer one', () => {
      const { incident } = make();
      // North and South both start from revision 1.
      store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'start' } }] });
      // South keeps working online: revisions 2 and 3.
      store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'south-1' }, baseRev: 1 }] });
      store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'south-2' }, baseRev: 2 }] });
      // North comes back an hour later and flushes the draft it made from revision 1.
      clock += 3600e3;
      const late = store.apply(incident.id, {
        docs: [{ id: 'ics-drafts', data: { v: 'north-offline' }, baseRev: 1 }],
        events: [{ id: 'n-e1', type: 'incident_note', summary: 'still applied' }],
      });
      expect(late.docConflicts).toEqual([
        { id: 'ics-drafts', baseRev: 1, current: expect.objectContaining({ data: { v: 'south-2' }, docRev: 3 }) },
      ]);
      expect(late.changes.events.map((e) => e.id)).toEqual(['n-e1']); // the rest of the batch went through
      expect(store.snapshot(incident.id).docs[0].data).toEqual({ v: 'south-2' });
      // Made from the current revision ("apply mine" after seeing theirs): accepted.
      const mine = store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'north-offline' }, baseRev: 3 }] });
      expect(mine.docConflicts).toEqual([]);
      expect(mine.changes.docs[0]).toMatchObject({ docRev: 4 });
      // No baseRev: unconditional, as before.
      expect(store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'x' } }] }).changes.docs).toHaveLength(1);
    });

    it('orders documents by when the server receives them, whatever the client clocks say', () => {
      const { incident } = make();
      // Site A's clock runs an hour fast, site B's ten minutes slow.
      store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'A' }, updatedAt: clock + 3600e3 }] });
      clock += 1000;
      const b = store.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { v: 'B' }, updatedAt: clock - 600e3 }] });
      expect(b.changed).toBe(true); // the later arrival wins although its clock says it is older
      const doc = store.snapshot(incident.id).docs[0];
      expect(doc).toMatchObject({ data: { v: 'B' }, docRev: 2, receivedAt: clock, updatedAt: clock - 600e3 });
      const restored = createIncidentStore({ now });
      restored.hydrate(JSON.parse(JSON.stringify(store.serialise())));
      expect(restored.snapshot(incident.id).docs[0]).toMatchObject({ docRev: 2, receivedAt: clock });
    });

    it('refuses an oversized document with 413', () => {
      const small = createIncidentStore({ now, limits: { maxDocBytes: 100 } });
      const { incident } = small.create({});
      expect(() => small.apply(incident.id, { docs: [{ id: 'ics-drafts', data: { x: 'y'.repeat(200) } }] })).toThrow(
        expect.objectContaining({ status: 413 }),
      );
    });
  });

  describe('hosted creation guards', () => {
    const hosted = (limits = {}) => createIncidentStore({ hosted: true, now, limits });

    it('requires a real-looking callsign', () => {
      const s = hosted();
      expect(() => s.create({}, {})).toThrow(expect.objectContaining({ status: 400 }));
      expect(() => s.create({}, { call: 'N0CALL' })).toThrow(expect.objectContaining({ status: 400 }));
      expect(() => s.create({}, { call: 'HELLO' })).toThrow(expect.objectContaining({ status: 400 }));
      expect(s.create({}, { call: 'w1aw/p' }).incident.id).toBeTruthy();
    });

    it('caps open incidents per callsign', () => {
      const s = hosted();
      s.create({}, { call: 'W1AW' });
      s.create({}, { call: 'W1AW' });
      expect(() => s.create({}, { call: 'w1aw' })).toThrow(expect.objectContaining({ status: 429 }));
      expect(s.create({}, { call: 'K1ABC' }).incident).toBeTruthy();
    });

    it('rate-limits creation across the whole server, sliding over an hour', () => {
      const s = hosted({ createsPerHour: 3, maxPerCallsign: 99 });
      for (let i = 0; i < 3; i++) s.create({}, { call: 'W1AW' });
      expect(() => s.create({}, { call: 'K1ABC' })).toThrow(/too fast/);
      clock += 61 * 60 * 1000;
      expect(s.create({}, { call: 'K1ABC' }).incident).toBeTruthy();
    });

    it('local installs need no callsign and have no global rate', () => {
      for (let i = 0; i < 30; i++) store.create({});
      expect(store.size).toBe(30);
    });
  });

  describe('pool pressure', () => {
    it('shortens the idle limit as the pool fills', () => {
      const week = 7 * 24 * 3600 * 1000;
      expect(idleLimitFor(0.2, week)).toBe(week);
      expect(idleLimitFor(0.6, week)).toBe(24 * 3600 * 1000);
      expect(idleLimitFor(0.85, week)).toBe(3600 * 1000);
      expect(idleLimitFor(1, week)).toBe(10 * 60 * 1000);
    });

    it('evicts unattended incidents idle past the pressure limit, never attended ones', () => {
      const s = createIncidentStore({ now, limits: { maxIncidents: 10 } });
      const ids = Array.from({ length: 9 }, () => s.create({}).incident.id); // 90% full
      s.touchParticipant(ids[0], 'present');
      clock += 2 * 3600 * 1000; // past the 1 h limit at ≥80%
      s.touchParticipant(ids[0], 'present');
      const dropped = s.relievePressure();
      // drops until the pool is below 50% (where the limit is back to 24 h > 2 h idle)
      expect(dropped).not.toContain(ids[0]);
      expect(s.has(ids[0])).toBe(true);
      expect(s.size).toBeLessThan(5);
    });

    it('a quiet pool keeps idle incidents for the full period', () => {
      const s = createIncidentStore({ now, limits: { maxIncidents: 10 } });
      s.create({});
      clock += 3 * 24 * 3600 * 1000;
      expect(s.expire()).toBe(0);
    });
  });

  describe('join key for the admin', () => {
    it('an admin verify returns the current join key, an operator verify does not', () => {
      const { incident, joinKey, adminKey } = make();
      expect(store.verify(incident.id, adminKey).joinKey).toBe(joinKey);
      expect(store.verify(incident.id, joinKey).joinKey).toBeUndefined();
      expect(JSON.stringify(store.serialise())).not.toContain(joinKey);
    });

    it('rotation with the admin key reseals the new key; survives a restart', () => {
      const { incident, adminKey } = make();
      const { joinKey: fresh } = store.rotateJoinKey(incident.id, adminKey);
      expect(store.verify(incident.id, adminKey).joinKey).toBe(fresh);
      const restored = createIncidentStore({ now });
      restored.hydrate(JSON.parse(JSON.stringify(store.serialise())));
      expect(restored.verify(incident.id, adminKey).joinKey).toBe(fresh);
    });
  });

  describe('tombstones on disk', () => {
    it('a restart does not let a deleted record come back', () => {
      const { incident } = make();
      store.apply(incident.id, {
        events: [{ id: 'e1', type: 'incident_note', summary: 'gone' }],
        reports: [{ id: 'f1', kind: 'field', callsign: 'W1AW', text: 'gone' }],
      });
      store.adminChange(incident.id, { delete: { events: ['e1'], reports: ['f1'] } });
      const seqAfterDelete = store.snapshot(incident.id).seq;
      const restored = createIncidentStore({ now });
      restored.hydrate(JSON.parse(JSON.stringify(store.serialise())));
      const replay = restored.apply(incident.id, {
        events: [{ id: 'e1', type: 'incident_note', summary: 'gone' }],
        reports: [{ id: 'f1', kind: 'field', callsign: 'W1AW', text: 'gone' }],
      });
      expect(replay.changed).toBe(false);
      expect(restored.snapshot(incident.id).events).toEqual([]);
      // a client that was up to date before the restart still gets a delta, tombstones intact
      const delta = restored.snapshot(incident.id, seqAfterDelete - 2);
      expect(delta.full).toBe(false);
      expect(delta.deleted.map((d) => d.id).sort()).toEqual(['e1', 'f1']);
    });

    it('tombstones go when the incident expires, and stay bounded', () => {
      const s = createIncidentStore({ now, idleMs: 1000 });
      const { incident } = s.create({});
      const evs = Array.from({ length: 1100 }, (_, i) => ({ id: `x${i}`, type: 'incident_note', summary: `${i}` }));
      for (let i = 0; i < evs.length; i += 200) s.apply(incident.id, { events: evs.slice(i, i + 200) });
      for (let i = 0; i < evs.length; i += 200) {
        s.adminChange(incident.id, { delete: { events: evs.slice(i, i + 200).map((e) => e.id) } });
      }
      expect(s.serialise()[0].tombstones.length).toBeLessThanOrEqual(1000);
      clock += 2000;
      s.expire();
      expect(s.serialise()).toEqual([]);
    });
  });

  describe('persistence of roles, docs and edits', () => {
    it('round-trips the admin key, docs, edit revs and creator', () => {
      const { incident, adminKey } = store.create({ name: 'X' }, { call: 'W1AW' });
      store.apply(incident.id, {
        events: [{ id: 'e1', type: 'incident_note', summary: 'a' }],
        docs: [{ id: 'ics-drafts', data: { header: { incidentName: 'X' } }, updatedAt: clock }],
      });
      store.adminChange(incident.id, { edit: { events: [{ id: 'e1', summary: 'b' }] } });
      const restored = createIncidentStore({ now });
      restored.hydrate(JSON.parse(JSON.stringify(store.serialise())));
      expect(restored.verify(incident.id, adminKey).role).toBe('admin');
      const snap = restored.snapshot(incident.id);
      expect(snap.events[0]).toMatchObject({ summary: 'b', rev: 1 });
      expect(snap.docs[0]).toMatchObject({ id: 'ics-drafts', data: { header: { incidentName: 'X' } } });
      expect(restored.get(incident.id).creatorCall).toBe('W1AW');
      // tombstones are persisted, so a cursor from before the restart still gets a delta
      expect(restored.snapshot(incident.id, 2).full).toBe(false);
      // a file from before tombstones were persisted forces one full resync
      const legacy = JSON.parse(JSON.stringify(store.serialise())).map(({ tombstones: _t, tombFloor: _f, ...r }) => r);
      const old = createIncidentStore({ now });
      old.hydrate(legacy);
      expect(old.snapshot(incident.id, 2).full).toBe(true);
    });
  });
});
