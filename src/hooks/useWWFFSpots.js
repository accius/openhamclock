/**
 * useWWFFSpots Hook
 * Fetches Parks on the Air activations via server proxy (for caching)
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { WGS84ToMaidenhead } from '@hamset/maidenhead-locator';
import { getBandFromFreq } from '../utils';

export const useWWFFSpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const lastNewestSpotRef = useRef(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchWWFF = async () => {
      try {
        // Use server proxy for caching - reduces external API calls
        // Server sets Cache-Control: no-store; fetch no-store bypasses browser cache
        const res = await apiFetch('/api/wwff/spots', { cache: 'no-store' });
        if (res?.ok) {
          const spots = await res.json();
          console.log(`[WWFF] Fetched ${Array.isArray(spots) ? spots.length : 0} spots`);

          // Only mark as "updated" when data content actually changes
          let newestTime = null;
          if (Array.isArray(spots) && spots.length > 0) {
            const times = spots
              .map((s) => s.spot_time)
              .filter(Boolean)
              .sort((a, b) => b - a);
            newestTime = times[0] || null;
          }
          if (newestTime !== lastNewestSpotRef.current || lastNewestSpotRef.current === null) {
            lastNewestSpotRef.current = newestTime;
            setLastUpdated(Date.now());
          }

          // Filter out QRT spots and nearly-expired spots, then sort by most recent
          const validSpots = spots
            .filter((s) => {
              // Filter out QRT (operator signed off)
              const comments = (s.remarks || '').toUpperCase().trim();
              if (comments === 'QRT' || comments.startsWith('QRT ') || comments.startsWith('QRT,')) return false;

              // We should also time it out if it's more than 60 minutes old
              if (Math.floor(Date.now() / 1000) - s.spot_time > 3600) return false;

              return true;
            })
            .sort((a, b) => {
              // Sort by spot_time descending (newest first)
              const timeA = a.spot_time ? a.spot_time : 0;
              const timeB = b.spot_time ? b.spot_time : 0;
              return timeB - timeA;
            });

          setData(
            validSpots.map((s) => {
              // Use API coordinates
              let lat = s.latitude ? parseFloat(s.latitude) : null;
              let lon = s.longitude ? parseFloat(s.longitude) : null;

              // WWFF API returns frequency_khz as a number (e.g., 7160 or 433240)
              // Convert to MHz for consistency with POTA/SOTA and proper rig control
              const freqKhz = parseFloat(s.frequency_khz);
              const freqMhz = !isNaN(freqKhz) ? freqKhz / 1000 : null;

              return {
                call: s.activator,
                ref: s.reference,
                freq: freqMhz ? freqMhz.toString() : s.frequency_khz, // Convert to MHz string
                band: getBandFromFreq(s.frequency_khz),
                mode: s.mode,
                name: s.reference_name,
                remarks: s.remarks,
                lat,
                lon,
                time: s.spot_time ? s.spot_time_formatted.substr(11, 5) + 'z' : '',
                expire: 0,
                grid: WGS84ToMaidenhead({ lat: lat, lng: lon }),
              };
            }),
          );
        } else {
          console.warn(`[WWFF] Fetch failed: ${res?.status || 'no response'} ${res?.statusText || ''}`);
        }
      } catch (err) {
        console.error('[WWFF] Fetch error:', err.message || err);
      } finally {
        setLastChecked(Date.now());
        setLoading(false);
      }
    };

    fetchWWFF();
    fetchRef.current = fetchWWFF;
    const interval = setInterval(fetchWWFF, 120 * 1000); // 2 minutes - reduced from 1 to save bandwidth
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 10000);

  return { data, loading, lastUpdated, lastChecked };
};

export default useWWFFSpots;
