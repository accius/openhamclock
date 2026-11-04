/**
 * useHamAlert — HamAlert alerts from whichever source this install has.
 *
 * Sources (merged, de-duplicated by call+freq+minute, newest first, ≤ 200):
 *   1. Rig Bridge plugin — arrives as window 'rig-plugin-data' CustomEvents
 *      ({ event: 'hamalert', data: alert }) from RigContext's SSE stream, in
 *      both local and cloud-relay modes. On (re)connect the bridge's
 *      /api/hamalert/alerts ring is fetched for a backfill when a bridge URL
 *      is known.
 *   2. Server feed — GET /api/hamalert/alerts (self-hosted installs with
 *      HAMALERT_USER/HAMALERT_PASS), polled every 30 s with ?since=.
 *
 * The hook never blocks rendering: loading is false from the start and
 * every fetch has a short timeout. `clear()` empties the list (CLR button).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { hamAlertKey } from '../utils/hamalertParser.js';

const MAX_ALERTS = 200;
const SERVER_POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 6_000;

function mergeAlerts(prev, incoming) {
  if (!incoming.length) return prev;
  const keys = new Set(prev.map(hamAlertKey));
  const fresh = [];
  for (const a of incoming) {
    const k = hamAlertKey(a);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    fresh.push(a);
  }
  if (!fresh.length) return prev;
  return [...fresh, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, MAX_ALERTS);
}

export function useHamAlert({ enabled = true, rigBridgeUrl = null } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [serverEnabled, setServerEnabled] = useState(null); // null = unknown yet
  const [serverConnected, setServerConnected] = useState(false);
  const [bridgeActive, setBridgeActive] = useState(false);
  const [error, setError] = useState(null);
  const clearedAtRef = useRef(0);

  const addAlerts = useCallback((list) => {
    const cutoff = clearedAtRef.current;
    const keep = cutoff ? list.filter((a) => (a.timestamp || 0) > cutoff) : list;
    if (keep.length) setAlerts((prev) => mergeAlerts(prev, keep));
  }, []);

  // 1. Rig Bridge plugin events
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      const msg = e.detail;
      if (!msg) return;
      if (msg.type === 'plugin-init' && Array.isArray(msg.plugins)) {
        setBridgeActive(msg.plugins.includes('hamalert'));
        return;
      }
      if (msg.event !== 'hamalert' || !msg.data) return;
      setBridgeActive(true);
      addAlerts([msg.data]);
    };
    window.addEventListener('rig-plugin-data', handler);
    return () => window.removeEventListener('rig-plugin-data', handler);
  }, [enabled, addAlerts]);

  // 1b. Backfill from the bridge's ring buffer when we know where it lives
  useEffect(() => {
    if (!enabled || !rigBridgeUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${rigBridgeUrl.replace(/\/$/, '')}/api/hamalert/alerts`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !body?.enabled || !Array.isArray(body.alerts)) return;
        setBridgeActive(true);
        addAlerts(body.alerts);
      } catch {
        /* bridge not reachable from this browser — SSE still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, rigBridgeUrl, addAlerts]);

  // 2. Server-side feed (self-hosted)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let since = 0;
    let timer = null;
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/hamalert/alerts${since ? `?since=${since}` : ''}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res?.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setServerEnabled(!!body.enabled);
        setServerConnected(!!body.connected);
        setError(body.status?.lastError || null);
        if (body.enabled && Array.isArray(body.alerts) && body.alerts.length) {
          addAlerts(body.alerts);
          since = Math.max(since, ...body.alerts.map((a) => a.timestamp || 0));
        }
        if (!body.enabled && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        /* transient — next poll retries */
      }
    };
    poll();
    timer = setInterval(poll, SERVER_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, addAlerts]);

  const clear = useCallback(() => {
    clearedAtRef.current = Date.now();
    setAlerts([]);
  }, []);

  return {
    alerts,
    clear,
    serverEnabled,
    serverConnected,
    bridgeActive,
    configured: serverEnabled === true || bridgeActive,
    error,
    loading: false,
  };
}

export default useHamAlert;
