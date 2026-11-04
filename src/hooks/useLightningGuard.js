/**
 * useLightningGuard — lightning antenna protection.
 *
 *  • useLightningGuard({ location, allUnits, layout }): mount ONCE (App.jsx).
 *    While Settings → Alerts → Lightning guard is on it subscribes to the
 *    shared Blitzortung feed (utils/lightningFeed.js — runs even when the
 *    Lightning map layer is off), measures every strike from DE, runs the
 *    warn → alarm → all-clear state machine (utils/lightningGuard.js) and on
 *    each transition fires the chosen alert channels: tone, spoken alert,
 *    browser notification, Web Push (opt-in servers), plus an EmComm event
 *    log entry when the EmComm layout is active; during an alarm it alerts
 *    again when lightning comes markedly closer (repeatCloser). Returns
 *    { level, relay, allClearMin, override } — what useHardwareIndicators
 *    posts to the Rig Bridge (lightningRelay, lightningAllClearMin,
 *    lightningOverride) for the GPIO lightningOut line.
 *  • useLightningGuardStatus(): any component (header indicator, banner,
 *    settings) subscribes to the live status.
 *
 * Test without a storm: Settings → Alerts → Lightning guard → "Simulate
 * strike", or
 *   window.dispatchEvent(new CustomEvent('ohc:inject-lightning',
 *     { detail: { distanceKm: 10, bearingDeg: 45 } }))
 * (or detail { lat, lon }). Simulated strikes go through the same feed, so
 * the map layer shows them too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import i18next from 'i18next';
import { subscribeStrikes, injectStrike } from '../utils/lightningFeed.js';
import {
  cardinal,
  describeStrike,
  destinationPoint,
  GuardRunner,
  nextOverride,
  normalizeGuardSettings,
  OVERRIDES,
  relayDemand,
} from '../utils/lightningGuard.js';
import { ALERT_SETTINGS_EVENT, getAlertSettings, playTone } from '../utils/audioAlerts.js';
import { formatAlertBody, getNotificationPermission, showAlertNotification } from '../utils/notifications.js';
import { formatSpeechText, getSpeechSettings, speakText } from '../utils/speechAlerts.js';
import { sendLightningPush, setLightningPushPrefs } from '../utils/push.js';
import { recordEvent } from '../utils/emcommEventLog.js';

export const INJECT_LIGHTNING_EVENT = 'ohc:inject-lightning';
const OVERRIDE_KEY = 'ohc_lightning_override';
const RELAY_CLAIM_KEY = 'ohc_lightning_relay_claimed';
const TICK_MS = 15000; // re-evaluate for the all-clear timer
const ALARM_BEEPS = 3;
const BEEP_GAP_MS = 450;

// ── Settings (inside the shared alert-settings blob) ───────────────────────
// (Saved by the Settings → Alerts card through AudioAlertsTab's blob writer.)
export function readGuardSettings() {
  return normalizeGuardSettings(getAlertSettings().lightningGuard);
}

// ── Store ──────────────────────────────────────────────────────────────────
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

export function getRelayOverride() {
  const v = lsGet(OVERRIDE_KEY);
  return OVERRIDES.includes(v) ? v : 'auto';
}

const OFF_STATUS = {
  enabled: false,
  level: 'off',
  windowMin: 10,
  since: null,
  nearest: null,
  last: null,
  warnCount: 0,
  alarmCount: 0,
  warnRate: 0,
  alarmRate: 0,
  clearAt: null,
  relay: null,
  relayReport: null,
  override: 'auto',
  imperial: false,
  settings: normalizeGuardSettings(null),
};

let status = { ...OFF_STATUS, override: getRelayOverride() };
const listeners = new Set();
let engineReevaluate = null;

function publish(next) {
  status = next;
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

export function getLightningGuardStatus() {
  return status;
}

export function subscribeLightningGuard(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Live guard status for components. */
export function useLightningGuardStatus() {
  return useSyncExternalStore(subscribeLightningGuard, getLightningGuardStatus, getLightningGuardStatus);
}

/** Manual relay override: 'auto' | 'on' (force protect) | 'off' (hold connected). */
export function setRelayOverride(value) {
  const v = OVERRIDES.includes(value) ? value : 'auto';
  lsSet(OVERRIDE_KEY, v === 'auto' ? null : v);
  if (engineReevaluate) engineReevaluate();
  else publish({ ...status, override: v });
}

/**
 * The bridge only hears `lightningRelay` from browsers that drive the relay,
 * so other displays can't release it. When this browser stops driving it
 * (relay switched off in Settings) it reports `false` once more, until the
 * bridge acknowledged it — useHardwareIndicators calls this after each POST.
 */
function relayReportFor(demand) {
  if (demand !== null) {
    if (lsGet(RELAY_CLAIM_KEY) !== '1') lsSet(RELAY_CLAIM_KEY, '1');
    return demand;
  }
  return lsGet(RELAY_CLAIM_KEY) === '1' ? false : null;
}

export function acknowledgeRelayReport(value) {
  if (value === false && status.relay === null && lsGet(RELAY_CLAIM_KEY) === '1') {
    lsSet(RELAY_CLAIM_KEY, null);
    publish({ ...status, relayReport: null });
  }
}

/** Fire a synthetic strike `distanceKm` from DE along `bearingDeg`. */
export function simulateStrike(distanceKm = 10, bearingDeg = 45) {
  window.dispatchEvent(new CustomEvent(INJECT_LIGHTNING_EVENT, { detail: { distanceKm, bearingDeg } }));
}

// ── Alerts ─────────────────────────────────────────────────────────────────
// Notification titles follow the UI language; spoken text and the EmComm log
// stay English like every other spoken alert and log entry.
// The app initialises the shared i18next instance (src/lang/i18n.js); before
// that (or in tests) the English default is used.
const translate = (key, opts) => (i18next.isInitialized ? i18next.t(key, opts) : opts.defaultValue);
const NOTIFY_TITLES = {
  warn: (t) => t('lightningGuard.notify.warn', { defaultValue: 'Lightning warning' }),
  alarm: (t) => t('lightningGuard.notify.alarm', { defaultValue: 'Lightning ALARM' }),
  clear: (t) => t('lightningGuard.notify.clear', { defaultValue: 'Lightning all clear' }),
  closer: (t) => t('lightningGuard.notify.closer', { defaultValue: 'Lightning closer' }),
  downgraded: (t) =>
    t('lightningGuard.notify.downgraded', { defaultValue: 'Lightning alarm ended — warning continues' }),
};
const notifyTitle = (key) => NOTIFY_TITLES[key](translate);
const LOG_TITLES = {
  warn: 'Lightning warning',
  alarm: 'Lightning ALARM',
  clear: 'Lightning all clear',
  closer: 'Lightning closer',
  downgraded: 'Lightning alarm ended — warning continues',
};

/**
 * Fire the chosen channels for a transition or a "closer" re-alert.
 * kind: 'escalate' | 'deescalate' | 'closer'
 */
function fireAlerts({ kind, st, settings, demand, prevDemand, imperial, layout }) {
  // Mention the relay when it is engaged, or when this transition released it
  const relay = demand === true ? true : demand === false && prevDemand === true ? false : null;
  const downgraded = kind === 'deescalate' && st.level === 'warn';
  const closer = kind === 'closer';
  const key = closer ? 'closer' : downgraded ? 'downgraded' : st.level;
  const strike = st.nearest;
  const alertSettings = getAlertSettings();
  const ch = settings.channels;

  if (ch.tone) {
    const volume = alertSettings.volume ?? 0.5;
    if (st.level === 'alarm') {
      for (let i = 0; i < ALARM_BEEPS; i++) setTimeout(() => playTone(settings.tone, volume), i * BEEP_GAP_MS);
    } else if (st.level === 'warn' && !downgraded) {
      playTone(settings.tone, volume);
    } else if (st.level === 'clear') {
      playTone('chime', volume);
    }
  }

  if (ch.speech) {
    const text = formatSpeechText(
      'lightning-guard',
      {
        level: st.level,
        downgraded,
        closer,
        distanceKm: strike?.distanceKm,
        bearing: strike ? cardinal(strike.bearingDeg, { words: true }) : '',
        imperial,
        relay: closer ? null : relay,
      },
      { phonetic: getSpeechSettings(alertSettings).phonetic },
    );
    if (text) speakText(text, alertSettings);
  }

  const distance = describeStrike(strike, imperial);
  if (ch.notify && getNotificationPermission() === 'granted') {
    showAlertNotification({
      feedId: 'lightning-guard',
      title: notifyTitle(key),
      body: formatAlertBody('lightning-guard', {
        level: st.level,
        distance,
        count: st.warnCount,
        windowMin: st.windowMin,
        relay: closer ? null : relay,
      }),
      tag: 'ohc-lightning-guard',
    });
  }

  if (ch.push && !downgraded) {
    sendLightningPush({
      level: st.level,
      strike: strike && st.level !== 'clear' ? { lat: strike.lat, lon: strike.lon, timestamp: strike.timestamp } : null,
      simulated: !!strike?.simulated,
      closer,
      imperial,
      relay: closer ? null : relay,
    });
  }

  // Screen readers (aria-live announcer in App, useLightningAnnouncements)
  if (strike && st.level !== 'clear' && !downgraded && typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent('lightning:proximity', {
        detail: {
          distanceKm: Math.round(strike.distanceKm),
          distanceMiles: Math.round(strike.distanceKm * 0.621371 * 10) / 10,
          direction: cardinal(strike.bearingDeg, { words: true }),
        },
      }),
    );
  }

  if (layout === 'emcomm') {
    recordEvent('lightning', {
      summary: LOG_TITLES[key],
      details: [
        distance && st.level !== 'clear' ? `nearest strike ${distance}` : '',
        st.level !== 'clear' && !closer
          ? `${st.warnCount} strike(s) within ${settings.warnKm} km in ${st.windowMin ?? 10} min`
          : '',
        !closer && relay === true
          ? 'antenna relay engaged'
          : !closer && relay === false
            ? 'antenna relay released'
            : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
}

// ── Push opt-in (server stores this browser's location + radii) ────────────
const PUSH_PREFS_KEY = 'ohc_lightning_push_prefs'; // last prefs the server accepted (JSON) or absent
const PUSH_PREFS_DEBOUNCE_MS = 2000;

/** The prefs this browser should have on the server, or null to opt out. */
export function lightningPushPrefsFor({ active, settings, lat, lon, imperial }) {
  if (!active || !settings?.channels?.push) return null;
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    warnKm: settings.warnKm,
    alarmKm: settings.alarmKm,
    imperial: !!imperial,
  };
}

/** Guard settings + location for Rig Bridge's headless guard. */
export function guardSettingsForBridge(settings, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    warnKm: settings.warnKm,
    alarmKm: settings.alarmKm,
    allClearMin: settings.allClearMin,
    minStrikes: settings.minStrikes,
    hysteresisPct: settings.hysteresisPct,
    repeatCloser: settings.repeatCloser,
    relayOn: settings.relay.on,
  };
}

// ── Engine ─────────────────────────────────────────────────────────────────
export default function useLightningGuard({ location, allUnits, layout } = {}) {
  const [settings, setSettings] = useState(readGuardSettings);
  useEffect(() => {
    const sync = () => setSettings(readGuardSettings());
    window.addEventListener(ALERT_SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ALERT_SETTINGS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const lat = location?.lat;
  const lon = location?.lon;
  const hasDe = Number.isFinite(lat) && Number.isFinite(lon);
  const active = settings.enabled && hasDe;
  const imperial = allUnits?.dist === 'imperial';

  // Refs so the feed subscription survives DE moves (GPS follow) and setting edits
  const deRef = useRef({ lat, lon });
  deRef.current = { lat, lon };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const imperialRef = useRef(false);
  imperialRef.current = imperial;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const runnerRef = useRef(null);
  if (!runnerRef.current) runnerRef.current = new GuardRunner(settings);
  const demandRef = useRef(null);

  const evaluate = useCallback((batch = []) => {
    const s = settingsRef.current;
    const runner = runnerRef.current;
    runner.setSettings(s);
    const { status: st, transition, closer } = runner.step(batch, deRef.current, Date.now());

    let override = getRelayOverride();
    const lapsed = nextOverride(override, st.level);
    if (lapsed !== override) {
      lsSet(OVERRIDE_KEY, lapsed === 'auto' ? null : lapsed);
      override = lapsed;
    }
    const demand = relayDemand({ settings: s, level: st.level, override });
    const prevDemand = demandRef.current;
    demandRef.current = demand;

    publish({
      enabled: true,
      ...st,
      relay: demand,
      relayReport: relayReportFor(demand),
      override,
      imperial: imperialRef.current,
      settings: s,
    });

    const common = { st, settings: s, demand, prevDemand, imperial: imperialRef.current, layout: layoutRef.current };
    if (transition) fireAlerts({ kind: transition, ...common });
    else if (closer) fireAlerts({ kind: 'closer', ...common });
    else if (demand !== prevDemand && prevDemand !== null && demand !== null && layoutRef.current === 'emcomm') {
      // Relay moved without a level change (manual override) — log it
      recordEvent('lightning', {
        summary: demand ? 'Antenna relay engaged (manual)' : 'Antenna relay released (manual)',
      });
    }
  }, []);

  useEffect(() => {
    if (!active) {
      runnerRef.current.reset();
      demandRef.current = null;
      engineReevaluate = null;
      publish({
        ...OFF_STATUS,
        override: getRelayOverride(),
        relayReport: relayReportFor(null),
        settings: settingsRef.current,
        imperial: imperialRef.current,
      });
      return undefined;
    }
    engineReevaluate = () => evaluate([]);
    evaluate([]);
    const unsubscribe = subscribeStrikes((batch) => evaluate(batch));
    const id = setInterval(() => evaluate([]), TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(id);
      engineReevaluate = null;
    };
  }, [active, evaluate]);

  // Settings edits (radii, timer, relay) take effect immediately
  useEffect(() => {
    if (active) evaluate([]);
  }, [settings, active, evaluate]);

  // Web Push opt-in: keep the server's copy of location + radii in step
  const pushPrefs = lightningPushPrefsFor({ active, settings, lat, lon, imperial });
  const pushPrefsJson = pushPrefs ? JSON.stringify(pushPrefs) : '';
  useEffect(() => {
    const stored = lsGet(PUSH_PREFS_KEY) || '';
    if (stored === pushPrefsJson) return undefined;
    const id = setTimeout(async () => {
      const r = await setLightningPushPrefs(pushPrefsJson ? JSON.parse(pushPrefsJson) : null);
      if (r.ok) lsSet(PUSH_PREFS_KEY, pushPrefsJson || null);
    }, PUSH_PREFS_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [pushPrefsJson]);

  // Synthetic strikes relative to DE (works for the map layer too)
  useEffect(() => {
    const onInject = (e) => {
      const d = e?.detail || {};
      const de = deRef.current;
      let point = null;
      if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) point = { lat: d.lat, lon: d.lon };
      else if (Number.isFinite(de.lat) && Number.isFinite(de.lon)) {
        const km = Number.isFinite(d.distanceKm) ? d.distanceKm : 10;
        point = destinationPoint(de.lat, de.lon, km, Number.isFinite(d.bearingDeg) ? d.bearingDeg : 45);
      }
      if (point) injectStrike(point);
    };
    window.addEventListener(INJECT_LIGHTNING_EVENT, onInject);
    return () => window.removeEventListener(INJECT_LIGHTNING_EVENT, onInject);
  }, []);

  const live = useLightningGuardStatus();
  // What Rig Bridge's headless guard should use (sent with the indicators)
  const guard = active ? guardSettingsForBridge(settings, lat, lon) : null;
  const guardJson = guard ? JSON.stringify(guard) : '';
  const guardStable = useMemo(() => (guardJson ? JSON.parse(guardJson) : null), [guardJson]);
  return {
    level: live.level,
    relay: live.relayReport,
    allClearMin: live.settings?.allClearMin ?? settings.allClearMin,
    override: live.override,
    guard: guardStable,
  };
}
