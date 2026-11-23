/**
 * useWinlink Hook
 * Polls Winlink plugin status and provides gateway discovery,
 * inbox/outbox retrieval, compose, and connect actions.
 *
 * Status, mail, compose and connect are Rig Bridge winlink-gateway routes
 * that the OHC server doesn't proxy (its own /api/winlink/status only
 * describes the shared gateway cache, with no patEnabled). With `rigUrl`
 * (this browser talks to the bridge directly) they go to the bridge, or
 * the Pat tabs never appear on local installs (#1281).
 *
 * @param {object} [opts]
 * @param {string|null} [opts.rigUrl]  Direct Rig Bridge base URL, or null
 * @param {string} [opts.apiToken]     Rig Bridge API token for writes
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { bridgeFetch } from '../utils/bridgeFetch';

const STATUS_INTERVAL = 10000; // 10s status check
const MAIL_INTERVAL = 30000; // 30s mail refresh
const CONNECT_TIMEOUT_MS = 10 * 60 * 1000;

export function useWinlink({ rigUrl = null, apiToken = '' } = {}) {
  const [status, setStatus] = useState({ enabled: false, running: false });
  const [inbox, setInbox] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await bridgeFetch('/api/winlink/status', { rigUrl });
      if (!res || !res.ok) {
        // No status endpoint (or rate-limited): stop "loading" — the panel's
        // Reachable view works from the gateway list alone.
        if (mountedRef.current) setLoading(false);
        return;
      }
      const data = await res.json();
      if (mountedRef.current) {
        setStatus(data);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, [rigUrl]);

  const fetchMail = useCallback(async () => {
    if (mountedRef.current) setMailLoading(true);
    try {
      const [inRes, outRes] = await Promise.all([
        bridgeFetch('/winlink/inbox', { rigUrl }),
        bridgeFetch('/winlink/outbox', { rigUrl }),
      ]);
      if (inRes?.ok) {
        const data = await inRes.json();
        if (mountedRef.current) setInbox(Array.isArray(data) ? data : []);
      }
      if (outRes?.ok) {
        const data = await outRes.json();
        if (mountedRef.current) setOutbox(Array.isArray(data) ? data : []);
      }
    } catch {}
    if (mountedRef.current) setMailLoading(false);
  }, [rigUrl]);

  const searchGateways = useCallback(
    async (grid, range, mode) => {
      const params = new URLSearchParams();
      if (grid) params.set('grid', grid);
      if (range) params.set('range', range);
      if (mode) params.set('mode', mode);
      const qs = params.toString();

      // Prefer the server-side proxy (openhamclock.com with WINLINK_API_KEY set)
      // so every user benefits from the shared 1h cache. Fall back to the
      // rig-bridge plugin when the server has no key (503) or no route —
      // self-hosters running rig-bridge get coverage that way.
      async function tryUrl(url, direct = null) {
        try {
          const res = direct ? await bridgeFetch(url, { rigUrl: direct }) : await apiFetch(url);
          if (!res) return null;
          if (res.status === 503) return null;
          if (!res.ok) return null;
          const data = await res.json();
          return data.gateways || [];
        } catch {
          return null;
        }
      }

      let list = await tryUrl(`/api/winlink/gateways${qs ? `?${qs}` : ''}`);
      if (list == null) list = await tryUrl(`/winlink/gateways${qs ? `?${qs}` : ''}`, rigUrl);
      list = list || [];
      if (mountedRef.current) setGateways(list);
      return list;
    },
    [rigUrl],
  );

  const compose = useCallback(
    async ({ to, cc, subject, body }) => {
      try {
        const res = await bridgeFetch('/winlink/compose', {
          rigUrl,
          apiToken,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, cc, subject, body }),
        });
        if (!res) return { error: 'Rate limited' };
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: err.error || `HTTP ${res.status}` };
        }
        await fetchMail();
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    [fetchMail, rigUrl, apiToken],
  );

  const connectGateway = useCallback(
    async (gateway, transport) => {
      try {
        const res = await bridgeFetch('/winlink/connect', {
          rigUrl,
          apiToken,
          method: 'POST',
          // Pat answers only when the session ends — an RF exchange takes minutes
          signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gateway, transport }),
        });
        if (!res) return { error: 'Rate limited' };
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: err.error || `HTTP ${res.status}` };
        }
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    [rigUrl, apiToken],
  );

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    const statusTimer = setInterval(fetchStatus, STATUS_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(statusTimer);
    };
  }, [fetchStatus]);

  // Fetch mail when Pat becomes reachable
  useEffect(() => {
    if (!status.patEnabled || !status.patReachable) return;
    fetchMail();
    const timer = setInterval(fetchMail, MAIL_INTERVAL);
    return () => clearInterval(timer);
  }, [status.patEnabled, status.patReachable, fetchMail]);

  useVisibilityRefresh(fetchStatus, 5000);

  return {
    status,
    inbox,
    outbox,
    gateways,
    loading,
    mailLoading,
    refresh: fetchStatus,
    refreshMail: fetchMail,
    searchGateways,
    compose,
    connectGateway,
  };
}
