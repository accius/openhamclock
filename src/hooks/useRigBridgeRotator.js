/**
 * useRigBridgeRotator — az/el rotator through Rig Bridge's rotctld plugin.
 *
 * Rig Bridge exposes GET /api/rotator/status and POST /api/rotator/position
 * { az, el } / /api/rotator/stop on the same origin as the rig (`rigUrl`).
 * Unlike the server-side PSTRotator UDP route this one knows elevation, so
 * satellite auto-track prefers it when it is running. Polls only while rig
 * control is enabled in local (non-relay) mode; backs off when unreachable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 30000;

export default function useRigBridgeRotator({ rigUrl, apiToken = '', enabled = false } = {}) {
  const [status, setStatus] = useState({
    available: false, // plugin running on rig-bridge
    connected: false, // rotctld socket up
    azimuth: null,
    elevation: null,
    targetAz: null,
    targetEl: null,
    lastSeen: 0,
    error: null,
  });
  const backoffRef = useRef(POLL_MS);
  const timerRef = useRef(null);
  const headers = apiToken
    ? { 'Content-Type': 'application/json', 'X-RigBridge-Token': apiToken }
    : { 'Content-Type': 'application/json' };
  const headersRef = useRef(headers);
  headersRef.current = headers;

  useEffect(() => {
    if (!enabled || !rigUrl) {
      setStatus((s) => (s.available ? { ...s, available: false, connected: false } : s));
      return undefined;
    }
    let alive = true;

    const schedule = (ms) => {
      if (!alive) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(poll, ms);
    };

    async function poll() {
      try {
        const res = await fetch(`${rigUrl}/api/rotator/status`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!alive) return;
        backoffRef.current = POLL_MS;
        const running = !!j?.running || !!j?.connected;
        setStatus({
          available: running,
          connected: !!j?.connected,
          azimuth: Number.isFinite(Number(j?.azimuth)) ? Number(j.azimuth) : null,
          elevation: Number.isFinite(Number(j?.elevation)) ? Number(j.elevation) : null,
          targetAz: Number.isFinite(Number(j?.targetAz)) ? Number(j.targetAz) : null,
          targetEl: Number.isFinite(Number(j?.targetEl)) ? Number(j.targetEl) : null,
          lastSeen: Date.now(),
          error: null,
        });
        schedule(running ? POLL_MS : 10000);
      } catch (err) {
        if (!alive) return;
        setStatus((s) =>
          s.available || s.connected
            ? { ...s, available: false, connected: false, error: String(err?.message || err) }
            : s,
        );
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        schedule(backoffRef.current);
      }
    }

    poll();
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [rigUrl, enabled]);

  const setPosition = useCallback(
    async (az, el = 0) => {
      if (!rigUrl) throw new Error('rig-bridge not configured');
      const res = await fetch(`${rigUrl}/api/rotator/position`, {
        method: 'POST',
        headers: headersRef.current,
        body: JSON.stringify({ az: Number(az), el: Number.isFinite(Number(el)) ? Number(el) : 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return data;
    },
    [rigUrl],
  );

  const stop = useCallback(async () => {
    if (!rigUrl) throw new Error('rig-bridge not configured');
    const res = await fetch(`${rigUrl}/api/rotator/stop`, { method: 'POST', headers: headersRef.current });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }, [rigUrl]);

  return { ...status, setPosition, stop };
}
