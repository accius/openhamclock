/**
 * Spoken alerts — Web Speech API text-to-speech for the alert feeds.
 *
 * Pure parts (tested): the per-feed sentence builder (formatSpeechText) and
 * the SpeechQueue that spaces utterances out (max one per MIN_GAP_MS) and
 * drops repeats seen within DEDUPE_MS, so a burst of new spots does not
 * stack a minute of chatter.
 *
 * Settings live inside the audio-alert settings blob (ohc_audio_alerts):
 *   settings.speech = { enabled, voice, rate, phonetic }
 *   settings[feedId].speak = true|false      (per-feed opt-in)
 */
import { speakableCallsign } from './phonetics.js';

export const SPEECH_DEFAULTS = { enabled: false, voice: '', rate: 1, phonetic: true };
export const MIN_GAP_MS = 4000;
export const DEDUPE_MS = 60 * 1000;
const MAX_QUEUE = 6;

export function getSpeechSettings(alertSettings) {
  return { ...SPEECH_DEFAULTS, ...(alertSettings?.speech || {}) };
}

export function isSpeechSupported() {
  return (
    typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** Available voices (may be empty until the browser fires voiceschanged). */
export function listVoices() {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

/** '20m' → '20 metres', '70cm' → '70 centimetres', '2m' → '2 metres'. */
export function bandToSpeech(band) {
  if (!band) return '';
  const m = String(band)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(cm|m)$/);
  if (!m) return String(band);
  return `${m[1]} ${m[2] === 'cm' ? 'centimetres' : 'metres'}`;
}

/** Frequency (MHz, kHz or Hz) → "14.074 megahertz". */
export function freqToSpeech(freq) {
  const v = parseFloat(freq);
  if (!Number.isFinite(v) || v <= 0) return '';
  const mhz = v > 1e6 ? v / 1e6 : v > 1000 ? v / 1000 : v;
  return `${mhz.toFixed(3)} megahertz`;
}

const minutesUntil = (when) => {
  const ms = typeof when === 'number' ? when : Date.parse(when || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms - Date.now()) / 60000));
};

const needWords = {
  dxcc: 'new DXCC',
  band: 'new band',
  zone: 'new zone',
  grid: 'new grid',
  state: 'new state',
};

/**
 * Build the sentence spoken for an alert item. Returns '' when there is
 * nothing meaningful to say (callers then stay silent).
 */
export function formatSpeechText(feedId, item, { phonetic = true } = {}) {
  if (!item || typeof item !== 'object') return '';
  const call = (c) => speakableCallsign(c, { phonetic });
  const where = (it) => {
    const band = bandToSpeech(it.band);
    if (band) return `on ${band}`;
    const f = freqToSpeech(it.freq ?? it.frequency);
    return f ? `on ${f}` : '';
  };
  switch (feedId) {
    case 'watchlist': {
      if (!item.call) return '';
      return ['Watchlist:', call(item.call), where(item), item.mode || ''].filter(Boolean).join(' ');
    }
    case 'dxcluster': {
      const c = item.call || item.dx || item.dxCall;
      if (!c) return '';
      return ['DX spot:', call(c), where(item)].filter(Boolean).join(' ');
    }
    case 'pota':
    case 'sota':
    case 'wwff':
    case 'wwbota': {
      const c = item.call || item.activator || item.callsign;
      if (!c) return '';
      const label = feedId.toUpperCase();
      const ref = item.ref || item.reference || '';
      return [`${label}:`, call(c), where(item), item.mode || '', ref ? `at ${ref}` : ''].filter(Boolean).join(' ');
    }
    case 'dxpeditions': {
      const c = item.callsign || item.call;
      if (!c) return '';
      return ['DXpedition:', call(c), item.entity || item.dxcc || ''].filter(Boolean).join(' ');
    }
    case 'contests':
      return item.name ? `Contest: ${item.name}` : '';
    case 'contest-start': {
      if (!item.name) return '';
      const mins = minutesUntil(item.start);
      return mins == null
        ? item.name
        : mins > 0
          ? `${item.name} starts in ${mins} minutes`
          : `${item.name} is starting now`;
    }
    case 'sat-pass': {
      if (!item.name) return '';
      const mins = minutesUntil(item.aos);
      const el = item.maxElevation != null ? `, maximum elevation ${Math.round(item.maxElevation)} degrees` : '';
      return mins == null || mins === 0
        ? `${item.name} pass starting${el}`
        : `${item.name} pass in ${mins} minutes${el}`;
    }
    case 'band-openings': {
      const band = bandToSpeech(item.band);
      if (!band) return '';
      const to = item.to_zone != null ? `zone ${item.to_zone}` : item.to_continent || '';
      const path = item.from_continent && to ? ` from ${item.from_continent} to ${to}` : '';
      return `${band} opening${path}`;
    }
    case 'swpc': {
      const scale = item.scale && item.scale.band != null ? `${item.scale.band} ${item.scale.level ?? ''}`.trim() : '';
      const title = item.title || item.productId || '';
      if (!scale && !title) return '';
      return ['Space weather:', scale, title].filter(Boolean).join(' ');
    }
    case 'lightning-guard': {
      // Lightning guard transition: { level, downgraded, distanceKm, bearing (words), imperial, relay }
      const relayWords =
        item.relay === true ? ' Antenna relay engaged.' : item.relay === false ? ' Antenna relay released.' : '';
      if (item.level === 'clear') return `Lightning all clear.${relayWords}`;
      if (item.level !== 'warn' && item.level !== 'alarm') return '';
      if (item.downgraded) return `Lightning alarm ended. Warning continues.${relayWords}`;
      const head = item.closer
        ? 'Lightning closer.'
        : item.level === 'alarm'
          ? 'Lightning alarm.'
          : 'Lightning warning.';
      if (!Number.isFinite(item.distanceKm)) return `${head}${relayWords}`;
      const dist = item.imperial ? item.distanceKm * 0.621371 : item.distanceKm;
      const unit = item.imperial ? 'miles' : 'kilometres';
      const where = item.bearing ? ` ${item.bearing}` : '';
      return `${head} Strike ${Math.max(1, Math.round(dist))} ${unit}${where}.${relayWords}`;
    }
    case 'opportunity': {
      if (!item.call) return '';
      const needs = (item.needs || []).map((n) => needWords[n]).filter(Boolean);
      return [
        'Opportunity:',
        call(item.call),
        where(item),
        item.mode || '',
        needs.length ? `, ${needs.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s,/g, ',');
    }
    default:
      return '';
  }
}

/**
 * Rate-limited, de-duplicating utterance queue.
 *
 * @param {object} opts
 * @param {(text:string)=>void} opts.speak   actually voice the text
 * @param {()=>number} [opts.now]            clock (tests)
 * @param {number} [opts.minGapMs]           min spacing between utterances
 * @param {number} [opts.dedupeMs]           identical text within this window is dropped
 * @param {number} [opts.maxQueue]           pending cap — oldest dropped first
 */
export class SpeechQueue {
  constructor({ speak, now = () => Date.now(), minGapMs = MIN_GAP_MS, dedupeMs = DEDUPE_MS, maxQueue = MAX_QUEUE }) {
    this.speak = speak;
    this.now = now;
    this.minGapMs = minGapMs;
    this.dedupeMs = dedupeMs;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.recent = new Map(); // text → spoken/enqueued at
    this.lastSpokenAt = -Infinity;
    this.timer = null;
  }

  /** @returns {boolean} true when accepted (not a duplicate) */
  enqueue(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    const now = this.now();
    for (const [k, at] of this.recent) if (now - at > this.dedupeMs) this.recent.delete(k);
    if (this.recent.has(t)) return false;
    this.recent.set(t, now);
    this.queue.push(t);
    while (this.queue.length > this.maxQueue) this.queue.shift();
    this._schedule();
    return true;
  }

  clear() {
    this.queue = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _schedule() {
    if (this.timer || this.queue.length === 0) return;
    const wait = Math.max(0, this.lastSpokenAt + this.minGapMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.queue.shift();
      if (next != null) {
        this.lastSpokenAt = this.now();
        try {
          this.speak(next);
        } catch {}
      }
      this._schedule();
    }, wait);
  }
}

// ── Browser singleton ──────────────────────────────────────────────────────

let currentSettings = { ...SPEECH_DEFAULTS };

function voiceByName(name) {
  if (!name) return null;
  return listVoices().find((v) => v.name === name || v.voiceURI === name) || null;
}

function browserSpeak(text) {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  const u = new window.SpeechSynthesisUtterance(text);
  const voice = voiceByName(currentSettings.voice);
  if (voice) {
    u.voice = voice;
    if (voice.lang) u.lang = voice.lang;
  }
  u.rate = Math.min(2, Math.max(0.5, Number(currentSettings.rate) || 1));
  try {
    synth.speak(u);
  } catch {}
}

let singleton = null;
function queue() {
  if (!singleton) singleton = new SpeechQueue({ speak: browserSpeak });
  return singleton;
}

/**
 * Speak an alert for a feed item, honouring the master + per-feed toggles.
 * Safe to call anywhere — silent when unsupported or disabled.
 */
export function speakAlert(feedId, item, alertSettings) {
  const speech = getSpeechSettings(alertSettings);
  if (!speech.enabled || !alertSettings?.[feedId]?.speak) return false;
  if (!isSpeechSupported()) return false;
  currentSettings = speech;
  const text = formatSpeechText(feedId, item, { phonetic: speech.phonetic });
  if (!text) return false;
  return queue().enqueue(text);
}

/**
 * Speak a sentence through the shared queue with the configured voice and
 * rate, regardless of the master/per-feed toggles. For safety alerts that
 * carry their own on/off switch (the lightning guard).
 */
export function speakText(text, alertSettings) {
  if (!isSpeechSupported()) return false;
  currentSettings = getSpeechSettings(alertSettings);
  return queue().enqueue(text);
}

/** Speak a sample sentence immediately (Settings "Test" button). */
export function speakSample(alertSettings) {
  if (!isSpeechSupported()) return;
  currentSettings = getSpeechSettings(alertSettings);
  try {
    window.speechSynthesis.cancel();
  } catch {}
  browserSpeak(
    formatSpeechText('watchlist', { call: 'VK9MA', band: '20m', mode: 'CW' }, { phonetic: currentSettings.phonetic }),
  );
}

export default {
  SPEECH_DEFAULTS,
  getSpeechSettings,
  isSpeechSupported,
  listVoices,
  bandToSpeech,
  freqToSpeech,
  formatSpeechText,
  SpeechQueue,
  speakAlert,
  speakText,
  speakSample,
};
