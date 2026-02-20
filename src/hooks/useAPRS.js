/**
 * useAPRS Hook
 * Polls /api/aprs/stations for real-time APRS position data.
 * Manages watchlist groups stored in localStorage.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/apiFetch';

const STORAGE_KEY = 'openhamclock_aprsWatchlist';
const POLL_INTERVAL = 15000; // 15 seconds

export const useAPRS = (options = {}) => {
  const { enabled = true } = options;

  const [stations, setStations] = useState([]);
  const [connected, setConnected] = useState(false);
  const [aprsEnabled, setAprsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

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

  // Fetch stations
  const fetchStations = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch(`/api/aprs/stations?_t=${Date.now()}`, { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setStations(data.stations || []);
        setConnected(data.connected || false);
        setAprsEnabled(data.enabled || false);
        setLastUpdate(new Date());
        setLoading(false);
      }
    } catch (err) {
      console.error('[APRS] Fetch error:', err);
      setLoading(false);
    }
  }, [enabled]);

  // Poll
  useEffect(() => {
    if (!enabled) return;
    fetchStations();
    const interval = setInterval(fetchStations, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, fetchStations]);

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

  // Filtered stations based on active group
  const filteredStations = useMemo(() => {
    if (watchlist.activeGroup === 'all') return stations;
    if (watchlist.activeGroup === 'watchlist') {
      return stations.filter((s) => allWatchlistCalls.has(s.call) || allWatchlistCalls.has(s.ssid));
    }
    const groupCalls = new Set(watchlist.groups[watchlist.activeGroup] || []);
    if (groupCalls.size === 0) return stations;
    return stations.filter((s) => groupCalls.has(s.call) || groupCalls.has(s.ssid));
  }, [stations, watchlist.activeGroup, watchlist.groups, allWatchlistCalls]);

  return {
    stations,
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
    refresh: fetchStations,
  };
};
