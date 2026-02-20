'use strict';

import { useEffect, useRef } from 'react';

/**
 * useScreenWakeLock
 *
 * Prevents the display from sleeping while the app is open.
 * - Web: uses the Screen Wake Lock API (navigator.wakeLock)
 * - Electron: uses powerSaveBlocker via the preload bridge (window.electronAPI)
 *
 * The lock is automatically re-acquired when the page becomes visible again,
 * because browsers release wake locks when the tab is hidden (required by spec).
 *
 * @param {object} config - app config object; reads config.preventSleep (boolean)
 */
export default function useScreenWakeLock(config) {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    if (!config.preventSleep) {
      // Release web wake lock if currently held
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      // Release Electron blocker
      window.electronAPI?.setPreventSleep(false);
      return;
    }

    // Electron path: delegate to the main process powerSaveBlocker
    if (window.electronAPI) {
      window.electronAPI.setPreventSleep(true);
    }

    // Web API path
    const acquire = async () => {
      if (!('wakeLock' in navigator)) {
        console.warn('[WakeLock] Screen Wake Lock API not supported in this browser.');
        return;
      }
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Screen wake lock acquired.');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('[WakeLock] Screen wake lock released.');
        });
      } catch (e) {
        console.warn('[WakeLock] Could not acquire screen wake lock:', e.message);
      }
    };

    acquire();

    // Browsers automatically release the wake lock when the tab is hidden.
    // Re-acquire it as soon as the tab becomes visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [config.preventSleep]);
}
