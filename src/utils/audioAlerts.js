/**
 * Audio Alerts — Web Audio API tone generation and settings persistence.
 * Generates distinct tones for different feed types. No sound files needed.
 */

let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Tone presets — each has a unique sound character
export const TONE_PRESETS = {
  ping: { label: 'Ping', freq: 880, type: 'sine', duration: 0.15 },
  'high-ping': { label: 'High Ping', freq: 1047, type: 'triangle', duration: 0.15 },
  'low-tone': { label: 'Low Tone', freq: 660, type: 'sine', duration: 0.2 },
  sharp: { label: 'Sharp', freq: 784, type: 'sawtooth', duration: 0.12 },
  beep: { label: 'Beep', freq: 523, type: 'square', duration: 0.1 },
  'two-tone': { label: 'Two-Tone', freq: [880, 1047], type: 'sine', duration: 0.1 },
  simple: { label: 'Simple', freq: 440, type: 'sine', duration: 0.2 },
  chime: { label: 'Chime', freq: 1175, type: 'sine', duration: 0.25 },
  chirp: { label: 'Chirp', freq: [600, 900], type: 'sine', duration: 0.08 },
};

// Feed definitions with default tone assignments.
// `eventful: true` marks sparse, event-shaped feeds (usually empty; items ARE
// the event) — useAudioAlerts establishes their new-item baseline even when
// the array is empty, so the first item to ever appear still alerts.
export const ALERT_FEEDS = {
  pota: { label: 'POTA Spots', defaultTone: 'ping' },
  sota: { label: 'SOTA Spots', defaultTone: 'high-ping' },
  wwff: { label: 'WWFF Spots', defaultTone: 'low-tone' },
  wwbota: { label: 'WWBOTA Spots', defaultTone: 'sharp' },
  dxcluster: { label: 'DX Cluster', defaultTone: 'beep' },
  watchlist: { label: 'Watchlist Hits', defaultTone: 'two-tone', eventful: true },
  dxpeditions: { label: 'DXpeditions', defaultTone: 'two-tone' },
  contests: { label: 'Contests', defaultTone: 'simple' },
  'contest-start': { label: 'Contest Starts', defaultTone: 'chime', eventful: true },
  'sat-pass': { label: 'Satellite Passes', defaultTone: 'ping', eventful: true },
  'sat-alerts': { label: 'Satellite Alerts (hams.at)', defaultTone: 'two-tone', eventful: true },
  'band-openings': { label: 'Band Openings', defaultTone: 'low-tone', eventful: true },
  swpc: { label: 'Space Weather', defaultTone: 'chime' },
  // Alarm clock (utils/alarmClock.js): armed alarms always ring; this entry
  // picks the tone and whether a browser notification accompanies it.
  alarm: { label: 'Alarm Clock', defaultTone: 'chime', eventful: true },
  'beacon-opening': { label: 'Beacon Openings (KiwiSDR monitor)', defaultTone: 'chirp', eventful: true },
  'grid-change': { label: 'Grid Change (Rover)', defaultTone: 'two-tone', eventful: true },
  // Opportunity feed (#P8): a new top-5 entry that is at least a new DXCC.
  opportunity: { label: 'Opportunities (new DXCC)', defaultTone: 'two-tone', eventful: true },
  hamalert: { label: 'HamAlert', defaultTone: 'two-tone', eventful: true },
};

const LS_KEY = 'ohc_audio_alerts';

/**
 * The old "Lightning Proximity" tone feed (`settings.lightning`: a fixed 30 km
 * alert while the map layer was shown) is now part of the lightning guard.
 * An enabled old feed turns the guard on with the same tone, notification
 * and speech choices; the old key is dropped either way. Pure.
 * @returns {{ settings: object, migrated: boolean }}
 */
export function migrateLegacyLightning(settings) {
  if (!settings || typeof settings !== 'object' || !('lightning' in settings)) return { settings, migrated: false };
  const { lightning: old, ...rest } = settings;
  if (old && old.enabled && !rest.lightningGuard) {
    rest.lightningGuard = {
      enabled: true,
      tone: typeof old.tone === 'string' && old.tone ? old.tone : 'chirp',
      channels: { tone: true, speech: !!old.speak, notify: !!old.notify, push: false },
    };
  }
  return { settings: rest, migrated: true };
}

export function getAlertSettings() {
  const defaults = {};
  for (const [id, feed] of Object.entries(ALERT_FEEDS)) {
    defaults[id] = { enabled: false, tone: feed.defaultTone, notify: false };
  }
  defaults.volume = 0.5;
  defaults.notifications = false; // master switch for browser notifications
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const { settings: parsed, migrated } = migrateLegacyLightning(JSON.parse(stored));
      if (migrated) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(parsed));
        } catch {}
      }
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

/** Fired on window whenever alert settings are saved, so live consumers can re-read them. */
export const ALERT_SETTINGS_EVENT = 'ohc-alert-settings';

/** Band Openings alert scope (#1191) — which openings this station is told about. */
export const BAND_OPENING_SCOPES = {
  'my-zone': 'My CQ zone',
  'my-continent': 'My continent',
  worldwide: 'Worldwide',
};
export const DEFAULT_BAND_OPENING_SCOPE = 'my-zone';

export function saveAlertSettings(settings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {}
  try {
    window.dispatchEvent(new Event(ALERT_SETTINGS_EVENT));
  } catch {}
}

export function playTone(toneName, volume = 0.5) {
  const preset = TONE_PRESETS[toneName];
  if (!preset) return;

  try {
    const ctx = getContext();
    const vol = Math.max(0, Math.min(1, volume));
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);

    const freqs = Array.isArray(preset.freq) ? preset.freq : [preset.freq];
    let offset = 0;

    freqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = preset.type;
      osc.frequency.value = freq;
      osc.connect(gainNode);

      const start = ctx.currentTime + offset;
      const end = start + preset.duration;

      gainNode.gain.setValueAtTime(vol * 0.3, start);
      gainNode.gain.exponentialRampToValueAtTime(0.001, end);

      osc.start(start);
      osc.stop(end + 0.05);
      offset += preset.duration;
    });
  } catch {
    // AudioContext not available
  }
}
