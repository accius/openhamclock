/**
 * useAudioAlerts Hook
 * Monitors data feed arrays for new items and plays audio tones.
 * Settings are read from localStorage (ohc_audio_alerts).
 */
import { useEffect, useRef } from 'react';
import { getAlertSettings, playTone } from '../../utils/audioAlerts';

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
      return `${item.activator || item.callsign || item.call || ''}-${item.reference || item.summitCode || ''}-${item.frequency || item.freq || ''}`;
    case 'dxcluster':
      return `${item.dx || item.call || ''}-${item.frequency || item.freq || ''}-${item.spotter || ''}`;
    case 'dxpeditions':
      return `${item.callsign || item.call || ''}-${item.entity || item.dxcc || ''}`;
    case 'contests':
      return item.id || item.name || item.contestId || '';
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
      if (!data || !Array.isArray(data) || data.length === 0) continue;

      const feedSettings = settings[feedId];
      if (!feedSettings?.enabled) continue;

      // Build current key set
      const currentKeys = new Set(data.map((item) => itemKey(feedId, item)));

      // First load — set baseline, no alert
      if (!isFirstLoadRef.current[feedId]) {
        isFirstLoadRef.current[feedId] = true;
        prevKeysRef.current[feedId] = currentKeys;
        continue;
      }

      const prevKeys = prevKeysRef.current[feedId] || new Set();

      // Check for any new keys
      let hasNew = false;
      for (const key of currentKeys) {
        if (!prevKeys.has(key)) {
          hasNew = true;
          break;
        }
      }

      if (hasNew) {
        // Cooldown check
        const lastTone = lastToneRef.current[feedId] || 0;
        if (now - lastTone >= COOLDOWN_MS) {
          playTone(feedSettings.tone, settings.volume ?? 0.5);
          lastToneRef.current[feedId] = now;
        }
      }

      prevKeysRef.current[feedId] = currentKeys;
    }
  }, [feeds.pota, feeds.sota, feeds.wwff, feeds.wwbota, feeds.dxcluster, feeds.dxpeditions, feeds.contests]);
}
