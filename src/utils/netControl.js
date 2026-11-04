/**
 * netControl — pure logic for the Net Control panel (`net-control`), which
 * runs a voice net on a repeater or simplex frequency.
 *
 * A running net:
 *   { id, name, frequency (free text), freqMhz?, mode?, region (band plan),
 *     offset (operator's TX offset override), ncs, scheduleId,
 *     scriptId (template), rev (write counter), startTime, endTime: null,
 *     calling: null|call (traffic station called with "next"),
 *     stations: [station…] (display order, newest activity first),
 *     undo: [{ stations, action, eventIds }…] (newest last, capped) }
 *
 * A station (one roster line):
 *   { id, call, name, location, flags: ['traffic'|'inout'|'relay'|'mobile'|
 *     'short'], note, checkinTime, lastActivity, checkoutTime: null|ms,
 *     recheckCount, trafficPassed: null|ms, logIds: [event-log ids] }
 *
 * Every mutator is pure: it returns a new net (or the same object when
 * nothing changed) and never touches storage. The panel persists the result
 * with saveRunningNet().
 *
 * Storage: the script templates (openhamclock_netControlScripts) are listed
 * in config.js SYNC_KEYS and profiles.js like other user settings. The running
 * net, the history of past nets and the remembered station names stay
 * per-browser. The voice roster snapshot (openhamclock_emcommNetRoster) holds
 * the stations in the EmComm roster entry shape for the Net Roster panel and
 * anything else built on the roster.
 */
import { csvEscape } from './emcommEventLog.js';
import { esc } from './escapeHtml.js';

export const NET_CONTROL_KEY = 'openhamclock_netControl';
export const NET_CONTROL_HISTORY_KEY = 'openhamclock_netControlHistory';
/** First-release single script — read once to migrate into the template list. */
export const NET_CONTROL_SCRIPT_KEY = 'openhamclock_netControlScript';
/** Named preamble/closing templates (synced and profiled). */
export const NET_CONTROL_SCRIPTS_KEY = 'openhamclock_netControlScripts';
export const NET_CONTROL_STATIONS_KEY = 'openhamclock_netControlStations';
/** Running (or last closed) net's stations, in the EmComm roster entry shape (see toRosterEntries). */
export const NET_CONTROL_ROSTER_KEY = 'openhamclock_emcommNetRoster';

export const MAX_HISTORY = 50;
export const MAX_UNDO = 20;
export const STATION_CACHE_MAX = 1000;
/** A second Enter on the same call within this window is a fat-finger duplicate, not a recheck. */
export const DUPLICATE_WINDOW_MS = 10 * 1000;

/**
 * Check-in status flags. `letter` is the keyboard code typed after the
 * callsign (`K0CJH T`, `K0CJH/M`, `K0CJH TM`); `key` is what is stored.
 */
export const FLAG_DEFS = [
  { key: 'inout', letter: 'I', label: 'In and out', short: 'I/O', color: '#f59e0b' },
  { key: 'traffic', letter: 'T', label: 'Traffic', short: 'TFC', color: '#ef4444' },
  { key: 'relay', letter: 'R', label: 'Relay', short: 'RLY', color: '#a855f7' },
  { key: 'mobile', letter: 'M', label: 'Mobile', short: 'MOB', color: '#3b82f6' },
  { key: 'short', letter: 'S', label: 'Short time', short: 'SHT', color: '#eab308' },
];
const FLAG_BY_LETTER = Object.fromEntries(FLAG_DEFS.map((f) => [f.letter, f.key]));
const FLAG_ORDER = FLAG_DEFS.map((f) => f.key);
const FLAG_TOKEN = /^[ITRMS]{1,5}$/;

/** Flags in canonical order, deduplicated, unknown keys dropped. */
export const normalizeFlags = (flags) => FLAG_ORDER.filter((k) => Array.isArray(flags) && flags.includes(k));

/** Short labels for a flag list ("TFC MOB"). */
export const flagsToText = (flags) =>
  normalizeFlags(flags)
    .map((k) => FLAG_DEFS.find((f) => f.key === k).short)
    .join(' ');

/** Loose callsign check: 3+ alphanumerics with at least one letter and one digit. */
export const isPlausibleCall = (s) => /^[A-Z0-9]{3,12}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);

/**
 * Parse one check-in line.
 *
 *   "k0cjh"            → { call: 'K0CJH', flags: [], note: '' }
 *   "K0CJH T"          → traffic
 *   "K0CJH/M"          → mobile (slash suffix made only of flag letters)
 *   "K0CJH TM Chris"   → traffic + mobile, note "Chris"
 *   "K0CJH /TMS"       → traffic + mobile + short time
 *   "K0CJH Chris"      → note "Chris" (a token with non-flag letters is a note)
 *   "K0CJH Tim"        → note "Tim" (bare flag tokens are at most 2 letters)
 *   "K0CJH-9"          → SSID stripped
 *
 * Returns null when the first token is not a plausible callsign.
 */
export function parseCheckin(input) {
  const tokens = String(input || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  let call = tokens[0].toUpperCase().replace(/-\d+$/, '');
  const flags = new Set();
  // Slash suffixes: strip SSID-like and flag-letter suffixes (K0CJH/M, K0CJH/T).
  // Other suffixes (/P, /QRP, /7) are left on the call.
  const parts = call.split('/');
  if (parts.length > 1) {
    const kept = [parts[0]];
    for (const p of parts.slice(1)) {
      if (FLAG_TOKEN.test(p) && p.length <= 2) {
        for (const ch of p) flags.add(FLAG_BY_LETTER[ch]);
      } else {
        kept.push(p);
      }
    }
    call = kept.join('/');
  }
  const base = call.split('/')[0];
  if (!isPlausibleCall(base)) return null;
  // Flag tokens before any note: 1–2 bare flag letters ("T", "TM"), or any
  // combination behind a "/" or "+" ("/TMS"). Longer bare tokens are notes,
  // so a name made of flag letters ("Tim", "Mitt") is never eaten as flags.
  const noteTokens = [];
  for (const tok of tokens.slice(1)) {
    const up = tok.toUpperCase();
    const prefixed = /^[/+]/.test(up) ? up.slice(1) : null;
    const flagText = prefixed ?? (up.length <= 2 ? up : '');
    if (noteTokens.length === 0 && FLAG_TOKEN.test(flagText)) {
      for (const ch of flagText) flags.add(FLAG_BY_LETTER[ch]);
    } else {
      noteTokens.push(tok);
    }
  }
  return { call, flags: normalizeFlags([...flags]), note: noteTokens.join(' ') };
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Start a new net. `name` is required; blanks fall back to sensible defaults. */
export function createNet({
  name,
  frequency = '',
  ncs = '',
  scheduleId = null,
  scriptId = null,
  freqMhz = null,
  mode = '',
  region = null,
  offset = '',
  now = Date.now(),
} = {}) {
  const n = String(name || '').trim();
  if (!n) return null;
  return {
    id: newId('net'),
    name: n,
    frequency: String(frequency || '').trim(),
    ncs: String(ncs || '')
      .trim()
      .toUpperCase(),
    scheduleId: scheduleId || null,
    scriptId: scriptId || null,
    freqMhz: Number.isFinite(Number(freqMhz)) && Number(freqMhz) > 0 ? Number(freqMhz) : null,
    mode: String(mode || '').toUpperCase(),
    region: region || null,
    offset: String(offset || '').trim(),
    startTime: now,
    rev: 0,
    endTime: null,
    calling: null,
    stations: [],
    undo: [],
  };
}

/**
 * Undo entries: { stations (snapshot before the action), action: { kind,
 * call }, eventIds: [event-log ids written for the action] }. Nets saved by
 * the first release stored bare station arrays; undoEntry() reads both.
 */
const undoEntry = (e) => (Array.isArray(e) ? { stations: e, action: null, eventIds: [] } : e);

const withUndo = (net, stations, action = null) => ({
  ...net,
  stations,
  undo: [...(net.undo || []), { stations: net.stations, action, eventIds: [] }].slice(-MAX_UNDO),
});

/** The action the next Undo would reverse ({ stations, action, eventIds }), or null. */
export function peekUndo(net) {
  const undo = net?.undo || [];
  return undo.length ? undoEntry(undo[undo.length - 1]) : null;
}

/**
 * Remember that event-log entry `eventId` was written for the latest action:
 * on the top undo entry (so Undo can withdraw it) and, when `call` is given,
 * on the station (so removing a mistyped call withdraws everything logged
 * for it). No undo entry of its own.
 */
export function attachEvent(net, eventId, call = null) {
  if (!net || !eventId) return net;
  const undo = (net.undo || []).slice();
  const c = call ? String(call).toUpperCase() : null;
  // The newest undo entry for this call (another tab's action may have been
  // stacked on top since), else the top one
  let at = undo.length - 1;
  if (c) {
    for (let i = undo.length - 1; i >= 0; i--) {
      if (undoEntry(undo[i]).action?.call === c) {
        at = i;
        break;
      }
    }
  }
  if (at >= 0) {
    const entry = undoEntry(undo[at]);
    undo[at] = { ...entry, eventIds: [...(entry.eventIds || []), eventId] };
  }
  const stations = c
    ? net.stations.map((x) => (x.call === c ? { ...x, logIds: [...(x.logIds || []), eventId] } : x))
    : net.stations;
  return { ...net, undo, stations };
}

const findStation = (net, call) => {
  const c = String(call || '').toUpperCase();
  return (net?.stations || []).find((s) => s.call === c) || null;
};

/**
 * Check a station in. Returns { net, station, result } where result is
 * 'new', 'recheck' (already on the roster → moved to the top, count bumped,
 * flags merged), 'return' (was checked out → back in) or 'duplicate' (same
 * call within DUPLICATE_WINDOW_MS → ignored, net unchanged).
 */
export function checkIn(net, { call, flags = [], note = '', name = '', location = '', now = Date.now() }) {
  const c = String(call || '').toUpperCase();
  const existing = findStation(net, c);
  const newFlags = normalizeFlags(flags);
  if (existing) {
    if (existing.checkoutTime == null && now - existing.lastActivity < DUPLICATE_WINDOW_MS) {
      return { net, station: existing, result: 'duplicate' };
    }
    const result = existing.checkoutTime != null ? 'return' : 'recheck';
    const updated = {
      ...existing,
      flags: normalizeFlags([...existing.flags, ...newFlags]),
      note: note || existing.note,
      name: existing.name || name,
      location: existing.location || location,
      lastActivity: now,
      checkoutTime: null,
      recheckCount: existing.recheckCount + 1,
    };
    const rest = net.stations.filter((s) => s.call !== c);
    return { net: withUndo(net, [updated, ...rest], { kind: result, call: c }), station: updated, result };
  }
  const station = {
    id: newId('stn'),
    call: c,
    name: String(name || ''),
    location: String(location || ''),
    flags: newFlags,
    note: String(note || ''),
    checkinTime: now,
    lastActivity: now,
    checkoutTime: null,
    recheckCount: 0,
    trafficPassed: null,
  };
  return { net: withUndo(net, [station, ...net.stations], { kind: 'new', call: c }), station, result: 'new' };
}

/** Mark a station checked out (stays on the roster, greyed). */
export function checkOut(net, call, now = Date.now()) {
  const s = findStation(net, call);
  if (!s || s.checkoutTime != null) return net;
  return withUndo(
    net,
    net.stations.map((x) => (x.call === s.call ? { ...x, checkoutTime: now, lastActivity: now } : x)),
    { kind: 'checkout', call: s.call },
  );
}

/** Toggle one flag on a station. */
export function toggleFlag(net, call, flag) {
  const s = findStation(net, call);
  if (!s || !FLAG_ORDER.includes(flag)) return net;
  const flags = s.flags.includes(flag) ? s.flags.filter((f) => f !== flag) : normalizeFlags([...s.flags, flag]);
  return withUndo(
    net,
    net.stations.map((x) => (x.call === s.call ? { ...x, flags } : x)),
    { kind: 'flag', call: s.call },
  );
}

/** Patch name/location/note on a station (no undo entry — these are fills, not actions). */
export function updateStation(net, call, patch) {
  const s = findStation(net, call);
  if (!s) return net;
  const clean = {};
  for (const k of ['name', 'location', 'note']) {
    if (patch?.[k] != null) clean[k] = String(patch[k]);
  }
  if (Object.keys(clean).length === 0) return net;
  return { ...net, stations: net.stations.map((x) => (x.call === s.call ? { ...x, ...clean } : x)) };
}

/** Remove a station entirely (a mis-typed call). */
export function removeStation(net, call) {
  const s = findStation(net, call);
  if (!s) return net;
  return withUndo(
    net,
    net.stations.filter((x) => x.call !== s.call),
    { kind: 'remove', call: s.call },
  );
}

/** Event-log summary for the compensating entry written when Undo reverses `action`. */
export function withdrawalSummary(action, netName = '') {
  const on = netName ? ` (${netName})` : '';
  switch (action?.kind) {
    case 'new':
      return `Check-in withdrawn${on}`;
    case 'recheck':
    case 'return':
      return `Re-check-in withdrawn${on}`;
    case 'checkout':
      return `Check-out withdrawn${on}`;
    case 'traffic':
      return `Traffic pass withdrawn${on}`;
    case 'remove':
      return `Removal undone, entries reinstated${on}`;
    default:
      return `Entry withdrawn${on}`;
  }
}

/**
 * Restore the roster to the state before the last check-in/out/flag/remove/
 * pass. Event-log entries written for that action are not touched here — the
 * panel reads peekUndo() first and logs compensating "withdrawn" events.
 */
export function undoLast(net) {
  const top = peekUndo(net);
  if (!top) return net;
  return { ...net, stations: top.stations, undo: net.undo.slice(0, -1) };
}

/**
 * Stations waiting to pass traffic: on the roster, flagged traffic, not yet
 * passed — oldest check-in first (first come, first served).
 */
export function trafficQueue(net) {
  return (net?.stations || [])
    .filter((s) => s.flags.includes('traffic') && s.trafficPassed == null && s.checkoutTime == null)
    .sort((a, b) => a.checkinTime - b.checkinTime);
}

/** Mark a station's traffic as passed (pops it from the queue). Returns the same net when not queued. */
export function passTraffic(net, call, now = Date.now()) {
  const s = findStation(net, call);
  if (!s || !s.flags.includes('traffic') || s.trafficPassed != null) return net;
  const next = withUndo(
    net,
    net.stations.map((x) => (x.call === s.call ? { ...x, trafficPassed: now, lastActivity: now } : x)),
    { kind: 'traffic', call: s.call },
  );
  return net.calling === s.call ? { ...next, calling: null } : next;
}

/**
 * "Next": call the head of the traffic queue — sets `calling` to that
 * station (shown large, with phonetics, until its traffic is passed).
 * Calling the same station again is a no-op; an empty queue clears it.
 */
export function nextTraffic(net) {
  if (!net) return net;
  const head = trafficQueue(net)[0]?.call ?? null;
  return (net.calling ?? null) === head ? net : { ...net, calling: head };
}

/** Close the net (sets endTime; a closed net is immutable from here on). */
export function closeNet(net, now = Date.now()) {
  if (!net || net.endTime != null) return net;
  return { ...net, endTime: now, undo: [] };
}

// ── Report ──────────────────────────────────────────────────────────────────

/** Duration of a net (end, or `now` while running) in ms. */
export const netDurationMs = (net, now = Date.now()) => Math.max(0, (net?.endTime ?? now) - (net?.startTime ?? now));

/** "00:12:34" running-timer format. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "1h 05m" / "12m" / "<1m" report format. */
export function formatDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const fmtUtc = (ts) => (ts == null ? '' : new Date(ts).toISOString().replace('T', ' ').substring(0, 16) + 'Z');
const fmtHHMM = (ts) => (ts == null ? '' : new Date(ts).toISOString().substring(11, 16));

// ── Local time (the operator's timezone setting) ────────────────────────────
const localFormatters = new Map();
/** Intl formatter for `timeZone` ('' / undefined = browser zone); falls back to the browser zone when invalid. */
function localFormatter(timeZone) {
  const key = timeZone || '';
  if (!localFormatters.has(key)) {
    const opts = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    };
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-US', { ...opts, ...(timeZone ? { timeZone } : {}) });
    } catch {
      fmt = new Intl.DateTimeFormat('en-US', opts);
    }
    localFormatters.set(key, fmt);
  }
  return localFormatters.get(key);
}

/** { date: 'YYYY-MM-DD', time: 'HH:MM', zone: 'CDT' } in the given zone, or null for no timestamp. */
export function localParts(ts, timeZone) {
  if (ts == null || !Number.isFinite(Number(ts))) return null;
  const parts = Object.fromEntries(
    localFormatter(timeZone)
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    zone: parts.timeZoneName || '',
  };
}
/** 'HH:MM' local. */
export const fmtLocalHHMM = (ts, timeZone) => localParts(ts, timeZone)?.time || '';
/** 'YYYY-MM-DD HH:MM CDT' local. */
export function fmtLocalDateTime(ts, timeZone) {
  const p = localParts(ts, timeZone);
  return p ? `${p.date} ${p.time}${p.zone ? ` ${p.zone}` : ''}` : '';
}
/** 'YYYY-MM-DD HH:MM' local, no zone (CSV cell; the zone has its own column). */
const fmtLocalCsv = (ts, timeZone) => {
  const p = localParts(ts, timeZone);
  return p ? `${p.date} ${p.time}` : '';
};
/** The zone name for CSV/print: the IANA name when set, else the browser's. */
export function zoneName(timeZone) {
  if (timeZone) return timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

/** Report time options: { times: 'utc' | 'both', timeZone }. */
const withLocal = (opts) => opts?.times === 'both';

/**
 * Build the net summary. Stations are listed in check-in order (oldest
 * first). totalCheckins counts rechecks; uniqueStations does not.
 */
export function buildReport(net, now = Date.now()) {
  const stations = [...(net?.stations || [])].sort((a, b) => a.checkinTime - b.checkinTime);
  const endTime = net?.endTime ?? now;
  return {
    id: net?.id || '',
    name: net?.name || '',
    ncs: net?.ncs || '',
    frequency: net?.frequency || '',
    startTime: net?.startTime ?? null,
    endTime,
    durationMs: netDurationMs(net, now),
    totalCheckins: stations.reduce((n, s) => n + 1 + (s.recheckCount || 0), 0),
    uniqueStations: stations.length,
    trafficCount: stations.filter((s) => s.flags.includes('traffic')).length,
    trafficPassed: stations.filter((s) => s.trafficPassed != null).length,
    stations: stations.map((s) => ({
      call: s.call,
      name: s.name || '',
      location: s.location || '',
      flags: normalizeFlags(s.flags),
      note: s.note || '',
      checkinTime: s.checkinTime,
      checkoutTime: s.checkoutTime,
      recheckCount: s.recheckCount || 0,
      trafficPassed: s.trafficPassed,
    })),
  };
}

/**
 * Plain-text report for the clipboard / email. With `{ times: 'both' }` each
 * time is followed by the local time in `timeZone`.
 */
export function reportToText(report, opts = {}) {
  const r = report;
  const both = withLocal(opts);
  const tz = opts.timeZone;
  const stamp = (ts) => (both ? `${fmtUtc(ts)} (${fmtLocalDateTime(ts, tz)})` : fmtUtc(ts));
  const lines = [
    `NET REPORT — ${r.name}`,
    `Net control: ${r.ncs || '—'}`,
    `Frequency: ${r.frequency || '—'}`,
    `Opened: ${stamp(r.startTime)}   Closed: ${stamp(r.endTime)}   Duration: ${formatDuration(r.durationMs)}`,
    `Check-ins: ${r.totalCheckins}   Unique stations: ${r.uniqueStations}   Traffic: ${r.trafficCount} listed, ${r.trafficPassed} passed`,
    '',
    both ? 'UTC   LOCAL CALL        FLAGS        NAME / LOCATION' : 'TIME  CALL        FLAGS        NAME / LOCATION',
  ];
  for (const s of r.stations) {
    const who = [s.name, s.location].filter(Boolean).join(', ');
    const out =
      s.checkoutTime != null
        ? `out ${fmtHHMM(s.checkoutTime)}${both ? `/${fmtLocalHHMM(s.checkoutTime, tz)}` : ''}`
        : '';
    const extra = [s.recheckCount > 0 ? `recheck x${s.recheckCount}` : '', out, s.note].filter(Boolean).join('; ');
    const tail = [who, extra ? `(${extra})` : ''].filter(Boolean).join(' ');
    const time = both ? `${fmtHHMM(s.checkinTime)} ${fmtLocalHHMM(s.checkinTime, tz)}` : fmtHHMM(s.checkinTime);
    lines.push(`${time} ${s.call.padEnd(11)} ${flagsToText(s.flags).padEnd(12)} ${tail}`.trimEnd());
  }
  lines.push('', 'Generated by OpenHamClock');
  return lines.join('\n');
}

const REPORT_CSV_HEADER = [
  'Net',
  'NCS',
  'Frequency',
  'Net Opened (UTC)',
  'Net Opened (local)',
  'Net Closed (UTC)',
  'Net Closed (local)',
  'Callsign',
  'Name',
  'Location',
  'Flags',
  'Check-In (UTC)',
  'Check-In (local)',
  'Check-Out (UTC)',
  'Check-Out (local)',
  'Rechecks',
  'Traffic Passed (UTC)',
  'Traffic Passed (local)',
  'Note',
  'Time Zone',
];

const iso = (ts) => (ts != null ? new Date(ts).toISOString() : '');

const reportRows = (r, timeZone) =>
  r.stations.map((s) =>
    [
      r.name,
      r.ncs,
      r.frequency,
      iso(r.startTime),
      fmtLocalCsv(r.startTime, timeZone),
      iso(r.endTime),
      fmtLocalCsv(r.endTime, timeZone),
      s.call,
      s.name,
      s.location,
      flagsToText(s.flags),
      iso(s.checkinTime),
      fmtLocalCsv(s.checkinTime, timeZone),
      iso(s.checkoutTime),
      fmtLocalCsv(s.checkoutTime, timeZone),
      s.recheckCount,
      iso(s.trafficPassed),
      fmtLocalCsv(s.trafficPassed, timeZone),
      s.note,
      zoneName(timeZone),
    ]
      .map(csvEscape)
      .join(','),
  );

/** One CSV row per station; every time in UTC and in local time (`timeZone`). */
export function reportToCsv(report, { timeZone } = {}) {
  return [REPORT_CSV_HEADER.join(','), ...reportRows(report, timeZone)].join('\r\n') + '\r\n';
}

/** All past nets as one CSV (one row per station per net). */
export function historyToCsv(history, { timeZone } = {}) {
  const rows = [REPORT_CSV_HEADER.join(',')];
  for (const net of history || []) rows.push(...reportRows(buildReport(net, net.endTime ?? net.startTime), timeZone));
  return rows.join('\r\n') + '\r\n';
}

/**
 * Self-contained print-ready HTML (caller opens a window and prints).
 * `{ times: 'both', timeZone }` adds local-time columns and header lines.
 */
export function reportToPrintHtml(report, opts = {}) {
  const r = report;
  const both = withLocal(opts);
  const tz = opts.timeZone;
  const zone = esc(localParts(r.startTime ?? Date.now(), tz)?.zone || zoneName(tz));
  const rows = r.stations
    .map(
      (s) => `<tr>
        <td class="mono">${fmtHHMM(s.checkinTime)}</td>${both ? `\n        <td class="mono">${fmtLocalHHMM(s.checkinTime, tz)}</td>` : ''}
        <td class="mono">${esc(s.call)}</td>
        <td>${esc(flagsToText(s.flags))}</td>
        <td>${esc(s.name)}</td>
        <td>${esc(s.location)}</td>
        <td class="mono">${s.checkoutTime != null ? fmtHHMM(s.checkoutTime) + (both ? ` / ${fmtLocalHHMM(s.checkoutTime, tz)}` : '') : ''}</td>
        <td>${esc(
          [
            s.recheckCount > 0 ? `recheck x${s.recheckCount}` : '',
            s.trafficPassed != null ? 'traffic passed' : '',
            s.note,
          ]
            .filter(Boolean)
            .join('; '),
        )}</td>
      </tr>`,
    )
    .join('\n');
  const localRow = (label, ts) =>
    both
      ? `\n  <tr><td class="k">${label} (local)</td><td class="mono">${esc(fmtLocalDateTime(ts, tz))}</td></tr>`
      : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Net Report — ${esc(r.name)}</title>
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
  @media print { body { margin: 8mm; } }
</style>
</head>
<body>
<h1>Net Report — ${esc(r.name)}</h1>
<div class="sub">Generated ${fmtUtc(Date.now())} by OpenHamClock</div>
<table class="head">
  <tr><td class="k">Net control</td><td class="mono">${esc(r.ncs || '—')}</td></tr>
  <tr><td class="k">Frequency</td><td class="mono">${esc(r.frequency || '—')}</td></tr>
  <tr><td class="k">Opened (UTC)</td><td class="mono">${fmtUtc(r.startTime)}</td></tr>${localRow('Opened', r.startTime)}
  <tr><td class="k">Closed (UTC)</td><td class="mono">${fmtUtc(r.endTime)}</td></tr>${localRow('Closed', r.endTime)}
  <tr><td class="k">Duration</td><td class="mono">${esc(formatDuration(r.durationMs))}</td></tr>
  <tr><td class="k">Check-ins</td><td class="mono">${r.totalCheckins} (${r.uniqueStations} unique)</td></tr>
  <tr><td class="k">Traffic</td><td class="mono">${r.trafficCount} listed, ${r.trafficPassed} passed</td></tr>
</table>
<table class="log">
  <thead><tr><th>In (UTC)</th>${both ? `<th>In (${zone})</th>` : ''}<th>Callsign</th><th>Flags</th><th>Name</th><th>Location</th><th>Out</th><th>Notes</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
}

// ── EmComm roster bridge ────────────────────────────────────────────────────

/**
 * A station as an EmComm Net Roster entry — the same shape the APRS roster
 * (`GET /api/aprs/net`) hands out, so anything built on the roster (ICS
 * forms, the Net Roster panel) can consume a voice net's check-ins unchanged.
 * The `status` string mirrors what a manual API check-in would carry.
 */
export function toRosterEntries(net) {
  return (net?.stations || [])
    .slice()
    .sort((a, b) => a.checkinTime - b.checkinTime)
    .map((s) => {
      const bits = [
        flagsToText(s.flags),
        s.name,
        s.location,
        s.checkoutTime != null ? `out ${fmtHHMM(s.checkoutTime)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        call: s.call,
        netName: net.name,
        status: bits ? `Voice net: ${bits}` : 'Checked in',
        checkinTime: s.checkinTime,
        lastHeard: s.checkoutTime ?? s.lastActivity ?? s.checkinTime,
        lat: null,
        lon: null,
        tokens: [],
        source: 'net-control',
      };
    });
}

// ── Script templates ────────────────────────────────────────────────────────

export const DEFAULT_PREAMBLE = `Calling all stations, calling all stations. This is {ncs} opening the {net}.

This net meets to pass traffic, share information, and keep our operators trained and ready. This is a directed net; please do not transmit unless called upon by net control. If you have emergency or priority traffic at any time, break in with your callsign and the word EMERGENCY.

Today is {date} and the time is {time}. Before we begin, is there any emergency or priority traffic? ... Nothing heard.

When checking in, give your callsign phonetically, your name, and your location, then say "no traffic" or "with traffic". Please wait for acknowledgement.

Stations with traffic for the net, please check in now.

Mobile and short-time stations, please check in now.

All other stations, please check in now.`;

export const DEFAULT_CLOSING = `Is there anything further for the net? ... Hearing nothing, this is {ncs} closing the {net} at {time} with {count} stations checked in.

Thank you to all who participated. The frequency is returned to normal amateur use. This is {ncs}, clear.`;

const SKYWARN_PREAMBLE = `This is {ncs}, net control for the {net}. This net is now in session as a directed net for severe weather reporting.

The National Weather Service has issued watches or warnings for our area. This frequency is reserved for weather reports and emergency traffic. Please do not transmit unless you have a report or are called by net control.

Report only what you observe directly: hail with its size compared to a coin or ball, measured or estimated wind speed and damage, rotation, funnel clouds or tornadoes, flooding, and heavy rain amounts. Give your callsign, your location, what you see, and the time you saw it.

Emergency traffic — any threat to life or property — may break in at any time.

Spotters in the warned area, please check in now with your callsign and location.

All other spotters, please check in now.`;

const SKYWARN_CLOSING = `The threat for our area has ended. This is {ncs} securing the {net} at {time}. {count} stations took part.

Thank you to every spotter — your reports go directly to the National Weather Service. Stay safe. {ncs}, clear.`;

const TACTICAL_PREAMBLE = `All stations, this is net control, {ncs}, for the {net} on {freq}. This is a directed tactical net. The time is {time}.

Use tactical call signs: Net Control, Shelter One, EOC, Hospital, and so on. Identify with your FCC call sign at the end of each exchange and at least every ten minutes.

Keep transmissions short. Priority traffic first, then welfare, then routine. Say "priority" or "emergency" before your call to break in.

Stations taking an assignment, check in now with your tactical call, your FCC call sign, and your location.`;

const TACTICAL_CLOSING = `All stations, this is net control. The {net} is secured at {time}. All tactical assignments are released. Report to your supervisor before leaving your post.

{ncs}, clear.`;

/** The scripts the panel ships with. Built-ins can be edited, reset or deleted like any other. */
export const BUILTIN_TEMPLATES = [
  { id: 'tpl-ares', builtin: 'ares', name: 'ARES weekly net', preamble: DEFAULT_PREAMBLE, closing: DEFAULT_CLOSING },
  {
    id: 'tpl-skywarn',
    builtin: 'skywarn',
    name: 'SKYWARN activation',
    preamble: SKYWARN_PREAMBLE,
    closing: SKYWARN_CLOSING,
  },
  {
    id: 'tpl-tactical',
    builtin: 'tactical',
    name: 'Tactical net',
    preamble: TACTICAL_PREAMBLE,
    closing: TACTICAL_CLOSING,
  },
];

/** Original text of a built-in template ({ preamble, closing }), or null for a user template. */
export function builtinDefault(template) {
  const b = BUILTIN_TEMPLATES.find((t) => t.builtin && t.builtin === template?.builtin);
  return b ? { preamble: b.preamble, closing: b.closing } : null;
}

const cleanTemplate = (t) =>
  t && typeof t === 'object' && t.id
    ? {
        id: String(t.id),
        name: String(t.name || 'Untitled script').slice(0, 60),
        preamble: typeof t.preamble === 'string' ? t.preamble : '',
        closing: typeof t.closing === 'string' ? t.closing : '',
        ...(t.builtin ? { builtin: String(t.builtin) } : {}),
      }
    : null;

/** Template by id, falling back to the first one (never null). */
export function getTemplate(templates, id) {
  const list = Array.isArray(templates) && templates.length ? templates : BUILTIN_TEMPLATES;
  return list.find((t) => t.id === id) || list[0];
}

/** "Name", "Name (2)", … — a name not already used in the list. */
export function uniqueTemplateName(templates, name) {
  const base = String(name || 'Untitled script').trim() || 'Untitled script';
  const used = new Set((templates || []).map((t) => t.name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
}

/** Add a template; returns { templates, id }. */
export function addTemplate(templates, { name = 'New script', preamble = '', closing = '' } = {}) {
  const t = { id: newId('tpl'), name: uniqueTemplateName(templates, name), preamble, closing };
  return { templates: [...(templates || []), t], id: t.id };
}

/** Copy a template (user copy, no built-in tag); returns { templates, id }. */
export function duplicateTemplate(templates, id) {
  const src = getTemplate(templates, id);
  return addTemplate(templates, { name: `${src.name} (copy)`, preamble: src.preamble, closing: src.closing });
}

export function renameTemplate(templates, id, name) {
  const n = String(name || '').trim();
  if (!n) return templates;
  const others = (templates || []).filter((t) => t.id !== id);
  return (templates || []).map((t) => (t.id === id ? { ...t, name: uniqueTemplateName(others, n).slice(0, 60) } : t));
}

export function updateTemplate(templates, id, { preamble, closing } = {}) {
  return (templates || []).map((t) =>
    t.id === id
      ? {
          ...t,
          ...(typeof preamble === 'string' ? { preamble } : {}),
          ...(typeof closing === 'string' ? { closing } : {}),
        }
      : t,
  );
}

/** Delete a template; the last remaining one cannot be deleted. */
export function deleteTemplate(templates, id) {
  if (!Array.isArray(templates) || templates.length <= 1) return templates;
  return templates.filter((t) => t.id !== id);
}

/** Date/time strings for the script placeholders. */
export function scriptContext(net, now = Date.now(), timeZone = undefined) {
  const d = new Date(now);
  let date = d.toDateString();
  let time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')} local`;
  const tz = timeZone ? { timeZone } : {};
  try {
    date = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...tz });
    time = `${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', ...tz })} local (${fmtHHMM(now)} UTC)`;
  } catch {
    /* Intl unavailable — keep the plain fallbacks */
  }
  return {
    net: net?.name || '',
    ncs: net?.ncs || '',
    freq: net?.frequency || '',
    date,
    time,
    count: String((net?.stations || []).length),
  };
}

/** Replace {net} {ncs} {freq} {date} {time} {count} in a script block. */
export function fillTemplate(text, ctx = {}) {
  return String(text || '').replace(/\{(net|ncs|freq|date|time|count)\}/g, (m, k) =>
    ctx[k] != null && ctx[k] !== '' ? String(ctx[k]) : m,
  );
}

// ── Station memory (name/location fills) ────────────────────────────────────

/**
 * Pick a name/location for a call from the logbook (most recent QSO with a
 * name wins). Location comes from ADIF QTH, then STATE.
 */
export function stationFromLogbook(qsos, call) {
  const c = String(call || '').toUpperCase();
  if (!c || !Array.isArray(qsos)) return null;
  let best = null;
  for (const q of qsos) {
    if (String(q?.call || '').toUpperCase() !== c) continue;
    const name = String(q.name || '').trim();
    const location = String(q.extras?.QTH || q.extras?.qth || q.extras?.STATE || q.extras?.state || '').trim();
    if (!name && !location) continue;
    const stamp = `${q.qso_date || ''}${q.time_on || ''}`;
    if (!best || stamp > best.stamp) best = { name, location, stamp };
  }
  return best ? { name: best.name, location: best.location } : null;
}

/** Name/location from a /api/callsign lookup result. */
export function stationFromLookup(data) {
  // Prefix / DXCC estimates know the country and nothing about the operator
  if (!data || typeof data !== 'object' || data.estimated || data.source === 'prefix') return null;
  const name = [data.fname, data.name].filter(Boolean).join(' ').trim();
  // Country alone is noise on a local net — only used alongside a real name
  const location =
    [data.county, data.state].filter(Boolean).join(', ') || (name && data.country !== 'Unknown' && data.country) || '';
  if (!name && !location) return null;
  return { name, location: String(location || '').trim() };
}

// ── Storage ─────────────────────────────────────────────────────────────────

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the panel keeps working in memory */
  }
};

const isLiveNet = (r) => !!(r && typeof r === 'object' && Array.isArray(r.stations) && r.name);
const isTombstone = (r) => !!(r && typeof r === 'object' && r.closedId && !Array.isArray(r.stations));
const normalizeNet = (r) => ({ undo: [], rev: 0, ...r });

/**
 * The stored running-net record as written: a live net (with `rev`), a
 * tombstone `{ closedId, rev }` left when a net is closed, or null.
 */
export function readRunningNetRecord() {
  const r = readJson(NET_CONTROL_KEY, null);
  return isLiveNet(r) || isTombstone(r) ? r : null;
}

/** The in-progress net, or null. */
export function loadRunningNet() {
  const r = readRunningNetRecord();
  return isLiveNet(r) ? normalizeNet(r) : null;
}
export const saveRunningNet = (net) => writeJson(NET_CONTROL_KEY, net);
export const clearRunningNet = () => writeJson(NET_CONTROL_KEY, null);

// ── Keeping tabs and panels in step ─────────────────────────────────────────
//
// Every write of the running net carries a revision counter (`rev`) that only
// ever goes up within a browser. A panel applies a change from elsewhere only
// when its rev is higher than what it holds, and refuses to write over a
// stored state newer than the one its change was based on — so a stale tab
// can never clobber a newer net. Other tabs hear about writes through the
// `storage` event; other panels (any tab) through a BroadcastChannel.

/** BroadcastChannel name for running-net changes and presence. */
export const NET_CONTROL_CHANNEL = 'ohc-net-control';
/** A panel that has not said hello for this long is assumed gone. */
export const PEER_TTL_MS = 12 * 1000;

/**
 * Should `record` (a stored/received running-net record) replace `local`?
 * Returns { net, changed }. Higher rev wins; a tombstone closes the matching
 * net; anything older or unrelated leaves `local` alone.
 */
export function pickNewer(local, record) {
  const localRev = local?.rev ?? 0;
  if (isTombstone(record)) {
    if (local && record.closedId === local.id && (record.rev ?? 0) >= localRev) return { net: null, changed: true };
    return { net: local, changed: false };
  }
  if (isLiveNet(record) && (!local || (record.rev ?? 0) > localRev))
    return { net: normalizeNet(record), changed: true };
  return { net: local, changed: false };
}

/**
 * Write `next` (null = the net was closed) as the successor of `base`.
 * Refused when the stored state moved on since `base` was read (another tab
 * or panel wrote first): returns { net: <the newer state>, conflict: true }
 * and writes nothing. Otherwise returns { net: <next with its new rev>,
 * conflict: false }.
 */
export function commitRunningNet(base, next, now = Date.now()) {
  const stored = readRunningNetRecord();
  const storedRev = stored?.rev ?? 0;
  const baseRev = base?.rev ?? 0;
  const conflict = base
    ? storedRev > baseRev && (isLiveNet(stored) || stored?.closedId === base.id)
    : isLiveNet(stored) && stored.id !== next?.id;
  if (conflict) return { net: pickNewer(base, stored).net, conflict: true };
  const rev = Math.max(storedRev, baseRev) + 1;
  if (next == null) {
    writeJson(NET_CONTROL_KEY, { closedId: base?.id || '', rev, updatedAt: now });
    return { net: null, conflict: false };
  }
  const out = { ...next, rev, updatedAt: now };
  writeJson(NET_CONTROL_KEY, out);
  return { net: out, conflict: false };
}

/** Net-level fields a change can touch (stations are compared per call). */
const NET_FIELDS = [
  'name',
  'frequency',
  'ncs',
  'calling',
  'scriptId',
  'endTime',
  'offset',
  'freqMhz',
  'mode',
  'region',
];

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Calls whose station line differs between nets `a` and `b` (added, removed or changed). */
export function changedCalls(a, b) {
  const byCall = (n) => new Map((n?.stations || []).map((s) => [s.call, s]));
  const ma = byCall(a);
  const mb = byCall(b);
  const out = new Set();
  for (const call of new Set([...ma.keys(), ...mb.keys()])) {
    if (!sameValue(ma.get(call), mb.get(call))) out.add(call);
  }
  return out;
}

/** Net-level fields that differ between `a` and `b`. */
export function changedNetFields(a, b) {
  return NET_FIELDS.filter((f) => !sameValue(a?.[f], b?.[f]));
}

/**
 * Can a change that was refused (because another tab or panel wrote first)
 * simply be re-applied to the newer net? `base` is what this panel had,
 * `mine` its change, `theirs` the newer stored net. Yes when the two changes
 * touched different station lines and different net fields (or set a field
 * to the same value) — e.g. checking in two different calls, or toggling
 * flags on two different lines. No when both changed the same station, when
 * the other side closed the net or started a different one.
 * Returns { ok, calls: [both changed], fields: [both changed differently] }.
 */
export function rebaseCheck(base, mine, theirs) {
  if (!base || !mine || !theirs || theirs.id !== base.id || mine.id !== base.id) {
    return { ok: false, calls: [], fields: [] };
  }
  const theirCalls = changedCalls(base, theirs);
  const calls = [...changedCalls(base, mine)].filter((c) => theirCalls.has(c));
  const theirFields = changedNetFields(base, theirs);
  const fields = changedNetFields(base, mine).filter((f) => theirFields.includes(f) && !sameValue(mine[f], theirs[f]));
  return { ok: calls.length === 0 && fields.length === 0, calls, fields };
}

/** Number of other Net Control panels heard from within PEER_TTL_MS ({ id: lastSeenMs }). */
export function livePeerCount(peers, now = Date.now()) {
  return Object.values(peers || {}).filter((ts) => now - ts < PEER_TTL_MS).length;
}

// ── Shared-incident adapters ────────────────────────────────────────────────
//
// For syncing the running net beyond this browser (a server-side shared
// incident). serializeNetState() produces a plain JSON document without the
// local undo stack; applyRemoteNetState() folds a received one into the local
// net with the same revision rules the tabs use. The transport is not here.

export const NET_STATE_VERSION = 1;

/** Plain JSON for the running net (or a closed-net tombstone, or null = no net). */
export function serializeNetState(netOrRecord, now = Date.now()) {
  if (isTombstone(netOrRecord)) {
    return {
      v: NET_STATE_VERSION,
      kind: 'net-control',
      net: null,
      closedId: netOrRecord.closedId,
      rev: netOrRecord.rev ?? 0,
      updatedAt: netOrRecord.updatedAt ?? now,
    };
  }
  if (!isLiveNet(netOrRecord))
    return { v: NET_STATE_VERSION, kind: 'net-control', net: null, closedId: null, rev: 0, updatedAt: now };
  const { undo: _undo, ...net } = netOrRecord;
  return {
    v: NET_STATE_VERSION,
    kind: 'net-control',
    net,
    closedId: null,
    rev: net.rev ?? 0,
    updatedAt: net.updatedAt ?? now,
  };
}

/**
 * Apply a serialized state from elsewhere. Returns { net, changed }. The
 * local undo stack is kept only when the remote state is the same net at the
 * same revision; a newer remote state starts with an empty undo stack (this
 * operator cannot undo someone else's entries).
 */
export function applyRemoteNetState(local, remote) {
  if (!remote || remote.kind !== 'net-control' || remote.v !== NET_STATE_VERSION) return { net: local, changed: false };
  const record = remote.net
    ? { ...remote.net, rev: remote.rev, undo: [] }
    : remote.closedId
      ? { closedId: remote.closedId, rev: remote.rev }
      : null;
  return pickNewer(local, record);
}

/** Past nets, newest first. */
export function loadHistory() {
  const list = readJson(NET_CONTROL_HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((n) => n && Array.isArray(n.stations)) : [];
}
export const saveHistory = (list) => writeJson(NET_CONTROL_HISTORY_KEY, list);

/** Prepend a closed net to the history (undo stack dropped), capped at MAX_HISTORY. */
export function pushHistory(list, net) {
  const { undo: _undo, ...rest } = net || {};
  return [rest, ...(list || []).filter((n) => n.id !== rest.id)].slice(0, MAX_HISTORY);
}

/**
 * Script templates: { templates: [{ id, name, preamble, closing, builtin? }],
 * lastId }. First load seeds the built-ins; a single script saved by the
 * first release (NET_CONTROL_SCRIPT_KEY) that differs from the default is
 * carried over as "My net script".
 */
export function loadScriptTemplates() {
  const stored = readJson(NET_CONTROL_SCRIPTS_KEY, null);
  const list = Array.isArray(stored?.templates) ? stored.templates.map(cleanTemplate).filter(Boolean) : [];
  if (list.length) return { templates: list, lastId: getTemplate(list, stored.lastId).id };
  const templates = BUILTIN_TEMPLATES.map((t) => ({ ...t }));
  const old = readJson(NET_CONTROL_SCRIPT_KEY, null);
  if (old && (old.preamble !== DEFAULT_PREAMBLE || old.closing !== DEFAULT_CLOSING)) {
    const mine = {
      id: newId('tpl'),
      name: 'My net script',
      preamble: typeof old.preamble === 'string' ? old.preamble : DEFAULT_PREAMBLE,
      closing: typeof old.closing === 'string' ? old.closing : DEFAULT_CLOSING,
    };
    return { templates: [mine, ...templates], lastId: mine.id };
  }
  return { templates, lastId: templates[0].id };
}
export const saveScriptTemplates = (state) => writeJson(NET_CONTROL_SCRIPTS_KEY, state);

/** Preamble/closing of the last-used template (kept for callers of the single-script API). */
export function loadScript() {
  const { templates, lastId } = loadScriptTemplates();
  const t = getTemplate(templates, lastId);
  return { preamble: t.preamble, closing: t.closing };
}

/** callsign → { name, location, ts } remembered from previous nets. */
export function loadStationCache() {
  const c = readJson(NET_CONTROL_STATIONS_KEY, {});
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

/** Remember a station's name/location (newest STATION_CACHE_MAX kept). Returns the new cache. */
export function rememberStation(cache, call, { name = '', location = '' } = {}, now = Date.now()) {
  const c = String(call || '').toUpperCase();
  if (!c || (!name && !location)) return cache;
  const prev = cache?.[c] || {};
  const next = { ...cache, [c]: { name: name || prev.name || '', location: location || prev.location || '', ts: now } };
  const keys = Object.keys(next);
  if (keys.length > STATION_CACHE_MAX) {
    keys.sort((a, b) => (next[a].ts || 0) - (next[b].ts || 0));
    for (const k of keys.slice(0, keys.length - STATION_CACHE_MAX)) delete next[k];
  }
  return next;
}
export const saveStationCache = (cache) => writeJson(NET_CONTROL_STATIONS_KEY, cache);

/** Window event fired after the roster snapshot changes (same-tab listeners). */
export const NET_CONTROL_ROSTER_EVENT = 'ohc-net-control-roster';

/**
 * Write the voice net's stations into the EmComm roster store, in the same
 * entry shape as `GET /api/aprs/net` roster entries. `active` is true while
 * the net runs (the EmComm Net Roster shows these stations live); a closed
 * net's roster stays readable (active: false) for reports and forms until
 * the next net starts.
 */
export function saveRosterSnapshot(net, { active = false, now = Date.now() } = {}) {
  writeJson(NET_CONTROL_ROSTER_KEY, {
    active: !!active,
    netId: net?.id || '',
    net: net?.name || '',
    ncs: net?.ncs || '',
    frequency: net?.frequency || '',
    freqMhz: net?.freqMhz ?? null,
    mode: net?.mode || '',
    region: net?.region || null,
    offset: net?.offset || '',
    startTime: net?.startTime ?? null,
    endTime: net?.endTime ?? null,
    roster: toRosterEntries(net),
    ts: now,
  });
  try {
    window.dispatchEvent(new Event(NET_CONTROL_ROSTER_EVENT));
  } catch {
    /* no window (tests/SSR) */
  }
}

/** The stored voice-net roster snapshot, or null. */
export function getNetControlRoster() {
  const snap = readJson(NET_CONTROL_ROSTER_KEY, null);
  return snap && Array.isArray(snap.roster) ? snap : null;
}

/**
 * Merge the APRS roster with the active voice net's roster entries for
 * display. An APRS entry wins over a voice entry for the same base call;
 * voice entries get age/stale like the APRS ones.
 */
export function mergeRosters(aprsRoster, snapshot, now = Date.now()) {
  const base = Array.isArray(aprsRoster) ? aprsRoster : [];
  if (!snapshot?.active || !Array.isArray(snapshot.roster)) return base;
  const baseCall = (c) =>
    String(c || '')
      .toUpperCase()
      .split('-')[0];
  const seen = new Set(base.map((op) => baseCall(op.call)));
  const extra = snapshot.roster
    .filter((op) => !seen.has(baseCall(op.call)))
    .map((op) => {
      const age = Math.max(0, Math.floor((now - (op.lastHeard ?? op.checkinTime ?? now)) / 60000));
      return { ...op, age, stale: false };
    });
  return extra.length ? [...base, ...extra] : base;
}

// ── Frequency text ──────────────────────────────────────────────────────────

/**
 * IARU region for repeater band plans, from the station's location
 * ({ lat, lon }). R2 = the Americas, R1 = Europe, Africa, the Middle East
 * and northern Asia, R3 = the rest of Asia and the Pacific. Null when the
 * location is unknown.
 */
export function bandPlanRegion(location) {
  const lat = Number(location?.lat);
  const lon = Number(location?.lon);
  if (location?.lat == null || location?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lon <= -25) return 'R2';
  if (lon < 60 || lat >= 50) return 'R1';
  return 'R3';
}

/**
 * Standard repeater offset magnitudes (MHz) by region and band: [lo, hi,
 * offset, check]. `check` marks offsets that vary locally (the band plan has
 * more than one pairing in use), so the panel says "check locally" instead
 * of presenting the guess as fact. A band missing here has no single
 * standard: the offset is reported unknown ("offset?") and the operator
 * types it.
 */
export const REPEATER_OFFSETS = {
  R2: [
    [29.5, 29.7, 0.1, false], // 10 m FM: 29.62–29.68 out, −100 kHz
    // 6 m, ARRL band plan (https://www.arrl.org/band-plan, checked 2026-10-15):
    // each repeater-output segment pairs with inputs 500 kHz below it —
    //   51.62–51.98 out / 51.12–51.48 in (19 channels)
    //   52.5–52.98 out  / 52.0–52.48 in  ("except as noted"; test pair 52.7/52.2)
    //   53.5–53.98 out  / 53.0–53.48 in  ("except as noted")
    // The two upper segments allow local exceptions, so they say "check
    // locally". Frequencies outside an output segment (simplex, inputs, a
    // locally coordinated pairing) have no standard and show "offset?".
    // The plan is the US one; it is applied to the whole of Region 2.
    [51.62, 51.98, 0.5, false],
    [52.5, 52.98, 0.5, true],
    [53.5, 53.98, 0.5, true],
    [144, 148, 0.6, false],
    [222, 225, 1.6, false],
    [420, 450, 5, false],
    [902, 928, 12, false],
  ],
  R1: [
    [29.5, 29.7, 0.1, false],
    [50, 52, 0.5, true], // 6 m repeaters exist in a few countries; 500 kHz where they do
    [144, 146, 0.6, false],
    [430, 440, 7.6, true], // IARU R1 −7.6 MHz; several countries use other splits
  ],
  R3: [
    [29.5, 29.7, 0.1, false],
    [144, 148, 0.6, true],
    [430, 440, 5, true],
  ],
};

/** { offset (MHz magnitude), check } for `mhz` in `region`, or null when there is no standard. */
export function standardOffset(mhz, region) {
  const row = (REPEATER_OFFSETS[region] || []).find(([lo, hi]) => mhz >= lo && mhz <= hi);
  return row ? { offset: row[2], check: row[3] } : null;
}

const MODE_RE = /\b(NFM|FM|DMR|D-?STAR|YSF|C4FM|FUSION|P25|NXDN|M17|USB|LSB|SSB|AM|CW)\b/i;
const normDash = (s) => String(s || '').replace(/[−–—]/g, '-');

/** "+5", "-0.6", "−600 kHz", "500k", "0" → { sign: '+'|'-'|null, mhz } or null. */
export function parseOffset(text) {
  const m = /^\s*([+-])?\s*(\d+(?:\.\d+)?)\s*(MHz|kHz|k|M)?\s*$/i.exec(normDash(text));
  if (!m) return null;
  let mhz = Number(m[2]);
  if (/^k/i.test(m[3] || '') || (!m[3] && mhz >= 100)) mhz /= 1000;
  return { sign: m[1] || null, mhz };
}

/**
 * Read a free-text frequency/repeater description as typed when starting a
 * net ("146.940 − PL 100.0", "442.150 +5 T 123.0 FM", "3.873 LSB").
 *
 * Options: `region` (bandPlanRegion) for standard offsets, `offset` — an
 * operator override ("−0.6", "+500k"; the sign may also come from the text).
 *
 * Returns { mhz, txMhz, offsetMhz (signed), offsetSource, offsetCheck, tone,
 * mode } or null when no frequency is found. offsetSource is 'explicit'
 * (written in the text), 'override', 'standard' (band plan; offsetCheck
 * true when it varies locally), 'simplex' (no offset given), or 'unknown'
 * — a direction without a known size, where txMhz and offsetMhz are null
 * and the panel shows "offset?".
 */
export function parseNetFrequency(text, { region = null, offset = '' } = {}) {
  const s = normDash(text);
  const m = /(\d{1,4}\.\d{1,6})/.exec(s);
  if (!m) return null;
  const mhz = Number(m[1]);
  if (!Number.isFinite(mhz) || mhz <= 0) return null;
  const rest = s.slice(m.index + m[0].length);
  const explicit = /^\s*(?:MHz)?\s*([+-])\s*(\d+(?:\.\d+)?)\s*(MHz|kHz)?/i.exec(rest);
  const signOnly = /^\s*(?:MHz)?\s*([+-])(?=\s|$|[A-Za-z])/i.exec(rest);
  const textSign = explicit?.[1] || signOnly?.[1] || null;
  const over = String(offset || '').trim() ? parseOffset(offset) : null;

  let offsetMhz = 0;
  let offsetSource = 'simplex';
  let offsetCheck = false;
  if (over) {
    const sign = over.sign || textSign || '-';
    offsetMhz = over.mhz === 0 ? 0 : sign === '-' ? -over.mhz : over.mhz;
    offsetSource = 'override';
  } else if (explicit) {
    let off = Number(explicit[2]);
    if (/khz/i.test(explicit[3] || '') || off >= 100) off /= 1000;
    offsetMhz = explicit[1] === '-' ? -off : off;
    offsetSource = 'explicit';
  } else if (signOnly) {
    const std = standardOffset(mhz, region);
    if (std) {
      offsetMhz = signOnly[1] === '-' ? -std.offset : std.offset;
      offsetSource = 'standard';
      offsetCheck = std.check;
    } else {
      offsetMhz = null;
      offsetSource = 'unknown';
    }
  }
  const round = (x) => Math.round(x * 1e6) / 1e6;
  const toneM =
    /\b(?:PL|CTCSS|TONE|TSQ|T)\s*:?\s*(\d{2,3}(?:\.\d)?)\b/i.exec(rest) ||
    /\b(\d{2,3}\.\d)\s*Hz\b/i.exec(rest) ||
    /\b(?:DCS|DPL)\s*:?\s*(\d{3})\b/i.exec(rest);
  const modeM = MODE_RE.exec(rest);
  return {
    mhz,
    txMhz: offsetMhz == null ? null : round(mhz + offsetMhz),
    offsetMhz: offsetMhz == null ? null : round(offsetMhz),
    offsetSource,
    offsetCheck,
    tone: toneM ? toneM[1] : '',
    mode: modeM ? modeM[1].toUpperCase() : '',
  };
}

/** "−0.6 MHz" / "+500 kHz" for an offset in MHz (signed). */
export function formatOffset(offsetMhz) {
  if (offsetMhz == null || !Number.isFinite(offsetMhz)) return '';
  const sign = offsetMhz < 0 ? '−' : '+';
  const abs = Math.abs(offsetMhz);
  return abs < 1 ? `${sign}${Math.round(abs * 1000)} kHz` : `${sign}${Number(abs.toFixed(3))} MHz`;
}
