/**
 * Tests for server/routes/incident.js — shared incident API transport:
 * key auth and roles, stream tickets, hosted opacity and creation guards,
 * SSE fan-out and resume, key rotation, persistence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-incident-'));
process.env.INCIDENT_FILE = path.join(tmpDir, 'incidents.json');

const route = require('./incident.js');

const makeApp = () => {
  const handlers = {};
  const record =
    (method) =>
    (p, ...fns) =>
      (handlers[`${method} ${p}`] = fns[fns.length - 1]);
  return { handlers, app: { get: record('GET'), post: record('POST') } };
};

const ctx = { ROOT_DIR: tmpDir, logInfo: () => {}, logWarn: () => {}, logDebug: () => {} };

const makeRes = () => {
  const res = {
    code: 200,
    body: undefined,
    headers: {},
    chunks: [],
    ended: false,
    setHeader: (k, v) => (res.headers[k] = v),
    status: (c) => {
      res.code = c;
      return res;
    },
    json: (b) => {
      res.body = b;
      return res;
    },
    writeHead: (c, h) => {
      res.code = c;
      Object.assign(res.headers, h);
    },
    flushHeaders: () => {},
    write: (chunk) => res.chunks.push(chunk),
    end: () => (res.ended = true),
  };
  return res;
};

const makeReq = ({ params = {}, body = {}, query = {}, headers = {}, ip = '10.0.0.1' } = {}) => {
  const listeners = {};
  return {
    params,
    body,
    query,
    headers,
    ip,
    on: (ev, fn) => (listeners[ev] = fn),
    emit: (ev) => listeners[ev]?.(),
  };
};

/** Parse SSE chunks into [{ id, event, data }]. */
const sseEvents = (res) =>
  res.chunks
    .filter((c) => !c.startsWith(':'))
    .map((c) => {
      const out = {};
      for (const line of c.trim().split('\n')) {
        const [k, ...rest] = line.split(': ');
        out[k] = rest.join(': ');
      }
      return { id: out.id ? Number(out.id) : undefined, event: out.event, data: JSON.parse(out.data) };
    });

const call = (h, key, opts) => {
  const req = makeReq(opts);
  const res = makeRes();
  h[key](req, res);
  return { req, res };
};

describe('incident routes', () => {
  let h;
  const savedHosted = process.env.OHC_HOSTED;

  const mount = () => {
    const { app, handlers } = makeApp();
    const exp = route(app, ctx);
    h = handlers;
    return exp;
  };

  beforeEach(() => {
    delete process.env.OHC_HOSTED;
    try {
      fs.unlinkSync(process.env.INCIDENT_FILE);
    } catch {}
    mount();
  });

  afterEach(() => {
    if (savedHosted === undefined) delete process.env.OHC_HOSTED;
    else process.env.OHC_HOSTED = savedHosted;
  });

  const create = (body = {}, ip) =>
    call(h, 'POST /api/incident', { body: { name: 'Flood', ic: 'K0CJH', clientId: 'c1', call: 'K0CJH', ...body }, ip })
      .res.body;

  const keyHeader = (key) => ({ 'x-incident-key': key });

  /** Ticket + stream in one go. */
  const openStream = (id, key, clientId, headers = {}) => {
    const t = call(h, 'POST /api/incident/:id/ticket', { params: { id }, headers: keyHeader(key), body: { clientId } });
    return call(h, 'GET /api/incident/:id/stream', {
      params: { id },
      query: { ticket: t.res.body.ticket, clientId },
      headers,
    });
  };

  const sync = (id, key, body) =>
    call(h, 'POST /api/incident/:id/sync', { params: { id }, headers: keyHeader(key), body }).res;

  it('creates an incident and returns the id, join key and admin key once', () => {
    const out = create();
    expect(out.ok).toBe(true);
    expect(out.id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(out.joinKey).toHaveLength(16);
    expect(out.adminKey).toHaveLength(16);
    expect(out.role).toBe('admin');
    expect(out.incident.board.name).toBe('Flood');
    expect(out.incident.participants).toBe(1);
  });

  it('joins with either key and reports the role; wrong key 403, unknown id 404 locally', () => {
    const { id, joinKey, adminKey } = create();
    const op = call(h, 'POST /api/incident/:id/join', { params: { id }, body: { key: joinKey, clientId: 'c2' } });
    expect(op.res.body).toMatchObject({ ok: true, role: 'operator' });
    expect(op.res.body.incident.participants).toBe(2);
    const ad = call(h, 'POST /api/incident/:id/join', { params: { id }, headers: keyHeader(adminKey), body: {} });
    expect(ad.res.body.role).toBe('admin');
    expect(call(h, 'POST /api/incident/:id/join', { params: { id }, body: { key: 'NOPE' } }).res.code).toBe(403);
    const unknown = call(h, 'POST /api/incident/:id/join', { params: { id: 'ABCDEFGH' }, body: { key: joinKey } });
    expect(unknown.res.code).toBe(404);
  });

  it('never accepts a key from the query string', () => {
    const { id, joinKey } = create();
    expect(call(h, 'GET /api/incident/:id', { params: { id }, query: { key: joinKey } }).res.code).toBe(403);
    const viaHeader = call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(joinKey) });
    expect(viaHeader.res.code).toBe(200);
    expect(viaHeader.res.body.role).toBe('operator');
    expect(viaHeader.res.headers['Cache-Control']).toMatch(/no-store/);
  });

  describe('stream tickets', () => {
    it('a ticket opens the stream once', () => {
      const { id, joinKey } = create();
      const t = call(h, 'POST /api/incident/:id/ticket', {
        params: { id },
        headers: keyHeader(joinKey),
        body: { clientId: 'c1' },
      }).res.body;
      expect(t).toMatchObject({ ok: true, expiresIn: 60, role: 'operator' });
      const first = call(h, 'GET /api/incident/:id/stream', {
        params: { id },
        query: { ticket: t.ticket, clientId: 'c1' },
      });
      expect(first.res.headers['Content-Type']).toBe('text/event-stream');
      expect(sseEvents(first.res)[0]).toMatchObject({ event: 'snapshot', data: { role: 'operator' } });
      const again = call(h, 'GET /api/incident/:id/stream', {
        params: { id },
        query: { ticket: t.ticket, clientId: 'c1' },
      });
      expect(again.res.code).toBe(403);
      first.req.emit('close');
    });

    it('is bound to the incident and the client id, and refused without one or with a key', () => {
      const { id, joinKey } = create();
      const other = create();
      const t = () =>
        call(h, 'POST /api/incident/:id/ticket', {
          params: { id },
          headers: keyHeader(joinKey),
          body: { clientId: 'c1' },
        }).res.body.ticket;
      expect(
        call(h, 'GET /api/incident/:id/stream', { params: { id: other.id }, query: { ticket: t(), clientId: 'c1' } })
          .res.code,
      ).toBe(403);
      expect(
        call(h, 'GET /api/incident/:id/stream', { params: { id }, query: { ticket: t(), clientId: 'someone-else' } })
          .res.code,
      ).toBe(403);
      expect(call(h, 'GET /api/incident/:id/stream', { params: { id }, query: { key: joinKey } }).res.code).toBe(403);
    });

    it('expires after 60 s', () => {
      const realNow = Date.now;
      try {
        const { id, joinKey } = create();
        const ticket = call(h, 'POST /api/incident/:id/ticket', {
          params: { id },
          headers: keyHeader(joinKey),
          body: { clientId: 'c1' },
        }).res.body.ticket;
        const t0 = realNow();
        Date.now = () => t0 + 61 * 1000;
        expect(
          call(h, 'GET /api/incident/:id/stream', { params: { id }, query: { ticket, clientId: 'c1' } }).res.code,
        ).toBe(403);
      } finally {
        Date.now = realNow;
      }
    });
  });

  it('syncs records, fans changes out to every stream, and skips no-op writes', () => {
    const { id, joinKey } = create();
    const a = openStream(id, joinKey, 'c1');
    const b = openStream(id, joinKey, 'c2');

    const body = {
      clientId: 'c1',
      site: 'EOC',
      roster: [{ call: 'W1AW', netName: 'ARES' }],
      events: [{ id: 'e1', type: 'net_checkin', callsign: 'W1AW', summary: 'in' }],
      docs: [{ id: 'net-running', data: { name: 'ARES' }, updatedAt: 5 }],
    };
    const res = sync(id, joinKey, body);
    expect(res.body.accepted).toEqual({ roster: 1, events: 1, reports: 0, docs: 1, board: false });

    for (const s of [a, b]) {
      const change = sseEvents(s.res).find((e) => e.event === 'change');
      expect(change.data.events[0]).toMatchObject({ id: 'e1', site: 'EOC' });
      expect(change.data.docs[0]).toMatchObject({ id: 'net-running' });
      expect(change.id).toBe(res.body.seq);
    }

    const before = b.res.chunks.length;
    const again = sync(id, joinKey, { events: body.events });
    expect(again.body.accepted.events).toBe(0);
    expect(
      sseEvents(b.res)
        .slice(before)
        .filter((e) => e.event === 'change'),
    ).toHaveLength(0);
    a.req.emit('close');
    b.req.emit('close');
  });

  it('a stale shared-document write gets 409 with the current copy; the rest of the batch is applied', () => {
    const { id, joinKey } = create();
    const first = sync(id, joinKey, { docs: [{ id: 'ics-drafts', data: { v: 1 } }] }).body;
    expect(first.docRevs).toEqual({ 'ics-drafts': 1 });
    sync(id, joinKey, { docs: [{ id: 'ics-drafts', data: { v: 2 }, baseRev: 1 }] });
    const stale = sync(id, joinKey, {
      docs: [{ id: 'ics-drafts', data: { v: 'old' }, baseRev: 1 }],
      events: [{ id: 'e1', type: 'incident_note', summary: 'kept' }],
    });
    expect(stale.code).toBe(409);
    expect(stale.body.accepted.events).toBe(1);
    expect(stale.body.conflicts).toEqual([
      expect.objectContaining({
        id: 'ics-drafts',
        baseRev: 1,
        current: expect.objectContaining({ data: { v: 2 }, docRev: 2 }),
      }),
    ]);
  });

  it('operators cannot change the board; admins can', () => {
    const { id, joinKey, adminKey } = create();
    const board = { name: 'New', ic: 'W1AW', netFreq: '', notes: '', updatedAt: Date.now() + 1000 };
    const op = sync(id, joinKey, { board });
    expect(op.body.accepted.board).toBe(false);
    expect(op.body.denied).toEqual(['board']);
    expect(sync(id, adminKey, { board }).body.accepted.board).toBe(true);
  });

  describe('admin', () => {
    it('edits and deletes records, broadcasting edits and tombstones; operators are refused', () => {
      const { id, joinKey, adminKey } = create();
      sync(id, joinKey, {
        events: [
          { id: 'e1', type: 'incident_note', summary: 'typo' },
          { id: 'e2', type: 'incident_note', summary: 'gone' },
        ],
      });
      const s = openStream(id, joinKey, 'c2');
      const denied = call(h, 'POST /api/incident/:id/admin', {
        params: { id },
        headers: keyHeader(joinKey),
        body: { delete: { events: ['e2'] } },
      });
      expect(denied.res.code).toBe(403);

      const out = call(h, 'POST /api/incident/:id/admin', {
        params: { id },
        headers: keyHeader(adminKey),
        body: { edit: { events: [{ id: 'e1', summary: 'fixed' }] }, delete: { events: ['e2'] } },
      }).res.body;
      expect(out).toMatchObject({ ok: true, edited: { events: 1, reports: 0 }, deleted: 1 });
      const change = sseEvents(s.res).find((e) => e.event === 'change');
      expect(change.data.events[0]).toMatchObject({ id: 'e1', summary: 'fixed', rev: 1 });
      expect(change.data.deleted).toEqual([expect.objectContaining({ kind: 'event', id: 'e2', deleted: true })]);
      s.req.emit('close');
    });

    it('rotating the join key closes operator streams, tells admin streams the new key, and locks out the old key', () => {
      const { id, joinKey, adminKey } = create();
      const op = openStream(id, joinKey, 'op');
      const ad = openStream(id, adminKey, 'ad');
      const staleTicket = call(h, 'POST /api/incident/:id/ticket', {
        params: { id },
        headers: keyHeader(joinKey),
        body: { clientId: 'op2' },
      }).res.body.ticket;

      expect(call(h, 'POST /api/incident/:id/rotate', { params: { id }, headers: keyHeader(joinKey) }).res.code).toBe(
        403,
      );
      const out = call(h, 'POST /api/incident/:id/rotate', { params: { id }, headers: keyHeader(adminKey) }).res.body;
      expect(out).toMatchObject({ ok: true, keyGen: 2, disconnected: 1 });
      expect(out.joinKey).not.toBe(joinKey);

      expect(op.res.ended).toBe(true);
      expect(sseEvents(op.res).find((e) => e.event === 'rekeyed').data).toEqual({ keyGen: 2 });
      expect(ad.res.ended).toBe(false);
      expect(sseEvents(ad.res).find((e) => e.event === 'rekeyed').data).toEqual({ keyGen: 2, joinKey: out.joinKey });

      expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(joinKey) }).res.code).toBe(403);
      expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(out.joinKey) }).res.code).toBe(200);
      expect(
        call(h, 'GET /api/incident/:id/stream', { params: { id }, query: { ticket: staleTicket, clientId: 'op2' } }).res
          .code,
      ).toBe(403);
      ad.req.emit('close');
    });
  });

  it('resumes a stream from Last-Event-ID with only the missed records', () => {
    const { id, joinKey } = create();
    const first = sync(id, joinKey, { events: [{ id: 'e1', type: 'incident_note', summary: 'one' }] }).body.seq;
    sync(id, joinKey, { events: [{ id: 'e2', type: 'incident_note', summary: 'two' }] });
    const s = openStream(id, joinKey, 'c1', { 'last-event-id': String(first) });
    const snap = sseEvents(s.res)[0];
    expect(snap.event).toBe('snapshot');
    expect(snap.data.full).toBe(false);
    expect(snap.data.events.map((e) => e.id)).toEqual(['e2']);
    s.req.emit('close');
  });

  it('leave drops the participant and tells the other streams', () => {
    const { id, joinKey } = create();
    call(h, 'POST /api/incident/:id/join', { params: { id }, body: { key: joinKey, clientId: 'c2' } });
    const s = openStream(id, joinKey, 'c1');
    const out = call(h, 'POST /api/incident/:id/leave', { params: { id }, body: { key: joinKey, clientId: 'c2' } });
    expect(out.res.body.participants).toBe(1);
    const presence = sseEvents(s.res).filter((e) => e.event === 'presence');
    expect(presence[presence.length - 1].data.participants).toBe(1);
    s.req.emit('close');
  });

  it('lists incidents locally without exposing keys', () => {
    const { id, joinKey, adminKey } = create();
    const list = call(h, 'GET /api/incident/list').res.body;
    expect(list.incidents.map((i) => i.id)).toContain(id);
    expect(JSON.stringify(list)).not.toContain(joinKey);
    expect(JSON.stringify(list)).not.toContain(adminKey);
  });

  it('gives an admin the join key on join, read, stream and after rotation — never an operator', () => {
    const { id, joinKey, adminKey } = create();
    const j = call(h, 'POST /api/incident/:id/join', { params: { id }, headers: keyHeader(adminKey), body: {} }).res
      .body;
    expect(j.joinKey).toBe(joinKey);
    expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(adminKey) }).res.body.joinKey).toBe(
      joinKey,
    );
    const op = call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(joinKey) }).res.body;
    expect('joinKey' in op).toBe(false);
    const ad = openStream(id, adminKey, 'ad');
    expect(sseEvents(ad.res)[0].data.joinKey).toBe(joinKey);
    const os = openStream(id, joinKey, 'op');
    expect('joinKey' in sseEvents(os.res)[0].data).toBe(false);
    os.req.emit('close');
    const rot = call(h, 'POST /api/incident/:id/rotate', { params: { id }, headers: keyHeader(adminKey) }).res.body;
    expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(adminKey) }).res.body.joinKey).toBe(
      rot.joinKey,
    );
    ad.req.emit('close');
  });

  it('a deleted record stays deleted across a server restart', () => {
    const first = mount();
    const { id, joinKey, adminKey } = create();
    sync(id, joinKey, { events: [{ id: 'e1', type: 'incident_note', summary: 'mistake' }] });
    call(h, 'POST /api/incident/:id/admin', {
      params: { id },
      headers: keyHeader(adminKey),
      body: { delete: { events: ['e1'] } },
    });
    first.flushIncidents();
    mount(); // restart
    const again = sync(id, joinKey, { events: [{ id: 'e1', type: 'incident_note', summary: 'mistake' }] });
    expect(again.body.accepted.events).toBe(0);
    expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(joinKey) }).res.body.events).toEqual(
      [],
    );
  });

  it('reloads a persisted incident with both keys still valid', () => {
    const first = mount();
    const { id, joinKey, adminKey } = create();
    sync(id, joinKey, { events: [{ id: 'e1', type: 'incident_note', summary: 'kept' }] });
    first.flushIncidents();
    const raw = fs.readFileSync(process.env.INCIDENT_FILE, 'utf8');
    expect(raw).not.toContain(joinKey);
    expect(raw).not.toContain(adminKey);
    mount(); // simulated restart
    const got = call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(joinKey) });
    expect(got.res.body.events.map((e) => e.id)).toEqual(['e1']);
    expect(call(h, 'GET /api/incident/:id', { params: { id }, headers: keyHeader(adminKey) }).res.body.role).toBe(
      'admin',
    );
  });

  describe('hosted', () => {
    beforeEach(() => {
      process.env.OHC_HOSTED = '1';
      try {
        fs.unlinkSync(process.env.INCIDENT_FILE);
      } catch {}
      mount();
    });

    it('answers an unknown id and a wrong key identically and disables listing', () => {
      const { id, joinKey } = create();
      const wrongKey = call(h, 'POST /api/incident/:id/join', { params: { id }, body: { key: 'X' } }).res;
      const unknownId = call(h, 'POST /api/incident/:id/join', {
        params: { id: 'ABCDEFGH' },
        body: { key: joinKey },
      }).res;
      expect(wrongKey.code).toBe(403);
      expect(unknownId.code).toBe(403);
      expect(unknownId.body).toEqual(wrongKey.body);
      expect(call(h, 'GET /api/incident/list').res.code).toBe(403);
      expect(call(h, 'GET /api/incident').res.body).toMatchObject({
        hosted: true,
        listing: false,
        requireCallsign: true,
      });
    });

    it('needs a valid callsign and caps incidents per callsign', () => {
      expect(call(h, 'POST /api/incident', { body: { call: 'N0CALL' } }).res.code).toBe(400);
      expect(call(h, 'POST /api/incident', { body: {} }).res.code).toBe(400);
      expect(call(h, 'POST /api/incident', { body: { call: 'W1AW' }, ip: '1.1.1.1' }).res.code).toBe(200);
      expect(call(h, 'POST /api/incident', { body: { call: 'W1AW' }, ip: '2.2.2.2' }).res.code).toBe(200);
      expect(call(h, 'POST /api/incident', { body: { call: 'W1AW' }, ip: '3.3.3.3' }).res.code).toBe(429);
    });

    it('caps incident creation per address', () => {
      const calls = ['K1AAA', 'K1BBB', 'K1CCC', 'K1DDD', 'K1EEE'];
      const codes = calls.map((c) => call(h, 'POST /api/incident', { body: { call: c }, ip: '9.9.9.9' }).res.code);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
    });
  });
});
