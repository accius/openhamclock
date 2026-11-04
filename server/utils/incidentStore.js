/**
 * incidentStore — the state model behind /api/incident/*.
 *
 * A shared incident is one operating picture that several browsers (and
 * several sites) append to: a net roster, an event log, field and shelter
 * reports, and a small free-text board (incident name, IC, net frequency,
 * notes). Every record carries a stable id chosen by the client, so a retry,
 * a reconnect or two browsers observing the same real-world event never
 * produce duplicates — merging is idempotent:
 *
 *   roster   keyed by callsign; newest `updatedAt` wins (check-out is a
 *            `checkedOut: true` update, never a delete, so late joiners see it)
 *   events   keyed by id, and additionally by `type:dedupeKey` when present
 *   reports  keyed by id
 *   board    whole-object, newest `updatedAt` wins (admin only)
 *   docs     shared working documents (ICS form drafts, the running voice
 *            net, net history) — whole-object, the last one the server
 *            receives wins (server-assigned `docRev`; client clocks only shown)
 *
 * Two keys open an incident. The join key admits an operator: append roster
 * entries, events and reports, check stations out, edit the shared documents.
 * The admin key (handed to the creator only) also edits and deletes events
 * and reports, edits the board, and rotates the join key. Edits bump a
 * record's `rev`; deletions leave a tombstone so connected clients drop the
 * record. A client whose cursor is older than the oldest kept tombstone gets
 * a full snapshot (`full: true`) instead of a delta.
 *
 * Each accepted change bumps the incident's monotonic `seq` and stamps the
 * record, so `snapshot(id, since)` returns exactly what changed after a
 * cursor and the SSE stream can resume from a Last-Event-ID.
 *
 * Everything is bounded: incidents, records per collection, participants.
 * Caps drop the oldest records; idle incidents expire after `idleMs`. The
 * hosted multi-user deployment gets tighter caps. The store is pure (no I/O,
 * injectable clock) — the route owns persistence and transport.
 */

const {
  makeIncidentId,
  makeJoinKey,
  hashJoinKey,
  verifyJoinKey,
  normaliseToken,
  isValidCallsign,
  sealJoinKey,
  openJoinKey,
} = require('./incidentAuth');

const DAY = 24 * 60 * 60 * 1000;

const HOUR = 60 * 60 * 1000;

const LIMITS = {
  local: {
    maxIncidents: 500,
    maxRoster: 300,
    maxEvents: 2000,
    maxReports: 500,
    maxParticipants: 100,
    maxDocBytes: 256 * 1024,
    requireCallsign: false, // N0CALL shacks may still create one on their own server
    maxPerCallsign: 20,
    createsPerHour: Infinity,
  },
  hosted: {
    maxIncidents: 50,
    maxRoster: 100,
    maxEvents: 500,
    maxReports: 200,
    maxParticipants: 50,
    maxDocBytes: 64 * 1024,
    requireCallsign: true,
    maxPerCallsign: 2,
    createsPerHour: 30, // across all addresses
  },
};

/** Shared working documents an incident can hold (see src/utils/incidentDocs.js). */
const DOC_IDS = new Set(['ics-drafts', 'net-running', 'net-history']);
const MAX_TOMBSTONES = 1000;

const STR_MAX = 80;
const TEXT_MAX = 500;
const NOTES_MAX = 2000;
const ID_MAX = 64;
const MAX_TOKENS = 20;
const MAX_EXTRA_KEYS = 20;
const MAX_BATCH = 200; // records per collection per apply()
const PARTICIPANT_TTL = 150 * 1000; // counted as present while heard within this window

/**
 * How long an unattended incident may sit idle before it is evicted, given
 * how full the pool is. A quiet pool keeps incidents for the full idle
 * period; a nearly full one recycles abandoned incidents much sooner so new
 * activations are not locked out. Attended incidents are never evicted.
 */
function idleLimitFor(fill, idleMs) {
  if (fill >= 1) return 10 * 60 * 1000;
  if (fill >= 0.8) return HOUR;
  if (fill >= 0.5) return Math.min(idleMs, 24 * HOUR);
  return idleMs;
}

// The EmComm Event Log's types (src/utils/emcommEventLog.js EVENT_TYPE_META) plus incident notes.
const EVENT_TYPES = new Set([
  'net_checkin',
  'net_checkout',
  'net_open',
  'net_close',
  'net_traffic',
  // Net Control's Undo: withdraws the event named by `ref` (kept below)
  'net_withdrawn',
  // A roster entry removed by net control (wrong net name etc., #1238)
  'net_removed',
  'ics213_sent',
  'aprs_msg_sent',
  'aprs_msg_rx',
  'nws_alert',
  'shelter_report',
  'field_report',
  'station_heard',
  'lightning',
  'incident_note',
]);
const REPORT_KINDS = new Set(['field', 'shelter']);

class IncidentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cleanStr = (v, max = STR_MAX) => (v == null ? '' : String(v).trim().substring(0, max));
const cleanCoord = (v, limit) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};
const cleanTs = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback);
const normCall = (v) => cleanStr(v, 20).toUpperCase();

const TOKEN_TYPES = new Set(['capacity', 'critical', 'status', 'need', 'quantity', 'text']);

/** Resource tokens as the APRS parser produces them: { key, type, current?, max?, value? }. */
function cleanTokens(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw.slice(0, MAX_TOKENS)) {
    if (!t || typeof t !== 'object') continue;
    const key = cleanStr(t.key, 20);
    if (!key) continue;
    const tok = { key, type: TOKEN_TYPES.has(t.type) ? t.type : 'text' };
    if (Number.isFinite(t.current)) tok.current = t.current;
    if (Number.isFinite(t.max)) tok.max = t.max;
    if (Number.isFinite(t.value)) tok.value = t.value;
    else if (t.value != null) tok.value = cleanStr(t.value, 40);
    out.push(tok);
  }
  return out;
}

function cleanExtra(raw) {
  const extra = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return extra;
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= MAX_EXTRA_KEYS) break;
    const key = cleanStr(k, 64);
    if (!key) continue;
    extra[key] = cleanStr(v, STR_MAX);
    count++;
  }
  return extra;
}

function sanitiseRoster(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const call = normCall(raw.call);
  if (!call) return null;
  return {
    call,
    netName: cleanStr(raw.netName, 40),
    // Net address the check-in was sent to (#1237); '' for voice / manual
    alias: cleanStr(raw.alias, 9).toUpperCase(),
    status: cleanStr(raw.status, STR_MAX) || 'Checked in',
    checkinTime: cleanTs(raw.checkinTime, now),
    lastHeard: cleanTs(raw.lastHeard, now),
    lat: cleanCoord(raw.lat, 90),
    lon: cleanCoord(raw.lon, 180),
    tokens: cleanTokens(raw.tokens),
    source: cleanStr(raw.source, 20) || 'incident',
    site: cleanStr(raw.site, 40),
    checkedOut: raw.checkedOut === true,
    updatedAt: cleanTs(raw.updatedAt, now),
  };
}

function sanitiseEvent(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanStr(raw.id, ID_MAX);
  const type = cleanStr(raw.type, 32);
  if (!id || !EVENT_TYPES.has(type)) return null;
  const ev = {
    id,
    ts: cleanTs(raw.ts, now),
    type,
    callsign: cleanStr(raw.callsign, 20).toUpperCase(),
    summary: cleanStr(raw.summary, 200),
    details: cleanStr(raw.details, TEXT_MAX),
    site: cleanStr(raw.site, 40),
  };
  if (raw.dedupeKey != null && raw.dedupeKey !== '') ev.dedupeKey = cleanStr(raw.dedupeKey, 120);
  if (raw.ref != null && raw.ref !== '') ev.ref = cleanStr(raw.ref, ID_MAX);
  // The originating station's own message number. Numbers are per station,
  // so they are kept as sent and read together with `site` (see docs/API.md).
  const msgNo = Number(raw.msgNo);
  if (Number.isInteger(msgNo) && msgNo > 0 && msgNo < 1e7) ev.msgNo = msgNo;
  return ev;
}

function sanitiseReport(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanStr(raw.id, ID_MAX);
  const kind = cleanStr(raw.kind, 10);
  if (!id || !REPORT_KINDS.has(kind)) return null;
  const callsign = normCall(raw.callsign);
  const formType = cleanStr(raw.formType, STR_MAX);
  const text = cleanStr(raw.text, TEXT_MAX);
  if (!callsign && !formType && !text) return null;
  return {
    id,
    kind,
    callsign,
    formType,
    text,
    lat: cleanCoord(raw.lat, 90),
    lon: cleanCoord(raw.lon, 180),
    timestamp: cleanTs(raw.timestamp, now),
    tokens: cleanTokens(raw.tokens),
    extra: cleanExtra(raw.extra),
    site: cleanStr(raw.site, 40),
  };
}

function sanitiseBoard(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    name: cleanStr(raw.name, STR_MAX),
    ic: cleanStr(raw.ic, STR_MAX),
    netFreq: cleanStr(raw.netFreq, 40),
    notes: cleanStr(raw.notes, NOTES_MAX),
    updatedAt: cleanTs(raw.updatedAt, now),
  };
}

// Sanitised records are built with a fixed key order, so a plain stringify
// of the copies (minus bookkeeping fields) is a stable equality check.
const sameRecord = (a, b, skip) => {
  const strip = (o) => {
    const c = { ...o };
    for (const k of skip) delete c[k];
    return JSON.stringify(c);
  };
  return strip(a) === strip(b);
};

/** A shared document's payload: any JSON value up to `maxBytes` when serialised. */
function sanitiseDoc(raw, now, maxBytes) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanStr(raw.id, 32);
  if (!DOC_IDS.has(id)) return null;
  let json;
  try {
    json = JSON.stringify(raw.data === undefined ? null : raw.data);
  } catch {
    return null;
  }
  if (json.length > maxBytes) throw new IncidentError(413, `Shared document "${id}" is larger than ${maxBytes} bytes`);
  return {
    id,
    data: JSON.parse(json),
    updatedAt: cleanTs(raw.updatedAt, now),
    by: cleanStr(raw.by, 20).toUpperCase(),
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.hosted] - tighter caps for the shared multi-user deployment
 * @param {number} [opts.idleMs] - incidents with no activity for this long expire (default 7 days)
 * @param {Function} [opts.now] - clock (tests)
 * @param {object} [opts.limits] - override any LIMITS field
 */
function createIncidentStore(opts = {}) {
  const hosted = !!opts.hosted;
  const limits = { ...(hosted ? LIMITS.hosted : LIMITS.local), ...(opts.limits || {}) };
  const idleMs = opts.idleMs ?? 7 * DAY;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  const incidents = new Map(); // id → incident
  const DUMMY_AUTH = hashJoinKey(makeJoinKey());
  let createTimes = []; // creation timestamps within the last hour (global create rate)

  const touch = (inc) => {
    inc.lastActivity = now();
  };

  const rebuildDedupe = (inc) => {
    inc.eventDedupe = new Set();
    for (const ev of inc.events.values()) if (ev.dedupeKey) inc.eventDedupe.add(`${ev.type}:${ev.dedupeKey}`);
  };

  /** Keep a Map at or under `max` entries by dropping the "oldest" per `orderKey`. */
  const capMap = (map, max, orderKey) => {
    if (map.size <= max) return;
    const victims = [...map.values()].sort((a, b) => a[orderKey] - b[orderKey]).slice(0, map.size - max);
    for (const v of victims) map.delete(v.id ?? v.call);
  };

  const capRoster = (inc) => {
    if (inc.roster.size <= limits.maxRoster) return;
    // Checked-out operators go first, then the longest-unheard.
    const victims = [...inc.roster.values()]
      .sort((a, b) => (a.checkedOut === b.checkedOut ? a.updatedAt - b.updatedAt : a.checkedOut ? -1 : 1))
      .slice(0, inc.roster.size - limits.maxRoster);
    for (const v of victims) inc.roster.delete(v.call);
  };

  const emptyIncident = (fields) => ({
    roster: new Map(),
    events: new Map(),
    reports: new Map(),
    docs: new Map(),
    tombstones: [], // [{ kind, id, seq }], oldest first
    tombFloor: 0, // a cursor below this missed pruned tombstones → full snapshot
    eventDedupe: new Set(),
    participants: new Map(),
    keyGen: 1,
    ...fields,
  });

  function addTombstone(inc, kind, id) {
    inc.tombstones.push({ kind, id, seq: ++inc.seq, deleted: true });
    if (inc.tombstones.length > MAX_TOMBSTONES) {
      const dropped = inc.tombstones.splice(0, inc.tombstones.length - MAX_TOMBSTONES);
      inc.tombFloor = dropped[dropped.length - 1].seq;
    }
    return inc.tombstones[inc.tombstones.length - 1];
  }

  function meta(inc) {
    return {
      id: inc.id,
      createdAt: inc.createdAt,
      lastActivity: inc.lastActivity,
      seq: inc.seq,
      board: inc.board,
      participants: participantCount(inc),
      counts: {
        roster: [...inc.roster.values()].filter((r) => !r.checkedOut).length,
        events: inc.events.size,
        reports: inc.reports.size,
      },
    };
  }

  function participantCount(inc) {
    const cutoff = now() - PARTICIPANT_TTL;
    let n = 0;
    for (const p of inc.participants.values()) if (p.lastSeen >= cutoff) n++;
    return n;
  }

  function mustGet(id) {
    const inc = incidents.get(normaliseToken(id));
    if (!inc) throw new IncidentError(404, 'Unknown or expired incident');
    return inc;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Evict unattended incidents that have been idle longer than the pool's
   * fill level allows (idleLimitFor). Returns the ids dropped.
   */
  function relievePressure() {
    const limit = idleLimitFor(incidents.size / limits.maxIncidents, idleMs);
    if (limit >= idleMs) return [];
    const cutoff = now() - limit;
    const victims = [...incidents.values()]
      .filter((inc) => inc.lastActivity < cutoff && participantCount(inc) === 0)
      .sort((a, b) => a.lastActivity - b.lastActivity);
    const dropped = [];
    for (const inc of victims) {
      if (idleLimitFor(incidents.size / limits.maxIncidents, idleMs) >= idleMs) break;
      incidents.delete(inc.id);
      dropped.push(inc.id);
    }
    return dropped;
  }

  /**
   * @param {object} input  board fields
   * @param {object} [who]  { call } — the creating station
   * @returns {{ incident, joinKey, adminKey }}
   */
  function create(input = {}, who = {}) {
    const call = normCall(who.call);
    if (limits.requireCallsign && !isValidCallsign(call)) {
      throw new IncidentError(400, 'Creating an incident here needs your callsign (Settings → Station)');
    }
    if (call && [...incidents.values()].filter((i) => i.creatorCall === call).length >= limits.maxPerCallsign) {
      throw new IncidentError(429, `${call} already has ${limits.maxPerCallsign} open incident(s) on this server`);
    }
    const t = now();
    createTimes = createTimes.filter((x) => x > t - HOUR);
    if (createTimes.length >= limits.createsPerHour) {
      throw new IncidentError(429, 'This server is creating incidents too fast, try again in a few minutes');
    }
    relievePressure();
    if (incidents.size >= limits.maxIncidents) throw new IncidentError(503, 'Incident limit reached, try again later');
    let id = makeIncidentId();
    for (let i = 0; i < 20 && incidents.has(id); i++) id = makeIncidentId();
    if (incidents.has(id)) throw new IncidentError(500, 'Could not allocate an incident id');
    const joinKey = makeJoinKey();
    let adminKey = makeJoinKey();
    while (adminKey === joinKey) adminKey = makeJoinKey();
    const board = sanitiseBoard(input, t) || sanitiseBoard({}, t);
    const inc = emptyIncident({
      id,
      createdAt: t,
      lastActivity: t,
      creatorCall: call,
      seq: 1,
      auth: hashJoinKey(joinKey),
      adminAuth: hashJoinKey(adminKey),
      // The join key, readable only with the admin key (see sealJoinKey).
      joinSeal: sealJoinKey(joinKey, adminKey),
      board: { ...board, updatedAt: t, seq: 1 },
    });
    incidents.set(id, inc);
    createTimes.push(t);
    return { incident: meta(inc), joinKey, adminKey };
  }

  /**
   * Check a key against both hashes (always both, so timing does not say
   * which one matched or whether the id exists).
   * An admin also gets the current join key, unsealed with their admin key
   * (null for incidents created before join keys were sealed).
   * @returns {{ incident: object, role: 'admin'|'operator', keyGen: number, joinKey?: string|null } | null}
   */
  function verify(id, key) {
    const inc = incidents.get(normaliseToken(id));
    const auth = inc?.auth || DUMMY_AUTH;
    const adminAuth = inc?.adminAuth || DUMMY_AUTH;
    const isAdmin = verifyJoinKey(key, adminAuth.salt, adminAuth.hash);
    const isOperator = verifyJoinKey(key, auth.salt, auth.hash);
    if (!inc || (!isAdmin && !isOperator)) return null;
    if (isAdmin) return { incident: inc, role: 'admin', keyGen: inc.keyGen, joinKey: openJoinKey(inc.joinSeal, key) };
    return { incident: inc, role: 'operator', keyGen: inc.keyGen };
  }

  /**
   * Replace the join key; everyone holding the old one must rejoin. With the
   * admin key the new join key is sealed for later admin reads. → the new key
   */
  function rotateJoinKey(id, adminKey = null) {
    const inc = mustGet(id);
    const joinKey = makeJoinKey();
    inc.auth = hashJoinKey(joinKey);
    inc.joinSeal = adminKey ? sealJoinKey(joinKey, adminKey) : null;
    inc.keyGen += 1;
    touch(inc);
    return { joinKey, keyGen: inc.keyGen };
  }

  const keyGenOf = (id) => incidents.get(normaliseToken(id))?.keyGen ?? null;
  const has = (id) => incidents.has(normaliseToken(id));
  const get = (id) => incidents.get(normaliseToken(id)) || null;

  function list() {
    return [...incidents.values()].map(meta).sort((a, b) => b.lastActivity - a.lastActivity);
  }

  function touchParticipant(id, clientId, call) {
    const inc = mustGet(id);
    const cid = cleanStr(clientId, 40);
    if (!cid) return participantCount(inc);
    const existing = inc.participants.get(cid);
    inc.participants.set(cid, { clientId: cid, call: normCall(call) || existing?.call || '', lastSeen: now() });
    touch(inc); // someone attending keeps the incident alive
    if (inc.participants.size > limits.maxParticipants) {
      const oldest = [...inc.participants.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
      inc.participants.delete(oldest.clientId);
    }
    return participantCount(inc);
  }

  function removeParticipant(id, clientId) {
    const inc = incidents.get(normaliseToken(id));
    if (!inc) return 0;
    inc.participants.delete(cleanStr(clientId, 40));
    return participantCount(inc);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Merge a batch of client records. Returns only what actually changed, each
   * record stamped with its new seq, so the caller can fan it out verbatim.
   * The board is only taken from an admin (`origin.role === 'admin'`).
   */
  function apply(id, batch = {}, origin = {}) {
    const inc = mustGet(id);
    const t = now();
    const site = cleanStr(origin.site, 40);
    const changes = { roster: [], events: [], reports: [], docs: [], board: null };
    const denied = [];
    const withSite = (rec) => (site && !rec.site ? { ...rec, site } : rec);

    for (const raw of (Array.isArray(batch.roster) ? batch.roster : []).slice(0, MAX_BATCH)) {
      const entry = sanitiseRoster(raw, t);
      if (!entry) continue;
      const existing = inc.roster.get(entry.call);
      if (existing) {
        // A record sent without its timestamps keeps the stored ones, so a
        // bare replay is a no-op rather than a fresh check-in.
        if (!Number.isFinite(raw.checkinTime)) entry.checkinTime = existing.checkinTime;
        if (!Number.isFinite(raw.lastHeard)) entry.lastHeard = existing.lastHeard;
        if (!Number.isFinite(raw.updatedAt)) entry.updatedAt = Math.max(entry.updatedAt, existing.updatedAt);
        if (entry.updatedAt < existing.updatedAt) continue;
        if (sameRecord(existing, entry, ['seq', 'updatedAt'])) continue;
      }
      const rec = { ...withSite(entry), seq: ++inc.seq };
      inc.roster.set(rec.call, rec);
      changes.roster.push(rec);
    }
    capRoster(inc);

    const deletedIds = (kind) => new Set(inc.tombstones.filter((x) => x.kind === kind).map((x) => x.id));
    const deletedEvents = deletedIds('event');
    for (const raw of (Array.isArray(batch.events) ? batch.events : []).slice(0, MAX_BATCH)) {
      const ev = sanitiseEvent(raw, t);
      if (!ev || inc.events.has(ev.id) || deletedEvents.has(ev.id)) continue; // a deleted record stays deleted
      const dk = ev.dedupeKey ? `${ev.type}:${ev.dedupeKey}` : null;
      if (dk && inc.eventDedupe.has(dk)) continue;
      const rec = { ...withSite(ev), seq: ++inc.seq };
      inc.events.set(rec.id, rec);
      if (dk) inc.eventDedupe.add(dk);
      changes.events.push(rec);
    }
    if (inc.events.size > limits.maxEvents) {
      capMap(inc.events, limits.maxEvents, 'ts');
      rebuildDedupe(inc);
    }

    const deletedReports = deletedIds('report');
    for (const raw of (Array.isArray(batch.reports) ? batch.reports : []).slice(0, MAX_BATCH)) {
      const r = sanitiseReport(raw, t);
      if (!r || inc.reports.has(r.id) || deletedReports.has(r.id)) continue;
      const rec = { ...withSite(r), seq: ++inc.seq };
      inc.reports.set(rec.id, rec);
      changes.reports.push(rec);
    }
    capMap(inc.reports, limits.maxReports, 'timestamp');

    const docConflicts = [];
    for (const raw of (Array.isArray(batch.docs) ? batch.docs : []).slice(0, DOC_IDS.size)) {
      const doc = sanitiseDoc(raw, t, limits.maxDocBytes);
      if (!doc) continue;
      const existing = inc.docs.get(doc.id);
      // Ordered by when the server receives them, never by client clocks
      // (a site whose clock runs slow must still be able to save). The
      // client's updatedAt is kept for display only.
      if (existing && JSON.stringify(existing.data) === JSON.stringify(doc.data)) continue;
      // Conditional write: a copy made from an older revision than the one
      // stored (an hour-old draft flushed after a long time offline) must not
      // silently replace newer edits. It is refused, with the current copy,
      // and the writer decides. A write without baseRev is unconditional.
      const baseRev = Number(raw.baseRev);
      if (existing && raw.baseRev != null && Number.isFinite(baseRev) && baseRev < (existing.docRev || 0)) {
        docConflicts.push({ id: doc.id, baseRev, current: existing });
        continue;
      }
      const rec = { ...doc, docRev: (existing?.docRev || 0) + 1, receivedAt: t, seq: ++inc.seq };
      inc.docs.set(doc.id, rec);
      changes.docs.push(rec);
    }

    const board = sanitiseBoard(batch.board, t);
    if (board && origin.role !== 'admin') denied.push('board');
    else if (board && board.updatedAt > (inc.board.updatedAt || 0)) {
      if (!sameRecord(inc.board, board, ['seq', 'updatedAt'])) {
        inc.board = { ...board, seq: ++inc.seq };
        changes.board = inc.board;
      } else {
        inc.board.updatedAt = board.updatedAt;
      }
    }

    const changed =
      changes.roster.length || changes.events.length || changes.reports.length || changes.docs.length || changes.board;
    if (changed) touch(inc);
    return { seq: inc.seq, changed: !!changed, changes, denied, docConflicts };
  }

  /**
   * Admin: edit existing events / reports in place and/or delete them.
   * @param {object} ops  { edit: { events:[{id,…fields}], reports:[…] }, delete: { events:[ids], reports:[ids], board: bool } }
   * @returns {{ seq, changed, changes: { events, reports, board, deleted:[{kind,id,seq}] } }}
   */
  function adminChange(id, ops = {}) {
    const inc = mustGet(id);
    const t = now();
    const changes = { events: [], reports: [], board: null, deleted: [] };
    const edit = ops.edit || {};
    const del = ops.delete || {};

    for (const raw of (Array.isArray(edit.events) ? edit.events : []).slice(0, MAX_BATCH)) {
      const cur = inc.events.get(cleanStr(raw?.id, ID_MAX));
      if (!cur) continue;
      const next = sanitiseEvent({ ...cur, ...raw, id: cur.id, type: raw.type ?? cur.type }, t);
      if (!next) continue;
      const rec = { ...next, site: cur.site, rev: (cur.rev || 0) + 1, editedAt: t, seq: ++inc.seq };
      inc.events.set(rec.id, rec);
      changes.events.push(rec);
    }
    for (const raw of (Array.isArray(edit.reports) ? edit.reports : []).slice(0, MAX_BATCH)) {
      const cur = inc.reports.get(cleanStr(raw?.id, ID_MAX));
      if (!cur) continue;
      const next = sanitiseReport({ ...cur, ...raw, id: cur.id, kind: cur.kind }, t);
      if (!next) continue;
      const rec = { ...next, site: cur.site, rev: (cur.rev || 0) + 1, editedAt: t, seq: ++inc.seq };
      inc.reports.set(rec.id, rec);
      changes.reports.push(rec);
    }
    for (const raw of (Array.isArray(del.events) ? del.events : []).slice(0, MAX_BATCH)) {
      const key = cleanStr(raw, ID_MAX);
      if (!inc.events.delete(key)) continue;
      changes.deleted.push(addTombstone(inc, 'event', key));
    }
    for (const raw of (Array.isArray(del.reports) ? del.reports : []).slice(0, MAX_BATCH)) {
      const key = cleanStr(raw, ID_MAX);
      if (!inc.reports.delete(key)) continue;
      changes.deleted.push(addTombstone(inc, 'report', key));
    }
    if (changes.deleted.some((d) => d.kind === 'event')) rebuildDedupe(inc);
    if (del.board === true) {
      inc.board = { ...sanitiseBoard({}, t), seq: ++inc.seq };
      changes.board = inc.board;
    }
    const changed = changes.events.length || changes.reports.length || changes.deleted.length || changes.board;
    if (changed) touch(inc);
    return { seq: inc.seq, changed: !!changed, changes };
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Full state (`full: true`), or only what changed after `since` — records
   * with a newer seq and tombstones for anything deleted since then. A cursor
   * older than the oldest kept tombstone gets the full state.
   */
  function snapshot(id, since = 0) {
    const inc = mustGet(id);
    const full = !(since > 0) || since < inc.tombFloor;
    const cursor = full ? 0 : since;
    const after = (rec) => rec.seq > cursor;
    return {
      ...meta(inc),
      since: cursor,
      full,
      board: inc.board.seq > cursor ? inc.board : null,
      roster: [...inc.roster.values()].filter(after),
      events: [...inc.events.values()].filter(after).sort((a, b) => a.ts - b.ts),
      reports: [...inc.reports.values()].filter(after),
      docs: [...inc.docs.values()].filter(after),
      deleted: full ? [] : inc.tombstones.filter(after),
    };
  }

  /** Drop incidents idle past `idleMs`, plus unattended ones under pool pressure. → count */
  function expire(at = now()) {
    const cutoff = at - idleMs;
    let dropped = 0;
    for (const [id, inc] of incidents) {
      if (inc.lastActivity < cutoff) {
        incidents.delete(id);
        dropped++;
      }
    }
    return dropped + relievePressure().length;
  }

  const remove = (id) => incidents.delete(normaliseToken(id));

  /**
   * Plain JSON for the persistence file. Participants and tickets are
   * ephemeral; tombstones are kept (bounded) so a restart cannot bring a
   * deleted record back.
   */
  function serialise() {
    return [...incidents.values()].map((inc) => ({
      id: inc.id,
      createdAt: inc.createdAt,
      lastActivity: inc.lastActivity,
      creatorCall: inc.creatorCall || '',
      seq: inc.seq,
      keyGen: inc.keyGen,
      auth: inc.auth,
      adminAuth: inc.adminAuth || null,
      joinSeal: inc.joinSeal || null,
      tombstones: inc.tombstones,
      tombFloor: inc.tombFloor,
      board: inc.board,
      roster: [...inc.roster.values()],
      events: [...inc.events.values()],
      reports: [...inc.reports.values()],
      docs: [...inc.docs.values()],
    }));
  }

  const keepEditMeta = (src, rec) => ({
    ...rec,
    seq: src.seq || 0,
    ...(Number.isFinite(src.rev) ? { rev: src.rev, editedAt: src.editedAt } : {}),
  });

  /** Load what serialise() wrote; malformed entries are skipped, caps re-applied. */
  function hydrate(data) {
    if (!Array.isArray(data)) return 0;
    let loaded = 0;
    for (const raw of data) {
      if (incidents.size >= limits.maxIncidents) break;
      if (!raw || typeof raw.id !== 'string' || !raw.auth?.salt || !raw.auth?.hash) continue;
      const t = now();
      const seq = Number.isFinite(raw.seq) ? raw.seq : 1;
      const inc = emptyIncident({
        id: raw.id,
        createdAt: cleanTs(raw.createdAt, t),
        lastActivity: cleanTs(raw.lastActivity, t),
        creatorCall: normCall(raw.creatorCall),
        seq,
        keyGen: Number.isFinite(raw.keyGen) ? raw.keyGen : 1,
        // Older files had no tombstones: every client resyncs fully once.
        tombFloor: Array.isArray(raw.tombstones) && Number.isFinite(raw.tombFloor) ? raw.tombFloor : seq,
        tombstones: (Array.isArray(raw.tombstones) ? raw.tombstones : [])
          .filter((x) => x && (x.kind === 'event' || x.kind === 'report') && typeof x.id === 'string')
          .slice(-MAX_TOMBSTONES)
          .map((x) => ({ kind: x.kind, id: cleanStr(x.id, ID_MAX), seq: Number(x.seq) || 0, deleted: true })),
        joinSeal:
          raw.joinSeal && typeof raw.joinSeal === 'object'
            ? {
                salt: String(raw.joinSeal.salt || ''),
                iv: String(raw.joinSeal.iv || ''),
                ct: String(raw.joinSeal.ct || ''),
                tag: String(raw.joinSeal.tag || ''),
              }
            : null,
        auth: { salt: String(raw.auth.salt), hash: String(raw.auth.hash) },
        adminAuth:
          raw.adminAuth?.salt && raw.adminAuth?.hash
            ? { salt: String(raw.adminAuth.salt), hash: String(raw.adminAuth.hash) }
            : null,
        board: { ...(sanitiseBoard(raw.board, t) || sanitiseBoard({}, t)), seq: raw.board?.seq || 1 },
      });
      for (const r of Array.isArray(raw.roster) ? raw.roster : []) {
        const e = sanitiseRoster(r, t);
        if (e) inc.roster.set(e.call, { ...e, seq: r.seq || 0 });
      }
      for (const r of Array.isArray(raw.events) ? raw.events : []) {
        const e = sanitiseEvent(r, t);
        if (e && !inc.events.has(e.id)) inc.events.set(e.id, keepEditMeta(r, e));
      }
      for (const r of Array.isArray(raw.reports) ? raw.reports : []) {
        const e = sanitiseReport(r, t);
        if (e && !inc.reports.has(e.id)) inc.reports.set(e.id, keepEditMeta(r, e));
      }
      for (const r of Array.isArray(raw.docs) ? raw.docs : []) {
        try {
          const d = sanitiseDoc(r, t, limits.maxDocBytes);
          if (d) {
            inc.docs.set(d.id, {
              ...d,
              docRev: Number.isFinite(r.docRev) ? r.docRev : 1,
              receivedAt: cleanTs(r.receivedAt, t),
              seq: r.seq || 0,
            });
          }
        } catch {
          /* over the (possibly lowered) size cap — drop it */
        }
      }
      capRoster(inc);
      capMap(inc.events, limits.maxEvents, 'ts');
      capMap(inc.reports, limits.maxReports, 'timestamp');
      rebuildDedupe(inc);
      incidents.set(inc.id, inc);
      loaded++;
    }
    return loaded;
  }

  return {
    limits,
    hosted,
    create,
    verify,
    rotateJoinKey,
    keyGenOf,
    has,
    get,
    list,
    meta: (id) => meta(mustGet(id)),
    touchParticipant,
    removeParticipant,
    apply,
    adminChange,
    snapshot,
    expire,
    relievePressure,
    remove,
    serialise,
    hydrate,
    get size() {
      return incidents.size;
    },
  };
}

module.exports = {
  createIncidentStore,
  IncidentError,
  LIMITS,
  EVENT_TYPES,
  REPORT_KINDS,
  DOC_IDS,
  PARTICIPANT_TTL,
  idleLimitFor,
  sanitiseRoster,
  sanitiseEvent,
  sanitiseReport,
  sanitiseBoard,
  sanitiseDoc,
};
