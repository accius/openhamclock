/**
 * useEmcommData Hook
 * Polls NWS Alerts, FEMA Shelters, and FEMA Disaster Declarations.
 * Zero API calls when not in EmComm layout.
 *
 * Offline: when a request fails, alerts, shelters, and disaster
 * declarations fall back to the newest last-known copy — the service
 * worker's cached response or an offline area pack snapshot (Settings →
 * Map Layers → Offline map areas) — and `asOf.<kind>` carries its
 * timestamp (null when live). The US state comes from bundled outlines
 * (utils/usState.js), so it resolves offline too; if it still cannot be
 * found, declarations come straight from the pack covering DE.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { fetchWithPackFallback, loadPackSnapshot } from '../utils/offlinePackStore.js';
import { resolveUsState } from '../utils/usState.js';

const ALERTS_INTERVAL = 3 * 60 * 1000; // 3 min
const SHELTERS_INTERVAL = 5 * 60 * 1000; // 5 min
const DISASTERS_INTERVAL = 15 * 60 * 1000; // 15 min

export const useEmcommData = (options = {}) => {
  // includeDisasters: false skips FEMA declarations (and the reverse-geocode
  // they need) for callers that don't show them, e.g. the Mobile EmComm card.
  const { location, enabled = false, includeDisasters = true } = options;

  const [alerts, setAlerts] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [disasters, setDisasters] = useState([]);
  const [loading, setLoading] = useState(false);
  // Timestamp of the last-known copy being shown per kind (null = live)
  const [asOf, setAsOf] = useState({ alerts: null, shelters: null, disasters: null });
  // When each kind last came back live — an older offline copy never
  // replaces newer live data that is already on screen.
  const liveAtRef = useRef({ alerts: 0, shelters: 0, disasters: 0 });

  const locationRef = useRef(location);
  locationRef.current = location;
  const resolvedStateRef = useRef(null);

  // Reverse geocode lat/lon to state code (Nominatim, remembered per location)
  const resolveState = useCallback(async (loc) => {
    if (loc.state || loc.lat == null || loc.lon == null) return loc;
    const state = await resolveUsState(loc.lat, loc.lon);
    if (state) {
      resolvedStateRef.current = { lat: loc.lat, lon: loc.lon, state };
      return { ...loc, state };
    }
    return loc;
  }, []);

  // Live fetch with offline fallback; `apply` receives the array to show.
  const fetchKind = useCallback(async (kind, url, apply) => {
    const loc = locationRef.current;
    try {
      const r = await fetchWithPackFallback(apiFetch, url, { cache: 'no-store' }, { kind, lat: loc.lat, lon: loc.lon });
      if (!r || r.source === 'none') return;
      if (r.source === 'live') {
        liveAtRef.current[kind] = Date.now();
        apply(Array.isArray(r.data) ? r.data : []);
        setAsOf((prev) => (prev[kind] == null ? prev : { ...prev, [kind]: null }));
        return;
      }
      if ((r.fetchedAt || 0) <= liveAtRef.current[kind]) return;
      apply(Array.isArray(r.data) ? r.data : []);
      setAsOf((prev) => ({ ...prev, [kind]: r.fetchedAt || null }));
    } catch (err) {
      console.error(`[EmComm] ${kind} fetch error:`, err);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    const loc = locationRef.current;
    if (loc?.lat == null || loc?.lon == null) return;
    await fetchKind('alerts', `/api/emcomm/alerts?lat=${loc.lat}&lon=${loc.lon}`, setAlerts);
  }, [fetchKind]);

  const fetchShelters = useCallback(async () => {
    const loc = locationRef.current;
    if (loc?.lat == null || loc?.lon == null) return;
    await fetchKind('shelters', `/api/emcomm/shelters?lat=${loc.lat}&lon=${loc.lon}&radius=200`, setShelters);
  }, [fetchKind]);

  const fetchDisasters = useCallback(async () => {
    const loc = locationRef.current;
    // Resolve state from lat/lon if not already set
    const resolved = await resolveState(loc || {});
    if (!resolved?.state) {
      // No state (point outside the outlines and Nominatim unreachable): the
      // newest offline area covering DE saved its state's declarations.
      if (loc?.lat == null || loc?.lon == null) return;
      const snap = await loadPackSnapshot(loc.lat, loc.lon, 'disasters');
      if (snap && (snap.fetchedAt || 0) > liveAtRef.current.disasters) {
        setDisasters(Array.isArray(snap.data) ? snap.data : []);
        setAsOf((prev) => ({ ...prev, disasters: snap.fetchedAt || null }));
      }
      return;
    }
    // Update ref so subsequent calls use cached state
    if (!locationRef.current?.state && resolved.state) {
      locationRef.current = { ...locationRef.current, state: resolved.state };
    }
    await fetchKind('disasters', `/api/emcomm/disasters?state=${encodeURIComponent(resolved.state)}`, setDisasters);
  }, [resolveState, fetchKind]);

  // Poll all endpoints at different intervals
  useEffect(() => {
    if (!enabled) {
      // Clear data when disabled
      setAlerts([]);
      setShelters([]);
      setDisasters([]);
      setAsOf({ alerts: null, shelters: null, disasters: null });
      liveAtRef.current = { alerts: 0, shelters: 0, disasters: 0 };
      return;
    }

    setLoading(true);

    // Initial fetch
    Promise.all([fetchAlerts(), fetchShelters(), includeDisasters ? fetchDisasters() : null]).finally(() =>
      setLoading(false),
    );

    const alertsTimer = setInterval(fetchAlerts, ALERTS_INTERVAL);
    const sheltersTimer = setInterval(fetchShelters, SHELTERS_INTERVAL);
    const disastersTimer = includeDisasters ? setInterval(fetchDisasters, DISASTERS_INTERVAL) : null;

    return () => {
      clearInterval(alertsTimer);
      clearInterval(sheltersTimer);
      clearInterval(disastersTimer);
    };
  }, [enabled, includeDisasters, fetchAlerts, fetchShelters, fetchDisasters]);

  return { alerts, shelters, disasters, loading, asOf, state: resolvedStateRef.current?.state ?? null };
};
