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

// Feed definitions with default tone assignments
export const ALERT_FEEDS = {
  pota: { label: 'POTA Spots', defaultTone: 'ping' },
  sota: { label: 'SOTA Spots', defaultTone: 'high-ping' },
  wwff: { label: 'WWFF Spots', defaultTone: 'low-tone' },
  wwbota: { label: 'WWBOTA Spots', defaultTone: 'sharp' },
  dxcluster: { label: 'DX Cluster', defaultTone: 'beep' },
  dxpeditions: { label: 'DXpeditions', defaultTone: 'two-tone' },
  contests: { label: 'Contests', defaultTone: 'simple' },
};

const LS_KEY = 'ohc_audio_alerts';

export function getAlertSettings() {
  const defaults = {};
  for (const [id, feed] of Object.entries(ALERT_FEEDS)) {
    defaults[id] = { enabled: false, tone: feed.defaultTone };
  }
  defaults.volume = 0.5;
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

export function saveAlertSettings(settings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
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
