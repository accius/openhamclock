/**
 * incidentSync — pure helpers behind useSharedIncident.
 *
 * A shared incident (server/routes/incident.js) mirrors the EmComm layout's
 * net roster, event log and field/shelter reports between browsers. All the
 * logic that decides *what* to send and *how* to fold what arrives lives here
 * so it can be tested without React, EventSource or a server:
 *
 *   - applyIncidentDelta   fold a snapshot / change event into local state,
 *                          merging by stable ids so a reconnect or a replayed
 *                          event never duplicates anything
 *   - outbox helpers       the offline buffer: queue, take a batch, ack it
 *   - diffRosterForPush    which local roster changes to send
 *   - display mergers      combine this browser's own data with the incident's
 *   - join URL helpers     `/#incident=ID&key=KEY` for the QR code / phone
 *
 * State shape (plain objects so it serialises to localStorage):
 *   { seq, board, participants, roster: { CALL: entry }, events: { id: ev }, reports: { id: report } }
 */

export const SESSION_KEY = 'openhamclock_incident';
export const OUTBOX_KEY = 'openhamclock_incidentOutbox';
export const CACHE_KEY = 'openhamclock_incidentCache';
export const CLIENT_ID_KEY = 'openhamclock_incidentClientId';

export const MAX_EVENTS = 2000;
export const MAX_CACHED_EVENTS = 500;
export const OUTBOX_LIMITS = { roster: 300, events: 500, reports: 200 };
export const STALE_MINUTES = 10;
// Check-ins taken by voice have no beacon to go quiet, so they never turn stale.
const VOICE_SOURCES = new Set(['manual', 'net-control']);

export function emptyIncidentState() {
  return { seq: 0, board: null, participants: 0, role: null, roster: {}, events: {}, reports: {}, docs: {} };
}

/**
 * Shared documents are ordered by the server (`docRev`, assigned on receipt),
 * never by client clocks. A local optimistic copy (no docRev yet) gives way
 * to any server copy; between two server copies the higher docRev wins.
 */
export function newerDoc(cur, incoming) {
  if (!cur) return true;
  if (!Number.isFinite(incoming?.docRev)) return !Number.isFinite(cur.docRev); // local over local only
  return !Number.isFinite(cur.docRev) || incoming.docRev > cur.docRev;
}

/** Keep an incoming record when it is new, or an admin edit (higher rev) of one we have. */
const newerRecord = (cur, rec) => !cur || (rec.rev || 0) > (cur.rev || 0);

/**
 * Merge a server snapshot or change event into state. Returns a new object
 * (React-friendly); untouched collections keep their identity.
 *
 * - `full: true` (a complete snapshot) replaces every collection, so records
 *   deleted while this browser was away disappear;
 * - `deleted: [{ kind, id }]` tombstones remove events / reports;
 * - an event or report with a higher `rev` (an admin edit) replaces ours;
 * - `docs` are whole shared documents, newest `updatedAt` wins.
 */
export function applyIncidentDelta(state, delta) {
  const prev = state || emptyIncidentState();
  if (!delta || typeof delta !== 'object') return prev;
  const base = delta.full
    ? { ...emptyIncidentState(), participants: prev.participants, role: prev.role, board: prev.board }
    : prev;
  const next = { ...base };

  if (Array.isArray(delta.roster) && delta.roster.length) {
    const roster = { ...base.roster };
    for (const e of delta.roster) {
      if (!e || !e.call) continue;
      const cur = roster[e.call];
      if (cur && (cur.updatedAt || 0) > (e.updatedAt || 0)) continue; // keep the newer one
      roster[e.call] = e;
    }
    next.roster = roster;
  }

  if (Array.isArray(delta.events) && delta.events.length) {
    let events = base.events;
    for (const ev of delta.events) {
      if (!ev || !ev.id || !newerRecord(events[ev.id], ev)) continue;
      if (events === base.events) events = { ...base.events };
      events[ev.id] = ev;
    }
    if (events !== base.events) next.events = capEvents(events, MAX_EVENTS);
  }

  if (Array.isArray(delta.reports) && delta.reports.length) {
    let reports = base.reports;
    for (const r of delta.reports) {
      if (!r || !r.id || !newerRecord(reports[r.id], r)) continue;
      if (reports === base.reports) reports = { ...base.reports };
      reports[r.id] = r;
    }
    next.reports = reports;
  }

  if (Array.isArray(delta.deleted) && delta.deleted.length) {
    for (const d of delta.deleted) {
      const key = d?.kind === 'event' ? 'events' : d?.kind === 'report' ? 'reports' : null;
      if (!key || !next[key][d.id]) continue;
      if (next[key] === base[key]) next[key] = { ...base[key] };
      delete next[key][d.id];
    }
  }

  if (Array.isArray(delta.docs) && delta.docs.length) {
    const docs = { ...base.docs };
    for (const d of delta.docs) {
      if (!d?.id) continue;
      const cur = docs[d.id];
      if (!newerDoc(cur, d)) continue;
      docs[d.id] = d;
    }
    next.docs = docs;
  }
  if (delta.role === 'admin' || delta.role === 'operator') next.role = delta.role;

  if (delta.board && (!base.board || (delta.board.seq || 0) >= (base.board.seq || 0))) next.board = delta.board;
  if (Number.isFinite(delta.seq)) next.seq = delta.full ? delta.seq : Math.max(base.seq || 0, delta.seq);
  if (Number.isFinite(delta.participants)) next.participants = delta.participants;
  return next;
}

function capEvents(events, max) {
  const ids = Object.keys(events);
  if (ids.length <= max) return events;
  const keep = ids
    .map((id) => events[id])
    .sort((a, b) => a.ts - b.ts)
    .slice(-max);
  return Object.fromEntries(keep.map((e) => [e.id, e]));
}

/** Events oldest first (the order the Event Log panel and exports expect). */
export function incidentEventList(state) {
  return Object.values(state?.events || {}).sort((a, b) => a.ts - b.ts || (a.seq || 0) - (b.seq || 0));
}

/** A trimmed copy for localStorage (latest events only). */
export function stateForCache(state) {
  if (!state) return null;
  return { ...state, events: capEvents(state.events || {}, MAX_CACHED_EVENTS) };
}

// ─── Roster ─────────────────────────────────────────────────────────────────

const ageMinutes = (ts, now) => Math.max(0, Math.floor((now - (ts || now)) / 60000));

/**
 * Active incident roster entries in the Net Roster panel's shape
 * ({ call, netName, status, age, stale, … }), freshest first. Manual (voice)
 * check-ins are never marked stale — there is no beacon to go quiet.
 */
export function incidentRosterList(state, now = Date.now()) {
  return Object.values(state?.roster || {})
    .filter((e) => !e.checkedOut)
    .map((e) => {
      const age = ageMinutes(e.lastHeard || e.checkinTime, now);
      return { ...e, age, stale: !VOICE_SOURCES.has(e.source) && age > STALE_MINUTES, fromIncident: true };
    })
    .sort((a, b) => a.age - b.age);
}

/**
 * Combine this server's roster (/api/aprs/net) with the incident roster.
 * The incident is the shared truth: an operator checked out there (after
 * their local check-in) is hidden even if this server still lists them;
 * operators only the incident knows about are added.
 */
export function mergeDisplayedRoster(localRoster, incidentState, now = Date.now()) {
  const inc = incidentState?.roster || {};
  const out = [];
  const seen = new Set();
  for (const op of localRoster || []) {
    if (!op?.call) continue;
    const call = String(op.call).toUpperCase();
    seen.add(call);
    const shared = inc[call];
    if (!shared) {
      out.push(op);
      continue;
    }
    if (shared.checkedOut && (shared.updatedAt || 0) >= (op.checkinTime || 0)) continue;
    // Local beacon data (position, tokens, last heard) is fresher than what was synced.
    out.push({ ...shared, ...op, status: shared.status || op.status, site: shared.site, fromIncident: true });
  }
  for (const e of incidentRosterList(incidentState, now)) {
    if (!seen.has(e.call)) out.push(e);
  }
  return out.sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
}

const rosterFingerprint = (op) =>
  JSON.stringify([op.netName || '', op.alias || '', op.status || '', op.lat ?? null, op.lon ?? null, op.tokens || []]);

/** Incident roster record from a local /api/aprs/net entry. */
export function rosterEntryForPush(op, updatedAt) {
  return {
    call: String(op.call).toUpperCase(),
    netName: op.netName || '',
    alias: op.alias || '',
    status: op.status || 'Checked in',
    checkinTime: op.checkinTime || updatedAt,
    lastHeard: op.lastHeard || updatedAt,
    lat: op.lat ?? null,
    lon: op.lon ?? null,
    tokens: Array.isArray(op.tokens) ? op.tokens : [],
    source: op.source || 'aprs',
    checkedOut: false,
    updatedAt,
  };
}

/**
 * Which local roster changes to send to the incident.
 *
 * @param {{ bootId, entries: Map }|null} prev  the previous pass (null = first pass)
 * @param {Array} localRoster  /api/aprs/net entries (plus voice-net entries)
 * @param {object} incidentState
 * @param {number} now
 * @param {string|null} bootId  /api/aprs/net `bootId` — changes when that server restarts
 * @returns {{ push: object[], next: { bootId, entries: Map } }}
 *
 * - new local check-in → pushed with updatedAt = its check-in time, so an
 *   older check-in can never override a newer check-out from another site;
 * - changed status / position / resources → pushed with updatedAt = now,
 *   unless the incident already has this operator checked out after their
 *   check-in (a remote check-out wins over local beacon noise);
 * - gone from the local roster → a check-out, unless already checked out.
 * The first pass sends every current entry (the server ignores unchanged ones).
 *
 * A server restart empties its in-memory roster. When the boot id changed
 * since the last pass, stations missing now are not checked out — the pass
 * only re-baselines. On the same boot, a roster that empties (even all at
 * once) is real and every station is checked out. Servers too old to send a
 * boot id fall back to treating a sudden total wipe as a restart.
 */
export function diffRosterForPush(prev, localRoster, incidentState, now = Date.now(), bootId = null) {
  const inc = incidentState?.roster || {};
  const prevEntries = prev?.entries || null;
  const next = new Map();
  const push = [];
  for (const op of localRoster || []) {
    if (!op?.call) continue;
    const call = String(op.call).toUpperCase();
    const fp = rosterFingerprint(op);
    next.set(call, { checkinTime: op.checkinTime || 0, fp, op });
    const before = prevEntries?.get(call);
    const shared = inc[call];
    if (!before || before.checkinTime !== (op.checkinTime || 0)) {
      push.push(rosterEntryForPush(op, op.checkinTime || now));
    } else if (before.fp !== fp) {
      if (shared?.checkedOut && (shared.updatedAt || 0) >= (op.checkinTime || 0)) continue;
      push.push(rosterEntryForPush(op, now));
    }
  }
  const restarted =
    prev && (bootId || prev.bootId) ? bootId !== prev.bootId : !!prevEntries && prevEntries.size > 1 && next.size === 0;
  if (prevEntries && !restarted) {
    for (const [call, before] of prevEntries) {
      if (next.has(call)) continue;
      const shared = inc[call];
      if (shared?.checkedOut) continue;
      push.push({
        ...rosterEntryForPush(before.op || { call }, now),
        status: 'Checked out',
        checkedOut: true,
      });
    }
  }
  return { push, next: { bootId: bootId || null, entries: next } };
}

// ─── Reports ────────────────────────────────────────────────────────────────

/** /api/emcomm/field-reports row → incident report. */
export function fieldReportForPush(r) {
  return {
    id: `field-${r.id}`,
    kind: 'field',
    callsign: r.callsign || '',
    formType: r.formType || '',
    text: r.text || '',
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    timestamp: r.timestamp || Date.now(),
    extra: r.extra || {},
  };
}

/** /api/aprs/shelters report → incident report (keyed by sender + report time). */
export function shelterReportForPush(s) {
  return {
    id: `shelter-${s.from}-${s.timestamp}`,
    kind: 'shelter',
    callsign: s.from || '',
    text: s.text || '',
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    timestamp: s.timestamp || Date.now(),
    tokens: Array.isArray(s.tokens) ? s.tokens : [],
  };
}

/** Field reports for the panel/map: local rows plus incident-only ones, with age in minutes. */
export function mergeFieldReports(localReports, incidentState, now = Date.now()) {
  const out = [...(localReports || [])];
  const have = new Set(out.map((r) => `field-${r.id}`));
  for (const r of Object.values(incidentState?.reports || {})) {
    if (r.kind !== 'field' || have.has(r.id)) continue;
    out.push({ ...r, age: ageMinutes(r.timestamp, now), fromIncident: true });
  }
  return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** Shelter reports in /api/aprs/shelters shape: local plus incident-only ones. */
export function mergeShelterReports(localReports, incidentState) {
  const out = [...(localReports || [])];
  const have = new Set(out.map((s) => `shelter-${s.from}-${s.timestamp}`));
  for (const r of Object.values(incidentState?.reports || {})) {
    if (r.kind !== 'shelter' || have.has(r.id)) continue;
    out.push({
      from: r.callsign,
      text: r.text,
      tokens: r.tokens || [],
      timestamp: r.timestamp,
      lat: r.lat,
      lon: r.lon,
      source: 'incident',
    });
  }
  return out;
}

/**
 * Messages exchanged with `call`, from the shared event log: received ones
 * (aprs_msg_rx from that station) and sent ones ("Message to <call>"), from
 * every joined site, in the message-history panel's shape. SSIDs match on the
 * base call, as the panel does for its own server's history.
 */
export function messageHistoryFromEvents(events, call) {
  const upper = String(call || '').toUpperCase();
  if (!upper) return [];
  const base = upper.split('-')[0];
  const same = (c) => {
    const u = String(c || '').toUpperCase();
    return u === upper || u.split('-')[0] === base;
  };
  const out = [];
  for (const ev of events || []) {
    if (ev.type === 'aprs_msg_rx' && same(ev.callsign)) {
      const to = String(ev.summary || '').replace(/^(Message|Bulletin) to\s+/i, '');
      out.push({
        from: ev.callsign,
        to,
        text: ev.details || '',
        timestamp: ev.ts,
        direction: 'received',
        source: 'incident',
        site: ev.site || '',
      });
    } else if (ev.type === 'aprs_msg_sent') {
      const to = String(ev.summary || '')
        .replace(/^Message to\s+/i, '')
        .trim();
      if (!same(to)) continue;
      out.push({
        from: ev.callsign,
        to: to.toUpperCase(),
        text: ev.details || '',
        timestamp: ev.ts,
        direction: 'sent',
        source: 'incident',
        site: ev.site || '',
      });
    }
  }
  return out;
}

/**
 * Merge message lists (server history, local log, shared incident) into one,
 * newest first, dropping copies of the same message (direction + text + minute).
 */
export function mergeMessageHistory(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const m of list || []) {
      const k = `${m.direction}|${m.text}|${Math.round((m.timestamp || 0) / 60000)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
  }
  return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** Local event-log entry → incident event (drops local-only bookkeeping). */
export function eventForPush(ev) {
  const out = {
    id: ev.id,
    ts: ev.ts,
    type: ev.type,
    callsign: ev.callsign || '',
    summary: ev.summary || '',
    details: ev.details || '',
  };
  if (ev.dedupeKey != null) out.dedupeKey = ev.dedupeKey;
  if (ev.ref != null) out.ref = ev.ref; // net_withdrawn → the entry it withdraws
  if (ev.msgNo != null) out.msgNo = ev.msgNo; // this station's own message number
  return out;
}

/**
 * Message numbers on a shared log. Each station numbers its own message
 * traffic (see emcommEventLog), so two sites both have a message 12. In the
 * shared log every event keeps its own number and its site:
 *
 *   - this station's events (ids also in its local log) are `own` and keep
 *     their numbers as they are — the ICS 309 is this station's log;
 *   - another site's events are marked `foreign`, are never numbered as ours,
 *     and carry `msgLabel` = "SITE:n" (or "n" without a site) for display.
 *
 * @param {Array} events     the shared log
 * @param {Set|Array} ownIds ids of this browser's own event-log entries
 */
export function annotateSharedEvents(events, ownIds) {
  const own = ownIds instanceof Set ? ownIds : new Set(ownIds || []);
  return (events || []).map((ev) => {
    if (own.has(ev.id)) return ev.foreign ? { ...ev, foreign: false, msgLabel: undefined } : ev;
    const n = Number(ev.msgNo);
    const label = Number.isInteger(n) && n > 0 ? (ev.site ? `${ev.site}:${n}` : String(n)) : '';
    return { ...ev, foreign: true, msgLabel: label };
  });
}

/** How a message number reads in the shared Event Log: own "12", another site's "EOC:12". */
export function sharedMsgLabel(ev) {
  if (ev?.foreign) return ev.msgLabel || '';
  const n = Number(ev?.msgNo);
  return Number.isInteger(n) && n > 0 ? String(n) : '';
}

// ─── Outbox (offline buffer) ────────────────────────────────────────────────

export function emptyOutbox() {
  return { roster: {}, events: {}, reports: {}, docs: {}, board: null };
}

export function outboxSize(o) {
  if (!o) return 0;
  return (
    Object.keys(o.roster || {}).length +
    Object.keys(o.events || {}).length +
    Object.keys(o.reports || {}).length +
    Object.keys(o.docs || {}).length +
    (o.board ? 1 : 0)
  );
}

function capRecord(map, max, orderKey) {
  const ids = Object.keys(map);
  if (ids.length <= max) return map;
  const keep = ids
    .map((k) => [k, map[k]])
    .sort((a, b) => (a[1][orderKey] || 0) - (b[1][orderKey] || 0))
    .slice(-max);
  return Object.fromEntries(keep);
}

/**
 * Add records to the outbox. Roster entries replace an older queued copy of
 * the same call (the newest state is all the server needs); events and
 * reports dedupe by id. Each collection is capped, oldest dropped.
 */
export function queueOutbox(outbox, { roster = [], events = [], reports = [], docs = [], board = null } = {}) {
  const o = outbox || emptyOutbox();
  const next = {
    roster: { ...o.roster },
    events: { ...o.events },
    reports: { ...o.reports },
    docs: { ...(o.docs || {}) },
    board: o.board,
  };
  for (const r of roster) {
    if (!r?.call) continue;
    const cur = next.roster[r.call];
    if (!cur || (r.updatedAt || 0) >= (cur.updatedAt || 0)) next.roster[r.call] = r;
  }
  for (const e of events) if (e?.id) next.events[e.id] = e;
  for (const r of reports) if (r?.id) next.reports[r.id] = r;
  for (const d of docs) {
    if (!d?.id) continue;
    const cur = next.docs[d.id];
    if (!cur || (d.updatedAt || 0) >= (cur.updatedAt || 0)) next.docs[d.id] = d; // only the newest copy matters
  }
  if (board && (!next.board || (board.updatedAt || 0) >= (next.board.updatedAt || 0))) next.board = board;
  next.roster = capRecord(next.roster, OUTBOX_LIMITS.roster, 'updatedAt');
  next.events = capRecord(next.events, OUTBOX_LIMITS.events, 'ts');
  next.reports = capRecord(next.reports, OUTBOX_LIMITS.reports, 'timestamp');
  return next;
}

/** The request body for POST /sync (arrays), or null when there is nothing to send. */
export function outboxBatch(outbox) {
  if (!outboxSize(outbox)) return null;
  const batch = {
    roster: Object.values(outbox.roster),
    events: Object.values(outbox.events).sort((a, b) => a.ts - b.ts),
    reports: Object.values(outbox.reports),
  };
  const docs = Object.values(outbox.docs || {});
  if (docs.length) batch.docs = docs;
  if (outbox.board) batch.board = outbox.board;
  return batch;
}

/**
 * Remove what a successful POST carried. Anything re-queued while the request
 * was in flight (a newer roster entry for the same call, a newer board) stays.
 */
export function ackOutbox(outbox, sent) {
  if (!outbox || !sent) return outbox || emptyOutbox();
  const next = {
    roster: { ...outbox.roster },
    events: { ...outbox.events },
    reports: { ...outbox.reports },
    docs: { ...(outbox.docs || {}) },
  };
  // By value, not identity: the outbox is re-read from localStorage (shared
  // by every tab), so what was sent and what is stored are different objects.
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  for (const r of sent.roster || []) if (same(next.roster[r.call], r)) delete next.roster[r.call];
  for (const d of sent.docs || []) if (same(next.docs[d.id], d)) delete next.docs[d.id];
  for (const e of sent.events || []) delete next.events[e.id];
  for (const r of sent.reports || []) delete next.reports[r.id];
  next.board = outbox.board && !same(outbox.board, sent.board) ? outbox.board : null;
  return next;
}

/** The outbox minus its shared documents (after the server refused one as too large). */
export function dropOutboxDocs(outbox) {
  return { ...(outbox || emptyOutbox()), docs: {} };
}

// ─── Join link ──────────────────────────────────────────────────────────────

/**
 * Join link for the QR code / copy button. The key rides in the fragment
 * (`#…`) so it never reaches a server log or a Referer header.
 */
export function buildJoinUrl(origin, id, key) {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/#incident=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`;
}

/** { id, key } from a join link, a bare fragment, or null. */
export function parseJoinUrl(input) {
  if (!input) return null;
  const s = String(input);
  const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s.replace(/^\?/, '');
  const params = new URLSearchParams(hash);
  const id = normaliseCode(params.get('incident'));
  const key = normaliseCode(params.get('key'));
  return id && key ? { id, key } : null;
}

/** Upper-case and strip separators people type for readability. */
export function normaliseCode(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS" (easier to read over the air). */
export function formatCode(v) {
  return (
    normaliseCode(v)
      .match(/.{1,4}/g)
      ?.join('-') || ''
  );
}

export function makeClientId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
