/**
 * Browser notifications for alert feeds.
 *
 * Fires OS-level notifications alongside the audio alert tones. Prefers the
 * PWA service worker registration (`registration.showNotification`) so
 * notifications keep working while the tab is backgrounded; falls back to a
 * plain `new Notification` where no worker is registered (Electron shell,
 * plain-http LAN, dev server). Everything no-ops silently when the
 * Notifications API is unsupported or permission was not granted.
 *
 * Future upgrade path: TRUE closed-browser notifications need Web Push
 * (VAPID keys on the server + push subscription storage + a `push` handler
 * in public/sw.js). Deliberately out of scope for now — this module only
 * covers open/backgrounded tabs.
 */

const ICON_URL = '/icon-192.png'; // shipped in public/ alongside icon-512.png

function notificationApi() {
  if (typeof window === 'undefined') return null;
  if (typeof window.Notification === 'undefined') return null;
  return window.Notification;
}

/** True when the Notifications API exists in this environment. */
export function isNotificationSupported() {
  return notificationApi() !== null;
}

/**
 * Current permission state: 'granted' | 'denied' | 'default' | 'unsupported'.
 */
export function getNotificationPermission() {
  const api = notificationApi();
  if (!api) return 'unsupported';
  return api.permission;
}

/**
 * Ask the browser for notification permission. MUST be called from a user
 * gesture (click handler) — browsers ignore or auto-deny unsolicited
 * requests. Resolves to the resulting permission string.
 */
export async function requestNotificationPermission() {
  const api = notificationApi();
  if (!api) return 'unsupported';
  if (api.permission !== 'default') return api.permission;
  try {
    return await api.requestPermission();
  } catch {
    // Legacy callback-style API or user dismissal — report current state.
    return api.permission;
  }
}

/**
 * Build the short human-readable notification body for a feed item.
 * Pure and defensive: every field is optional, unknown shapes degrade to ''.
 */
export function formatAlertBody(feedId, item) {
  if (!item || typeof item !== 'object') return '';
  const parts = [];
  switch (feedId) {
    case 'pota':
    case 'sota':
    case 'wwff':
    case 'wwbota': {
      // Hook-normalized spots: { call, ref, freq (MHz string), mode }
      const freq = item.freq || item.frequency || '';
      const call = item.call || item.activator || item.callsign || '';
      const mode = item.mode || '';
      const ref = item.ref || item.reference || '';
      const main = [freq, call, mode].filter(Boolean).join(' ');
      if (main) parts.push(main);
      if (ref) parts.push(ref);
      break;
    }
    case 'dxcluster': {
      // spotList items: { call, freq, comment, spotter }
      const freq = item.freq || item.frequency || '';
      const call = item.call || item.dx || item.dxCall || '';
      const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
      const main = [freq, call].filter(Boolean).join(' ');
      if (main) parts.push(main);
      if (comment) parts.push(comment);
      break;
    }
    case 'watchlist': {
      // Watchlist hits: { call, freq (MHz string), mode, band }
      const call = item.call || '';
      if (call) {
        const detail = [item.freq, item.mode].filter(Boolean).join(' ');
        parts.push(detail ? `${call} spotted: ${detail}` : `${call} spotted`);
      }
      break;
    }
    case 'hamalert': {
      // HamAlert alert: { call, freq (MHz string), mode, source, comment }
      const call = item.call || '';
      const detail = [item.freq, item.mode, item.source ? `(${item.source})` : ''].filter(Boolean).join(' ');
      if (call) parts.push(detail ? `${call} ${detail}` : call);
      if (typeof item.comment === 'string' && item.comment.trim()) parts.push(item.comment.trim());
      break;
    }
    case 'contest-start': {
      // Contest reminder: { name, start (ISO) } — minutes computed at display time
      const name = item.name || '';
      if (name) {
        const startMs = Date.parse(item.start || '');
        if (Number.isFinite(startMs)) {
          const mins = Math.max(0, Math.round((startMs - Date.now()) / 60000));
          parts.push(mins > 0 ? `${name} starts in ${mins} min` : `${name} starting now`);
        } else {
          parts.push(name);
        }
      }
      break;
    }
    case 'sat-pass': {
      // Upcoming pass: { name, aos (ms), maxElevation (deg) }
      const name = item.name || '';
      if (name) {
        const aosMs = typeof item.aos === 'number' ? item.aos : Date.parse(item.aos || '');
        if (Number.isFinite(aosMs)) {
          const mins = Math.max(0, Math.round((aosMs - Date.now()) / 60000));
          parts.push(mins > 0 ? `${name} pass in ${mins} min` : `${name} pass starting`);
        } else {
          parts.push(`${name} pass`);
        }
        if (item.maxElevation != null && Number.isFinite(Number(item.maxElevation))) {
          parts.push(`max el ${Math.round(item.maxElevation)}°`);
        }
      }
      break;
    }
    case 'sat-alerts': {
      // hams.at alerted pass: { name, callsign, aos (ms), grids[], maxElevation }
      const name = item.name || '';
      const who = item.callsign || '';
      if (name || who) {
        const aosMs = typeof item.aos === 'number' ? item.aos : Date.parse(item.aos || '');
        const head = [who, name ? `on ${name}` : ''].filter(Boolean).join(' ');
        if (Number.isFinite(aosMs)) {
          const mins = Math.max(0, Math.round((aosMs - Date.now()) / 60000));
          parts.push(mins > 0 ? `${head} in ${mins} min` : `${head} now`);
        } else {
          parts.push(head);
        }
        if (Array.isArray(item.grids) && item.grids.length) parts.push(item.grids.join(' '));
      }
      break;
    }
    case 'grid-change': {
      // Rover: { grid, from }
      if (item.grid) parts.push(item.from ? `Entered ${item.grid} (from ${item.from})` : `Entered ${item.grid}`);
      break;
    }
    case 'band-openings': {
      // Opening entry: { band, from_continent, to_continent | to_zone, shortCount, factor }
      const band = item.band || '';
      const to = item.to_zone != null ? `zone ${item.to_zone}` : item.to_continent || '';
      const path = item.from_continent && to ? `${item.from_continent}→${to}` : '';
      if (band || path) {
        const main = [band, 'opening', path].filter(Boolean).join(' ');
        const stats = [];
        if (item.shortCount != null) stats.push(`${item.shortCount} spots`);
        if (item.factor != null) stats.push(`${item.factor}x baseline`);
        parts.push(stats.length ? `${main} (${stats.join(', ')})` : main);
      }
      break;
    }
    case 'beacon-opening': {
      // Measured beacon opening: { beacon, band, snrDb }
      const beacon = item.beacon || '';
      if (beacon) {
        const snr = Number.isFinite(item.snrDb) ? `${item.snrDb >= 0 ? '+' : ''}${Math.round(item.snrDb)} dB` : '';
        parts.push([item.band, beacon, 'heard', snr].filter(Boolean).join(' '));
      }
      break;
    }
    case 'dxpeditions': {
      const call = item.callsign || item.call || '';
      const entity = item.entity || item.dxcc || '';
      if (call) parts.push(call);
      if (entity) parts.push(entity);
      break;
    }
    case 'contests': {
      const name = item.name || item.id || '';
      if (name) parts.push(name);
      break;
    }
    case 'swpc': {
      // { title, productId, scale: { band, level }, message }
      const scale = item.scale && item.scale.band != null ? `${item.scale.band}${item.scale.level ?? ''}` : '';
      const title = item.title || item.productId || '';
      const main = [scale, title].filter(Boolean).join(' ');
      if (main) parts.push(main);
      break;
    }
    case 'lightning-guard': {
      // Lightning guard: { level, distance ("12 km NE"), rate (strikes/10 min), relay }
      if (item.level === 'clear') parts.push('All clear');
      else if (item.distance) parts.push(`Nearest strike ${item.distance}`);
      if (item.level !== 'clear' && Number.isFinite(item.count) && item.count > 0) {
        const win = Number.isFinite(item.windowMin) ? item.windowMin : 10;
        parts.push(`${item.count} strike${item.count === 1 ? '' : 's'} in ${win} min`);
      }
      if (item.relay === true) parts.push('antenna relay engaged');
      else if (item.relay === false) parts.push('antenna relay released');
      break;
    }
    case 'opportunity': {
      // Opportunity row: { call, freq (MHz), band, mode, needs: ['dxcc', ...], reliability }
      const call = item.call || '';
      if (call) {
        const detail = [item.freq, item.mode].filter(Boolean).join(' ');
        parts.push(detail ? `${call} ${detail}` : call);
        const needs = (item.needs || []).map((n) => `new ${n === 'dxcc' ? 'DXCC' : n}`).join(', ');
        if (needs) parts.push(needs);
        if (item.reliability != null) parts.push(`${Math.round(item.reliability)}% predicted`);
      }
      break;
    }
    default:
      break;
  }
  const body = parts.filter(Boolean).join(' · ');
  return body.length > 120 ? `${body.slice(0, 117)}…` : body;
}

/**
 * Show an OS notification for an alert feed. Silent no-op when unsupported
 * or permission is not granted. Prefers the service worker registration so
 * the notification survives tab backgrounding; falls back to a page-owned
 * `new Notification` (the path Electron's Chromium uses).
 *
 * `tag` defaults to one per feed so repeated alerts replace the previous
 * notification instead of stacking up.
 */
export async function showAlertNotification({ feedId, title, body = '', tag } = {}) {
  const api = notificationApi();
  if (!api || api.permission !== 'granted') return;
  if (!title) return;

  const options = {
    body,
    tag: tag || `ohc-alert-${feedId || 'generic'}`,
    icon: ICON_URL,
    badge: ICON_URL,
    silent: true, // the audio-alert tone is the sound; avoid double audio
  };

  // Preferred: service worker registration (works while backgrounded).
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {
    // Fall through to the plain Notification path.
  }

  // Fallback: page-owned notification.
  try {
    new api(title, options);
  } catch {
    // Some platforms throw for page-owned notifications — stay silent.
  }
}
