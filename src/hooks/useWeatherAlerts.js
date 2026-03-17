/**
 * useWeatherAlerts Hook
 * Fetches active weather alerts for a given location from the NWS API.
 * Only works for US locations (NWS coverage area).
 * Returns alerts sorted by severity.
 */
import { useState, useEffect, useRef } from 'react';

// Severity ordering for sorting (most severe first)
const SEVERITY_ORDER = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

// Rough check: is this lat/lon likely in the US (including territories)?
function isLikelyUS(lat, lon) {
  if (lat == null || lon == null) return false;
  // Continental US
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) return true;
  // Alaska
  if (lat >= 51 && lat <= 72 && lon >= -180 && lon <= -130) return true;
  // Hawaii
  if (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154) return true;
  // Puerto Rico / USVI
  if (lat >= 17 && lat <= 19 && lon >= -68 && lon <= -64) return true;
  // Guam
  if (lat >= 13 && lat <= 14 && lon >= 144 && lon <= 145) return true;
  return false;
}

// Map NWS alert events to compact display info
function getAlertDisplay(event) {
  const e = (event || '').toLowerCase();
  if (e.includes('tornado emergency')) return { icon: '‼️', color: '#8B0000', priority: 0 };
  if (e.includes('tornado warning')) return { icon: '🌪️', color: '#FF0000', priority: 1 };
  if (e.includes('hurricane') && e.includes('warning')) return { icon: '🌀', color: '#FF0000', priority: 2 };
  if (e.includes('storm surge warning')) return { icon: '🌊', color: '#FF0000', priority: 3 };
  if (e.includes('extreme wind')) return { icon: '💨', color: '#FF0000', priority: 4 };
  if (e.includes('severe thunderstorm warning')) return { icon: '⛈️', color: '#FF8C00', priority: 5 };
  if (e.includes('flash flood warning')) return { icon: '🌊', color: '#FF0000', priority: 6 };
  if (e.includes('flood warning')) return { icon: '🌊', color: '#00CC00', priority: 7 };
  if (e.includes('tornado watch')) return { icon: '👁️', color: '#FFAA00', priority: 8 };
  if (e.includes('hurricane') && e.includes('watch')) return { icon: '🌀', color: '#FF00FF', priority: 9 };
  if (e.includes('severe thunderstorm watch')) return { icon: '⛈️', color: '#FFAA00', priority: 10 };
  if (e.includes('winter storm warning')) return { icon: '❄️', color: '#FF69B4', priority: 11 };
  if (e.includes('blizzard')) return { icon: '🌨️', color: '#FF4500', priority: 12 };
  if (e.includes('ice storm')) return { icon: '🧊', color: '#8B008B', priority: 13 };
  if (e.includes('winter storm watch')) return { icon: '❄️', color: '#4682B4', priority: 14 };
  if (e.includes('wind advisory')) return { icon: '💨', color: '#D2B48C', priority: 15 };
  if (e.includes('heat') && e.includes('warning')) return { icon: '🔥', color: '#FF0000', priority: 16 };
  if (e.includes('heat') && e.includes('advisory')) return { icon: '🌡️', color: '#FF7F50', priority: 17 };
  if (e.includes('flood') && e.includes('watch')) return { icon: '🌊', color: '#2E8B57', priority: 18 };
  if (e.includes('freeze warning')) return { icon: '🥶', color: '#483D8B', priority: 19 };
  if (e.includes('frost advisory')) return { icon: '🥶', color: '#6495ED', priority: 20 };
  if (e.includes('fog advisory')) return { icon: '🌫️', color: '#808080', priority: 21 };
  if (e.includes('warning')) return { icon: '⚠️', color: '#FF6600', priority: 30 };
  if (e.includes('watch')) return { icon: '👁️', color: '#FFAA00', priority: 31 };
  if (e.includes('advisory')) return { icon: 'ℹ️', color: '#FFD700', priority: 32 };
  return { icon: '⚠️', color: '#AAAAAA', priority: 40 };
}

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export const useWeatherAlerts = (location) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (location?.lat == null || location?.lon == null) {
      setAlerts([]);
      return;
    }

    if (!isLikelyUS(location.lat, location.lon)) {
      setAlerts([]);
      return;
    }

    const fetchAlerts = async () => {
      try {
        setLoading(true);
        const lat = location.lat.toFixed(4);
        const lon = location.lon.toFixed(4);

        const response = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}&status=actual`, {
          headers: {
            'User-Agent': 'OpenHamClock (https://github.com/accius/openhamclock)',
          },
        });

        if (!response.ok) {
          // NWS API may return 404 for points outside US coverage
          if (response.status === 404) {
            setAlerts([]);
            return;
          }
          throw new Error(`NWS API: ${response.status}`);
        }

        const data = await response.json();
        const features = data.features || [];

        const parsed = features.map((f) => {
          const p = f.properties;
          const display = getAlertDisplay(p.event);
          const expires = p.expires ? new Date(p.expires) : null;
          const expiresMs = expires ? expires.getTime() - Date.now() : null;

          return {
            id: p.id || f.id,
            event: p.event,
            headline: p.headline,
            severity: p.severity,
            urgency: p.urgency,
            description: p.description,
            expires: p.expires || null,
            expiresMs,
            areaDesc: p.areaDesc,
            senderName: p.senderName,
            web: p.web,
            ...display,
          };
        });

        // Sort by priority (most severe first), then by expiry (soonest first)
        parsed.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          const sevA = SEVERITY_ORDER[a.severity] ?? 4;
          const sevB = SEVERITY_ORDER[b.severity] ?? 4;
          if (sevA !== sevB) return sevA - sevB;
          return (a.expiresMs || Infinity) - (b.expiresMs || Infinity);
        });

        setAlerts(parsed);
      } catch (err) {
        console.error('[WeatherAlerts] Fetch error:', err.message);
        // Don't clear existing alerts on error — keep showing stale data
      } finally {
        setLoading(false);
      }
    };

    // Debounce location changes (3s — shorter than weather since NWS API is fast and free)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAlerts, 3000);

    const interval = setInterval(fetchAlerts, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [location?.lat, location?.lon]);

  return { alerts, loading };
};

export default useWeatherAlerts;
