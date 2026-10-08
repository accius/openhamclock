/**
 * Per-user log-sync (Wavelog/Cloudlog, QRZ Logbook, LoTW) configuration.
 *
 * Mirrors utils/callbookAuth.js: credentials live ONLY in this browser's
 * localStorage under an `ohc-` (dash) prefixed key, which the backup/settings
 * sync deliberately excludes (see utils/backup.js) — so API keys and the LoTW
 * password never travel in a backup file or server-side settings sync. They
 * are sent per-request to our own /api/logsync/* proxy, which never stores
 * them.
 *
 * Non-secret sync bookkeeping (last sync times, LoTW "confirmations since"
 * cursor) lives under `openhamclock_logsync_state` so it DOES travel in a
 * backup: after restoring on a new browser the user re-enters credentials but
 * keeps their LoTW sync cursor. The retry queue is browser-local transient
 * bookkeeping and stays under an `ohc-` dash key (utils/logsync.js).
 */

const AUTH_KEY = 'ohc-logsync-auth';
export const LOGSYNC_STATE_KEY = 'openhamclock_logsync_state';

const DEFAULTS = {
  wavelog: { enabled: false, url: '', apiKey: '', stationProfileId: '', pullEnabled: false, pullStationIds: [] },
  qrz: { enabled: false, apiKey: '' },
  lotw: { enabled: false, username: '', password: '' },
};

/** Full log-sync config with defaults filled in. Never throws. */
export function getLogsyncConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
  } catch {
    stored = {};
  }
  return {
    wavelog: { ...DEFAULTS.wavelog, ...(stored.wavelog || {}) },
    qrz: { ...DEFAULTS.qrz, ...(stored.qrz || {}) },
    lotw: { ...DEFAULTS.lotw, ...(stored.lotw || {}) },
  };
}

/** Shallow-merge one service's config ({ enabled, url, apiKey, ... }). */
export function setLogsyncServiceConfig(service, fields) {
  if (!DEFAULTS[service]) return;
  const cfg = getLogsyncConfig();
  cfg[service] = { ...cfg[service], ...fields };
  const isBlank = Object.entries(cfg[service]).every(([k, v]) => (k === 'enabled' ? !v : !v));
  try {
    const all = { wavelog: cfg.wavelog, qrz: cfg.qrz, lotw: cfg.lotw };
    if (isBlank) delete all[service];
    const any = Object.values(all).some((s) => s && Object.values(s).some((v) => v));
    if (!any) localStorage.removeItem(AUTH_KEY);
    else localStorage.setItem(AUTH_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (private mode) — config just won't persist
  }
}

/** True when the service is enabled and has the credentials it needs. */
export function isServiceReady(service, cfg = getLogsyncConfig()) {
  const c = cfg[service];
  if (!c || !c.enabled) return false;
  if (service === 'wavelog') return !!(c.url && c.apiKey);
  if (service === 'qrz') return !!c.apiKey;
  if (service === 'lotw') return !!(c.username && c.password);
  return false;
}

// btoa() chokes on non-ASCII; encode via UTF-8 bytes so any password works
// (same helper as utils/callbookAuth.js).
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Auth header for the LoTW proxy — credentials never appear in the URL. */
export function lotwAuthHeaders(cfg = getLogsyncConfig()) {
  const { username, password } = cfg.lotw || {};
  if (!username || !password) return {};
  try {
    return { 'X-LoTW-Auth': b64(`${username}:${password}`) };
  } catch {
    return {};
  }
}

// ── Non-secret sync state (travels in backups) ─────────────────────────────

/** { wavelogLastPushAt, qrzLastPushAt, lotwLastSyncAt, lotwLastAttemptAt,
 *    lotwQslSince, lotwLastResult } — all optional. */
export function getLogsyncState() {
  try {
    return JSON.parse(localStorage.getItem(LOGSYNC_STATE_KEY)) || {};
  } catch {
    return {};
  }
}

export function setLogsyncState(fields) {
  try {
    const next = { ...getLogsyncState(), ...fields };
    localStorage.setItem(LOGSYNC_STATE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — state just won't persist
  }
}

export default {
  getLogsyncConfig,
  setLogsyncServiceConfig,
  isServiceReady,
  lotwAuthHeaders,
  getLogsyncState,
  setLogsyncState,
  LOGSYNC_STATE_KEY,
};
