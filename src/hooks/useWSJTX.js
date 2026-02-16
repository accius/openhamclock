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

const POLL_FAST = 2000;    // 2s when data is flowing
const POLL_SLOW = 30000;   // 30s idle check — is anything connected?
const API_URL = '/api/wsjtx';
const DECODES_URL = '/api/wsjtx/decodes';

// Generate or retrieve persistent session ID
// NOTE: Kept short (8 chars) intentionally — long UUIDs in query strings
// trigger false positives in Bitdefender and similar security software
function getSessionId() {
  const KEY = 'ohc-wsjtx-session';
  const generate = () => Math.random().toString(36).substring(2, 10);
  try {
    let id = localStorage.getItem(KEY);
    // Must be 8-12 chars alphanumeric — reject old UUIDs (36 chars with dashes)
    // which trigger Bitdefender false positives as "tracking tokens"
    if (id && id.length >= 8 && id.length <= 12 && /^[a-z0-9]+$/.test(id)) return id;
    id = generate();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Fallback for privacy browsers that block localStorage
    return generate();
  }
}

export function useWSJTX(enabled = true) {
  const [sessionId] = useState(getSessionId);
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
  const hasDataFlowing = useRef(false); // True when relay/UDP is active

  // Lightweight poll - just new decodes since last check
  const pollDecodes = useCallback(async () => {
    if (!enabled) return;
    // Skip if we're in a rate-limit backoff window
    if (Date.now() < backoffUntil.current) return;
    try {
      const base = lastTimestamp.current 
        ? `${DECODES_URL}?since=${lastTimestamp.current}`
        : DECODES_URL;
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
        setData(prev => {
          // Merge new decodes, dedup by id, keep last 200
          const existing = new Set(prev.decodes.map(d => d.id));
          const newDecodes = json.decodes.filter(d => !existing.has(d.id));
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
      hasDataFlowing.current = !!(json.enabled && (
        (json.stats?.activeClients > 0) ||
        (json.decodes?.length > 0) ||
        (json.qsos?.length > 0)
      ));
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

  // Polling - adaptive: fast (2s) when data flows, slow (30s) when idle
  useEffect(() => {
    if (!enabled) return;
    
    let timer;
    const tick = () => {
      const interval = hasDataFlowing.current ? POLL_FAST : POLL_SLOW;
      fullFetchCounter.current++;
      if (fullFetchCounter.current >= 8) { // Full refresh every ~16s (fast) or ~240s (slow)
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
  useVisibilityRefresh(() => { if (enabled) fetchFull(); }, 5000);

  return {
    ...data,
    loading,
    error,
    sessionId,
    refresh: fetchFull,
  };
}
