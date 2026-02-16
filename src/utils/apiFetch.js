/**
 * apiFetch — drop-in replacement for fetch() with shared 429 backoff.
 * 
 * When any API call gets a 429, ALL subsequent apiFetch calls pause
 * for the backoff period (default 30s, or per Retry-After header).
 * This prevents a 429 cascade where dozens of hooks keep hammering
 * the server and making the rate limit situation worse.
 * 
 * Usage: import { apiFetch } from '../utils/apiFetch';
 *        const res = await apiFetch('/api/dxcluster/paths');
 *        // returns null during backoff (caller should handle gracefully)
 */

let backedOffUntil = 0;

export async function apiFetch(url, options) {
  const now = Date.now();
  
  // If we're in a backoff period, skip the request entirely
  if (now < backedOffUntil) {
    return null;
  }
  
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    // Parse Retry-After header (seconds) or default to 30s
    const retryAfter = response.headers.get('Retry-After');
    const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
    backedOffUntil = Date.now() + backoffMs;
    console.warn(`[API] 429 rate limited — backing off ${backoffMs / 1000}s for all API calls`);
  }
  
  return response;
}

// Check if currently backed off (for hooks that want to skip without calling)
export function isBackedOff() {
  return Date.now() < backedOffUntil;
}
