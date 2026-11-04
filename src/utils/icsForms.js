/**
 * icsForms — data model, row builders, CSV and print-HTML for the ICS Forms
 * panel (EmComm layout operations rail + dockable `ics-forms`).
 *
 * Four standard incident forms are generated from what the app already
 * records, so the paperwork an EOC or served agency asks for at the end of
 * a shift is a print dialog away instead of a transcription job:
 *
 *   ICS 309  Communications Log   — rows from the EmComm event log
 *   ICS 214  Activity Log         — rows imported from the event log, plus
 *                                    free-text rows typed by the operator
 *   ICS 213  General Message      — composed here; optionally sent as one
 *                                    or more 67-character APRS messages
 *   ICS 205  Incident Radio Communications Plan — channels picked from the
 *                                    Repeaters panel and the Net Schedule,
 *                                    plus manually added simplex rows
 *
 * Block numbering and column headings follow the published forms (the
 * ICS 309 is the 8-block communications-unit layout with FROM/TO call
 * sign and message-number columns; 213, 214 and 205 follow the FEMA
 * ICS Forms Booklet). All times are UTC and shown in 24-hour HHMM form —
 * EmComm logs are kept in UTC so stations in different zones agree.
 *
 * Everything here is pure (no DOM, no React): the panel keeps a draft
 * object (persisted in localStorage under ICS_DRAFTS_KEY) and calls these
 * helpers to derive rows, CSV and the print document.
 */
import { esc } from './escapeHtml.js';
import { EVENT_TYPE_META, csvEscape, messageNumbers, activeEvents } from './emcommEventLog.js';
import { parseNetFrequency, formatOffset } from './netControl.js';

export const ICS_DRAFTS_KEY = 'openhamclock_icsForms';
/** Maximum APRS message text length (bytes after the addressee field). */
export const APRS_MSG_MAX = 67;
/** Rows per printed page, chosen so a page of each form fits US Letter/A4. */
export const ICS309_ROWS_PER_PAGE = 28;
export const ICS214_ROWS_PER_PAGE = 24;
export const ICS205_ROWS_PER_PAGE = 16;

export const ICS_FORM_IDS = ['309', '214', '213', '205'];
export const ICS_FORM_TITLES = {
  309: 'ICS 309 Communications Log',
  214: 'ICS 214 Activity Log',
  213: 'ICS 213 General Message',
  205: 'ICS 205 Incident Radio Communications Plan',
};

// ── UTC time helpers ────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' (UTC). */
export function utcDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 'HHMM' 24-hour (UTC). */
export function utcTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD HHMM' (UTC). */
export function utcDateTime(ts) {
  const d = utcDate(ts);
  return d ? `${d} ${utcTime(ts)}` : '';
}

/**
 * Value for an <input type="datetime-local"> holding a UTC wall time:
 * 'YYYY-MM-DDTHH:MM'. We deliberately treat the input as UTC (the label
 * says so) rather than browser-local time.
 */
export function toInputDateTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${utcDate(ts)}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Parse 'YYYY-MM-DDTHH:MM' (or with seconds) as UTC → epoch ms, or null. */
export function fromInputDateTime(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str || '').trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  return Number.isFinite(ms) ? ms : null;
}

/** 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DD HHMM' for printing; passes through other text. */
export function inputToPrintDateTime(str) {
  const ms = fromInputDateTime(str);
  return ms == null ? String(str || '') : utcDateTime(ms);
}

// ── Drafts (persisted form state) ───────────────────────────────────────────
let idCounter = 0;
/** Unique-enough id for editable rows. */
export function newRowId() {
  return `${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
}

/**
 * Fresh draft set. `header` is shared by every form (incident name,
 * operational period, who prepared it) so the operator types it once.
 */
/**
 * Draft format version. Stored drafts older than this are migrated once in
 * mergeDrafts():
 *   v1 → v2  tick `net_traffic` in the 309's event types (it became a default
 *            after drafts had already saved their own type list).
 *   v2 → v3  tick `net_removed` (roster removals, #1238) the same way.
 */
export const DRAFTS_VERSION = 3;

/** One-time upgrades of a stored draft's 309 type list. Pure; returns a new array. */
export function migrateIcs309Types(types, fromVersion) {
  const list = Array.isArray(types) ? [...types] : null;
  if (!list) return list;
  if (fromVersion < 2 && !list.includes('net_traffic')) list.push('net_traffic');
  if (fromVersion < 3 && !list.includes('net_removed')) list.push('net_removed');
  return list;
}

export function defaultDrafts(now = Date.now()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return {
    version: DRAFTS_VERSION,
    header: {
      incidentName: '',
      periodFrom: toInputDateTime(start.getTime()),
      periodTo: toInputDateTime(now),
      preparedBy: '',
      preparedCall: '',
      // 'en' prints the FEMA wording; 'ui' prints labels in the interface language
      printLang: 'en',
    },
    ics309: {
      netName: '',
      operatorName: '',
      operatorCall: '',
      types: [...ICS309_DEFAULT_TYPES],
      // First message number for this operational period ('' = the station's running numbers)
      startNumber: '',
      edits: {}, // event row id → changed fields
      removed: [], // event row ids hidden from the log
      manual: [], // rows typed by the operator
    },
    ics214: {
      name: '',
      icsPosition: '',
      homeAgency: '',
      resources: [],
      rows: [],
    },
    ics213: {
      to: '',
      toCall: '',
      from: '',
      subject: '',
      dateTime: toInputDateTime(now),
      message: '',
      approvedBy: '',
      approvedPosition: '',
      reply: '',
      repliedBy: '',
      repliedDateTime: '',
      sendState: null, // per-part APRS send tracking (newSendState)
    },
    ics205: {
      rows: [],
      specialInstructions: '',
    },
  };
}

/** Deep-ish merge of a stored draft over the defaults (tolerates old shapes). */
export function mergeDrafts(stored, now = Date.now()) {
  const base = defaultDrafts(now);
  if (!stored || typeof stored !== 'object') return base;
  const out = {};
  for (const key of Object.keys(base)) {
    const s = stored[key];
    out[key] = s && typeof s === 'object' ? { ...base[key], ...s } : base[key];
  }
  // Drafts saved before versioning count as v1
  const storedVersion = Number.isInteger(stored.version) && stored.version > 0 ? stored.version : 1;
  if (Array.isArray(out.ics309.types)) out.ics309.types = migrateIcs309Types(out.ics309.types, storedVersion);
  out.version = DRAFTS_VERSION;
  if (!Array.isArray(out.ics214.resources)) out.ics214.resources = [];
  if (!Array.isArray(out.ics214.rows)) out.ics214.rows = [];
  if (!Array.isArray(out.ics205.rows)) out.ics205.rows = [];
  if (!Array.isArray(out.ics309.types)) out.ics309.types = [...ICS309_DEFAULT_TYPES];
  if (!Array.isArray(out.ics309.manual)) out.ics309.manual = [];
  if (!Array.isArray(out.ics309.removed)) out.ics309.removed = [];
  if (!out.ics309.edits || typeof out.ics309.edits !== 'object' || Array.isArray(out.ics309.edits))
    out.ics309.edits = {};
  if (out.header.printLang !== 'ui') out.header.printLang = 'en';
  return out;
}

export function loadDrafts(now = Date.now()) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ICS_DRAFTS_KEY) : null;
    return mergeDrafts(raw ? JSON.parse(raw) : null, now);
  } catch {
    return defaultDrafts(now);
  }
}

export function saveDrafts(drafts) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ICS_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* quota / private mode — the draft lives on in memory */
  }
}

// ── Event-log range filter ──────────────────────────────────────────────────
/**
 * Events inside [from, to] (epoch ms, either may be null = open-ended),
 * oldest first.
 */
export function eventsInRange(events, { from = null, to = null } = {}) {
  // Entries withdrawn by Net Control's Undo (and the withdrawal records
  // themselves) never reach a form.
  return activeEvents(events)
    .filter((ev) => Number.isFinite(ev?.ts) && (from == null || ev.ts >= from) && (to == null || ev.ts <= to))
    .slice()
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Range from the shared header's operational period (UTC inputs). The inputs
 * have minute resolution, so the end is inclusive of its whole minute.
 */
export function headerRange(header) {
  const to = fromInputDateTime(header?.periodTo);
  return { from: fromInputDateTime(header?.periodFrom), to: to == null ? null : to + 59999 };
}

// ── Print-label translation ─────────────────────────────────────────────────
/**
 * Every label on a printed form goes through a translate function
 * `tr(key, { defaultValue, ...vars })` (i18next's `t` signature). Keys live
 * under `icsForms.print.*`; the English defaultValue is the FEMA wording.
 * The pure default below just interpolates the English text, so the
 * builders work (and test) without i18next.
 */
export function defaultTr(_key, opts = {}) {
  const text = opts.defaultValue != null ? String(opts.defaultValue) : '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : ''));
}

const L = (tr, key, def, vars = {}) => (tr || defaultTr)(`icsForms.print.${key}`, { defaultValue: def, ...vars });

// ── ICS 309 Communications Log ──────────────────────────────────────────────
/**
 * Event types that are message traffic and belong on a Comm Log by default.
 * NWS alerts and first-heard stations are situational awareness rather than
 * traffic handled by the operator, so they are opt-in.
 */
export const ICS309_DEFAULT_TYPES = [
  'net_checkin',
  'net_checkout',
  // A removal stays on the log so the record shows the correction (#1238)
  'net_removed',
  'net_traffic',
  'aprs_msg_sent',
  'aprs_msg_rx',
  'ics213_sent',
  'shelter_report',
  'field_report',
];

/** Message types we originate — their number goes in the FROM Msg # column. */
const SENT_TYPES = new Set(['aprs_msg_sent', 'ics213_sent']);

const MSG_TO_RE = /\bto\s+(\S+)\s*$/i;

/** Editable fields of a 309 row (also the CSV/print columns). */
export const ICS309_FIELDS = ['dateTime', 'from', 'fromMsg', 'to', 'toMsg', 'message'];

/** Add the printed date / time columns derived from `dateTime`. */
function withPrintTime(row) {
  const ms = fromInputDateTime(row.dateTime);
  return { ...row, date: ms == null ? '' : utcDate(ms), time: ms == null ? '' : utcTime(ms) };
}

/**
 * One ICS 309 row per event. The log's FROM/TO columns are filled from what
 * each event type knows:
 *   aprs_msg_sent  from = our call, to = addressee (parsed from the summary)
 *   aprs_msg_rx    from = sender, to = addressee (bulletin → "Bulletin: …")
 *   net_checkin/out, shelter_report, field_report, station_heard
 *                  from = the station, to = our call (operatorCall)
 *   nws_alert      from = "NWS", to = our call
 * `message` is the summary plus details so nothing in the log is lost.
 *
 * Message-type events carry the station message number from the event log
 * (`messageNumbers`, derived for older events): in FROM Msg # for traffic we
 * originated, in TO Msg # for traffic we received. `startNumber` (a positive
 * integer) renumbers the period's messages from that number instead.
 *
 * In a shared incident the log also holds other sites' traffic (`foreign`):
 * those rows show the other station's "SITE:n" number and are never counted
 * or renumbered as this station's messages.
 */
export function ics309RowsFromEvents(
  events,
  { from = null, to = null, operatorCall = '', types = null, startNumber = null } = {},
) {
  const me = String(operatorCall || '').toUpperCase();
  const allow = Array.isArray(types) ? new Set(types) : null;
  const numbers = messageNumbers(events);
  const start = Number(startNumber);
  const renumber = Number.isInteger(start) && start > 0;
  let seq = renumber ? start : 0;
  return eventsInRange(events, { from, to })
    .filter((ev) => !allow || allow.has(ev.type))
    .map((ev) => {
      const label = EVENT_TYPE_META[ev.type]?.label || ev.type;
      let rowFrom = String(ev.callsign || '').toUpperCase();
      let rowTo = me;
      let message = ev.summary || '';
      const details = ev.details || '';
      if (ev.type === 'aprs_msg_sent') {
        const m = MSG_TO_RE.exec(ev.summary || '');
        rowTo = m ? m[1].toUpperCase() : '';
        message = details || ev.summary || '';
      } else if (ev.type === 'ics213_sent') {
        // summary: "ICS 213 to <CALL>: <subject>"; details: the text sent
        const m = /\bto\s+([^\s:]+)/i.exec(ev.summary || '');
        rowTo = m ? m[1].toUpperCase() : '';
        message = `ICS 213 — ${details || ev.summary || ''}`;
      } else if (ev.type === 'aprs_msg_rx') {
        const m = MSG_TO_RE.exec(ev.summary || '');
        rowTo = m ? m[1].toUpperCase() : me;
        const bulletin = /^bulletin/i.test(ev.summary || '');
        message = `${bulletin ? 'Bulletin: ' : ''}${details || ev.summary || ''}`;
      } else if (ev.type === 'nws_alert') {
        rowFrom = rowFrom || 'NWS';
        message = `${label}: ${ev.summary || ''}${details ? ` — ${details}` : ''}`;
      } else {
        message = `${ev.summary || label}${details ? ` — ${details}` : ''}`;
      }
      let no = numbers.get(ev.id);
      if (no != null && renumber) no = seq++;
      // Another site's traffic in a shared incident keeps its own "SITE:n" label.
      const msgNo = ev.foreign ? ev.msgLabel || '' : no == null ? '' : String(no);
      const sent = SENT_TYPES.has(ev.type);
      return withPrintTime({
        id: `ev-${ev.id}`,
        eventId: ev.id,
        ts: ev.ts,
        dateTime: toInputDateTime(ev.ts),
        from: rowFrom,
        fromMsg: sent ? msgNo : '',
        to: rowTo,
        toMsg: sent ? '' : msgNo,
        message,
        type: ev.type,
        source: 'event',
      });
    });
}

/** Blank manual 309 row, stamped now. */
export function newIcs309Row(now = Date.now(), partial = {}) {
  return {
    id: newRowId(),
    dateTime: toInputDateTime(now),
    from: '',
    fromMsg: '',
    to: '',
    toMsg: '',
    message: '',
    source: 'manual',
    ...partial,
  };
}

/**
 * The 309 as the operator will print it: event rows for the period (with
 * the operator's edits applied and removed rows dropped) plus the rows they
 * added by hand, sorted by time. Edits are stored per row id in the draft
 * (`ics309.edits`), so the log keeps updating live underneath them.
 */
export function ics309Rows(drafts, events) {
  const f = drafts?.ics309 || {};
  const removed = new Set(Array.isArray(f.removed) ? f.removed : []);
  const edits = f.edits && typeof f.edits === 'object' ? f.edits : {};
  const auto = ics309RowsFromEvents(events, {
    ...headerRange(drafts?.header),
    operatorCall: f.operatorCall,
    types: f.types,
    startNumber: f.startNumber,
  })
    .filter((r) => !removed.has(r.id))
    .map((r) => (edits[r.id] ? withPrintTime({ ...r, ...edits[r.id], edited: true }) : r));
  const manual = (Array.isArray(f.manual) ? f.manual : []).map((r) => withPrintTime(r));
  return sortRowsByDateTime([...auto, ...manual]);
}

/**
 * Apply an edit to a 309 row in the draft: manual rows are edited in place,
 * event rows get an entry in `edits` (only the changed fields).
 * @returns the new ics309 draft section
 */
export function editIcs309Row(section, row, changes) {
  const f = section || {};
  if (row.source === 'manual') {
    return { ...f, manual: (f.manual || []).map((r) => (r.id === row.id ? { ...r, ...changes } : r)) };
  }
  const prev = (f.edits || {})[row.id] || {};
  return { ...f, edits: { ...(f.edits || {}), [row.id]: { ...prev, ...changes } } };
}

/** Remove a 309 row: drop a manual row, hide an event row. */
export function removeIcs309Row(section, row) {
  const f = section || {};
  if (row.source === 'manual') return { ...f, manual: (f.manual || []).filter((r) => r.id !== row.id) };
  const removed = new Set(f.removed || []);
  removed.add(row.id);
  return { ...f, removed: [...removed] };
}

/** CSV for the ICS 309: a short identification block, then the log table. */
export function ics309Csv(drafts, rows, { now = Date.now(), tr = defaultTr } = {}) {
  const h = drafts.header || {};
  const f = drafts.ics309 || {};
  const line = (cells) => cells.map(csvEscape).join(',');
  const lines = [
    line([L(tr, 'form', 'Form'), L(tr, '309.title', 'ICS 309 Communications Log')]),
    line([L(tr, '309.b1', '1. Incident Name and Activation Number'), h.incidentName || '']),
    line([
      L(tr, '309.b2csv', '2. Operational Period (UTC)'),
      `${inputToPrintDateTime(h.periodFrom)} – ${inputToPrintDateTime(h.periodTo)}`,
    ]),
    line([L(tr, '309.b3', '3. Radio Net Name (for NCS) or Position/Tactical Call'), f.netName || '']),
    line([L(tr, '309.b4', '4. Radio Operator (Name, Call Sign)'), nameCall(f.operatorName, f.operatorCall)]),
    line([L(tr, '309.b6', '6. Prepared By (Name, Call Sign)'), nameCall(h.preparedBy, h.preparedCall)]),
    line([L(tr, '309.b7', '7. Date & Time Prepared (UTC)'), utcDateTime(now)]),
    '',
    line([
      L(tr, 'dateUtc', 'Date (UTC)'),
      L(tr, '309.time', 'Time (24:00)'),
      L(tr, '309.fromCall', 'From Call Sign/ID'),
      L(tr, '309.fromMsg', 'From Msg #'),
      L(tr, '309.toCall', 'To Call Sign/ID'),
      L(tr, '309.toMsg', 'To Msg #'),
      L(tr, '309.message', 'Message'),
    ]),
  ];
  for (const r of rows || []) lines.push(line([r.date, r.time, r.from, r.fromMsg, r.to, r.toMsg, r.message]));
  return lines.join('\r\n') + '\r\n';
}

// ── ICS 214 Activity Log ────────────────────────────────────────────────────
/** Editable activity rows derived from the event log (block 7). */
export function ics214RowsFromEvents(events, { from = null, to = null } = {}) {
  return eventsInRange(events, { from, to }).map((ev) => {
    const label = EVENT_TYPE_META[ev.type]?.label || ev.type;
    const who = ev.callsign ? `${String(ev.callsign).toUpperCase()}: ` : '';
    const details = ev.details ? ` — ${ev.details}` : '';
    return {
      id: `ev-${ev.id}`,
      dateTime: toInputDateTime(ev.ts),
      text: `${label}. ${who}${ev.summary || ''}${details}`.trim(),
      source: 'event',
    };
  });
}

/** Blank manual activity row (block 7), stamped now. */
export function newIcs214Row(now = Date.now()) {
  return { id: newRowId(), dateTime: toInputDateTime(now), text: '', source: 'manual' };
}

/**
 * Merge event-derived rows into existing rows: rows already imported (same
 * id) are left alone so the operator's edits survive a re-import; new
 * events are appended and the list is re-sorted by time.
 */
export function mergeIcs214Rows(existing, imported) {
  const have = new Set((existing || []).map((r) => r.id));
  const out = [...(existing || [])];
  for (const r of imported || []) if (!have.has(r.id)) out.push(r);
  return sortRowsByDateTime(out);
}

/** Stable sort by `dateTime` (rows without a valid time go last). */
export function sortRowsByDateTime(rows) {
  return (rows || [])
    .map((r, i) => ({ r, i, t: fromInputDateTime(r.dateTime) ?? Infinity }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ r }) => r);
}

export function newIcs214Resource() {
  return { id: newRowId(), name: '', position: '', agency: '' };
}

// ── ICS 213 General Message → APRS ──────────────────────────────────────────
/** The text that goes on the air: "Subject: message" (subject optional). */
export function ics213AprsText(form) {
  const subject = String(form?.subject || '').trim();
  const message = String(form?.message || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!message) return subject;
  return subject ? `${subject}: ${message}` : message;
}

/**
 * Split text into APRS-sized parts. A single part is sent as-is. Longer
 * text becomes numbered parts — "1/3 …", "2/3 …" — each ≤ `max` characters
 * including its prefix, split on word boundaries where possible (a word
 * longer than a whole part is hard-cut). Returns [] for blank text.
 */
export function splitForAprs(text, max = APRS_MSG_MAX) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const chunk = (budget) => {
    const parts = [];
    let rest = clean;
    while (rest.length) {
      if (rest.length <= budget) {
        parts.push(rest);
        break;
      }
      let cut = rest.lastIndexOf(' ', budget);
      if (cut < Math.floor(budget / 2)) cut = budget; // no usable space — hard cut
      parts.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    return parts;
  };

  // The "i/N " prefix length depends on N, which depends on the prefix
  // length. Iterate until the count is stable (converges in ≤ 3 passes).
  let n = chunk(max - 4).length; // assume "9/9 " (4 chars) to start
  for (let pass = 0; pass < 4; pass++) {
    const prefixLen = `${n}/${n} `.length;
    const parts = chunk(max - prefixLen);
    if (parts.length === n) {
      return parts.map((p, i) => `${i + 1}/${n} ${p}`);
    }
    n = parts.length;
  }
  const prefixLen = `${n}/${n} `.length;
  const parts = chunk(max - prefixLen);
  return parts.map((p, i) => `${i + 1}/${parts.length} ${p}`);
}

/**
 * Per-part send tracking for an ICS 213 going out over APRS. Each part is
 * 'pending', 'sent' or 'failed'. Kept in the draft so a partial send can be
 * resumed after a reload.
 */
export function newSendState(to, parts, now = Date.now()) {
  return {
    to: String(to || '').toUpperCase(),
    startedAt: now,
    parts: (parts || []).map((text) => ({ text, state: 'pending' })),
  };
}

/** Index of the first part not yet sent, or -1 when everything went out. */
export function firstUnsentPart(state) {
  if (!state?.parts?.length) return -1;
  return state.parts.findIndex((p) => p.state !== 'sent');
}

/**
 * Record the outcome of sending parts[start..] — `result` is sendAprsParts'
 * { sent, total, error }: the first `sent` parts went out; on error the next
 * one is marked failed and the rest stay pending.
 */
export function applySendResult(state, start, result) {
  const parts = state.parts.map((p) => ({ ...p }));
  const sent = Math.max(0, Number(result?.sent) || 0);
  for (let i = start; i < Math.min(parts.length, start + sent); i++) {
    parts[i].state = 'sent';
    delete parts[i].error;
  }
  const failIdx = start + sent;
  if (result?.error && failIdx < parts.length) {
    parts[failIdx].state = 'failed';
    parts[failIdx].error = String(result.error);
  }
  return { ...state, parts };
}

/** True when the tracked send is for this addressee and exactly these parts. */
export function sendStateMatches(state, to, parts) {
  if (!state?.parts) return false;
  if (state.to !== String(to || '').toUpperCase()) return false;
  if (state.parts.length !== (parts || []).length) return false;
  return state.parts.every((p, i) => p.text === parts[i]);
}

// ── ICS 205 Incident Radio Communications Plan ──────────────────────────────
/** Mode code for block 4: A = analog, D = digital, M = mixed. */
export function ics205ModeCode(mode) {
  const m = String(mode || '')
    .trim()
    .toUpperCase();
  if (!m) return 'A';
  if (
    /MIXED|\bM\b/.test(m) ||
    (m.includes('/') && /FM|ANALOG/.test(m) && /DMR|D-?STAR|YSF|C4FM|P25|NXDN|DIGITAL/.test(m))
  )
    return 'M';
  if (
    /DMR|D-?STAR|\bDV\b|\bDN\b|YSF|FUSION|C4FM|P25|NXDN|DIGITAL|\bDIG\b|DATA|FT8|FT4|JS8|PACKET|APRS|M17|TETRA/.test(m)
  )
    return 'D';
  return 'A';
}

/** Frequency as printed on the plan: MHz with 4 decimals, trailing zeros trimmed to at least 3. */
export function formatPlanFreq(mhz) {
  const n = Number(mhz);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = n.toFixed(4);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/**
 * Blank editable channel row (block 4). Bandwidth defaults to W: amateur FM
 * (±5 kHz deviation, 25 kHz channels) is "wide" in ICS 205 terms; N is the
 * 12.5 kHz narrowband used by most public-safety systems.
 */
export function newIcs205Row(partial = {}) {
  return {
    id: newRowId(),
    zone: '',
    ch: '',
    function: '',
    name: '',
    assignment: '',
    rxFreq: '',
    rxNW: 'W',
    rxTone: '',
    txFreq: '',
    txNW: 'W',
    txTone: '',
    mode: 'A',
    modeName: '',
    remarks: '',
    source: 'manual',
    ...partial,
  };
}

/**
 * Row from a Repeaters panel entry ({ callsign, mhz, offsetMhz, tone, mode,
 * city, group }). The repeater's output is what the radio receives, so RX
 * is the listed frequency and TX is output + offset; the listed tone is the
 * uplink (TX) tone.
 */
export function ics205RowFromRepeater(r) {
  const out = Number(r?.mhz);
  const offset = Number(r?.offsetMhz) || 0;
  return newIcs205Row({
    function: 'Repeater',
    name: String(r?.callsign || '').toUpperCase(),
    rxFreq: formatPlanFreq(out),
    txFreq: formatPlanFreq(out + offset),
    txTone: String(r?.tone || ''),
    mode: ics205ModeCode(r?.mode),
    modeName: String(r?.mode || ''),
    remarks: [r?.city, r?.group].filter(Boolean).join(' · '),
    source: 'repeater',
  });
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Row from a Net Schedule entry ({ name, freq_mhz, mode, day, time_utc, notes }). */
export function ics205RowFromNet(net) {
  const freq = formatPlanFreq(net?.freq_mhz);
  const day = net?.day === 'daily' ? 'Daily' : DAY_SHORT[Number(net?.day)] || '';
  const when = [day, net?.time_utc ? `${net.time_utc}Z` : ''].filter(Boolean).join(' ');
  return newIcs205Row({
    function: 'Net',
    name: String(net?.name || ''),
    assignment: 'All stations',
    rxFreq: freq,
    txFreq: freq,
    mode: ics205ModeCode(net?.mode),
    modeName: String(net?.mode || ''),
    remarks: [when, net?.mode || '', net?.notes || ''].filter(Boolean).join(' · '),
    source: 'net',
  });
}

/**
 * Row from the voice net running in Net Control (its roster snapshot:
 * { net, ncs, frequency (free text), freqMhz?, mode?, region?, offset? }).
 * The frequency text is read for an offset and tone ("146.940 − PL 100.0"):
 * RX is the listed frequency, TX the listed frequency plus the offset
 * (written in the text, the operator's override, or the region's standard),
 * the tone goes on TX. When only a direction is known the TX cell is left
 * for the operator, flagged `txUnknown` (the editor shows "offset?") and
 * noted in the remarks; a standard offset that varies locally is noted too.
 */
export function ics205RowFromVoiceNet(snapshot) {
  const parsed =
    parseNetFrequency(snapshot?.frequency, { region: snapshot?.region || null, offset: snapshot?.offset || '' }) || {};
  const rx = Number(snapshot?.freqMhz) > 0 ? Number(snapshot.freqMhz) : parsed.mhz;
  const sameFreq = parsed.mhz != null && parsed.mhz === rx;
  const tx = sameFreq ? parsed.txMhz : rx;
  const txUnknown = sameFreq && parsed.offsetSource === 'unknown';
  const offsetNote = txUnknown
    ? 'TX offset? — fill in TX'
    : sameFreq && parsed.offsetCheck
      ? `TX offset ${formatOffset(parsed.offsetMhz)} assumed — check locally`
      : '';
  return newIcs205Row({
    function: 'Net',
    name: String(snapshot?.net || ''),
    assignment: 'All stations',
    rxFreq: formatPlanFreq(rx),
    txFreq: tx == null ? '' : formatPlanFreq(tx),
    txTone: parsed.tone || '',
    mode: ics205ModeCode(snapshot?.mode || parsed.mode),
    modeName: String(snapshot?.mode || parsed.mode || ''),
    remarks: [offsetNote, snapshot?.ncs ? `NCS ${snapshot.ncs}` : '', snapshot?.frequency || '']
      .filter(Boolean)
      .join(' · '),
    source: 'net-control',
    ...(txUnknown ? { txUnknown: true } : {}),
  });
}

/** Manually added simplex channel: RX = TX, no tone. */
export function newSimplexRow({ name = '', mhz = '', func = 'Simplex' } = {}) {
  const freq = formatPlanFreq(mhz);
  return newIcs205Row({ function: func, name, rxFreq: freq, txFreq: freq, source: 'manual' });
}

/** Fill blank "Ch #" cells with their 1-based position (operator entries win). */
export function numberChannels(rows) {
  return (rows || []).map((r, i) => (String(r.ch || '').trim() ? r : { ...r, ch: String(i + 1) }));
}

/** Distinct zone/group names in row order (blank excluded). */
export function zonesOf(rows) {
  const seen = [];
  for (const r of rows || []) {
    const z = String(r.zone || '').trim();
    if (z && !seen.includes(z)) seen.push(z);
  }
  return seen;
}

/**
 * Rows grouped by zone/group: zones in order of first appearance, rows
 * inside a zone keep their order, rows without a zone go last.
 */
export function groupRowsByZone(rows) {
  const zones = zonesOf(rows);
  const rank = (r) => {
    const z = String(r.zone || '').trim();
    return z ? zones.indexOf(z) : zones.length;
  };
  return (rows || [])
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ r }) => r);
}

// ── Print HTML ──────────────────────────────────────────────────────────────
const pages = (rows, perPage) => {
  const out = [];
  const list = rows && rows.length ? rows : [];
  for (let i = 0; i < Math.max(1, Math.ceil(list.length / perPage)); i++)
    out.push(list.slice(i * perPage, (i + 1) * perPage));
  return out;
};

const blankRows = (count, cols) =>
  Array.from({ length: count }, () => `<tr class="blank">${'<td>&nbsp;</td>'.repeat(cols)}</tr>`).join('');

const cell = (label, value, extra = '') =>
  `<div class="ics-cell${extra ? ` ${extra}` : ''}"><div class="ics-label">${esc(label)}</div><div class="ics-value">${esc(value || '')}&nbsp;</div></div>`;

const nameCall = (name, call) => [name, call].filter(Boolean).join(' ');

const pageOf = (tr, n, total) => L(tr, 'pageOf', 'Page {{page}} of {{total}}', { page: n, total });

const periodText = (tr, h) =>
  L(tr, 'periodFromTo', 'Date/Time From: {{from}}  Date/Time To: {{to}}', {
    from: inputToPrintDateTime(h.periodFrom),
    to: inputToPrintDateTime(h.periodTo),
  });

/**
 * ICS 309 Communications Log. One printed page per ICS309_ROWS_PER_PAGE rows,
 * header repeated, "Page n of N" in block 8.
 */
export function buildIcs309Html(drafts, rows, { now = Date.now(), tr = defaultTr } = {}) {
  const h = drafts.header || {};
  const f = drafts.ics309 || {};
  const period = L(tr, '309.period', 'From: {{from}}  To: {{to}}', {
    from: inputToPrintDateTime(h.periodFrom),
    to: inputToPrintDateTime(h.periodTo),
  });
  const pageList = pages(rows, ICS309_ROWS_PER_PAGE);
  return pageList
    .map((pageRows, pi) => {
      const body = pageRows
        .map(
          (r) =>
            `<tr><td class="mono">${esc(r.time)}</td><td class="mono">${esc(r.from)}</td><td class="mono">${esc(r.fromMsg)}</td><td class="mono">${esc(r.to)}</td><td class="mono">${esc(r.toMsg)}</td><td>${esc(r.message)}</td></tr>`,
        )
        .join('');
      const fill = pi === pageList.length - 1 ? blankRows(Math.max(0, ICS309_ROWS_PER_PAGE - pageRows.length), 6) : '';
      return `<section class="ics-form ics-309">
<header class="ics-head">
  <div class="ics-title"><strong>${esc(L(tr, '309.name', 'COMM Log'))}</strong><br>ICS 309</div>
  ${cell(L(tr, '309.b1', '1. Incident Name and Activation Number'), h.incidentName, 'grow')}
  ${cell(L(tr, '309.b2', '2. Operational Period (Date/Time, UTC)'), period, 'grow')}
</header>
<div class="ics-row">
  ${cell(L(tr, '309.b3', '3. Radio Net Name (for NCS) or Position/Tactical Call'), f.netName, 'grow')}
  ${cell(L(tr, '309.b4', '4. Radio Operator (Name, Call Sign)'), nameCall(f.operatorName, f.operatorCall), 'grow')}
</div>
<div class="ics-section">${esc(L(tr, '309.b5', '5. COMMUNICATIONS LOG'))}</div>
<table class="ics-table">
<thead>
  <tr><th rowspan="2" class="w-time">${esc(L(tr, '309.timeHead', 'Time'))}<br>(24:00)</th><th colspan="2">${esc(L(tr, '309.from', 'FROM'))}</th><th colspan="2">${esc(L(tr, '309.to', 'TO'))}</th><th rowspan="2">${esc(L(tr, '309.message', 'Message'))}</th></tr>
  <tr><th class="w-call">${esc(L(tr, '309.callSign', 'Call Sign/ID'))}</th><th class="w-msg">${esc(L(tr, '309.msgNo', 'Msg #'))}</th><th class="w-call">${esc(L(tr, '309.callSign', 'Call Sign/ID'))}</th><th class="w-msg">${esc(L(tr, '309.msgNo', 'Msg #'))}</th></tr>
</thead>
<tbody>${body}${fill}</tbody>
</table>
<footer class="ics-row">
  ${cell(L(tr, '309.b6', '6. Prepared By (Name, Call Sign)'), nameCall(h.preparedBy, h.preparedCall), 'grow')}
  ${cell(L(tr, '309.b7', '7. Date & Time Prepared (UTC)'), utcDateTime(now), 'grow')}
  ${cell('8.', pageOf(tr, pi + 1, pageList.length))}
</footer>
</section>`;
    })
    .join('');
}

/** ICS 214 Activity Log (FEMA blocks 1–8), paged on block 7. */
export function buildIcs214Html(drafts, { now = Date.now(), tr = defaultTr } = {}) {
  const h = drafts.header || {};
  const f = drafts.ics214 || {};
  const rows = sortRowsByDateTime(f.rows || []);
  const pageList = pages(rows, ICS214_ROWS_PER_PAGE);
  const resources = (f.resources || []).filter((r) => r.name || r.position || r.agency);
  const resRows =
    resources
      .map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.position)}</td><td>${esc(r.agency)}</td></tr>`)
      .join('') + blankRows(Math.max(0, 3 - resources.length), 3);
  const icsPosition = L(tr, '214.icsPosition', 'ICS Position');
  const homeAgency = L(tr, '214.homeAgency', 'Home Agency (and Unit)');
  return pageList
    .map((pageRows, pi) => {
      const body = pageRows
        .map((r) => `<tr><td class="mono">${esc(inputToPrintDateTime(r.dateTime))}</td><td>${esc(r.text)}</td></tr>`)
        .join('');
      const fill = pi === pageList.length - 1 ? blankRows(Math.max(0, ICS214_ROWS_PER_PAGE - pageRows.length), 2) : '';
      return `<section class="ics-form ics-214">
<header class="ics-head">
  <div class="ics-title"><strong>${esc(L(tr, '214.name', 'ACTIVITY LOG'))}</strong><br>(ICS 214)</div>
  ${cell(L(tr, '214.b1', '1. Incident Name'), h.incidentName, 'grow')}
  ${cell(L(tr, '214.b2', '2. Operational Period (UTC)'), periodText(tr, h), 'grow')}
</header>
<div class="ics-row">
  ${cell(L(tr, '214.b3', '3. Name'), f.name, 'grow')}
  ${cell(`4. ${icsPosition}`, f.icsPosition, 'grow')}
  ${cell(`5. ${homeAgency}`, f.homeAgency, 'grow')}
</div>
<div class="ics-section">${esc(L(tr, '214.b6', '6. Resources Assigned'))}</div>
<table class="ics-table">
<thead><tr><th>${esc(L(tr, '214.resName', 'Name'))}</th><th>${esc(icsPosition)}</th><th>${esc(homeAgency)}</th></tr></thead>
<tbody>${resRows}</tbody>
</table>
<div class="ics-section">${esc(L(tr, '214.b7', '7. Activity Log'))}</div>
<table class="ics-table">
<thead><tr><th class="w-datetime">${esc(L(tr, 'dateTimeUtc', 'Date/Time (UTC)'))}</th><th>${esc(L(tr, '214.notable', 'Notable Activities'))}</th></tr></thead>
<tbody>${body}${fill}</tbody>
</table>
<footer class="ics-row">
  ${cell(L(tr, '214.b8', '8. Prepared by: Name/Position/Title'), nameCall(h.preparedBy, h.preparedCall), 'grow')}
  ${cell(L(tr, 'signature', 'Signature'), '', 'grow sig')}
  ${cell(L(tr, 'dateTimeUtc', 'Date/Time (UTC)'), utcDateTime(now))}
  ${cell('', pageOf(tr, pi + 1, pageList.length))}
</footer>
<div class="ics-foot">ICS 214, ${esc(L(tr, 'page', 'Page {{page}}', { page: pi + 1 }))}</div>
</section>`;
    })
    .join('');
}

/** ICS 213 General Message (FEMA blocks 1–10), one page. */
export function buildIcs213Html(drafts, { tr = defaultTr } = {}) {
  const h = drafts.header || {};
  const f = drafts.ics213 || {};
  const when = fromInputDateTime(f.dateTime);
  const date = when == null ? '' : utcDate(when);
  const time = when == null ? '' : utcTime(when);
  return `<section class="ics-form ics-213">
<header class="ics-head">
  <div class="ics-title"><strong>${esc(L(tr, '213.name', 'GENERAL MESSAGE'))}</strong><br>(ICS 213)</div>
  ${cell(L(tr, '213.b1', '1. Incident Name (Optional)'), h.incidentName, 'grow')}
</header>
<div class="ics-row">${cell(L(tr, '213.b2', '2. To (Name and Position)'), f.toCall ? `${f.to || ''} (${f.toCall})`.trim() : f.to, 'grow')}</div>
<div class="ics-row">${cell(L(tr, '213.b3', '3. From (Name and Position)'), f.from, 'grow')}</div>
<div class="ics-row">
  ${cell(L(tr, '213.b4', '4. Subject'), f.subject, 'grow')}
  ${cell(L(tr, '213.b5', '5. Date (UTC)'), date)}
  ${cell(L(tr, '213.b6', '6. Time (UTC)'), time)}
</div>
<div class="ics-row"><div class="ics-cell grow tall"><div class="ics-label">${esc(L(tr, '213.b7', '7. Message'))}</div><div class="ics-value pre">${esc(f.message || '')}&nbsp;</div></div></div>
<div class="ics-row">
  ${cell(L(tr, '213.b8', '8. Approved by: Name'), f.approvedBy, 'grow')}
  ${cell(L(tr, 'signature', 'Signature'), '', 'grow sig')}
  ${cell(L(tr, 'positionTitle', 'Position/Title'), f.approvedPosition, 'grow')}
</div>
<div class="ics-row"><div class="ics-cell grow tall"><div class="ics-label">${esc(L(tr, '213.b9', '9. Reply'))}</div><div class="ics-value pre">${esc(f.reply || '')}&nbsp;</div></div></div>
<div class="ics-row">
  ${cell(L(tr, '213.b10', '10. Replied by: Name/Position/Title'), f.repliedBy, 'grow')}
  ${cell(L(tr, 'signature', 'Signature'), '', 'grow sig')}
  ${cell(L(tr, 'dateTimeUtc', 'Date/Time (UTC)'), inputToPrintDateTime(f.repliedDateTime))}
</div>
<div class="ics-foot">ICS 213</div>
</section>`;
}

/** ICS 205 Incident Radio Communications Plan (FEMA blocks 1–6), paged on block 4. */
export function buildIcs205Html(drafts, { now = Date.now(), tr = defaultTr } = {}) {
  const h = drafts.header || {};
  const f = drafts.ics205 || {};
  const rows = numberChannels(f.rows || []);
  const pageList = pages(rows, ICS205_ROWS_PER_PAGE);
  const freq = (mhz, nw) => `${esc(mhz)}${mhz ? ` ${esc(nw === 'N' ? 'N' : 'W')}` : ''}`;
  const th = (key, def) => `<th>${esc(L(tr, `205.${key}`, def))}</th>`;
  return pageList
    .map((pageRows, pi) => {
      const body = pageRows
        .map(
          (r) =>
            `<tr><td>${esc(r.zone)}</td><td>${esc(r.ch)}</td><td>${esc(r.function)}</td><td>${esc(r.name)}</td><td>${esc(r.assignment)}</td><td class="mono">${freq(r.rxFreq, r.rxNW)}</td><td class="mono">${esc(r.rxTone)}</td><td class="mono">${freq(r.txFreq, r.txNW)}</td><td class="mono">${esc(r.txTone)}</td><td>${esc(r.mode)}</td><td>${esc(r.remarks)}</td></tr>`,
        )
        .join('');
      const fill = pi === pageList.length - 1 ? blankRows(Math.max(0, ICS205_ROWS_PER_PAGE - pageRows.length), 11) : '';
      return `<section class="ics-form ics-205 landscape">
<header class="ics-head">
  <div class="ics-title"><strong>${esc(L(tr, '205.name', 'INCIDENT RADIO COMMUNICATIONS PLAN'))}</strong><br>(ICS 205)</div>
  ${cell(L(tr, '205.b1', '1. Incident Name'), h.incidentName, 'grow')}
  ${cell(L(tr, '205.b2', '2. Date/Time Prepared (UTC)'), utcDateTime(now))}
  ${cell(L(tr, '205.b3', '3. Operational Period (UTC)'), periodText(tr, h), 'grow')}
</header>
<div class="ics-section">${esc(L(tr, '205.b4', '4. Basic Radio Channel Use'))}</div>
<table class="ics-table ics-205-table">
<thead><tr>
  ${th('zone', 'Zone Grp.')}${th('ch', 'Ch #')}${th('function', 'Function')}${th('channelName', 'Channel Name/Trunked Radio System Talkgroup')}${th('assignment', 'Assignment')}
  ${th('rxFreq', 'RX Freq N or W')}${th('rxTone', 'RX Tone/NAC')}${th('txFreq', 'TX Freq N or W')}${th('txTone', 'TX Tone/NAC')}${th('mode', 'Mode (A, D, or M)')}${th('remarks', 'Remarks')}
</tr></thead>
<tbody>${body}${fill}</tbody>
</table>
<div class="ics-row"><div class="ics-cell grow tall"><div class="ics-label">${esc(L(tr, '205.b5', '5. Special Instructions'))}</div><div class="ics-value pre">${esc(f.specialInstructions || '')}&nbsp;</div></div></div>
<footer class="ics-row">
  ${cell(L(tr, '205.b6', '6. Prepared by (Communications Unit Leader): Name'), nameCall(h.preparedBy, h.preparedCall), 'grow')}
  ${cell(L(tr, 'signature', 'Signature'), '', 'grow sig')}
  ${cell(L(tr, 'dateTimeUtc', 'Date/Time (UTC)'), utcDateTime(now))}
  ${cell('', pageOf(tr, pi + 1, pageList.length))}
</footer>
<div class="ics-foot">ICS 205</div>
</section>`;
    })
    .join('');
}

/** Build the print HTML for any form id. */
export function buildIcsHtml(formId, drafts, { events = [], now = Date.now(), tr = defaultTr } = {}) {
  switch (String(formId)) {
    case '309':
      return buildIcs309Html(drafts, ics309Rows(drafts, events), { now, tr });
    case '214':
      return buildIcs214Html(drafts, { now, tr });
    case '213':
      return buildIcs213Html(drafts, { tr });
    case '205':
      return buildIcs205Html(drafts, { now, tr });
    default:
      return '';
  }
}
