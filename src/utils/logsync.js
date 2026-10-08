/**
 * logsync — client engine for the three log-sync integrations:
 *
 *   1. Wavelog/Cloudlog push  → POST /api/logsync/wavelog (server proxy)
 *   2. QRZ Logbook push       → POST /api/logsync/qrz     (server proxy)
 *   3. LoTW confirmations pull → GET /api/logsync/lotw    (server proxy)
 *
 * Push model ("unsynced" = pending queue):
 *   Every QSO logged in OHC while a push service is enabled is appended to a
 *   per-service retry queue in localStorage (`ohc-logsync-queue`, capped at
 *   100 entries, oldest dropped). A successful push removes the entry; a
 *   failed push keeps it for retry. "Push all unsynced" simply drains the
 *   queue. This was chosen over an extras.SYNC flag on each QSO because:
 *     - extras are emitted verbatim by buildAdif, so a flag would pollute
 *       every ADIF export with a non-standard field;
 *     - sync state is per-service (Wavelog vs QRZ) — one flag can't be;
 *     - an imported 10k-QSO history must NOT count as "unsynced" (draining
 *       it at 1 push/sec would take hours and spam the remote logbook) —
 *       with the queue model, only QSOs logged here while the integration
 *       is on are ever candidates.
 *   Consequence: editing an already-pushed QSO does not re-push it (noted as
 *   a follow-up; remote update APIs differ per service).
 *
 * Rate-limit courtesy: pushes are spaced 1/sec; LoTW syncs are gated by a
 * 5-minute client-side cooldown (LoTW is slow and fragile).
 *
 * Credentials come from utils/logsyncConfig.js (browser-local only) and are
 * sent per-request to our server proxy — never stored server-side.
 */

import * as logbookStore from '../services/logbookStore.js';
import { buildAdif } from './adif.js';
import {
  getLogsyncConfig,
  getLogsyncState,
  isServiceReady,
  lotwAuthHeaders,
  setLogsyncState,
} from './logsyncConfig.js';

export const QUEUE_KEY = 'ohc-logsync-queue';
export const QUEUE_CAP = 100;
export const PUSH_SPACING_MS = 1000; // 1 push/sec courtesy throttle
export const LOTW_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between LoTW syncs
export const LOTW_MATCH_WINDOW_MS = 30 * 60 * 1000; // ±30 min time match

// ── Change notification (Settings cards + Logbook footer badge) ────────────

const subscribers = new Set();
const notify = () => {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
};

/** Subscribe to queue/state changes. cb takes no args — re-read the getters. */
export const subscribeLogsync = (cb) => {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
};

// ── Retry queue (localStorage, capped) ─────────────────────────────────────

/** [{ service:'wavelog'|'qrz', qsoId, attempts, addedAt }] */
export const getQueue = () => {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
};

const saveQueue = (queue) => {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage unavailable — queue just won't survive a reload
  }
  notify();
};

/** Pending (unsynced) count, optionally for one service. */
export const getPendingCount = (service) => {
  const q = getQueue();
  return service ? q.filter((e) => e.service === service).length : q.length;
};

/** Append a QSO to a service's queue (no dupes; capped, oldest dropped). */
export const enqueue = (service, qsoId) => {
  if (!qsoId) return;
  const queue = getQueue();
  if (queue.some((e) => e.service === service && e.qsoId === qsoId)) return;
  queue.push({ service, qsoId, attempts: 0, addedAt: Date.now() });
  while (queue.length > QUEUE_CAP) queue.shift();
  saveQueue(queue);
};

const removeFromQueue = (service, qsoId) => {
  saveQueue(getQueue().filter((e) => !(e.service === service && e.qsoId === qsoId)));
};

// ── ADIF helpers ───────────────────────────────────────────────────────────

/**
 * Single ADIF record (no header) for upstream APIs — both Wavelog's `string`
 * field and QRZ's `ADIF=` parameter want record(s) without an <eoh> header.
 * Reuses buildAdif and strips its header so there is one field-emission path.
 */
export const buildAdifRecord = (qso, { myCall } = {}) => {
  const full = buildAdif([qso], { myCall });
  const eoh = full.search(/<eoh>/i);
  return (eoh === -1 ? full : full.slice(eoh + '<eoh>'.length)).trim();
};

/** UTC millis for a QSO's qso_date (YYYYMMDD) + time_on (HHMM[SS]); NaN when unparsable. */
export const qsoTimestamp = (qso) => {
  const d = String(qso?.qso_date || '').trim();
  const t = String(qso?.time_on || '').trim();
  if (!/^\d{8}$/.test(d) || !/^\d{4}(\d{2})?$/.test(t)) return NaN;
  return Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    t.length === 6 ? Number(t.slice(4, 6)) : 0,
  );
};

// ── Server proxy calls ─────────────────────────────────────────────────────

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

const pushOne = async (service, qso, myCall) => {
  const cfg = getLogsyncConfig();
  const adif = buildAdifRecord(qso, { myCall });
  if (service === 'wavelog') {
    await postJson('/api/logsync/wavelog', {
      url: cfg.wavelog.url,
      key: cfg.wavelog.apiKey,
      stationProfileId: cfg.wavelog.stationProfileId,
      adif,
    });
    setLogsyncState({ wavelogLastPushAt: Date.now() });
  } else if (service === 'qrz') {
    await postJson('/api/logsync/qrz', { key: cfg.qrz.apiKey, adif });
    setLogsyncState({ qrzLastPushAt: Date.now() });
  } else {
    throw new Error(`unknown push service: ${service}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let processing = false;

/**
 * Drain the retry queue: sequential, 1/sec. A failure marks that service
 * "down" for the rest of the run (its remaining entries stay queued) so a
 * dead server doesn't burn one timeout per entry. Safe to call anytime;
 * concurrent calls coalesce.
 * @returns {Promise<{ pushed: number, failed: number }>}
 */
export const processQueue = async ({ myCall } = {}) => {
  if (processing) return { pushed: 0, failed: 0 };
  processing = true;
  let pushed = 0;
  let failed = 0;
  try {
    const cfg = getLogsyncConfig();
    const skipServices = new Set(['wavelog', 'qrz'].filter((s) => !isServiceReady(s, cfg)));
    const snapshot = getQueue();
    let first = true;
    for (const entry of snapshot) {
      if (skipServices.has(entry.service)) continue;
      const qso = logbookStore.getAll().find((q) => q.id === entry.qsoId);
      if (!qso) {
        removeFromQueue(entry.service, entry.qsoId); // deleted since queueing
        continue;
      }
      if (!first) await sleep(PUSH_SPACING_MS);
      first = false;
      try {
        await pushOne(entry.service, qso, myCall);
        removeFromQueue(entry.service, entry.qsoId);
        pushed++;
      } catch (err) {
        failed++;
        skipServices.add(entry.service);
        const queue = getQueue();
        const live = queue.find((e) => e.service === entry.service && e.qsoId === entry.qsoId);
        if (live) {
          live.attempts += 1;
          live.lastError = String(err?.message || err).slice(0, 200);
        }
        saveQueue(queue);
      }
    }
  } finally {
    processing = false;
    notify();
  }
  return { pushed, failed };
};

/**
 * Hook for "a QSO was just logged in this browser": queue it for every
 * enabled push service and kick a background drain (fire-and-forget).
 */
export const onQsoLogged = (qso, { myCall } = {}) => {
  if (!qso?.id) return;
  const cfg = getLogsyncConfig();
  let queued = false;
  for (const service of ['wavelog', 'qrz']) {
    if (isServiceReady(service, cfg)) {
      enqueue(service, qso.id);
      queued = true;
    }
  }
  if (queued) processQueue({ myCall }).catch(() => {});
};

// ── Test buttons ───────────────────────────────────────────────────────────

/** Validate a Wavelog/Cloudlog URL+key. Resolves { ok, stations:[...] }. */
export const testWavelog = async ({ url, key }) => postJson('/api/logsync/wavelog', { url, key, test: true });

/** Validate a QRZ Logbook API key via ACTION=STATUS. Resolves { ok, data }. */
export const testQrz = async ({ key }) => postJson('/api/logsync/qrz', { key, test: true });

/** Validate LoTW credentials with a zero-row query. Resolves { ok }. */
export const testLotw = async ({ username, password }) => {
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const res = await fetch('/api/logsync/lotw?test=1', {
    headers: { 'X-LoTW-Auth': b64(`${username}:${password}`) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// ── LoTW confirmations pull ────────────────────────────────────────────────

/** ms until the next LoTW sync is allowed (0 = allowed now). */
export const lotwCooldownRemainingMs = (now = Date.now()) => {
  const last = getLogsyncState().lotwLastAttemptAt || 0;
  return Math.max(0, last + LOTW_COOLDOWN_MS - now);
};

const compatibleModes = (a, b) => {
  const am = String(a.mode || '').toUpperCase();
  const bm = String(b.mode || '').toUpperCase();
  const asub = String(a.submode || '').toUpperCase();
  const bsub = String(b.submode || '').toUpperCase();
  // Same mode, or one side's submode equals the other's mode (LoTW reports
  // e.g. FT4 as MODE=MFSK SUBMODE=FT4 while local logs often say MODE=FT4).
  return (am && am === bm) || (asub && asub === bm) || (bsub && bsub === am) || (asub && asub === bsub);
};

/**
 * Match LoTW QSL records against local QSOs: call + band + compatible mode +
 * time_on within ±30 min (closest wins; each local QSO matches once).
 *
 * @param {Array<object>} lotwRecords parsed ADIF records from the LoTW report
 * @param {Array<object>} localQsos   records from logbookStore
 * @returns {{ updates: Array<{id, extras}>, matched: number, unmatched: Array<object> }}
 *   `updates[].extras` is the FULL merged extras object (logbookStore.update
 *   shallow-merges fields, so extras must be merged by the caller side here).
 */
export const matchLotwConfirmations = (lotwRecords, localQsos) => {
  const updates = [];
  const unmatched = [];
  const claimed = new Set();

  // Pre-index local QSOs by call for cheap candidate lookup.
  const byCall = new Map();
  for (const q of localQsos) {
    const call = String(q.call || '')
      .trim()
      .toUpperCase();
    if (!call) continue;
    if (!byCall.has(call)) byCall.set(call, []);
    byCall.get(call).push(q);
  }

  for (const rec of Array.isArray(lotwRecords) ? lotwRecords : []) {
    const qslRcvd = String(rec.extras?.QSL_RCVD || 'Y').toUpperCase();
    if (qslRcvd !== 'Y') continue; // qso_qsl=yes should only return QSLs, but guard anyway
    const call = String(rec.call || '')
      .trim()
      .toUpperCase();
    const band = String(rec.band || '')
      .trim()
      .toLowerCase();
    const ts = qsoTimestamp(rec);
    const candidates = byCall.get(call) || [];

    let best = null;
    let bestDelta = Infinity;
    for (const q of candidates) {
      if (claimed.has(q.id)) continue;
      if (
        String(q.band || '')
          .trim()
          .toLowerCase() !== band
      )
        continue;
      if (!compatibleModes(rec, q)) continue;
      const qts = qsoTimestamp(q);
      if (!Number.isFinite(ts) || !Number.isFinite(qts)) continue;
      const delta = Math.abs(ts - qts);
      if (delta <= LOTW_MATCH_WINDOW_MS && delta < bestDelta) {
        best = q;
        bestDelta = delta;
      }
    }

    if (best) {
      claimed.add(best.id);
      const qslDate = rec.extras?.QSLRDATE || rec.extras?.APP_LOTW_RXQSL || '';
      updates.push({
        id: best.id,
        extras: {
          ...(best.extras || {}),
          LOTW_QSL_RCVD: 'Y',
          ...(qslDate ? { LOTW_QSLRDATE: String(qslDate).slice(0, 10).replace(/-/g, '') } : {}),
        },
      });
    } else {
      unmatched.push(rec);
    }
  }

  return { updates, matched: updates.length, unmatched };
};

/**
 * Pull new QSOs from Wavelog into the native logbook.
 *
 * Wavelog's QSO primary key is used as the incremental cursor. The cursor is
 * advanced only after the returned ADIF has been successfully persisted, so a
 * failed import is safe to retry. Native-logbook dedup makes retries harmless.
 */
export const syncWavelogQsos = async ({ parseAdif }) => {
  const cfg = getLogsyncConfig();
  const wavelog = cfg.wavelog || {};

  if (!wavelog.pullEnabled) {
    throw new Error('Wavelog pull is not enabled');
  }

  const stationIds = Array.isArray(wavelog.pullStationIds)
    ? wavelog.pullStationIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  if (!wavelog.url || !wavelog.apiKey || stationIds.length === 0) {
    throw new Error('Wavelog pull is not fully configured');
  }

  const state = getLogsyncState();
  const fetchFromId = Number(state.wavelogLastFetchedId) || 0;

  const data = await postJson('/api/logsync/wavelog/pull', {
    url: wavelog.url,
    key: wavelog.apiKey,
    stationIds,
    fetchFromId,
    limit: 5000,
  });

  let imported = 0;
  let skipped = 0;

  if (data.adif && data.exportedQsos > 0) {
    const { qsos } = parseAdif(data.adif);
    const result = await logbookStore.addMany(qsos, { strict: true });
    imported = result.imported;
    skipped = result.skipped;

    // Feed newly pulled, mappable QSOs to OpenHamClock's existing map layer.
    // The API layer is intentionally temporary; the native logbook remains
    // the persistent copy.
    const mapQsos = qsos
      .filter((qso) => qso.gridsquare)
      .map((qso) => {
        const date = String(qso.qso_date || '').replace(/-/g, '');
        const time = String(qso.time_on || '').replace(/:/g, '');
        const timestamp =
          /^\d{8}$/.test(date) && /^\d{4,6}$/.test(time)
            ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6) || '00'}Z`
            : undefined;

        return {
          call: qso.call,
          grid: qso.gridsquare,
          freq: qso.freq,
          band: qso.band,
          mode: qso.mode,
          timestamp,
          label: 'Wavelog',
        };
      });

    // Map arcs are best-effort. A visualization failure must not prevent the
    // successfully persisted native logbook from advancing its Wavelog cursor.
    try {
      for (let i = 0; i < mapQsos.length; i += 100) {
        await postJson('/api/qso-layer', { qsos: mapQsos.slice(i, i + 100) });
      }
    } catch (err) {
      console.warn('Wavelog QSO map-layer update failed:', err);
    }
  }

  const lastFetchedId = Number(data.lastFetchedId);
  if (!Number.isInteger(lastFetchedId) || lastFetchedId < fetchFromId) {
    throw new Error('Wavelog returned an invalid QSO cursor');
  }

  const result = {
    imported,
    skipped,
    fetched: Number(data.exportedQsos) || 0,
    lastFetchedId,
    at: Date.now(),
  };

  setLogsyncState({
    wavelogLastFetchedId: lastFetchedId,
    wavelogLastPullAt: result.at,
    wavelogLastPullResult: result,
  });
  notify();

  return result;
};

/**
 * Pull LoTW confirmations since the stored cursor and apply matches to the
 * local log. Enforces the 5-min cooldown. parseAdif is injected by the caller
 * (the UI already imports utils/adif) so tests can drive this with a stub.
 */
export const syncLotwConfirmations = async ({ parseAdif }) => {
  const remaining = lotwCooldownRemainingMs();
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60000);
    throw new Error(`LoTW cooldown: try again in ${mins} min`);
  }
  setLogsyncState({ lotwLastAttemptAt: Date.now() });
  notify();

  const state = getLogsyncState();
  const params = new URLSearchParams();
  // Overlap the cursor by one day so confirmations landing during a sync are
  // never missed; matching is idempotent so re-seeing a QSL is harmless.
  if (state.lotwQslSince && /^\d{4}-\d{2}-\d{2}$/.test(state.lotwQslSince)) {
    const d = new Date(`${state.lotwQslSince}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    params.set('since', d.toISOString().slice(0, 10));
  }

  const res = await fetch(`/api/logsync/lotw?${params.toString()}`, { headers: lotwAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `LoTW proxy error (HTTP ${res.status})`);
  }
  const text = await res.text();
  const { qsos: lotwRecords } = parseAdif(text);

  await logbookStore.init();
  const { updates, matched, unmatched } = matchLotwConfirmations(lotwRecords, logbookStore.getAll());
  for (const u of updates) {
    await logbookStore.update(u.id, { extras: u.extras });
  }

  const result = { matched, unmatched: unmatched.length, total: lotwRecords.length, at: Date.now() };
  setLogsyncState({
    lotwLastSyncAt: result.at,
    lotwQslSince: new Date().toISOString().slice(0, 10),
    lotwLastResult: result,
  });
  notify();
  return result;
};

/** Test hook: wipe queue + processing flag between tests. */
export const __resetLogsyncForTests = () => {
  processing = false;
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {}
  subscribers.clear();
};

export default {
  subscribeLogsync,
  getQueue,
  getPendingCount,
  enqueue,
  processQueue,
  onQsoLogged,
  buildAdifRecord,
  qsoTimestamp,
  matchLotwConfirmations,
  syncWavelogQsos,
  syncLotwConfirmations,
  lotwCooldownRemainingMs,
  testWavelog,
  testQrz,
  testLotw,
  QUEUE_KEY,
  QUEUE_CAP,
};
