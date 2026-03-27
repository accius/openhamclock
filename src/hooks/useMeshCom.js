/**
 * useMeshCom Hook
 * Polls /api/meshcom/nodes and /api/meshcom/messages for MeshCom node and
 * message data received via the rig-bridge UDP plugin.
 *
 * Traffic optimisations:
 *   - 30s poll interval (LoRa beacons are every 5-15 min, 15s is wasteful)
 *   - ETag / If-None-Match on nodes — 304 with no body when nothing changed
 *   - ?since= incremental messages — only new messages each poll
 *
 * Isolation — MeshCom must never block other panels:
 *   - loading is cleared immediately on mount (panel never stays "Loading…")
 *   - Each fetch carries a 5s AbortSignal timeout — a slow/absent server
 *     cannot hold a browser HTTP connection open indefinitely
 *   - The three fetches fire independently (not Promise.all) so a slow
 *     nodes response cannot delay message or status updates, and never
 *     consumes more than one browser connection at a time
 *   - /api/meshcom/status is purely synchronous server-side (no outbound
 *     rig-bridge call) so it resolves in < 1 ms
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';

const POLL_INTERVAL = 30_000; // 30 s — LoRa beacon rate is much slower than APRS
const FETCH_TIMEOUT_MS = 5_000; // hard cap per request — never tie up a connection longer

export const useMeshCom = (options = {}) => {
  const { enabled = true } = options;

  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  // Start as false — panel renders immediately with empty state rather than
  // showing "Loading…" and potentially blocking perceived page readiness.
  const [loading, setLoading] = useState(false);

  // ETag for nodes endpoint — avoid body transfer when nothing changed
  const nodeEtagRef = useRef(null);
  // Timestamp of newest message received — for ?since= incremental fetch
  const lastMessageTsRef = useRef(0);

  const fetchNodes = useCallback(async () => {
    if (!enabled) return;
    try {
      const headers = {};
      if (nodeEtagRef.current) headers['If-None-Match'] = nodeEtagRef.current;

      const res = await apiFetch('/api/meshcom/nodes', {
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
  }, [enabled]);

  const fetchMessages = useCallback(async () => {
    if (!enabled) return;
    try {
      const since = lastMessageTsRef.current;
      const res = await apiFetch(since > 0 ? `/api/meshcom/messages?since=${since}` : '/api/meshcom/messages', {
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
  }, [enabled]);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/api/meshcom/status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res?.ok) {
        const data = await res.json();
        setConnected(data.rigBridge?.running === true);
      }
    } catch {
      setConnected(false);
    }
  }, [enabled]);

  // Fire all three fetches independently — not Promise.all — so a slow
  // response on one endpoint cannot delay the others or occupy multiple
  // connections simultaneously from the browser's per-host pool.
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

  const sendMessage = useCallback(async (to, message) => {
    const res = await apiFetch('/api/meshcom/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to || '*', message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      throw new Error(data.error || 'Send failed');
    }
    return true;
  }, []);

  return {
    nodes,
    messages,
    connected,
    loading,
    sendMessage,
    refresh,
  };
};
