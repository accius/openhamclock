/**
 * Web Push client — subscribe/unsubscribe flows for TRUE closed-browser
 * notifications (v1: severe space weather broadcasts from the server).
 *
 * Pairs with:
 *   - server/routes/push.js  (VAPID keys, subscription store, broadcasts)
 *   - public/sw.js           (`push` + `notificationclick` handlers)
 *
 * Requires a registered service worker (production builds over HTTPS or
 * localhost — see src/pwa/registerServiceWorker.js) and Notification
 * permission (helpers reused from src/utils/notifications.js). When the
 * server has no VAPID keys configured, getServerPushStatus() reports
 * { configured: false } and the Settings card shows the dormant state.
 */

import { apiFetch } from './apiFetch';
import { getNotificationPermission, requestNotificationPermission } from './notifications';

/** True when this browser environment can do Web Push at all. */
export function isPushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    window.isSecureContext === true
  );
}

/**
 * Ask the server whether push is configured and get the VAPID public key.
 * Resolves { configured: boolean, publicKey?: string, lightning?: boolean,
 * lightningBroadcast?: boolean } (lightning: targeted lightning pushes are
 * available; lightningBroadcast: the server's station-wide override is on). Network failures
 * report configured: false — the UI treats that the same as dormant.
 */
export async function getServerPushStatus() {
  try {
    const res = await apiFetch('/api/push/vapid-key');
    if (!res) return { configured: false };
    const data = await res.json().catch(() => null);
    if (res.ok && data?.publicKey) {
      return {
        configured: true,
        publicKey: data.publicKey,
        lightning: !!data.lightning,
        lightningBroadcast: !!data.lightningBroadcast,
      };
    }
    return { configured: false };
  } catch {
    return { configured: false };
  }
}

/** Current PushSubscription for this browser, or null. */
export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Decode a URL-safe base64 VAPID key into the Uint8Array subscribe() wants. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Full subscribe flow. MUST be called from a user gesture (permission
 * prompt). Resolves { ok: true } or { ok: false, reason } where reason is
 * 'unsupported' | 'no-permission' | 'server-dormant' | 'no-worker' | 'failed'.
 */
export async function subscribeToPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  let permission = getNotificationPermission();
  if (permission === 'default') permission = await requestNotificationPermission();
  if (permission !== 'granted') return { ok: false, reason: 'no-permission' };

  const status = await getServerPushStatus();
  if (!status.configured) return { ok: false, reason: 'server-dormant' };

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { ok: false, reason: 'no-worker' };
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey),
    });
    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!res || !res.ok) {
      // Server refused to store it — undo the browser-side subscription so
      // the toggle state stays truthful.
      await subscription.unsubscribe().catch(() => {});
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Full unsubscribe flow (browser + server). Always resolves { ok: boolean }. */
export async function unsubscribeFromPush() {
  const subscription = await getPushSubscription();
  if (!subscription) return { ok: true };
  try {
    await apiFetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});
    await subscription.unsubscribe();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Ask the server to send a test push to THIS browser's subscription.
 * Resolves { ok: boolean, error?: string }.
 */
export async function sendTestPush() {
  const subscription = await getPushSubscription();
  if (!subscription) return { ok: false, error: 'not-subscribed' };
  try {
    const res = await apiFetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (res?.ok) return { ok: true };
    const data = await res?.json().catch(() => null);
    return { ok: false, error: data?.error || 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * Opt this browser's push subscription in to lightning pushes for a station
 * location and radii (prefs), or out (null). The server stores the location
 * rounded to 0.01° with the subscription. Resolves { ok, reason? } — reason
 * 'not-subscribed' when this browser has no push subscription yet.
 *
 * @param {{ lat: number, lon: number, warnKm: number, alarmKm: number, imperial?: boolean } | null} prefs
 */
export async function setLightningPushPrefs(prefs) {
  const subscription = await getPushSubscription();
  if (!subscription) return { ok: prefs === null, reason: 'not-subscribed' };
  try {
    const res = await apiFetch('/api/push/lightning/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint, lightning: prefs }),
    });
    if (!res) return { ok: false, reason: 'backoff' };
    return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Lightning guard → server → the push subscribers it concerns. The server
 * computes, for every subscription that opted in (setLightningPushPrefs),
 * whether this strike falls inside ITS radius and pushes only to those;
 * all-clear and simulated strikes go back to this browser only.
 * Never throws; resolves { ok, error? }.
 *
 * @param {{ level: 'warn'|'alarm'|'clear', strike?: {lat:number, lon:number, timestamp:number}|null,
 *           simulated?: boolean, closer?: boolean, imperial?: boolean, relay?: boolean|null }} report
 */
export async function sendLightningPush(report) {
  const subscription = await getPushSubscription();
  if (!subscription) return { ok: false, error: 'not-subscribed' };
  try {
    const s = report?.strike;
    const res = await apiFetch('/api/push/lightning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        level: report?.level,
        strike:
          s && Number.isFinite(s.lat) && Number.isFinite(s.lon)
            ? { lat: Math.round(s.lat * 1000) / 1000, lon: Math.round(s.lon * 1000) / 1000, timestamp: s.timestamp }
            : null,
        simulated: report?.simulated === true,
        closer: report?.closer === true,
        imperial: report?.imperial === true,
        relay: typeof report?.relay === 'boolean' ? report.relay : null,
      }),
    });
    if (!res) return { ok: false, error: 'backoff' };
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, ...(data || {}) } : { ok: false, error: data?.error || `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
