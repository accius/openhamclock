/**
 * useAPRS Hook
 * Polls /api/aprs/stations for internet APRS-IS data.
 * In local/direct mode (rig-bridge SSE), RF stations are maintained in a
 * separate in-memory store fed directly by SSE events — no server round-trip.
 * Manages watchlist groups stored in localStorage.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/apiFetch';

const STORAGE_KEY = 'openhamclock_aprsWatchlist';
const POLL_INTERVAL = 15000; // 15 seconds
const RF_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes — match server APRS_MAX_AGE_MINUTES

export const useAPRS = (options = {}) => {
  const { enabled = true } = options;

  // Internet APRS-IS stations from server polling
  const [stations, setStations] = useState([]);
  // Local RF stations from rig-bridge SSE — Map keyed by ssid (full callsign)
  const [rfStations, setRfStations] = useState(new Map());

  const [connected, setConnected] = useState(false);
  const [aprsEnabled, setAprsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tncConnected, setTncConnected] = useState(false);
  // True once SSE confirms aprs-tnc is running — prevents server poll from
  // resetting aprsEnabled to false when the OHC server has APRS_ENABLED=false.
  const tncDetectedViaSse = useRef(false);
  // sourceFilter: 'all' | 'internet' | 'rf'
  const [sourceFilter, setSourceFilter] = useState('all');

  // Watchlist: { groups: { 'Group Name': ['CALL1', 'CALL2'], ... }, activeGroup: 'all' | 'Group Name' }
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : { groups: {}, activeGroup: 'all' };
    } catch {
      return { groups: {}, activeGroup: 'all' };
    }
  });

  // Persist watchlist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
    } catch {}
  }, [watchlist]);

  // Fetch internet APRS-IS stations from server
  const fetchStations = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/api/aprs/stations', { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setStations(data.stations || []);
        setConnected(data.connected || false);
        // Don't let the server poll override aprsEnabled when the TNC was
        // detected locally via SSE — the OHC server may have APRS_ENABLED=false
        // even while rig-bridge's aprs-tnc plugin is actively receiving packets.
        if (!tncDetectedViaSse.current) {
          setAprsEnabled(data.enabled || data.tncActive || false);
        }
        setLastUpdate(new Date());
        setLoading(false);
      }
    } catch (err) {
      console.error('[APRS] Fetch error:', err);
      setLoading(false);
    }
  }, [enabled]);

  // Poll TNC connection status from rig-bridge (via server proxy)
  const fetchTncStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/api/aprs/tnc-status', { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setTncConnected(data.connected ?? false);
      }
    } catch {
      setTncConnected(false);
    }
  }, [enabled]);

  // Poll stations
  useEffect(() => {
    if (!enabled) return;
    fetchStations();
    const interval = setInterval(fetchStations, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, fetchStations]);

  // Poll TNC status every 10 seconds (less frequent than stations)
  useEffect(() => {
    if (!enabled) return;
    fetchTncStatus();
    const interval = setInterval(fetchTncStatus, 10000);
    return () => clearInterval(interval);
  }, [enabled, fetchTncStatus]);

  // Age out stale RF stations (mirrors server-side APRS_MAX_AGE_MINUTES)
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const cutoff = Date.now() - RF_MAX_AGE_MS;
      setRfStations((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [key, st] of next) {
          if ((st.timestamp ?? 0) < cutoff) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 60000); // check every minute
    return () => clearInterval(interval);
  }, [enabled]);

  // Receive APRS packets from rig-bridge SSE /stream (local/direct mode only).
  // Packets now carry parsed position fields (lat, lon, symbol, …) added by
  // aprs-tnc.js, so no server round-trip is needed.
  // plugin-init tells us which integration plugins are running.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      const msg = e.detail;

      if (msg.type === 'plugin-init') {
        const hasTnc = msg.plugins?.includes('aprs-tnc') ?? false;
        setTncConnected(hasTnc);
        if (hasTnc) {
          tncDetectedViaSse.current = true;
          setAprsEnabled(true);
          setLoading(false);
        }
        return;
      }

      if (msg.event !== 'aprs') return;

      const pkt = msg.data;
      // Only add to RF store if the packet was successfully parsed (has lat/lon)
      if (pkt.lat == null || pkt.lon == null) return;

      const key = pkt.ssid ?? pkt.source;
      setRfStations((prev) => {
        const next = new Map(prev);
        next.set(key, {
          ...pkt,
          source: 'local-tnc', // use the standard source tag the UI expects
          timestamp: pkt.timestamp ?? Date.now(),
          lastUpdate: Date.now(),
        });
        return next;
      });
      tncDetectedViaSse.current = true;
      setTncConnected(true);
      setAprsEnabled(true);
      setLastUpdate(new Date());
      setLoading(false);
    };
    window.addEventListener('rig-plugin-data', handler);
    return () => window.removeEventListener('rig-plugin-data', handler);
  }, [enabled]);

  // Merge internet stations with local RF stations.
  // RF stations take precedence: if the same callsign is heard both on the
  // internet and over RF, the RF entry wins (preserves local-tnc tag).
  const allStations = useMemo(() => {
    const rf = Array.from(rfStations.values());
    const rfKeys = new Set(rf.map((s) => s.ssid ?? s.source));
    const internet = stations.filter((s) => !rfKeys.has(s.ssid) && !rfKeys.has(s.call));
    return [...rf, ...internet];
  }, [stations, rfStations]);

  // Watchlist helpers
  const addGroup = useCallback((name) => {
    if (!name?.trim()) return;
    setWatchlist((prev) => ({
      ...prev,
      groups: { ...prev.groups, [name.trim()]: prev.groups[name.trim()] || [] },
    }));
  }, []);

  const removeGroup = useCallback((name) => {
    setWatchlist((prev) => {
      const groups = { ...prev.groups };
      delete groups[name];
      return {
        ...prev,
        groups,
        activeGroup: prev.activeGroup === name ? 'all' : prev.activeGroup,
      };
    });
  }, []);

  const addCallToGroup = useCallback((groupName, callsign) => {
    if (!groupName || !callsign?.trim()) return;
    const call = callsign.trim().toUpperCase();
    setWatchlist((prev) => {
      const group = prev.groups[groupName] || [];
      if (group.includes(call)) return prev;
      return {
        ...prev,
        groups: { ...prev.groups, [groupName]: [...group, call] },
      };
    });
  }, []);

  const removeCallFromGroup = useCallback((groupName, callsign) => {
    setWatchlist((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        [groupName]: (prev.groups[groupName] || []).filter((c) => c !== callsign),
      },
    }));
  }, []);

  const setActiveGroup = useCallback((name) => {
    setWatchlist((prev) => ({ ...prev, activeGroup: name }));
  }, []);

  // All watchlist callsigns (across all groups)
  const allWatchlistCalls = useMemo(() => {
    const calls = new Set();
    Object.values(watchlist.groups).forEach((group) => group.forEach((c) => calls.add(c)));
    return calls;
  }, [watchlist.groups]);

  // Stations filtered by source (all / internet / rf)
  const sourceFilteredStations = useMemo(() => {
    if (sourceFilter === 'rf') return allStations.filter((s) => s.source === 'local-tnc');
    if (sourceFilter === 'internet') return allStations.filter((s) => s.source !== 'local-tnc');
    return allStations;
  }, [allStations, sourceFilter]);

  // Filtered stations: source filter applied first, then group/watchlist filter
  const filteredStations = useMemo(() => {
    const base = sourceFilteredStations;
    if (watchlist.activeGroup === 'all') return base;
    if (watchlist.activeGroup === 'watchlist') {
      return base.filter((s) => allWatchlistCalls.has(s.call) || allWatchlistCalls.has(s.ssid));
    }
    const groupCalls = new Set(watchlist.groups[watchlist.activeGroup] || []);
    if (groupCalls.size === 0) return base;
    return base.filter((s) => groupCalls.has(s.call) || groupCalls.has(s.ssid));
  }, [sourceFilteredStations, watchlist.activeGroup, watchlist.groups, allWatchlistCalls]);

  // Whether any RF (local-tnc) station is currently in the local store
  const hasRFStations = rfStations.size > 0;

  return {
    stations: allStations,
    filteredStations,
    connected,
    aprsEnabled,
    loading,
    lastUpdate,
    watchlist,
    allWatchlistCalls,
    addGroup,
    removeGroup,
    addCallToGroup,
    removeCallFromGroup,
    setActiveGroup,
    sourceFilter,
    setSourceFilter,
    tncConnected,
    hasRFStations,
    refresh: fetchStations,
  };
};
