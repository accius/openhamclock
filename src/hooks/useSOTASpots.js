/**
 * useSOTASpots Hook
 * Fetches Summits on the Air activations via server proxy (for caching)
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { WGS84ToMaidenhead } from '@hamset/maidenhead-locator';
import { getBandFromFreq } from '../utils/callsign';

export const useSOTASpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const lastNewestSpotRef = useRef(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchSOTA = async () => {
      try {
        // Server sets Cache-Control: no-store; fetch no-store bypasses browser cache
        const res = await apiFetch('/api/sota/spots', { cache: 'no-store' });
        if (res?.ok) {
          const spots = await res.json();
          console.log(`[SOTA] Fetched ${Array.isArray(spots) ? spots.length : 0} spots`);

          // Only mark as "updated" when data content actually changes
          let newestTime = null;
          if (Array.isArray(spots) && spots.length > 0) {
            const times = spots
              .map((s) => s.timeStamp)
              .filter(Boolean)
              .sort()
              .reverse();
            newestTime = times[0] || null;
          }
          if (newestTime !== lastNewestSpotRef.current || lastNewestSpotRef.current === null) {
            lastNewestSpotRef.current = newestTime;
            setLastUpdated(Date.now());
          }

          let entry = []; // To weed out duplicate entries. We only want the most recent (first) spot matching "callsign summit"

          // Map SOTA API response to our standard spot format
          const mapped = (Array.isArray(spots) ? spots : [])
            .filter((s) => {
              if (!(s.activatorCallsign && s.frequency)) return false;
              // Filter out QRT (operator signed off)
              const comments = (s.comments || '').toUpperCase().trim();
              if (comments === 'QRT' || comments.startsWith('QRT ') || comments.startsWith('QRT,')) return false;
              // Filter out spots older than 60 minutes
              if (s.timeStamp) {
                const ts = s.timeStamp.endsWith('Z') || s.timeStamp.endsWith('z') ? s.timeStamp : s.timeStamp + 'Z';
                const ageMs = Date.now() - new Date(ts).getTime();
                if (ageMs > 60 * 60 * 1000) return false;
              }

              // Check to see if we already have already seen a spot for key.
              const key = `${s.activatorCallsign} ${s.associationCode}/${s.summitCode}`;
              if (entry.includes(key)) return false;
              else entry.push(key);

              return true;
            })
            .map((s) => {
              // summitDetails often contains lat/lng from the SOTA DB
              const details = s.summitDetails || {};
              const lat = details.latitude != null ? parseFloat(details.latitude) : null;
              const lon = details.longitude != null ? parseFloat(details.longitude) : null;

              // Parse frequency — SOTA API may return it as a string like "14.062"
              const freq = s.frequency ? String(s.frequency) : '';

              return {
                call: s.activatorCallsign,
                ref: s.associationCode && s.summitCode ? `${s.associationCode}/${s.summitCode}` : s.summitCode || '',
                summit: details.name || '',
                name: `${details.name} (${details.points}pt)`,
                altM: details.altM || details.altitude || null,
                points: details.points || s.points || null,
                freq,
                band: getBandFromFreq(s.frequency),
                mode: s.mode || '',
                comments: s.comments || '',
                lat,
                lon,
                // SOTA API returns UTC timestamps without 'Z' suffix, violating ISO 8601
                // Defensively append 'Z' if not present to force UTC interpretation
                time: s.timeStamp
                  ? (() => {
                      const ts =
                        s.timeStamp.endsWith('Z') || s.timeStamp.endsWith('z') ? s.timeStamp : s.timeStamp + 'Z';
                      return new Date(ts).toISOString().substr(11, 5) + 'z';
                    })()
                  : '',
                grid: WGS84ToMaidenhead({ lat: lat, lng: lon }),
              };
            });

          setData(mapped);
        } else {
          console.warn(`[SOTA] Fetch failed: ${res?.status || 'no response'} ${res?.statusText || ''}`);
        }
      } catch (err) {
        console.error('[SOTA] Fetch error:', err.message || err);
      } finally {
        setLastChecked(Date.now());
        setLoading(false);
      }
    };

    fetchSOTA();
    fetchRef.current = fetchSOTA;
    const interval = setInterval(fetchSOTA, 120 * 1000); // 2 minutes
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 10000);

  return { data, loading, lastUpdated, lastChecked };
};

export default useSOTASpots;
