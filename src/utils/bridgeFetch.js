/**
 * bridgeFetch — call a Rig Bridge plugin route, directly or via the server.
 *
 * Plugin routes such as /api/js8call/status or /winlink/inbox live only on
 * Rig Bridge. The OHC server doesn't proxy them, so when this browser talks
 * to Rig Bridge itself (rig control on, not Cloud Relay) the request has to
 * go straight to the bridge (#1279, #1281). Without a direct bridge URL the
 * request goes through apiFetch to the OHC server, as before.
 *
 * The API token is sent only on writes: reads are not gated on the bridge,
 * and a custom header on every status poll would force a CORS preflight.
 */
import { apiFetch } from './apiFetch';

const DIRECT_TIMEOUT_MS = 8000;

export function bridgeFetch(path, { rigUrl = null, apiToken = '', ...opts } = {}, fetchImpl = globalThis.fetch) {
  if (!rigUrl) return apiFetch(path, opts);
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { ...(opts.headers || {}) };
  if (method !== 'GET' && apiToken) headers['X-RigBridge-Token'] = apiToken;
  return fetchImpl(`${rigUrl}${path}`, {
    ...opts,
    headers,
    signal: opts.signal || AbortSignal.timeout(DIRECT_TIMEOUT_MS),
  });
}
