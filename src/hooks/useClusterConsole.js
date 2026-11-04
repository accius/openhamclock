/**
 * useClusterConsole — polls the raw text of this station's custom telnet
 * cluster session (GET /api/dxcluster/console) and sends commands to it
 * (POST /api/dxcluster/console/send).
 *
 * Only active when the DX cluster source is a telnet cluster ('custom') and a
 * host is configured; otherwise it does nothing and reports `available:false`
 * so the panel can explain itself. Polling is incremental (`since` = last
 * sequence number) and the client keeps the same 500-line window the server
 * does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { validateClusterCommand } from '../utils/clusterCommands.js';
import { useVisibilityRefresh } from './useVisibilityRefresh';

const POLL_MS = 2000;
const MAX_LINES = 500;

export const isTelnetClusterSource = (config) =>
  (config?.dxClusterSource || '') === 'custom' && !!config?.customDxCluster?.host;

export const useClusterConsole = (config, { enabled = true } = {}) => {
  const available = isTelnetClusterSource(config);
  const host = config?.customDxCluster?.host || '';
  const port = config?.customDxCluster?.port || 7300;
  const callsign = config?.callsign && config.callsign !== 'N0CALL' ? config.callsign : '';

  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState({ exists: false, connected: false, authenticated: false, parked: false });
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const seqRef = useRef(0);
  const fetchRef = useRef(null);

  // Reset when the target session changes.
  useEffect(() => {
    seqRef.current = 0;
    setLines([]);
    setError(null);
  }, [host, port, callsign]);

  useEffect(() => {
    if (!available || !enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ host, port: String(port), since: String(seqRef.current) });
        if (callsign) params.append('callsign', callsign);
        const res = await apiFetch(`/api/dxcluster/console?${params}`);
        if (cancelled || !res) return;
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) message = body.error;
          } catch {}
          setError(message);
          return;
        }
        const body = await res.json();
        setError(null);
        setStatus({
          exists: !!body.exists,
          connected: !!body.connected,
          authenticated: !!body.authenticated,
          parked: !!body.parked,
          node: body.node,
          loginCallsign: body.loginCallsign,
        });
        if (Array.isArray(body.lines) && body.lines.length) {
          // The server restarted (sequence went backwards) → start over.
          const reset = body.seq < seqRef.current;
          seqRef.current = body.seq;
          setLines((prev) => {
            const merged = reset ? body.lines : [...prev, ...body.lines];
            return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
          });
        } else if (typeof body.seq === 'number') {
          seqRef.current = body.seq;
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'console poll failed');
      }
    };
    fetchRef.current = poll;
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [available, enabled, host, port, callsign]);

  useVisibilityRefresh(() => fetchRef.current?.(), POLL_MS);

  const send = useCallback(
    async (command) => {
      const v = validateClusterCommand(command);
      if (!v.ok) return { ok: false, error: v.reason };
      setSending(true);
      try {
        const res = await apiFetch('/api/dxcluster/console/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, port, callsign, command: v.command }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
        // Pull the echo + response promptly instead of waiting a full poll.
        setTimeout(() => fetchRef.current?.(), 400);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || 'send failed' };
      } finally {
        setSending(false);
      }
    },
    [host, port, callsign],
  );

  const clear = useCallback(() => setLines([]), []);

  return { available, lines, status, error, sending, send, clear, host, port, callsign };
};

export default useClusterConsole;
