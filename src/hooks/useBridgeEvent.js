/**
 * useBridgeEvent — latest payload of one Rig Bridge plugin event.
 *
 * RigContext forwards every `{ type: 'plugin', event, source, data }` SSE
 * message from the bridge as a window `rig-plugin-data` CustomEvent (both in
 * local/direct and cloud-relay mode). Hardware plugins (gps, env, gpio,
 * brightness) publish their state that way and replay it on connect, so a
 * hook only has to remember the last one.
 *
 * @param {string} eventName  e.g. 'gps', 'env', 'brightness', 'gpio'
 * @param {object} [opts]
 * @param {number} [opts.staleMs=0]  >0 → `stale` turns true when nothing
 *                                   arrived for that long (checked every 5 s)
 * @returns {{ data: object|null, at: number, stale: boolean }}
 */
import { useEffect, useState } from 'react';

const STALE_CHECK_MS = 5000;

export function useBridgeEvent(eventName, { staleMs = 0 } = {}) {
  const [entry, setEntry] = useState({ data: null, at: 0 });
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const onData = (e) => {
      const d = e?.detail;
      if (!d || d.type !== 'plugin' || d.event !== eventName) return;
      setEntry({ data: d.data ?? null, at: Date.now() });
      setStale(false);
    };
    window.addEventListener('rig-plugin-data', onData);
    return () => window.removeEventListener('rig-plugin-data', onData);
  }, [eventName]);

  useEffect(() => {
    if (!staleMs || !entry.at) return undefined;
    const check = () => setStale(Date.now() - entry.at > staleMs);
    check();
    const id = setInterval(check, STALE_CHECK_MS);
    return () => clearInterval(id);
  }, [staleMs, entry.at]);

  return { data: entry.data, at: entry.at, stale };
}

export default useBridgeEvent;
