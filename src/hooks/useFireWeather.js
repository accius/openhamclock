/**
 * useFireWeather — NWS Red Flag Warnings / Fire Weather Watches from
 * /api/fire-weather/alerts (server-cached 5 min, zone polygons attached).
 * Distance and bearing from DE are computed here so the server response is
 * identical for every user. Shared with the fire-weather-alerts map layer.
 */
import { useEffect, useMemo, useState } from 'react';
import { subscribe } from '../utils/sharedFetcher';
import { calculateDistance, calculateBearing } from '../utils/geo';

export const FIRE_WEATHER_URL = '/api/fire-weather/alerts';
const INTERVAL = 5 * 60 * 1000;

export const useFireWeather = (enabled = true, deLat = null, deLon = null) => {
  const [state, setState] = useState({ data: null, error: null, fetchedAt: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe(FIRE_WEATHER_URL, INTERVAL, setState);
  }, [enabled]);

  const alerts = useMemo(() => {
    const list = state.data?.alerts || [];
    const hasDe = Number.isFinite(deLat) && Number.isFinite(deLon);
    return list
      .map((a) => {
        const c = a.centroid;
        const km = hasDe && c ? calculateDistance(deLat, deLon, c.lat, c.lon) : null;
        const bearing = hasDe && c ? calculateBearing(deLat, deLon, c.lat, c.lon) : null;
        return { ...a, km, bearing };
      })
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || (a.event === 'Red Flag Warning' ? -1 : 1));
  }, [state.data, deLat, deLon]);

  return {
    alerts,
    zonesPending: state.data?.zonesPending || 0,
    stale: !!state.data?.stale,
    fetchedAt: state.data?.fetchedAt || null,
    loading: !state.data && !state.error,
    error: state.error,
  };
};

export default useFireWeather;
