/**
 * useAPRS Hook
 * Polls /api/aprs/stations for internet APRS-IS data — only the stations
 * within this viewer's chosen radius of its station location (the server's
 * single APRS-IS feed filters for the union of its viewers' areas), or none
 * when this viewer has internet APRS off ("Local RF only").
 * In local/direct mode (rig-bridge SSE), RF stations are maintained in a
 * separate in-memory store fed directly by SSE events — no server round-trip.
 * Manages watchlist groups stored in localStorage.
 */
import { cleanRfStation } from '../utils/aprsMiceClean.js';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/apiFetch';

// RF frames from the rig-bridge SSE are also posted to the server (#1212)
const RF_FORWARD_DEBOUNCE_MS = 1000;
const RF_FORWARD_BATCH_MAX = 200;
import {
  DWELL_OPTIONS_MINUTES,
  RF_STORE_KEY,
  NET_STORE_KEY,
  readDwellMinutes,
  writeDwellMinutes,
  readClearedAt,
  writeClearedAt,
  pruneStations,
  mergeStations,
  loadStations,
  saveStations,
} from '../utils/aprsRetention';
import {
  RADIUS_OPTIONS_KM,
  readInternetSettings,
  writeInternetSettings,
  stationsUrl,
  viewerArea,
  showInternetStation,
} from '../utils/aprsInternet.js';

const STORAGE_KEY = 'openhamclock_aprsWatchlist';
const POLL_INTERVAL = 15000; // 15 seconds
// Backoff cadence when the server reports APRS-IS disabled with no TNC data —
// idle instances shouldn't pay the full polling rate for a feature not in use.
const IDLE_POLL_INTERVAL = 90000; // 90 seconds
const TNC_POLL_INTERVAL = 10000; // 10 seconds while a TNC is connected
const TNC_IDLE_POLL_INTERVAL = 60000; // 60 seconds while no TNC is detected
const PERSIST_DEBOUNCE_MS = 1500;

export const useAPRS = (options = {}) => {
  const { enabled = true, location = null } = options;
  const locLat = location?.lat ?? null;
  const locLon = location?.lon ?? null;

  // Per-viewer internet APRS: on/off and radius (km) around the station location
  const [internetAprs, setInternetAprsState] = useState(readInternetSettings);
  const stationsPath = stationsUrl(internetAprs, { lat: locLat, lon: locLon });

  // Dwell: how long a station stays after it was last heard (#1190). The
  // server ages its own cache at APRS_MAX_AGE_MINUTES; this is the client's
  // view and may be longer — stations the server has dropped stay retained
  // here until they age past the dwell.
  const [dwellMinutes, setDwellMinutesState] = useState(readDwellMinutes);
  // Epoch ms of the operator's last "clear" — anything heard at/before it
  // stays gone until a fresh beacon arrives.
  const clearedAtRef = useRef(readClearedAt());
  const retentionOpts = () => ({ dwellMs: dwellMinutes * 60000, clearedAt: clearedAtRef.current });

  // Internet APRS-IS stations — server snapshots folded into a retained Map
  // keyed by ssid so a refresh or a server-side age-out does not lose them.
  const [netStations, setNetStations] = useState(() => loadStations(NET_STORE_KEY, retentionOpts()));
  // Local RF stations from rig-bridge SSE — Map keyed by ssid (full callsign).
  // Persisted: these never reach the server, so without this a page refresh
  // wiped every RF symbol off the map (#1190).
  const [rfStations, setRfStations] = useState(() => loadStations(RF_STORE_KEY, retentionOpts()));
  const forwardQueueRef = useRef([]); // RF frames waiting to be posted to /api/aprs/local
  const forwardTimerRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [aprsEnabled, setAprsEnabled] = useState(false);
  // Server-wide APRS-IS master switch (APRS_ENABLED), as the server reports it
  const [serverInternetEnabled, setServerInternetEnabled] = useState(false);
  const [serverInternetReason, setServerInternetReason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tncConnected, setTncConnected] = useState(false);
  // True once SSE confirms aprs-tnc is running — prevents server poll from
  // resetting aprsEnabled to false when the OHC server has APRS_ENABLED=false.
  const tncDetectedViaSse = useRef(false);
  // Refs mirroring server activity so the poll loops can pick their next delay
  // without re-arming effects (which would trigger an extra immediate fetch).
  const stationsIdleRef = useRef(false);
  const tncConnectedRef = useRef(false);
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
      const res = await apiFetch(stationsPath, { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setNetStations((prev) => mergeStations(prev, data.stations || [], { clearedAt: clearedAtRef.current }));
        setConnected(data.connected || false);
        setServerInternetEnabled(!!data.enabled);
        setServerInternetReason(data.reason || null);
        // Don't let the server poll override aprsEnabled when the TNC was
        // detected locally via SSE — the OHC server may have APRS_ENABLED=false
        // even while rig-bridge's aprs-tnc plugin is actively receiving packets.
        if (!tncDetectedViaSse.current) {
          setAprsEnabled(data.enabled || data.tncActive || false);
        }
        // Idle when APRS-IS is off server-side and nothing has been relayed
        // from a TNC — the next poll backs off to IDLE_POLL_INTERVAL.
        stationsIdleRef.current = !data.enabled && !data.tncActive && (data.stations || []).length === 0;
        setLastUpdate(new Date());
        setLoading(false);
      }
    } catch (err) {
      console.error('[APRS] Fetch error:', err);
      setLoading(false);
    }
  }, [enabled, stationsPath]);

  // Poll TNC connection status from rig-bridge (via server proxy)
  const fetchTncStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/api/aprs/tnc-status', { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        // The server can only probe a bridge on its own localhost:5555. When
        // this browser's bridge stream already reported a TNC, a "not
        // connected" from that probe means it looked in the wrong place
        // (#1243) — keep the stream's answer.
        if (!data.connected && tncDetectedViaSse.current) return;
        tncConnectedRef.current = data.connected ?? false;
        setTncConnected(data.connected ?? false);
      }
    } catch {
      if (tncDetectedViaSse.current) return;
      tncConnectedRef.current = false;
      setTncConnected(false);
    }
  }, [enabled]);

  // Poll stations — full rate while APRS data is flowing, backed off when the
  // server reports the feature idle (APRS-IS off, no TNC relays).
  useEffect(() => {
    if (!enabled) return;
    let timer;
    let cancelled = false;
    const tick = async () => {
      await fetchStations();
      if (cancelled) return;
      timer = setTimeout(tick, stationsIdleRef.current ? IDLE_POLL_INTERVAL : POLL_INTERVAL);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, fetchStations]);

  // Poll TNC status — fast while a TNC is connected (detect disconnects),
  // slow otherwise (a self-hosted rig-bridge starting up is detected within
  // a minute; SSE plugin-init covers the local/direct case instantly).
  useEffect(() => {
    if (!enabled) return;
    let timer;
    let cancelled = false;
    const tick = async () => {
      await fetchTncStatus();
      if (cancelled) return;
      timer = setTimeout(tick, tncConnectedRef.current ? TNC_POLL_INTERVAL : TNC_IDLE_POLL_INTERVAL);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, fetchTncStatus]);

  // Age out stations past the dwell — both stores, immediately when the
  // dwell changes and then once a minute.
  useEffect(() => {
    if (!enabled) return;
    const prune = () => {
      const opts = { dwellMs: dwellMinutes * 60000, clearedAt: clearedAtRef.current };
      setRfStations((prev) => pruneStations(prev, opts));
      setNetStations((prev) => pruneStations(prev, opts));
    };
    prune();
    const interval = setInterval(prune, 60000);
    return () => clearInterval(interval);
  }, [enabled, dwellMinutes]);

  // Persist both stores (debounced — RF packets can arrive in bursts)
  useEffect(() => {
    const timer = setTimeout(() => saveStations(RF_STORE_KEY, rfStations), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rfStations]);
  useEffect(() => {
    const timer = setTimeout(() => saveStations(NET_STORE_KEY, netStations), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [netStations]);

  const setInternetAprs = useCallback((patch) => {
    setInternetAprsState((prev) => {
      const next = { ...prev, ...patch };
      if (!RADIUS_OPTIONS_KM.includes(next.radiusKm)) next.radiusKm = prev.radiusKm;
      next.enabled = !!next.enabled;
      writeInternetSettings(next);
      return next;
    });
  }, []);

  const setDwellMinutes = useCallback((minutes) => {
    const m = Number(minutes);
    if (!DWELL_OPTIONS_MINUTES.includes(m)) return;
    setDwellMinutesState(m);
    writeDwellMinutes(m);
  }, []);

  // Flush every station (map and list). Stations heard at/before this
  // moment stay gone even if the server still lists them; new beacons show.
  const clearStations = useCallback(() => {
    const now = Date.now();
    clearedAtRef.current = now;
    writeClearedAt(now);
    setRfStations(new Map());
    setNetStations(new Map());
  }, []);

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
        tncConnectedRef.current = hasTnc;
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
      // Hand every RF frame to the server as well (#1212). In local mode the
      // TNC feed reaches only this browser, so without this the server never
      // saw RF messages, telemetry or net check-ins — `CQ NETNAME` heard over
      // the air could not appear in the Net Roster. Same payload shape the
      // cloud relay posts; batched so a busy channel is one request a second.
      if (pkt?.source && pkt?.info) {
        forwardQueueRef.current.push({
          source: pkt.source,
          destination: pkt.destination,
          digipeaters: pkt.digipeaters,
          info: pkt.info,
          timestamp: pkt.timestamp ?? Date.now(),
        });
        if (!forwardTimerRef.current) {
          forwardTimerRef.current = setTimeout(() => {
            forwardTimerRef.current = null;
            const packets = forwardQueueRef.current.splice(0, RF_FORWARD_BATCH_MAX);
            if (!packets.length) return;
            apiFetch('/api/aprs/local', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ packets }),
            }).catch(() => {}); // best effort — the RF map does not depend on it
          }, RF_FORWARD_DEBOUNCE_MS);
        }
      }
      // Only add to RF store if the packet was successfully parsed (has lat/lon)
      if (pkt.lat == null || pkt.lon == null) return;

      const key = pkt.ssid ?? pkt.source;
      // Mic-E type bytes off the comment, as the server does for its stations (#1245)
      const clean = cleanRfStation(pkt);
      setRfStations((prev) => {
        const next = new Map(prev);
        next.set(key, {
          ...clean,
          source: 'local-tnc', // use the standard source tag the UI expects
          timestamp: pkt.timestamp ?? Date.now(),
          lastUpdate: Date.now(),
        });
        return next;
      });
      tncDetectedViaSse.current = true;
      tncConnectedRef.current = true;
      setTncConnected(true);
      setAprsEnabled(true);
      setLastUpdate(new Date());
      setLoading(false);
    };
    window.addEventListener('rig-plugin-data', handler);
    return () => {
      window.removeEventListener('rig-plugin-data', handler);
      clearTimeout(forwardTimerRef.current);
      forwardTimerRef.current = null;
    };
  }, [enabled]);

  // Merge internet stations with local RF stations.
  // RF stations take precedence: if the same callsign is heard both on the
  // internet and over RF, the RF entry wins (preserves local-tnc tag).
  // Retained internet stations outside this viewer's area (or all of them
  // with internet APRS off) are hidden; RF relayed through the server stays.
  const allStations = useMemo(() => {
    const rf = Array.from(rfStations.values());
    const rfKeys = new Set(rf.map((s) => s.ssid ?? s.source));
    const loc = { lat: locLat, lon: locLon };
    const internet = Array.from(netStations.values()).filter(
      (s) =>
        !rfKeys.has(s.ssid) &&
        !rfKeys.has(s.call) &&
        (s.source === 'local-tnc' || showInternetStation(s, internetAprs, loc)),
    );
    return [...rf, ...internet];
  }, [netStations, rfStations, internetAprs, locLat, locLon]);

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
    dwellMinutes,
    setDwellMinutes,
    dwellOptions: DWELL_OPTIONS_MINUTES,
    clearStations,
    // Per-viewer internet APRS (centre = station location)
    internetAprs,
    setInternetAprs,
    internetArea: viewerArea(internetAprs, { lat: locLat, lon: locLon }),
    radiusOptions: RADIUS_OPTIONS_KM,
    serverInternetEnabled,
    serverInternetReason,
    refresh: fetchStations,
  };
};
