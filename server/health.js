'use strict';

/**
 * Subsystem health cache.
 *
 * Each subsystem is evaluated periodically (REFRESH_MS) and cached. The
 * public `/api/health` endpoint reads from this cache so a probe stays
 * fast and never makes upstream calls on the request path.
 *
 * Status values: 'ok' | 'degraded' | 'down' | 'unknown'.
 * `unknown` means we haven't evaluated yet (first 30s after boot) or
 * the subsystem is intentionally disabled (e.g. FLETCHER_URL unset).
 */

const { classifyFletcherRelays } = require('./utils/fletcherRelayHealth');

const REFRESH_MS = 30 * 1000;
const PROBE_TIMEOUT_MS = 5 * 1000;
const RBN_STALE_AFTER_MS = 10 * 60 * 1000; // no spot in 10 min => degraded
const SATELLITES_GRACE_MS = 60 * 60 * 1000; // 1h past OMM_CACHE_DURATION before degraded
const SATELLITES_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // mirrors OMM_CACHE_DURATION

const subsystems = {
  fletcher: { status: 'unknown', lastChecked: null, detail: null },
  'ohc-cluster': { status: 'unknown', lastChecked: null, detail: null },
  rbn: { status: 'unknown', lastChecked: null, detail: null },
  satellites: { status: 'unknown', lastChecked: null, detail: null },
  propagation: { status: 'unknown', lastChecked: null, detail: null },
};

async function probeHttp(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, label };
  } catch (err) {
    return { ok: false, status: 0, label, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, label };
    return { ok: true, status: res.status, label, json: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, label, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkFletcher(ctx) {
  // Read the env var directly so this works both pre and post the
  // tle-fetcher → fletcher rename in #1063 (config.js key was renamed there
  // too). Falls back to the parsed CONFIG value if env vars are empty.
  const raw =
    process.env.FLETCHER_URL ||
    process.env.TLE_FETCHER_URL ||
    ctx.CONFIG?.satellites?.fletcherUrl ||
    ctx.CONFIG?.satellites?.tleFetcherUrl ||
    '';
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    return { status: 'unknown', detail: 'FLETCHER_URL/TLE_FETCHER_URL unset (direct upstream mode)' };
  }
  // Probe /stats rather than the bare /health liveness endpoint: fletcher
  // can be alive while every relayed upstream fetch fails, which is exactly
  // the state that burned the v26.6.0 release day (#1165). /stats carries
  // lastUpstreamOkAt/lastUpstreamErrorAt so we can report relay trouble.
  const result = await probeJson(`${base}/stats`, 'fletcher');
  if (result.ok) {
    // Verdict logic lives in utils/fletcherRelayHealth so it's testable:
    // degraded needs ≥2 consecutive relay failures — a single transient
    // blip used to page watchtower for a guaranteed 10 minutes.
    const verdict = classifyFletcherRelays(result.json || {}, Date.now());
    if (verdict.status === 'degraded') return verdict;
    return { status: 'ok', detail: `${result.status} from ${base}/stats — ${verdict.detail}` };
  }

  // Older fletcher builds without the outcome fields still answer /health.
  const liveness = await probeHttp(`${base}/health`, 'fletcher');
  if (liveness.ok) return { status: 'ok', detail: `${liveness.status} from ${base}/health (liveness only)` };
  return {
    status: 'down',
    detail: liveness.error ? `probe failed: ${liveness.error}` : `HTTP ${liveness.status}`,
  };
}

async function checkOhcCluster() {
  // Same normalization as the dxcluster route: prepend http:// when the
  // scheme is missing so a schemeless Railway env var still probes.
  let base = (process.env.OHC_CLUSTER_URL || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) base = `http://${base}`;
  if (!base) {
    return { status: 'unknown', detail: 'OHC_CLUSTER_URL unset (node not deployed)' };
  }
  const result = await probeHttp(`${base}/health`, 'ohc-cluster');
  if (result.ok) return { status: 'ok', detail: `${result.status} from ${base}/health` };
  return {
    status: 'down',
    detail: result.error ? `probe failed: ${result.error}` : `HTTP ${result.status}`,
  };
}

function checkRbn(ctx) {
  const rbn = ctx.rbnHealth;
  if (!rbn) return { status: 'unknown', detail: 'rbnHealth not initialized' };
  if (!rbn.connected) return { status: 'down', detail: 'rbn telnet not connected' };
  if (!rbn.authenticated) return { status: 'degraded', detail: 'connected but not authenticated' };
  const age = rbn.lastSpotAt ? Date.now() - rbn.lastSpotAt : Infinity;
  if (age > RBN_STALE_AFTER_MS) {
    const mins = Math.round(age / 60_000);
    return { status: 'degraded', detail: `no spot in ${mins} min` };
  }
  return { status: 'ok', detail: `last spot ${Math.round(age / 1000)}s ago` };
}

function checkSatellites(ctx) {
  const ts = ctx.getSatellitesLastFetchAt?.();
  if (!ts) return { status: 'unknown', detail: 'no successful OMM fetch yet' };
  const age = Date.now() - ts;
  if (age > SATELLITES_CACHE_DURATION_MS + SATELLITES_GRACE_MS) {
    const hours = (age / 3_600_000).toFixed(1);
    return { status: 'down', detail: `last OMM fetch ${hours}h ago` };
  }
  if (age > SATELLITES_CACHE_DURATION_MS) {
    const hours = (age / 3_600_000).toFixed(1);
    return { status: 'degraded', detail: `last OMM fetch ${hours}h ago (past 24h window)` };
  }
  return { status: 'ok', detail: `last OMM fetch ${Math.round(age / 60_000)} min ago` };
}

async function checkPropagation(ctx) {
  const base = ctx.ITURHFPROP_URL;
  if (!base) return { status: 'unknown', detail: 'ITURHFPROP_URL unset (WASM-only mode)' };
  // The iturhfprop service has no /api/version (#1264). /api/health always
  // answers 200 and reports 'degraded' when its binary, data or circuit
  // breaker is unhealthy.
  const result = await probeJson(`${base}/api/health`, 'propagation');
  if (result.ok) {
    const svc = result.json?.status;
    if (svc === 'degraded') return { status: 'degraded', detail: `${base}/api/health reports degraded` };
    return { status: 'ok', detail: `${result.status} from ${base}/api/health` };
  }
  return {
    status: 'down',
    detail: result.error ? `probe failed: ${result.error}` : `HTTP ${result.status}`,
  };
}

async function refreshAll(ctx) {
  const now = Date.now();
  const [fletcher, ohcCluster, rbn, satellites, propagation] = await Promise.all([
    checkFletcher(ctx),
    checkOhcCluster(),
    Promise.resolve(checkRbn(ctx)),
    Promise.resolve(checkSatellites(ctx)),
    checkPropagation(ctx),
  ]);
  subsystems.fletcher = { ...fletcher, lastChecked: now };
  subsystems['ohc-cluster'] = { ...ohcCluster, lastChecked: now };
  subsystems.rbn = { ...rbn, lastChecked: now };
  subsystems.satellites = { ...satellites, lastChecked: now };
  subsystems.propagation = { ...propagation, lastChecked: now };
}

const SEVERITY = { ok: 0, unknown: 0, degraded: 1, down: 2 };

function aggregateStatus() {
  let worst = 0;
  for (const v of Object.values(subsystems)) {
    if ((SEVERITY[v.status] ?? 0) > worst) worst = SEVERITY[v.status];
  }
  if (worst === 2) return 'down';
  if (worst === 1) return 'degraded';
  return 'ok';
}

function getSubsystems() {
  return {
    aggregate: aggregateStatus(),
    ...Object.fromEntries(Object.entries(subsystems).map(([k, v]) => [k, { ...v }])),
  };
}

function start(ctx) {
  // First refresh runs after REFRESH_MS, not immediately. Boot grace so RBN
  // has time to connect + authenticate (~5-10s) before we flip it to 'down'.
  // Between boot and the first refresh, all subsystems report 'unknown' —
  // external watchers should treat that as not-yet-determined.
  const handle = setInterval(() => {
    refreshAll(ctx).catch(() => {});
  }, REFRESH_MS);
  handle.unref?.();
  return handle;
}

module.exports = { start, getSubsystems };
