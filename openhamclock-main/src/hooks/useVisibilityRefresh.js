/**
 * useVisibilityRefresh Hook
 * 
 * Handles browser tab throttling — Chromium-based browsers (Edge, Chrome)
 * aggressively throttle or freeze setInterval in background tabs.
 * When the tab becomes visible again, this hook fires the callback
 * so data can be refetched immediately instead of waiting for the
 * next (potentially delayed) interval tick.
 * 
 * Usage:
 *   useVisibilityRefresh(fetchData, 5000);
 *   // calls fetchData when tab becomes visible, with 5s cooldown
 */
import { useEffect, useRef } from 'react';

export function useVisibilityRefresh(callback, cooldownMs = 5000) {
  const lastCallRef = useRef(0);
  const callbackRef = useRef(callback);
  
  // Keep callback ref current without re-registering listener
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Cooldown prevents hammering if user rapidly switches tabs
        if (now - lastCallRef.current > cooldownMs) {
          lastCallRef.current = now;
          callbackRef.current?.();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cooldownMs]);
}

export default useVisibilityRefresh;
