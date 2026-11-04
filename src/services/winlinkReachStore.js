/**
 * winlinkReachStore — the ONE prediction runner behind every reachable-
 * Winlink-gateway consumer: the Winlink panel's Reachable view, the
 * Winlink Gateways map layer (when its Reachability filter is not "All")
 * and the EmComm layout's gateway list.
 *
 * Consumers register demand with requestReach(id, params). While at least
 * one consumer is registered the store keeps the gateway list loaded,
 * follows the display-time hour, and runs one P.533 prediction per
 * (gateway, required-SNR group) through the browser WASM worker — the same
 * predictInWorker call Prediction Check uses — two at a time, at most
 * MAX_PREDICTIONS_PER_REFRESH per refresh. Results go into a module-level
 * cache keyed per gateway + frequencies + hour + station settings, so a
 * second consumer, a remount, or a threshold change costs no engine work.
 * With several consumers there is still one run: the highest-priority
 * consumer that knows the station location supplies the parameters.
 *
 * When the WASM engine is unavailable it falls back to /api/propagation,
 * one request at a time and at most MAX_PREDICTIONS_REST per refresh,
 * reading the display-time hour from the endpoint's 24-hour series.
 *
 * Pure logic lives in utils/winlinkReach.js; React access via
 * hooks/useWinlinkReach.js (useSyncExternalStore).
 */
import { predictInWorker } from './p533/predictInWorker.js';
import { ANTENNA_PROFILES } from '../utils/propagationAdjust.js';
import { apiFetch } from '../utils/apiFetch.js';
import { displayNow, subscribeDisplayTime } from '../utils/displayTime.js';
import { ssnForMonth, ymOf } from '../utils/solarCycleSsn.js';
import {
  DEFAULT_RANGE_KM,
  DEFAULT_THRESHOLDS,
  MAX_PREDICTIONS_PER_REFRESH,
  MAX_PREDICTIONS_REST,
  PREDICT_CONCURRENCY,
  REST_CONCURRENCY,
  RANGE_OPTIONS_KM,
  aggregateGateways,
  buildPredictionParams,
  buildReachSnapshot,
  cacheKey,
  cachePut,
  hourKeyFor,
  normalizeThresholds,
  rankGateways,
  restFallbackMode,
  restResultForJob,
  runBatched,
  scoreChannels,
  selectCandidates,
  summarizeGateway,
} from '../utils/winlinkReach.js';

const GATEWAY_REFRESH_MS = 60 * 60 * 1000; // matches the server's 1 h gateway cache
const SSN_REFRESH_MS = 60 * 60 * 1000;
const HOUR_TICK_MS = 60 * 1000;
const RANGE_KEY = 'ohc_winlinkReachRangeKm';
const THRESHOLDS_KEY = 'ohc_winlinkReachThresholds';
const PACTOR4_KEY = 'ohc_winlinkReachPactor4';

/** Consumer priorities: whose parameters win when several are registered. */
export const REACH_PRIORITY = { panel: 3, emcomm: 2, layer: 1 };

function loadRange() {
  try {
    const v = parseInt(localStorage.getItem(RANGE_KEY), 10);
    return RANGE_OPTIONS_KM.includes(v) ? v : DEFAULT_RANGE_KM;
  } catch {
    return DEFAULT_RANGE_KM;
  }
}

function loadPactor4() {
  try {
    return localStorage.getItem(PACTOR4_KEY) === '1';
  } catch {
    return false;
  }
}

function loadThresholds() {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    return raw ? normalizeThresholds(JSON.parse(raw)) : { ...DEFAULT_THRESHOLDS };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

// ── Module state ───────────────────────────────────────────────────────────

const resultCache = new Map();
const consumers = new Map(); // id → { priority, params }
const listeners = new Set();

let wasmUnavailable = false;
let restChain = Promise.resolve();
let rawRows = null;
let gateways = [];
let listVersion = 0;
let listError = false;
let listTimer = null;
let listLoading = null;
let fetchedSsn = null;
let ssnAttempted = false;
// Solar-cycle feed (/api/solar-cycle) for a time-shifted display month.
let cycleData = null;
let cycleAttempted = false;
let cycleLoading = false;
let ssnTimer = null;
let hourTimer = null;
let unsubscribeTime = null;
let reconcileQueued = false;
let gen = 0;
let currentRunKey = null;
let currentSel = null;
let currentLocal = new Map();
let forceNext = false;
let nonce = 0;

let state = makeState({ rangeKm: loadRange(), thresholds: loadThresholds(), pactor4: loadPactor4() });

function makeState(over = {}) {
  return {
    active: false,
    rows: [],
    packet: [],
    truncated: 0,
    progress: { done: 0, total: 0 },
    running: false,
    hour: null,
    updatedAt: null,
    engine: null,
    gatewayCount: 0,
    listLoaded: false,
    listError: false,
    hasDe: false,
    byCall: null,
    rangeKm: DEFAULT_RANGE_KM,
    ssnUsed: null,
    ssnSource: 'current',
    thresholds: { ...DEFAULT_THRESHOLDS },
    pactor4: false,
    ...over,
  };
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getReachState() {
  return state;
}

export function subscribeReach(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Register (or update) a consumer's demand. params: { deLocation, propConfig, ssn }.
 * Returns a release function.
 */
export function requestReach(id, { priority = 1, deLocation = null, propConfig = null, ssn = null } = {}) {
  consumers.set(id, { priority, params: { deLocation, propConfig, ssn } });
  scheduleReconcile();
  return () => releaseReach(id);
}

export function releaseReach(id) {
  if (consumers.delete(id)) scheduleReconcile();
}

export function setReachRange(km) {
  const v = RANGE_OPTIONS_KM.includes(Number(km)) ? Number(km) : DEFAULT_RANGE_KM;
  try {
    localStorage.setItem(RANGE_KEY, String(v));
  } catch {
    /* storage unavailable */
  }
  if (v !== state.rangeKm) {
    setState({ rangeKm: v });
    scheduleReconcile();
  }
}

export function setReachThresholds(t) {
  const next = normalizeThresholds(t);
  try {
    localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  setState({ thresholds: next });
  recompose(); // classification only — no engine work
}

/**
 * "My modem supports PACTOR 4": P4-capable gateways are then scored against
 * the SCS −19 dB floor instead of PACTOR 3's. Changes the engine input, so
 * it re-runs (cached per setting — toggling back costs nothing).
 */
export function setReachPactor4(on) {
  const v = !!on;
  try {
    localStorage.setItem(PACTOR4_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  if (v !== state.pactor4) {
    setState({ pactor4: v });
    scheduleReconcile();
  }
}

export function refreshReach() {
  forceNext = true;
  nonce++;
  scheduleReconcile();
}

// ── Internals ──────────────────────────────────────────────────────────────

function scheduleReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  Promise.resolve().then(() => {
    reconcileQueued = false;
    reconcile();
  });
}

function effectiveParams() {
  const list = [...consumers.values()].sort((a, b) => b.priority - a.priority);
  const pick = (fn) => {
    for (const c of list) {
      const v = fn(c.params);
      if (v != null) return v;
    }
    return null;
  };
  const de = pick((p) =>
    p.deLocation && Number.isFinite(p.deLocation.lat) && Number.isFinite(p.deLocation.lon) ? p.deLocation : null,
  );
  const propConfig = pick((p) => p.propConfig) || {};
  const consumerSsn = pick((p) => (p.ssn != null && Number.isFinite(Number(p.ssn)) ? Number(p.ssn) : null));
  return { de, propConfig, consumerSsn, ssn: consumerSsn ?? fetchedSsn ?? 100 };
}

async function fetchGatewayRows() {
  // Server proxy first (shared 1 h cache), then the local rig-bridge plugin —
  // the same order useWinlink's gateway search uses.
  for (const url of ['/api/winlink/gateways', '/winlink/gateways']) {
    try {
      const res = await apiFetch(url);
      if (!res || !res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.gateways;
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

function loadList() {
  if (listLoading) return listLoading;
  listLoading = fetchGatewayRows().then((list) => {
    listLoading = null;
    if (list) {
      rawRows = list;
      gateways = aggregateGateways(list);
      listVersion++;
      listError = false;
    } else {
      listError = true;
    }
    setState({ listLoaded: rawRows != null, listError, gatewayCount: gateways.length });
    scheduleReconcile();
  });
  return listLoading;
}

async function loadCycle() {
  if (cycleLoading) return;
  cycleLoading = true;
  try {
    const res = await apiFetch('/api/solar-cycle');
    if (res && res.ok) cycleData = await res.json();
  } catch {
    /* keep the current SSN */
  } finally {
    cycleLoading = false;
    cycleAttempted = true;
    scheduleReconcile();
  }
}

async function loadSsn() {
  try {
    const res = await apiFetch('/api/solar-indices');
    if (!res || !res.ok) return;
    const data = await res.json();
    const v = Number(data?.ssn?.current);
    if (Number.isFinite(v)) {
      fetchedSsn = v;
      scheduleReconcile();
    }
  } catch {
    /* keep the default */
  } finally {
    if (!ssnAttempted) {
      ssnAttempted = true;
      scheduleReconcile();
    }
  }
}

function startBackground(needSsn) {
  if (!listTimer) {
    if (rawRows == null) loadList();
    listTimer = setInterval(loadList, GATEWAY_REFRESH_MS);
  }
  if (needSsn && !ssnTimer) {
    loadSsn();
    ssnTimer = setInterval(loadSsn, SSN_REFRESH_MS);
  }
  if (!hourTimer) hourTimer = setInterval(scheduleReconcile, HOUR_TICK_MS);
  if (!unsubscribeTime) unsubscribeTime = subscribeDisplayTime(scheduleReconcile);
}

function stopBackground() {
  if (listTimer) clearInterval(listTimer);
  if (ssnTimer) clearInterval(ssnTimer);
  if (hourTimer) clearInterval(hourTimer);
  if (unsubscribeTime) unsubscribeTime();
  listTimer = ssnTimer = hourTimer = null;
  unsubscribeTime = null;
}

/** Serialize REST fallback calls — one in flight at a time. */
function serialRest(fn) {
  const p = restChain.then(fn, fn);
  restChain = p.catch(() => {});
  return p;
}

async function restPredict(cand, job, de, power, antenna, hour, month) {
  return serialRest(async () => {
    const params = new URLSearchParams({
      deLat: de.lat.toFixed(2),
      deLon: de.lon.toFixed(2),
      dxLat: cand.gateway.lat.toFixed(2),
      dxLon: cand.gateway.lon.toFixed(2),
      mode: restFallbackMode(job.requiredSNR),
      power: String(power),
      antenna,
      // Display-time month: the server runs (and caches) that month's model;
      // the hour is read from the returned 24-hour series.
      month: String(month),
    });
    const res = await apiFetch(`/api/propagation?${params}`);
    if (!res) throw new Error('rate limited');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      scored: scoreChannels(job.channels, restResultForJob(job, data, hour), job.requiredSNR),
      engine: /P\.533/.test(data.model || '') ? 'server' : 'est',
      updatedAt: Date.now(),
    };
  });
}

function compose() {
  if (!currentSel) return [];
  const thresholds = state.thresholds;
  return rankGateways(
    currentSel.hf.map((cand) => {
      let scored = [];
      let engine = null;
      let updatedAt = null;
      let isPending = false;
      for (const job of cand.jobs) {
        const r = currentLocal.get(job.key);
        if (r) {
          scored = scored.concat(r.scored);
          engine = engine || r.engine;
          updatedAt = Math.max(updatedAt || 0, r.updatedAt);
        } else {
          scored = scored.concat(scoreChannels(job.channels, [], job.requiredSNR));
          isPending = true;
        }
      }
      const row = summarizeGateway(cand, scored, {
        engine,
        updatedAt,
        thresholds,
        offAirChannels: cand.offAirChannels,
      });
      row.pending = isPending;
      return row;
    }),
  );
}

function engineOf(rows) {
  const engines = new Set(rows.map((r) => r.engine).filter(Boolean));
  if (engines.has('wasm')) return 'wasm';
  if (engines.has('server')) return 'server';
  if (engines.has('est')) return 'est';
  return null;
}

function publishRows(extra = {}) {
  const rows = compose();
  setState({
    rows,
    packet: currentSel ? currentSel.packet : [],
    byCall: buildReachSnapshot(rows, currentSel ? currentSel.packet : []),
    engine: engineOf(rows),
    ...extra,
  });
}

function recompose() {
  if (state.active && currentSel) publishRows();
}

function reconcile() {
  if (consumers.size === 0) {
    gen++; // cancel any in-flight run
    currentRunKey = null;
    stopBackground();
    if (state.active) setState({ active: false, running: false, byCall: null });
    return;
  }

  const { de, propConfig, consumerSsn, ssn } = effectiveParams();
  // Consumers without solar data (map layer, EmComm) get the SSN fetched here.
  startBackground(consumerSsn == null);

  const patch = { active: true, hasDe: !!de };
  // Wait for the gateway list and, when nobody supplied an SSN, for the first
  // SSN fetch — running at a guessed SSN would only be redone a moment later.
  const waitingForSsn = consumerSsn == null && fetchedSsn == null && !ssnAttempted;
  if (!de || !gateways.length || waitingForSsn) {
    setState({ ...patch, running: !!de && (listLoading != null || waitingForSsn) });
    return;
  }

  const now = displayNow();
  const hour = now.getUTCHours();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const power = parseFloat(propConfig?.power) || 100;
  const antenna = propConfig?.antenna || 'isotropic';

  // Display time shifted into another month: run with that month's smoothed
  // SSN (SWPC observed, else the cycle-25 prediction) — the same feed the
  // Solar Cycle panel and the server fallback use. Today's SSN otherwise.
  const displayYm = ymOf(now);
  let ssnUsed = Number.isFinite(ssn) ? ssn : 100;
  let ssnSource = 'current';
  if (displayYm !== ymOf(new Date())) {
    if (!cycleAttempted) {
      loadCycle();
      setState({ ...patch, running: true });
      return;
    }
    const cyc = ssnForMonth(cycleData, displayYm);
    if (Number.isFinite(cyc)) {
      ssnUsed = cyc;
      ssnSource = 'solar-cycle';
    }
  }
  const ssnBucket = Math.round(ssnUsed / 10) * 10;
  const rangeKm = state.rangeKm;
  const pactor4 = !!state.pactor4;
  const runKey = [
    pactor4 ? 'p4' : 'p3',
    de.lat.toFixed(1),
    de.lon.toFixed(1),
    rangeKm,
    power,
    antenna,
    ssnBucket,
    hourKeyFor(now),
    listVersion,
    nonce,
  ].join('|');
  if (runKey === currentRunKey) {
    if (!state.active) setState(patch);
    return;
  }
  currentRunKey = runKey;
  const myGen = ++gen;
  const isCancelled = () => myGen !== gen;
  const force = forceNext;
  forceNext = false;

  const restOnly = wasmUnavailable;
  const sel = selectCandidates(gateways, de, {
    rangeKm,
    hour,
    pactor4,
    maxPredictions: restOnly ? MAX_PREDICTIONS_REST : MAX_PREDICTIONS_PER_REFRESH,
  });
  const txGain = (ANTENNA_PROFILES[antenna] || ANTENNA_PROFILES.isotropic).gain;
  const ctx = { hour, month, year, ssn: ssnBucket, power, txGain };

  const local = new Map();
  const pending = [];
  for (const cand of sel.hf) {
    for (const job of cand.jobs) {
      job.key = cacheKey({
        callsign: cand.callsign,
        freqsMHz: job.freqsMHz,
        requiredSNR: job.requiredSNR,
        deLat: de.lat,
        deLon: de.lon,
        hour,
        month,
        year,
        ssn: ssnBucket,
        power,
        antenna,
      });
      const hit = force ? null : resultCache.get(job.key);
      if (hit) local.set(job.key, hit);
      else pending.push({ cand, job });
    }
  }
  currentSel = sel;
  currentLocal = local;

  publishRows({
    ...patch,
    ssnUsed: Math.round(ssnUsed),
    ssnSource,
    truncated: sel.truncated,
    progress: { done: 0, total: pending.length },
    running: pending.length > 0,
    hour,
    updatedAt: pending.length ? state.updatedAt : Date.now(),
  });
  if (!pending.length) return;

  let restUsed = 0;
  const runJob = async ({ cand, job }) => {
    let entry = null;
    if (!wasmUnavailable) {
      try {
        const result = await predictInWorker(buildPredictionParams(cand, job, de, ctx));
        entry = {
          scored: scoreChannels(job.channels, result.frequencies, job.requiredSNR, { muf: result.muf }),
          engine: 'wasm',
          updatedAt: Date.now(),
        };
      } catch (err) {
        wasmUnavailable = true;
        console.warn('[WinlinkReach] WASM engine unavailable, using the server estimate:', err.message);
      }
    }
    if (!entry) {
      if (restUsed >= MAX_PREDICTIONS_REST) return null;
      restUsed++;
      entry = await restPredict(cand, job, de, power, antenna, hour, month);
    }
    if (entry) {
      cachePut(resultCache, job.key, entry);
      if (!isCancelled()) local.set(job.key, entry);
    }
    return entry;
  };

  runBatched(pending, runJob, {
    concurrency: restOnly ? REST_CONCURRENCY : PREDICT_CONCURRENCY,
    isCancelled,
    onProgress: (done, total) => publishRows({ progress: { done, total } }),
  }).then(() => {
    if (isCancelled()) return;
    publishRows({ running: false, updatedAt: Date.now() });
  });
}

/** Test hook: reset every piece of module state. */
export function __resetWinlinkReachStoreForTests() {
  stopBackground();
  resultCache.clear();
  consumers.clear();
  listeners.clear();
  wasmUnavailable = false;
  restChain = Promise.resolve();
  rawRows = null;
  gateways = [];
  listVersion = 0;
  listError = false;
  listLoading = null;
  fetchedSsn = null;
  ssnAttempted = false;
  cycleData = null;
  cycleAttempted = false;
  cycleLoading = false;
  reconcileQueued = false;
  gen++;
  currentRunKey = null;
  currentSel = null;
  currentLocal = new Map();
  forceNext = false;
  nonce = 0;
  state = makeState({ rangeKm: loadRange(), thresholds: loadThresholds(), pactor4: loadPactor4() });
}
