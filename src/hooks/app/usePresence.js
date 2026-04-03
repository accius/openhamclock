/**
 * usePresence Hook
 * Reports this user's callsign and location to the presence API
 * so they appear on the Active Users map layer for other operators.
 * Runs globally for all configured users (callsign != N0CALL).
 */
import { useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes

export default function usePresence({ callsign, locator, sharePresence = true }) {
  const locationRef = useRef(null);

  // Parse locator to lat/lon
  useEffect(() => {
    if (!locator || locator.length < 4) {
      locationRef.current = null;
      return;
    }
    const g = locator.toUpperCase();
    const lonField = (g.charCodeAt(0) - 65) * 20 - 180;
    const latField = (g.charCodeAt(1) - 65) * 10 - 90;
    const lonSquare = parseInt(g[2]) * 2;
    const latSquare = parseInt(g[3]) * 1;
    let lat = latField + latSquare + 0.5;
    let lon = lonField + lonSquare + 1;
    if (g.length >= 6) {
      const lonSub = (g.charCodeAt(4) - 65) * (2 / 24);
      const latSub = (g.charCodeAt(5) - 65) * (1 / 24);
      lat = latField + latSquare + latSub + 1 / 48;
      lon = lonField + lonSquare + lonSub + 1 / 24;
    }
    locationRef.current = { lat, lon };
  }, [locator]);

  // Send heartbeat
  useEffect(() => {
    if (!sharePresence || !callsign || callsign === 'N0CALL' || !locationRef.current) return;

    const sendHeartbeat = async () => {
      if (!locationRef.current) return;
      try {
        await apiFetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callsign,
            lat: locationRef.current.lat,
            lon: locationRef.current.lon,
            grid: locator || '',
          }),
        });
      } catch {
        // Not critical
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Remove presence immediately when the tab closes
    const handleUnload = () => {
      // navigator.sendBeacon is fire-and-forget — works even during unload
      const payload = JSON.stringify({ callsign });
      navigator.sendBeacon('/api/presence/leave', payload);
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      // Remove presence immediately when stopping (toggle off or unmount)
      navigator.sendBeacon('/api/presence/leave', JSON.stringify({ callsign }));
    };
  }, [callsign, locator, sharePresence]);
}
