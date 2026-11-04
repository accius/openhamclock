/**
 * emcommEventLog — client-side session event log for EmComm operations.
 *
 * Accumulates significant events (net check-ins/outs, APRS messages sent and
 * received, new NWS alerts, shelter and field reports, first-heard EmComm
 * stations, lightning guard warnings / alarms / all-clears) into localStorage so operators can export an After Action Review
 * as CSV or a print-friendly report.
 *
 * Storage: localStorage key `openhamclock_emcommEventLog`, capped at 2000
 * events (oldest dropped first). Events carry an optional dedupe key so the
 * same real-world event (e.g. an NWS alert re-observed after a page reload)
 * is only recorded once per log lifetime.
 */
import { esc } from './escapeHtml.js';

export const STORAGE_KEY = 'openhamclock_emcommEventLog';
export const MAX_EVENTS = 2000;
/** Last message number handed out (persisted so numbers survive reloads). */
export const MSG_SEQ_KEY = 'openhamclock_emcommMsgSeq';

/**
 * Event types that are message traffic and get a station message number at
 * record time (shown in the ICS 309 Msg # columns). Alerts, first-heard
 * stations and reports are logged but not numbered.
 */
export const MESSAGE_EVENT_TYPES = new Set([
  'aprs_msg_sent',
  'aprs_msg_rx',
  'ics213_sent',
  'net_checkin',
  'net_checkout',
]);

/** Human-readable labels + colors per event type (used by UI + print export) */
export const EVENT_TYPE_META = {
  net_checkin: { label: 'Net Check-In', color: '#22c55e' },
  net_checkout: { label: 'Net Check-Out', color: '#f59e0b' },
  net_open: { label: 'Net Opened', color: '#14b8a6' },
  net_close: { label: 'Net Closed', color: '#14b8a6' },
  net_traffic: { label: 'Traffic Passed', color: '#ef4444' },
  // Compensating entry written when Net Control's Undo reverses something
  // already logged. `ref` names the event it withdraws (withdrawing a
  // withdrawal reinstates the original). Never a form row of its own.
  net_withdrawn: { label: 'Net Entry Withdrawn', color: '#6b7280', internal: true },
  // Net control removed a roster entry (wrong net name etc., #1238). Kept as
  // a row of its own: the check-in it corrects stays on the record.
  net_removed: { label: 'Removed from Roster', color: '#ef4444' },
  aprs_msg_sent: { label: 'APRS Msg Sent', color: '#22d3ee' },
  aprs_msg_rx: { label: 'APRS Msg Rcvd', color: '#3b82f6' },
  nws_alert: { label: 'NWS Alert', color: '#dc2626' },
  shelter_report: { label: 'Shelter Report', color: '#22c55e' },
  field_report: { label: 'Field Report', color: '#f472b6' },
  station_heard: { label: 'Station Heard', color: '#a855f7' },
  ics213_sent: { label: 'ICS 213 Sent', color: '#eab308' },
  lightning: { label: 'Lightning', color: '#facc15' },
  incident_note: { label: 'Incident', color: '#38bdf8' },
};

// ── In-memory state (mirrors localStorage) ──────────────────────────────────
let events = null; // lazy-loaded array, oldest first
let dedupeIndex = null; // Set of `${type}:${dedupeKey}`
const listeners = new Set();
let idCounter = 0;
let msgSeq = null; // last message number handed out (lazy-loaded)

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function load() {
  if (events) return events;
  events = [];
  dedupeIndex = new Set();
  const ls = safeStorage();
  if (ls) {
    try {
      const raw = ls.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) events = parsed.slice(-MAX_EVENTS);
      }
    } catch {
      /* corrupted store — start fresh */
    }
  }
  for (const ev of events) {
    if (ev.dedupeKey) dedupeIndex.add(`${ev.type}:${ev.dedupeKey}`);
  }
  return events;
}

function persist() {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* quota exceeded — drop oldest half and retry once */
    try {
      events = events.slice(-Math.floor(MAX_EVENTS / 2));
      ls.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      /* give up silently — log keeps working in memory */
    }
  }
}

function notify() {
  const snapshot = getEvents();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* listener errors must not break recording */
    }
  }
}

/**
 * Message number for every message-type event, keyed by event id.
 *
 * Events recorded since numbering was introduced carry `msgNo`. Older events
 * (and any whose number was lost) get one derived here: walking the log in
 * time order, a missing number is the previous number + 1. Because the
 * persisted sequence is seeded from this same walk, derived numbers never
 * collide with ones handed out later.
 *
 * Events another site logged in a shared incident (`foreign: true`, see
 * annotateSharedEvents in incidentSync.js) carry that station's own numbers
 * and are left out: they are never numbered as this station's traffic.
 * @returns {Map<string, number>}
 */
export function messageNumbers(evts) {
  const out = new Map();
  let last = 0;
  const ordered = (evts || []).filter((ev) => ev && !ev.foreign && MESSAGE_EVENT_TYPES.has(ev.type));
  ordered.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const ev of ordered) {
    const n = Number(ev.msgNo);
    const no = Number.isInteger(n) && n > 0 ? n : last + 1;
    out.set(ev.id, no);
    last = Math.max(last, no);
  }
  return out;
}

/**
 * Load the message-number sequence once per session. The stored value wins
 * whenever there is one — including 0 right after an explicit reset — so a
 * reset survives a reload. Only when nothing has ever been stored (logs from
 * before numbering existed) is the sequence seeded from the log, so legacy
 * events keep their derived numbers and new ones continue after them.
 */
function ensureMsgSeq() {
  if (msgSeq != null) return msgSeq;
  let raw = null;
  try {
    raw = safeStorage()?.getItem(MSG_SEQ_KEY) ?? null;
  } catch {
    /* unreadable — derive below */
  }
  const stored = raw == null || raw === '' ? NaN : Number(raw);
  if (Number.isInteger(stored) && stored >= 0) {
    msgSeq = stored;
  } else {
    let derivedMax = 0;
    for (const n of messageNumbers(load()).values()) derivedMax = Math.max(derivedMax, n);
    msgSeq = derivedMax;
  }
  return msgSeq;
}

function storeMsgSeq() {
  try {
    safeStorage()?.setItem(MSG_SEQ_KEY, String(msgSeq));
  } catch {
    /* number still unique for this session */
  }
}

function nextMsgNo() {
  ensureMsgSeq();
  msgSeq += 1;
  storeMsgSeq();
  return msgSeq;
}

/** The number the next message-type event will get (does not consume it). */
export function peekNextMsgNo() {
  return ensureMsgSeq() + 1;
}

/**
 * Restart station message numbering at 1. Deliberately separate from
 * clearEvents(): clearing the log between operations keeps the numbers
 * running, and only this explicit action (the UI confirms first) restarts them.
 */
export function resetMessageNumbers() {
  msgSeq = 0;
  storeMsgSeq();
  notify();
}

/** Return a copy of all events, oldest first. */
export function getEvents() {
  return load().slice();
}

/**
 * Record an event.
 * @param {string} type - one of EVENT_TYPE_META keys
 * @param {object} data - { callsign, summary, details, ts, dedupeKey, ref }
 *   ts: optional epoch ms override (defaults to now)
 *   ref: optional id of another event this one refers to (net_withdrawn)
 *   dedupeKey: optional — if an event with the same type+dedupeKey already
 *   exists in the log, recording is skipped (returns null).
 * @returns {object|null} the stored event, or null when deduped
 */
export function recordEvent(type, data = {}) {
  load();
  const { callsign = '', summary = '', details = '', ts, dedupeKey, ref } = data;
  if (dedupeKey != null) {
    const key = `${type}:${dedupeKey}`;
    if (dedupeIndex.has(key)) return null;
    dedupeIndex.add(key);
  }
  const now = Date.now();
  const ev = {
    id: `${now}-${++idCounter}`,
    ts: Number.isFinite(ts) ? ts : now,
    // When this browser wrote the entry (ts may be the event's own time) —
    // a shared incident mirrors only entries recorded after joining.
    recordedAt: now,
    type,
    callsign: String(callsign || ''),
    summary: String(summary || ''),
    details: String(details || ''),
    ...(dedupeKey != null ? { dedupeKey: String(dedupeKey) } : {}),
    ...(MESSAGE_EVENT_TYPES.has(type) ? { msgNo: nextMsgNo() } : {}),
    ...(ref != null ? { ref: String(ref) } : {}),
  };
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  persist();
  notify();
  return ev;
}

/** Clear the entire log (UI calls this after confirmation). */
export function clearEvents() {
  load();
  // Message numbers keep running across a clear: settle the sequence (seeding
  // it from the log first if it was never stored) before the events go.
  ensureMsgSeq();
  storeMsgSeq();
  events = [];
  dedupeIndex = new Set();
  persist();
  notify();
}

/**
 * Subscribe to log changes. Listener receives the full events array (copy).
 * @returns {Function} unsubscribe
 */
export function subscribeEvents(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Another tab wrote the log: drop the in-memory copy so the next read (and
 * the next recordEvent) starts from what is stored, instead of this tab
 * overwriting the other tab's entries with its older array.
 */
export function reloadFromStorage() {
  events = null;
  dedupeIndex = null;
  msgSeq = null; // re-seed from MSG_SEQ_KEY, which the other tab advanced
  notify();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) reloadFromStorage();
  });
}

// ── Withdrawn entries ───────────────────────────────────────────────────────
/**
 * Ids of events that have been withdrawn by a net_withdrawn entry. Entries
 * are applied in log order; withdrawing a withdrawal reinstates its target.
 */
export function withdrawnEventIds(evts) {
  const byId = new Map((evts || []).map((ev) => [ev.id, ev]));
  const out = new Set();
  for (const ev of (evts || []).slice().sort((a, b) => a.ts - b.ts)) {
    if (ev.type !== 'net_withdrawn' || !ev.ref) continue;
    const target = byId.get(ev.ref);
    if (target?.type === 'net_withdrawn') {
      if (target.ref) out.delete(target.ref);
    } else {
      out.add(ev.ref);
    }
  }
  return out;
}

/**
 * The log without withdrawn entries and without the withdrawal records — what
 * forms should use.
 *
 * Message numbers: net_withdrawn is not a message type, so a withdrawal record
 * never takes a number. A withdrawn check-in keeps the number it was given —
 * it is skipped on the ICS 309, leaving a gap, but later numbers do not shift
 * (numbers already read out on the air or written down stay valid). Number
 * the rows with messageNumbers() over the full log, not over activeEvents().
 */
export function activeEvents(evts) {
  const gone = withdrawnEventIds(evts);
  return (evts || []).filter((ev) => ev.type !== 'net_withdrawn' && !gone.has(ev.id));
}

/** Reset in-memory state (test helper — forces reload from localStorage). */
export function _resetForTests() {
  events = null;
  dedupeIndex = null;
  msgSeq = null;
  listeners.clear();
}

// ── Diff helper ─────────────────────────────────────────────────────────────
/**
 * Compute items newly appearing versus a previous key set.
 * @param {Set|null} prevKeys - previous snapshot's keys, or null on the very
 *   first snapshot (nothing is reported as added — baseline only).
 * @param {Array} items
 * @param {Function} keyFn - item → string key
 * @returns {{ added: Array, removed: string[], keys: Set }}
 */
export function diffAdded(prevKeys, items, keyFn) {
  const keys = new Set();
  const added = [];
  for (const item of items || []) {
    const k = keyFn(item);
    if (k == null) continue;
    keys.add(k);
    if (prevKeys && !prevKeys.has(k)) added.push(item);
  }
  const removed = [];
  if (prevKeys) {
    for (const k of prevKeys) {
      if (!keys.has(k)) removed.push(k);
    }
  }
  return { added, removed, keys };
}

// ── CSV export ──────────────────────────────────────────────────────────────
/** Escape a single CSV field per RFC 4180. */
export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize events to CSV (oldest first).
 * Columns: Time (UTC), Type, Callsign, Summary, Details
 */
export function eventsToCSV(evts) {
  const rows = ['Time (UTC),Type,Callsign,Summary,Details'];
  for (const ev of evts || []) {
    const label = EVENT_TYPE_META[ev.type]?.label || ev.type;
    rows.push([new Date(ev.ts).toISOString(), label, ev.callsign, ev.summary, ev.details].map(csvEscape).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

// ── Print / PDF export ──────────────────────────────────────────────────────
function fmtUtc(ts) {
  return new Date(ts).toISOString().replace('T', ' ').substring(0, 19) + 'Z';
}

/**
 * Build a self-contained print-friendly HTML document for the event log.
 * The caller opens a window, document.write()s this, then calls print().
 * @param {object} opts - { events, callsign, location: {lat,lon}, grid }
 */
export function buildPrintHtml(opts = {}) {
  const { events: evts = [], callsign = '', location = null, grid = '' } = opts;
  const first = evts.length ? evts[0].ts : null;
  const last = evts.length ? evts[evts.length - 1].ts : null;
  const range = first != null ? `${fmtUtc(first)} — ${fmtUtc(last)}` : 'No events recorded';
  const loc =
    location && location.lat != null && location.lon != null
      ? `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}${grid ? ` (${esc(grid)})` : ''}`
      : grid
        ? esc(grid)
        : 'Unknown';

  const rows = evts
    .map((ev) => {
      const label = EVENT_TYPE_META[ev.type]?.label || ev.type;
      return `<tr>
        <td class="mono">${fmtUtc(ev.ts)}</td>
        <td>${esc(label)}</td>
        <td class="mono">${esc(ev.callsign)}</td>
        <td>${esc(ev.summary)}${ev.details ? `<div class="detail">${esc(ev.details)}</div>` : ''}</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>EmComm Event Log — ${esc(callsign || 'Operator')}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px 0; }
  .sub { color: #555; font-size: 11px; margin-bottom: 14px; }
  table.head { border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  table.head td { padding: 2px 12px 2px 0; }
  table.head td.k { color: #555; font-weight: bold; }
  table.log { border-collapse: collapse; width: 100%; font-size: 11px; }
  table.log th { text-align: left; border-bottom: 2px solid #333; padding: 4px 8px; }
  table.log td { border-bottom: 1px solid #ddd; padding: 4px 8px; vertical-align: top; }
  .mono { font-family: "Courier New", monospace; white-space: nowrap; }
  .detail { color: #555; font-size: 10px; margin-top: 2px; }
  @media print { body { margin: 8mm; } }
</style>
</head>
<body>
<h1>EmComm Operation Event Log</h1>
<div class="sub">After Action Review — generated ${fmtUtc(Date.now())} by OpenHamClock</div>
<table class="head">
  <tr><td class="k">Operator</td><td class="mono">${esc(callsign || 'N0CALL')}</td></tr>
  <tr><td class="k">Station location</td><td class="mono">${loc}</td></tr>
  <tr><td class="k">Period (UTC)</td><td class="mono">${range}</td></tr>
  <tr><td class="k">Events</td><td class="mono">${evts.length}</td></tr>
</table>
<table class="log">
  <thead><tr><th>Time (UTC)</th><th>Type</th><th>Callsign</th><th>Event</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
}
