/**
 * Remote kill switch for outbound DX cluster connections.
 *
 * Old OpenHamClock deployments have no way to be reached once they're in the
 * wild (the NC7J saga: pre-v26.4 installs hammered a node for months and we
 * could do nothing but apologize). This module gives every release from now on
 * a remote off-switch: before dialing any cluster node, callers consult a tiny
 * status file served from the GitHub repo. Flipping `enabled` to false — or
 * raising `minAppVersion` above a misbehaving release — stops the whole fleet
 * from dialing within one refresh interval, no user action required.
 *
 * Flag file shape (cluster-status.json at the repo root, Staging branch):
 *   {
 *     "enabled": true,          // false = nobody dials, any version
 *     "minAppVersion": null,    // e.g. "26.6.0" — main-app installs below this stop dialing
 *     "minProxyVersion": null,  // same idea for dxspider-proxy deployments
 *     "message": ""             // shown in logs so operators know why
 *   }
 *
 * Design constraints:
 *  - FAIL OPEN. GitHub being down must never take out cluster features; only an
 *    explicit, successfully-fetched flag disables dialing.
 *  - Non-blocking. Callers get a synchronous answer from the cached status;
 *    refreshes happen in the background.
 */

const STATUS_URL =
  process.env.CLUSTER_STATUS_URL || 'https://raw.githubusercontent.com/accius/openhamclock/Staging/cluster-status.json';
const REFRESH_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;

let status = { enabled: true, minAppVersion: null, minProxyVersion: null, message: '' };
let lastFetchAt = 0;
let fetching = false;
let warnedNoFetch = false;

// Numeric dotted-version compare: -1 / 0 / 1. Non-numeric segments compare as 0.
function compareVersions(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function refresh() {
  if (fetching) return;
  if (typeof fetch !== 'function') {
    if (!warnedNoFetch) {
      warnedNoFetch = true;
      console.warn('[ClusterStatus] global fetch unavailable — kill switch inert (dialing stays enabled)');
    }
    return;
  }
  fetching = true;
  lastFetchAt = Date.now();
  fetch(STATUS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || typeof data !== 'object') return;
      const next = {
        enabled: data.enabled !== false,
        minAppVersion: typeof data.minAppVersion === 'string' ? data.minAppVersion : null,
        minProxyVersion: typeof data.minProxyVersion === 'string' ? data.minProxyVersion : null,
        message: typeof data.message === 'string' ? data.message : '',
      };
      const changed = JSON.stringify(next) !== JSON.stringify(status);
      status = next;
      if (changed) {
        console.log(
          `[ClusterStatus] Remote status updated: enabled=${status.enabled}` +
            (status.minAppVersion ? ` minAppVersion=${status.minAppVersion}` : '') +
            (status.message ? ` — ${status.message}` : ''),
        );
      }
    })
    .catch(() => {}) // fail open: keep last known status
    .finally(() => {
      fetching = false;
    });
}

/**
 * May this install dial out to cluster nodes right now?
 * Synchronous (answers from cache); kicks a background refresh when stale.
 * @param {string} appVersion - this install's version (APP_VERSION)
 * @param {'app'|'proxy'} kind - which minimum-version field applies
 * @returns {{allowed: boolean, reason?: string}}
 */
function isDialingAllowed(appVersion, kind = 'app') {
  if (Date.now() - lastFetchAt > REFRESH_MS) refresh();

  if (!status.enabled) {
    return {
      allowed: false,
      reason: status.message || 'cluster connections disabled remotely (cluster-status.json)',
    };
  }
  const minVersion = kind === 'proxy' ? status.minProxyVersion : status.minAppVersion;
  if (minVersion && compareVersions(appVersion, minVersion) < 0) {
    return {
      allowed: false,
      reason:
        `version ${appVersion} is below the remote minimum ${minVersion} — please update` +
        (status.message ? ` (${status.message})` : ''),
    };
  }
  return { allowed: true };
}

// Prime the cache at startup so the first dial already has real data.
refresh();

module.exports = { isDialingAllowed, compareVersions, _refresh: refresh };
