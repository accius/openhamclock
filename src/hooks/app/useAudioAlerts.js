/**
 * useAudioAlerts Hook
 * Monitors data feed arrays for new items and plays audio tones, and
 * (when enabled per feed) fires a browser notification for the same event.
 * Settings are read from localStorage (ohc_audio_alerts).
 */
import { useEffect, useRef } from 'react';
import { getAlertSettings, playTone, ALERT_FEEDS } from '../../utils/audioAlerts';
import { formatAlertBody, showAlertNotification } from '../../utils/notifications';
import { speakAlert } from '../../utils/speechAlerts';

const COOLDOWN_MS = 10000; // Min 10s between tones per feed
const VISIBILITY_GRACE_MS = 5000; // Suppress alerts for 5s after tab becomes visible

// Generate a unique key for a data item based on feed type
function itemKey(feedId, item) {
  if (!item) return '';
  switch (feedId) {
    case 'pota':
    case 'sota':
    case 'wwff':
    case 'wwbota':
      return `${item.activator || item.callsign || item.call || ''}-${item.reference || item.ref || item.summitCode || ''}-${item.frequency || item.freq || ''}`;
    case 'dxcluster':
      return `${item.dx || item.call || ''}-${item.frequency || item.freq || ''}-${item.spotter || ''}`;
    case 'watchlist':
      // Keyed call+band (not freq): re-spots every minute don't spam, but a
      // watched call showing up on a new band re-alerts once per opening.
      return `${item.call || ''}-${item.band || ''}`;
    case 'dxpeditions':
      return `${item.callsign || item.call || ''}-${item.entity || item.dxcc || ''}`;
    case 'contests':
      return item.id || item.name || item.contestId || '';
    case 'contest-start':
      // One alert per contest occurrence (name+start identifies it).
      return `${item.name || ''}-${item.start || ''}`;
    case 'sat-pass':
      // One alert per pass (satellite + AOS time).
      return `${item.name || ''}-${item.aos || ''}`;
    case 'sat-alerts':
      // hams.at alert id (one alert per announced pass).
      return `${item.id || `${item.name || ''}-${item.aos || ''}`}`;
    case 'band-openings':
      // One alert per opening episode: band + path + hour it was first seen.
      return `${item.band || ''}-${item.from_continent || ''}-${item.to_zone != null ? `Z${item.to_zone}` : item.to_continent || ''}-${item.firstSeenHour ?? ''}`;
    case 'swpc':
      return `${item.productId || ''}-${item.serial || ''}`;
    case 'beacon-opening':
      // One alert per opening episode: beacon + band + when the contiguous
      // heard run began (a beacon re-measured every 15 min does not re-alert).
      return `${item.beacon || ''}-${item.band || ''}-${item.openedAt ?? ''}`;
    case 'grid-change':
      // One alert per grid entered (rover mode: GPS crossed a grid line).
      return `${item.grid || ''}-${item.at || ''}`;
    case 'opportunity':
      // One alert per station+band entering the top 5 (re-spots stay quiet).
      return `${item.call || ''}-${item.band || ''}`;
    case 'hamalert':
      // One alert per HamAlert line: call + frequency + minute.
      return `${item.call || ''}-${item.freqKhz || item.freq || ''}-${item.time || ''}`;
    default:
      return JSON.stringify(item).substring(0, 80);
  }
}

export default function useAudioAlerts(feeds) {
  const prevKeysRef = useRef({});
  const lastToneRef = useRef({});
  const isFirstLoadRef = useRef({});
  const tabVisibleAtRef = useRef(Date.now());

  // Track tab visibility to suppress alert floods on tab return
  useEffect(() => {
    const onVisChange = () => {
      if (!document.hidden) {
        tabVisibleAtRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  // Monitor each feed for new items
  useEffect(() => {
    const settings = getAlertSettings();
    const now = Date.now();

    // Suppress if tab just became visible (avoid flood from stale data refresh)
    if (now - tabVisibleAtRef.current < VISIBILITY_GRACE_MS) return;

    for (const [feedId, data] of Object.entries(feeds)) {
      // Event-shaped feeds (watchlist hits, contest starts, …) are usually
      // empty — their empty array still establishes the baseline, so the
      // first item that ever appears is treated as new and alerts.
      const eventful = !!ALERT_FEEDS[feedId]?.eventful;
      if (!data || !Array.isArray(data) || (data.length === 0 && !eventful)) continue;

      const feedSettings = settings[feedId];
      if (!feedSettings?.enabled) continue;

      // Build current key set and find new items in one pass
      const prevKeys = prevKeysRef.current[feedId] || new Set();
      const currentKeys = new Set();
      let firstNewItem = null;
      let newCount = 0;
      for (const item of data) {
        const key = itemKey(feedId, item);
        currentKeys.add(key);
        if (!prevKeys.has(key)) {
          newCount += 1;
          if (!firstNewItem) firstNewItem = item;
        }
      }

      // First load — set baseline, no alert
      if (!isFirstLoadRef.current[feedId]) {
        isFirstLoadRef.current[feedId] = true;
        prevKeysRef.current[feedId] = currentKeys;
        continue;
      }

      if (newCount > 0) {
        // Cooldown check — shared by tone and notification so they fire
        // (or stay quiet) together.
        const lastTone = lastToneRef.current[feedId] || 0;
        if (now - lastTone >= COOLDOWN_MS) {
          playTone(feedSettings.tone, settings.volume ?? 0.5);
          // Spoken alert (Web Speech API) — queued + de-duplicated inside
          // speakAlert; a no-op unless Settings → Alerts → Speak alerts is on
          // for this feed.
          speakAlert(feedId, firstNewItem, settings);
          if (settings.notifications && feedSettings.notify) {
            const body = formatAlertBody(feedId, firstNewItem);
            const suffix = newCount > 1 ? `+${newCount - 1} more` : '';
            showAlertNotification({
              feedId,
              title: ALERT_FEEDS[feedId]?.label || feedId,
              body: [body, suffix].filter(Boolean).join(' · '),
            });
          }
          lastToneRef.current[feedId] = now;
        }
      }

      prevKeysRef.current[feedId] = currentKeys;
    }
  }, [
    feeds.pota,
    feeds.sota,
    feeds.wwff,
    feeds.wwbota,
    feeds.dxcluster,
    feeds.watchlist,
    feeds.dxpeditions,
    feeds.contests,
    feeds['contest-start'],
    feeds['sat-pass'],
    feeds['sat-alerts'],
    feeds['band-openings'],
    feeds.swpc,
    feeds['beacon-opening'],
    feeds.opportunity,
    feeds.hamalert,
  ]);
}
