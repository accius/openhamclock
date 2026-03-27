/**
 * useMeshCom Hook
 * Polls /api/meshcom/nodes and /api/meshcom/messages for MeshCom node and
 * message data received via the rig-bridge UDP plugin.
 *
 * Session isolation:
 *   Uses the shared relay session ID from src/utils/relaySession.js
 *   (localStorage key 'ohc-relay-session'). The rig-bridge cloud relay
 *   plugin sends this same ID in the x-relay-session header on every push,
 *   so ingest and poll always use the same session. All relay-delivered
 *   data types (WSJTX, APRS, MeshCom) share one session ID.
 *
 * Traffic optimisations:
 *   - 30s poll interval (LoRa beacons are every 5-15 min, 15s is wasteful)
 *   - ETag / If-None-Match on nodes — 304 with no body when nothing changed
 *   - ?since= incremental messages — only new messages each poll
 *
 * Isolation — MeshCom must never block other panels:
 *   - loading is always false — the panel renders immediately with empty state
 *     rather than blocking on the first fetch
 *   - Each fetch carries a 5s AbortSignal timeout — a slow/absent server
 *     cannot hold a browser HTTP connection open indefinitely
 *   - The three fetches fire independently (not Promise.all) so a slow
 *     response on one endpoint cannot delay the others
 *   - /api/meshcom/status is purely synchronous server-side (no outbound
 *     rig-bridge call) so it resolves in < 1 ms
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { getRelaySessionId } from '../utils/relaySession';

const POLL_INTERVAL = 30_000; // 30 s — LoRa beacon rate is much slower than APRS
const FETCH_TIMEOUT_MS = 5_000; // hard cap per request — never tie up a connection longer

export function useMeshCom(options = {}) {
  const { enabled = true } = options;

  // Stable relay session ID — shared with useWSJTX and all other relay-delivered data
  const [sessionId] = useState(getRelaySessionId);

  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  // Always false — panel renders immediately with empty state rather than
  // showing "Loading…" and potentially blocking perceived page readiness.
  const [loading] = useState(false);

  // ETag for nodes endpoint — avoid body transfer when nothing changed
  const nodeEtagRef = useRef(null);
  // Timestamp of newest message received — for ?since= incremental fetch
  const lastMessageTsRef = useRef(0);

  const fetchNodes = useCallback(async () => {
    if (!enabled) return;
    try {
      const headers = {};
      if (nodeEtagRef.current) headers['If-None-Match'] = nodeEtagRef.current;

      const res = await apiFetch(`/api/meshcom/nodes?session=${sessionId}`, {
        cache: 'no-store',
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res?.status === 304) return; // nothing changed — keep existing nodes
      if (res?.ok) {
        const etag = res.headers?.get('ETag');
        if (etag) nodeEtagRef.current = etag;
        const data = await res.json();
        setNodes(data.nodes || []);
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') {
        console.error('[MeshCom] Nodes fetch error:', err);
      }
    }
  }, [enabled, sessionId]);

  const fetchMessages = useCallback(async () => {
    if (!enabled) return;
    try {
      const since = lastMessageTsRef.current;
      const base = `/api/meshcom/messages?session=${sessionId}`;
      const url = since > 0 ? `${base}&since=${since}` : base;
      const res = await apiFetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res?.ok) {
        const data = await res.json();
        if (data.messages?.length > 0) {
          const newest = Math.max(...data.messages.map((m) => m.timestamp ?? 0));
          if (newest > lastMessageTsRef.current) lastMessageTsRef.current = newest;
          if (since > 0) {
            setMessages((prev) => {
              const combined = [...prev, ...data.messages];
              return combined.length > 200 ? combined.slice(combined.length - 200) : combined;
            });
          } else {
            setMessages(data.messages);
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') {
        console.error('[MeshCom] Messages fetch error:', err);
      }
    }
  }, [enabled, sessionId]);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch(`/api/meshcom/status?session=${sessionId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res?.ok) {
        const data = await res.json();
        setConnected(data.rigBridge?.running === true);
      }
    } catch (err) {
      setConnected(false);
      if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') {
        console.error('[MeshCom] Status fetch error:', err);
      }
    }
  }, [enabled, sessionId]);

  // Fire all three fetches independently — not Promise.all — so a slow
  // response on one endpoint cannot delay the others.
  const refresh = useCallback(() => {
    fetchNodes();
    fetchMessages();
    fetchStatus();
  }, [fetchNodes, fetchMessages, fetchStatus]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  const sendMessage = useCallback(
    async (to, message) => {
      let res;
      try {
        res = await apiFetch('/api/meshcom/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to || '*', message, session: sessionId }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
          throw new Error('Send timed out — check that rig-bridge is running and reachable');
        }
        throw new Error('Could not reach the server — check your network connection');
      }
      if (!res?.ok) {
        const data = await res?.json().catch(() => ({}));
        throw new Error(data.error || 'Send failed');
      }
      return true;
    },
    [sessionId],
  );

  return {
    nodes,
    messages,
    connected,
    loading,
    sessionId,
    sendMessage,
    refresh,
  };
}
