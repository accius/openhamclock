/**
 * useEmcommData Hook
 * Polls NWS Alerts, FEMA Shelters, and FEMA Disaster Declarations.
 * Zero API calls when not in EmComm layout.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';

const ALERTS_INTERVAL = 3 * 60 * 1000; // 3 min
const SHELTERS_INTERVAL = 5 * 60 * 1000; // 5 min
const DISASTERS_INTERVAL = 15 * 60 * 1000; // 15 min

export const useEmcommData = (options = {}) => {
  const { location, enabled = false } = options;

  const [alerts, setAlerts] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [disasters, setDisasters] = useState([]);
  const [loading, setLoading] = useState(false);

  const locationRef = useRef(location);
  locationRef.current = location;
  const resolvedStateRef = useRef(null);

  // Reverse geocode lat/lon to state code via Nominatim
  const resolveState = useCallback(async (loc) => {
    if (loc.state || loc.lat == null || loc.lon == null) return loc;
    // Use cached result if location hasn't changed
    if (resolvedStateRef.current?.lat === loc.lat && resolvedStateRef.current?.lon === loc.lon) {
      return { ...loc, state: resolvedStateRef.current.state };
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json&zoom=5`,
        { headers: { 'User-Agent': 'OpenHamClock' } },
      );
      const data = await res.json();
      const iso = data?.address?.['ISO3166-2-lvl4']; // e.g., "US-CO"
      if (iso) {
        const state = iso.split('-')[1];
        resolvedStateRef.current = { lat: loc.lat, lon: loc.lon, state };
        return { ...loc, state };
      }
    } catch {
      // Silently fail — disasters panel just stays empty
    }
    return loc;
  }, []);

  const fetchAlerts = useCallback(async () => {
    const loc = locationRef.current;
    if (loc?.lat == null || loc?.lon == null) return;
    try {
      const res = await apiFetch(`/api/emcomm/alerts?lat=${loc.lat}&lon=${loc.lon}`, { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Alerts fetch error:', err);
    }
  }, []);

  const fetchShelters = useCallback(async () => {
    const loc = locationRef.current;
    if (loc?.lat == null || loc?.lon == null) return;
    try {
      const res = await apiFetch(`/api/emcomm/shelters?lat=${loc.lat}&lon=${loc.lon}&radius=200`, {
        cache: 'no-store',
      });
      if (res?.ok) {
        const data = await res.json();
        setShelters(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Shelters fetch error:', err);
    }
  }, []);

  const fetchDisasters = useCallback(async () => {
    const loc = locationRef.current;
    // Resolve state from lat/lon if not already set
    const resolved = await resolveState(loc || {});
    if (!resolved?.state) return;
    // Update ref so subsequent calls use cached state
    if (!locationRef.current?.state && resolved.state) {
      locationRef.current = { ...locationRef.current, state: resolved.state };
    }
    try {
      const res = await apiFetch(`/api/emcomm/disasters?state=${encodeURIComponent(resolved.state)}`, {
        cache: 'no-store',
      });
      if (res?.ok) {
        const data = await res.json();
        setDisasters(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Disasters fetch error:', err);
    }
  }, [resolveState]);

  // Poll all endpoints at different intervals
  useEffect(() => {
    if (!enabled) {
      // Clear data when disabled
      setAlerts([]);
      setShelters([]);
      setDisasters([]);
      return;
    }

    setLoading(true);

    // Initial fetch
    Promise.all([fetchAlerts(), fetchShelters(), fetchDisasters()]).finally(() => setLoading(false));

    const alertsTimer = setInterval(fetchAlerts, ALERTS_INTERVAL);
    const sheltersTimer = setInterval(fetchShelters, SHELTERS_INTERVAL);
    const disastersTimer = setInterval(fetchDisasters, DISASTERS_INTERVAL);

    return () => {
      clearInterval(alertsTimer);
      clearInterval(sheltersTimer);
      clearInterval(disastersTimer);
    };
  }, [enabled, fetchAlerts, fetchShelters, fetchDisasters]);

  return { alerts, shelters, disasters, loading };
};
