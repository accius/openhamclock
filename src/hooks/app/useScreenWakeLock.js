'use strict';

import { useEffect, useRef, useState, useCallback } from 'react';

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
 * Returns a `wakeLockStatus` object so the UI can show real-time state:
 *   { active: bool, reason: string | null }
 *
 * Possible reason values when active is false:
 *   'disabled'    – user has preventSleep turned off
 *   'insecure'    – page is not served over HTTPS (required by spec)
 *   'unsupported' – browser does not implement the API
 *   'error'       – API available but request failed (e.g. Low Power Mode)
 *   'electron'    – running in Electron (handled by powerSaveBlocker, no web sentinel)
 *
 * @param {object} config - app config object; reads config.preventSleep (boolean)
 * @returns {{ wakeLockStatus: { active: boolean, reason: string|null } }}
 */
export default function useScreenWakeLock(config) {
  const wakeLockRef = useRef(null);
  const [wakeLockStatus, setWakeLockStatus] = useState({ active: false, reason: 'disabled' });

  const acquire = useCallback(async () => {
    // Electron delegates entirely to powerSaveBlocker — no web sentinel needed
    if (window.electronAPI) {
      setWakeLockStatus({ active: true, reason: 'electron' });
      return;
    }

    // Screen Wake Lock API requires a secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      console.warn('[WakeLock] Screen Wake Lock requires HTTPS. Current context is insecure.');
      setWakeLockStatus({ active: false, reason: 'insecure' });
      return;
    }

    if (!('wakeLock' in navigator)) {
      console.warn('[WakeLock] Screen Wake Lock API not supported in this browser.');
      setWakeLockStatus({ active: false, reason: 'unsupported' });
      return;
    }

    try {
      // Release any existing sentinel before requesting a new one
      if (wakeLockRef.current) {
        await wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setWakeLockStatus({ active: true, reason: null });
      console.log('[WakeLock] Screen wake lock acquired.');

      wakeLockRef.current.addEventListener('release', () => {
        // Only update status if we didn't release intentionally (ref cleared on intentional release)
        if (wakeLockRef.current) {
          setWakeLockStatus({ active: false, reason: 'error' });
        }
        console.log('[WakeLock] Screen wake lock released.');
      });
    } catch (e) {
      console.warn('[WakeLock] Could not acquire screen wake lock:', e.message);
      setWakeLockStatus({ active: false, reason: 'error' });
    }
  }, []);

  useEffect(() => {
    if (!config.preventSleep) {
      // Release web wake lock if currently held
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      // Release Electron blocker
      window.electronAPI?.setPreventSleep(false);
      setWakeLockStatus({ active: false, reason: 'disabled' });
      return;
    }

    // Electron path: delegate to the main process powerSaveBlocker
    if (window.electronAPI) {
      window.electronAPI.setPreventSleep(true);
      setWakeLockStatus({ active: true, reason: 'electron' });
      return;
    }

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
  }, [config.preventSleep, acquire]);

  return { wakeLockStatus };
}
