/**
 * useKioskLock — React side of utils/kioskLock.js.
 *
 * On mount it honours `?lock=1` / `?lockpin=NNNN` (then strips them from the
 * address bar), mirrors the lock state into sessionFlags (for the header
 * padlock) and exposes an "unlock prompt" that guarded actions open instead
 * of doing their thing while locked.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  applyUrlParams,
  getKioskState,
  KIOSK_LOCK_EVENT,
  lock as lockNow,
  unlock as unlockWith,
} from '../../utils/kioskLock.js';
import { setFlag } from '../../utils/sessionFlags.js';

export const KIOSK_UNLOCK_REQUEST_EVENT = 'ohc:kiosk-unlock-request';

export default function useKioskLock() {
  const [state, setState] = useState(() => getKioskState());
  const [unlockPrompt, setUnlockPrompt] = useState(false);

  useEffect(() => {
    try {
      const applied = applyUrlParams(window.location.search);
      if (applied.setPin || applied.locked) {
        const url = new URL(window.location.href);
        url.searchParams.delete('lock');
        url.searchParams.delete('lockpin');
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      /* ignore */
    }
    const sync = () => setState(getKioskState());
    sync();
    window.addEventListener(KIOSK_LOCK_EVENT, sync);
    window.addEventListener('storage', sync);
    const onRequest = () => setUnlockPrompt(true);
    window.addEventListener(KIOSK_UNLOCK_REQUEST_EVENT, onRequest);
    return () => {
      window.removeEventListener(KIOSK_LOCK_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener(KIOSK_UNLOCK_REQUEST_EVENT, onRequest);
    };
  }, []);

  useEffect(() => {
    setFlag('kioskLocked', state.locked);
    if (!state.locked) setUnlockPrompt(false);
  }, [state.locked]);

  const requestUnlock = useCallback(() => setUnlockPrompt(true), []);
  const cancelUnlock = useCallback(() => setUnlockPrompt(false), []);
  const tryUnlock = useCallback((pin) => unlockWith(pin), []);
  const lock = useCallback(() => lockNow(), []);

  return { locked: state.locked, hasPin: state.hasPin, unlockPrompt, requestUnlock, cancelUnlock, tryUnlock, lock };
}
