/**
 * Browser-local opt-in settings for low-frequency amateur bands.
 */

export const BAND_630M_STORAGE_KEY = 'openhamclock_630mEnabled';
export const BAND_630M_CHANGE_EVENT = 'openhamclock-band-630m-change';

export const loadBand630mEnabled = () => {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(BAND_630M_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const saveBand630mEnabled = (enabled) => {
  const next = enabled === true;

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BAND_630M_STORAGE_KEY, String(next));
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BAND_630M_CHANGE_EVENT, { detail: { enabled: next } }));
  }

  return next;
};
