/**
 * useDigitalModes Hook
 * Polls status for all digital mode plugins (MSHV, JTDX, JS8Call)
 * and provides control actions (halt, freetext, reply, highlight).
 *
 * WSJT-X is handled separately by useWSJTX — this hook covers the
 * rig-bridge digital mode plugins that share the digital-mode-base.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.rigUrl]  Rig Bridge base URL when this browser
 *   talks to the bridge directly (see utils/aprsMessageSend directRigUrl).
 *   The OHC server doesn't proxy these plugin routes, so in local mode they
 *   must go to the bridge itself (#1279). null → via the OHC server.
 * @param {string} [opts.apiToken]     Rig Bridge API token for control actions.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { bridgeFetch } from '../utils/bridgeFetch';

const POLL_INTERVAL = 5000; // 5s status check
const PLUGINS = ['mshv', 'jtdx', 'js8call'];
const OFF = { enabled: false, running: false, connected: false };

export function useDigitalModes({ rigUrl = null, apiToken = '' } = {}) {
  const [statuses, setStatuses] = useState(() => {
    const init = {};
    for (const id of PLUGINS) init[id] = { ...OFF };
    return init;
  });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchStatuses = useCallback(async () => {
    // Only successful polls update state. A failed poll (bridge down, route
    // not proxied, rate-limited) keeps what we had, including what the SSE
    // status events set — replacing it made the panel flip to "No Digital
    // Modes Enabled" every 5 s on local installs (#1279).
    const results = {};
    await Promise.all(
      PLUGINS.map(async (id) => {
        try {
          const res = await bridgeFetch(`/api/${id}/status`, { rigUrl });
          if (!res || !res.ok) return;
          const data = await res.json();
          if (data && typeof data === 'object') results[id] = data;
        } catch {
          /* keep previous state */
        }
      }),
    );
    if (mountedRef.current) {
      if (Object.keys(results).length) {
        setStatuses((prev) => {
          const next = { ...prev };
          for (const [id, data] of Object.entries(results)) {
            // The bridge says the plugin is off → drop SSE leftovers too
            next[id] = data.enabled === false ? { ...OFF, ...data } : { ...prev[id], ...data };
          }
          return next;
        });
      }
      setLoading(false);
    }
  }, [rigUrl]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatuses();
    const timer = setInterval(fetchStatuses, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchStatuses]);

  useVisibilityRefresh(fetchStatuses, 5000);

  // Receive status events pushed over the rig-bridge SSE /stream — the
  // fastest path for connection/frequency changes between polls.
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.event !== 'status') return;
      const { source, data: s } = msg;
      if (!PLUGINS.includes(source)) return;
      if (!mountedRef.current) return;
      setStatuses((prev) => ({
        ...prev,
        [source]: {
          ...prev[source],
          enabled: true,
          running: true,
          connected: s.dialFrequency != null,
          dialFrequency: s.dialFrequency,
          mode: s.mode,
          transmitting: s.transmitting,
          decoding: s.decoding,
        },
      }));
      setLoading(false);
    };
    window.addEventListener('rig-plugin-data', handler);
    return () => window.removeEventListener('rig-plugin-data', handler);
  }, []);

  // Control actions
  const sendCommand = useCallback(
    async (pluginId, action, body = {}) => {
      try {
        const res = await bridgeFetch(`/api/${pluginId}/${action}`, {
          rigUrl,
          apiToken,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res) return { error: 'Rate limited' };
        if (!res.ok) {
          if (res.status === 401) return { error: 'Rig Bridge API token missing or wrong' };
          const err = await res.json().catch(() => ({}));
          return { error: err.error || `HTTP ${res.status}` };
        }
        return await res.json();
      } catch (e) {
        return { error: rigUrl ? `Rig Bridge not reachable at ${rigUrl}` : e.message };
      }
    },
    [rigUrl, apiToken],
  );

  const haltTx = useCallback(
    (pluginId, autoTxOnly = false) => sendCommand(pluginId, 'halt', { autoTxOnly }),
    [sendCommand],
  );
  const sendFreeText = useCallback(
    (pluginId, text, send = true) => sendCommand(pluginId, 'freetext', { text, send }),
    [sendCommand],
  );
  const sendReply = useCallback((pluginId, message) => sendCommand(pluginId, 'reply', { message }), [sendCommand]);
  const highlightCall = useCallback(
    (pluginId, callsign, highlight = true) => sendCommand(pluginId, 'highlight', { callsign, highlight }),
    [sendCommand],
  );

  return {
    statuses,
    loading,
    plugins: PLUGINS,
    refresh: fetchStatuses,
    haltTx,
    sendFreeText,
    sendReply,
    highlightCall,
  };
}
