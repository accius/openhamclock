/**
 * useHamsAtAlerts — upcoming alerted satellite passes from hams.at, via the
 * server proxy (/api/hams-at/alerts/upcoming).
 *
 * One poll loop per API key is shared by every mounted consumer (the
 * Satellite Passes panel and the audio-alert feed in App), so a browser never
 * asks the server more than once per 5 minutes however many panels are open.
 * The key travels in the X-HamsAt-Key header; the server caches by its hash
 * and never stores it.
 */
import { useEffect, useState } from 'react';
import { normalizeHamsAtAlerts } from '../utils/hamsAtAlerts.js';

export const HAMS_AT_POLL_MS = 5 * 60 * 1000;

// apiKey → { data, error, loading, fetchedAt, keyed, timer, subs:Set, inflight }
const loops = new Map();

function notify(loop) {
  for (const fn of loop.subs) {
    try {
      fn();
    } catch {}
  }
}

async function refresh(loop, apiKey) {
  if (loop.inflight) return loop.inflight;
  loop.loading = true;
  notify(loop);
  loop.inflight = (async () => {
    try {
      const headers = apiKey ? { 'X-HamsAt-Key': apiKey } : {};
      const res = await fetch('/api/hams-at/alerts/upcoming', { headers, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        loop.error = body?.error || `HTTP ${res.status}`;
        loop.errorStatus = res.status;
      } else {
        loop.data = normalizeHamsAtAlerts(body.alerts);
        loop.fetchedAt = body.fetchedAt || Date.now();
        loop.keyed = !!body.keyed;
        loop.error = null;
        loop.errorStatus = null;
      }
    } catch (err) {
      loop.error = err?.message || 'fetch failed';
      loop.errorStatus = null;
    } finally {
      loop.loading = false;
      loop.inflight = null;
      notify(loop);
    }
  })();
  return loop.inflight;
}

function acquire(apiKey) {
  let loop = loops.get(apiKey);
  if (!loop) {
    loop = {
      data: [],
      error: null,
      errorStatus: null,
      loading: false,
      fetchedAt: 0,
      keyed: !!apiKey,
      timer: null,
      subs: new Set(),
      inflight: null,
    };
    loops.set(apiKey, loop);
  }
  if (loop.subs.size === 0) {
    refresh(loop, apiKey);
    loop.timer = setInterval(() => refresh(loop, apiKey), HAMS_AT_POLL_MS);
  }
  return loop;
}

function release(apiKey, fn) {
  const loop = loops.get(apiKey);
  if (!loop) return;
  loop.subs.delete(fn);
  if (loop.subs.size === 0 && loop.timer) {
    clearInterval(loop.timer);
    loop.timer = null;
  }
}

/**
 * @param {string} apiKey  hams.at personal API key ('' for the public feed)
 * @param {{enabled?: boolean}} opts  set enabled=false to stop polling (e.g. tab hidden)
 * @returns {{ alerts, loading, error, errorStatus, fetchedAt, keyed, refresh }}
 */
export default function useHamsAtAlerts(apiKey = '', { enabled = true } = {}) {
  const key = String(apiKey || '').trim();
  const [, bump] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const loop = acquire(key);
    const fn = () => bump((n) => n + 1);
    loop.subs.add(fn);
    fn();
    return () => release(key, fn);
  }, [key, enabled]);

  const loop = loops.get(key);
  return {
    alerts: enabled && loop ? loop.data : [],
    loading: enabled && loop ? loop.loading : false,
    error: enabled && loop ? loop.error : null,
    errorStatus: enabled && loop ? loop.errorStatus : null,
    fetchedAt: enabled && loop ? loop.fetchedAt : 0,
    keyed: enabled && loop ? loop.keyed : false,
    refresh: () => {
      const l = loops.get(key);
      if (l) refresh(l, key);
    },
  };
}
