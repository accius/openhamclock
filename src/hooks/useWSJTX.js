/**
 * useWSJTX Hook
 * Polls the server for WSJT-X UDP data (decoded messages, status, QSOs)
 *
 * WSJT-X sends decoded FT8/FT4/JT65/WSPR messages over UDP.
 * The server listens on the configured port and this hook fetches the results.
 *
 * Each browser gets a unique session ID so relay data is per-user.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { getRelaySessionId } from '../utils/relaySession';

const POLL_FAST = 2000; // 2s when data is flowing
const POLL_SLOW = 30000; // 30s idle check — is anything connected?
const API_URL = '/api/wsjtx';
const DECODES_URL = '/api/wsjtx/decodes';

export function useWSJTX(enabled = true) {
  const [sessionId] = useState(getRelaySessionId);
  const [data, setData] = useState({
    clients: {},
    decodes: [],
    qsos: [],
    wspr: [],
    stats: { totalDecodes: 0, totalQsos: 0, totalWspr: 0, activeClients: 0 },
    enabled: false,
    port: 2237,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastTimestamp = useRef(0);
  const fullFetchCounter = useRef(0);
  const backoffUntil = useRef(0); // Rate-limit backoff timestamp
  const hasDataFlowing = useRef(false); // True when relay/UDP is active (HTTP path)
  const isLocalMode = useRef(false); // True once SSE data arrives from rig-bridge directly
  const lastSseAt = useRef(0); // Timestamp of last SSE message (ms); used for staleness check

  // ── DX Target tracking ──
  // When the operator selects a callsign in WSJT-X (Std Msgs), the server
  // resolves it to coordinates. We track changes here so the app can set
  // the DX target automatically — same as clicking a PSKReporter report.
  const [dxTarget, setDxTarget] = useState(null); // { call, grid, lat, lon }
  const prevDxCallRef = useRef(null);

  // ── Band change tracking ──
  // When WSJT-X changes bands, old decodes are stale. We track the current
  // band and clear decodes when it changes.
  const prevBandRef = useRef(null);

  // Lightweight poll - just new decodes since last check
  const pollDecodes = useCallback(async () => {
    if (!enabled) return;
    // Skip if we're in a rate-limit backoff window
    if (Date.now() < backoffUntil.current) return;
    try {
      const base = lastTimestamp.current ? `${DECODES_URL}?since=${lastTimestamp.current}` : DECODES_URL;
      const sep = base.includes('?') ? '&' : '?';
      const url = `${base}${sep}session=${sessionId}`;
      const res = await apiFetch(url);
      if (!res) return; // backed off globally
      if (res.status === 429) {
        // Back off for 30 seconds on rate limit
        backoffUntil.current = Date.now() + 30000;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (json.decodes?.length > 0) {
        setData((prev) => {
          // Merge new decodes, dedup by id AND by content (time+freq+message)
          const existingIds = new Set(prev.decodes.map((d) => d.id));
          const existingKeys = new Set(
            prev.decodes.map((d) => `${d.time}-${d.freq}-${(d.message || '').replace(/\s+/g, '')}`),
          );
          const newDecodes = json.decodes.filter((d) => {
            if (existingIds.has(d.id)) return false;
            const contentKey = `${d.time}-${d.freq}-${(d.message || '').replace(/\s+/g, '')}`;
            if (existingKeys.has(contentKey)) return false;
            existingIds.add(d.id);
            existingKeys.add(contentKey);
            return true;
          });
          if (newDecodes.length === 0) return prev;

          const merged = [...prev.decodes, ...newDecodes].slice(-500);
          return { ...prev, decodes: merged, stats: { ...prev.stats, totalDecodes: merged.length } };
        });
      }

      lastTimestamp.current = json.timestamp || Date.now();
      setError(null);
    } catch (e) {
      // Silent fail for lightweight polls
    }
  }, [enabled, sessionId]);

  // Full fetch - get everything including status, QSOs, clients
  const fetchFull = useCallback(async () => {
    if (!enabled) return;
    // Skip if we're in a rate-limit backoff window
    if (Date.now() < backoffUntil.current) return;
    try {
      const res = await apiFetch(`${API_URL}?session=${sessionId}`);
      if (!res) return; // backed off globally
      if (res.status === 429) {
        backoffUntil.current = Date.now() + 30000;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      // Data is flowing if there are active clients or recent decodes
      hasDataFlowing.current = !!(
        json.enabled &&
        (json.stats?.activeClients > 0 || json.decodes?.length > 0 || json.qsos?.length > 0 || json.wspr?.length > 0)
      );
      lastTimestamp.current = Date.now();
      setLoading(false);
      setError(null);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [enabled, sessionId]);

  // Initial full fetch
  useEffect(() => {
    if (enabled) fetchFull();
  }, [enabled, fetchFull]);

  // Polling - adaptive: fast (2s) when data flows, slow (30s) when idle.
  // Stops entirely once local/direct SSE mode is detected (isLocalMode).
  useEffect(() => {
    if (!enabled) return;

    let timer;
    const SSE_STALE_MS = 30000; // Reset local mode if no SSE message for 30 s
    const tick = () => {
      // SSE from rig-bridge is the data source — no need to poll the server.
      // But if SSE has gone silent for >30 s, assume rig-bridge disconnected and
      // resume polling so the UI doesn't show stale data indefinitely.
      if (isLocalMode.current) {
        if (Date.now() - lastSseAt.current < SSE_STALE_MS) return;
        isLocalMode.current = false; // SSE appears stale — fall back to polling
      }
      const interval = hasDataFlowing.current ? POLL_FAST : POLL_SLOW;
      fullFetchCounter.current++;
      if (fullFetchCounter.current >= 8) {
        // Full refresh every ~16s (fast) or ~240s (slow)
        fullFetchCounter.current = 0;
        fetchFull();
      } else {
        pollDecodes();
      }
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, POLL_SLOW); // Start slow, speed up if data arrives

    return () => clearTimeout(timer);
  }, [enabled, fetchFull, pollDecodes]);

  // Refresh immediately when tab becomes visible (handles browser throttling)
  // Don't do this if we are using SSE as fetchFull() flushes our history and
  // SSE will need to uld it up again from scratch.
  useVisibilityRefresh(() => {
    if (enabled && !isLocalMode.current) fetchFull();
  }, 5000);

  // Receive decode/status/qso events pushed over the rig-bridge SSE /stream
  // (local/direct mode only — cloud relay uses the server polling path above).
  // plugin-init seeds the decode list with recent history from rig-bridge's
  // ring-buffer so the UI is populated immediately on connect.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      const msg = e.detail;

      // Mark local mode on the first SSE message and refresh the heartbeat on every one.
      // The polling loop checks lastSseAt and resets isLocalMode if SSE goes silent for >30 s.
      lastSseAt.current = Date.now();
      if (!isLocalMode.current) {
        isLocalMode.current = true;
        setLoading(false);
        setError(null);
      }

      if (msg.type === 'plugin-init') {
        // Seed from ring-buffer replay
        if (Array.isArray(msg.decodes) && msg.decodes.length > 0) {
          setData((prev) => {
            const existingKeys = new Set(
              prev.decodes.map((d) => `${d.time}-${d.freq}-${(d.message ?? '').replace(/\s+/g, '')}`),
            );
            const fresh = msg.decodes.filter((d) => {
              const k = `${d.time}-${d.freq}-${(d.message ?? '').replace(/\s+/g, '')}`;
              return !existingKeys.has(k);
            });
            if (fresh.length === 0) return prev;
            const merged = [...fresh, ...prev.decodes].slice(-500);
            return { ...prev, decodes: merged, enabled: true };
          });
        }
        return;
      }

      if (msg.event === 'decode') {
        setData((prev) => {
          const d = msg.data;
          const existingIds = new Set(prev.decodes.map((x) => x.id));
          if (d.id && existingIds.has(d.id)) return prev;
          const existingKeys = new Set(
            prev.decodes.map((x) => `${x.time}-${x.freq}-${(x.message ?? '').replace(/\s+/g, '')}`),
          );
          const contentKey = `${d.time}-${d.freq}-${(d.message ?? '').replace(/\s+/g, '')}`;
          if (existingKeys.has(contentKey)) return prev;
          const merged = [...prev.decodes, d].slice(-500);
          return { ...prev, decodes: merged, enabled: true, stats: { ...prev.stats, totalDecodes: merged.length } };
        });
      } else if (msg.event === 'status') {
        const { source, data: s } = msg;
        setData((prev) => ({
          ...prev,
          enabled: true,
          clients: {
            ...prev.clients,
            [source]: {
              ...(prev.clients[source] ?? {}),
              dialFrequency: s.dialFrequency,
              mode: s.mode,
              dxCall: s.dxCall,
              dxGrid: s.dxGrid,
              dxLat: s.dxLat ?? null,
              dxLon: s.dxLon ?? null,
              band: s.band ?? null,
              bandChanged: s.bandChanged ?? false,
              transmitting: s.transmitting,
              decoding: s.decoding,
              lastSeen: Date.now(),
            },
          },
        }));
      } else if (msg.event === 'qso') {
        setData((prev) => {
          const updated = [msg.data, ...prev.qsos].slice(-200);
          return { ...prev, qsos: updated, stats: { ...prev.stats, totalQsos: updated.length } };
        });
      } else if (msg.event === 'clear') {
        // WSJT-X cleared its band activity — remove decodes from that client
        const clientId = msg.data?.clientId;
        if (clientId) {
          setData((prev) => ({ ...prev, decodes: prev.decodes.filter((d) => d.clientId !== clientId) }));
        }
      } else if (msg.event === 'wspr') {
        setData((prev) => {
          const updated = [msg.data, ...prev.wspr].slice(-100);
          return { ...prev, wspr: updated, stats: { ...prev.stats, totalWspr: updated.length } };
        });
      } else if (msg.event === 'decode-update') {
        // Async HamQTH result arrived — patch any existing decodes from this callsign
        const { callsign, lat, lon } = msg.data ?? {};
        if (callsign && lat != null && lon != null) {
          setData((prev) => ({
            ...prev,
            decodes: prev.decodes.map((d) => {
              const match = d.caller === callsign || d.dxCall === callsign || d.deCall === callsign;
              return match && d.lat == null ? { ...d, lat, lon, gridSource: 'hamqth' } : d;
            }),
          }));
        }
      }
    };
    window.addEventListener('rig-plugin-data', handler);
    return () => window.removeEventListener('rig-plugin-data', handler);
  }, [enabled]);

  // ── Derive DX target from active WSJT-X client status ──
  // Pick the most recently active client (most recent lastSeen).
  // When its dxCall changes and has resolved coordinates, update dxTarget.
  useEffect(() => {
    const clients = data.clients || {};
    const entries = Object.values(clients);
    if (entries.length === 0) return;

    // Pick most recently active client
    const active = entries.reduce((a, b) => ((a.lastSeen || 0) > (b.lastSeen || 0) ? a : b));

    const call = (active.dxCall || '').trim();
    const lat = active.dxLat;
    const lon = active.dxLon;
    const grid = active.dxGrid || null;

    // Only fire when the DX call actually changes (not on every poll)
    if (call && call !== prevDxCallRef.current && lat != null && lon != null) {
      setDxTarget({ call, grid, lat, lon });
    } else if (!call && prevDxCallRef.current) {
      // DX call cleared (operator cleared Std Msgs)
      setDxTarget(null);
    }
    prevDxCallRef.current = call || null;

    // ── Band change detection ──
    // Use the bandChanged flag emitted by the rig-bridge enrichment layer, which
    // sets it for exactly one STATUS cycle when a transition is detected.
    // Fall back to manual tracking for the server/relay path which may not set it.
    const currentBand = active.band ?? null;
    const bandJustChanged =
      active.bandChanged || (currentBand && prevBandRef.current && currentBand !== prevBandRef.current);
    if (bandJustChanged) {
      setData((prev) => ({
        ...prev,
        decodes: [], // Clear all decodes on band change — new-band decodes will fill in
      }));
    }
    prevBandRef.current = currentBand;
  }, [data.clients]);

  return {
    ...data,
    loading,
    error,
    sessionId,
    dxTarget,
    refresh: fetchFull,
  };
}
