/**
 * Live delivery state of APRS messages this station sent (#1247).
 *
 * Rig Bridge re-sends a message to a callsign until it is acked and reports
 * each change as a { type:'plugin', event:'aprs-msg' } stream event, which
 * RigContext re-dispatches as a window 'rig-plugin-data' event. This store
 * keeps the latest state per message id; the server also marks a message
 * delivered when it sees the ack, so a list loaded later still shows it.
 */
import { useEffect, useState } from 'react';

const states = new Map(); // msgId → { state, tries, maxTries, to, updatedAt }
const listeners = new Set();
let installed = false;

export function applyMsgStatus(status) {
  if (!status?.msgId) return;
  states.set(String(status.msgId), { ...status });
  if (states.size > 200) states.delete(states.keys().next().value);
  for (const fn of listeners) fn();
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('rig-plugin-data', (e) => {
    const d = e?.detail;
    if (d?.type === 'plugin' && d.event === 'aprs-msg') applyMsgStatus(d.data);
  });
}

export function getMsgStatus(msgId) {
  return msgId ? states.get(String(msgId)) || null : null;
}

/** Re-renders the caller whenever any message's delivery state changes. */
export function useAprsMsgStatus() {
  const [, setTick] = useState(0);
  useEffect(() => {
    install();
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return getMsgStatus;
}

/**
 * What to show for a sent message: live state from Rig Bridge first, then
 * what the server recorded. null when no ack was requested (alias, bulletin,
 * retries off, or an older Rig Bridge).
 */
export function deliveryLabel(m, live) {
  const state = live?.state || m?.delivery || null;
  if (!m?.msgId || !state) return null;
  if (state === 'acked')
    return { text: '✓ delivered', color: '#22c55e', title: 'The station acknowledged this message' };
  if (state === 'rejected') return { text: '✕ rejected', color: '#ef4444', title: 'The station rejected this message' };
  if (state === 'expired')
    return {
      text: '✕ no ack',
      color: '#ef4444',
      title: `Sent ${live?.tries ?? ''} times, never acknowledged`.replace('  ', ' '),
    };
  const tries = live?.tries;
  return {
    text: tries ? `↻ ${tries}/${live.maxTries}` : '… waiting',
    color: '#f59e0b',
    title: 'Waiting for the station to acknowledge — Rig Bridge re-sends it until it does',
  };
}
