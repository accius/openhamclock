/**
 * useAlarmClock — React bindings for utils/alarmClock.js.
 *
 *  • useAlarmScheduler(timeZone): mount ONCE (App.jsx). Ticks every second on
 *    real time, rings due alarms (repeating tone from the `alarm` audio feed,
 *    browser notification, on-screen banner via the store's `ringing`), and
 *    disarms the once-only alarm after it fires. Also installs the
 *    `ohc:set-alarm` remote-control listener.
 *  • useAlarmState(): any component (header bell, Clock layout, settings)
 *    subscribes to the alarm settings + ringing state and gets setters.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAlarmState,
  getRinging,
  setRinging,
  subscribeAlarm,
  updateAlarm,
  saveAlarmState,
  dueAlarms,
  nextAlarmTimes,
  installSetAlarmListener,
  onceAlarmAt,
} from '../../utils/alarmClock.js';
import { getAlertSettings, playTone } from '../../utils/audioAlerts.js';
import { showAlertNotification } from '../../utils/notifications.js';

const RING_REPEAT_MS = 2000;
const RING_MAX_MS = 90_000;

export function useAlarmState(timeZone) {
  const [snap, setSnap] = useState(() => ({ alarm: getAlarmState(), ringing: getRinging() }));
  const [nextAt, setNextAt] = useState(() => nextAlarmTimes(getAlarmState(), { tz: timeZone }).next);

  useEffect(() => subscribeAlarm(setSnap), []);

  // Countdown refresh once a minute + whenever the alarm settings change.
  useEffect(() => {
    const refresh = () => setNextAt(nextAlarmTimes(snap.alarm, { tz: timeZone }).next);
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [snap.alarm, timeZone]);

  const update = useCallback((kind, patch) => updateAlarm(kind, patch), []);
  const setOnceAt = useCallback((instant, label) => saveAlarmState(onceAlarmAt(getAlarmState(), instant, label)), []);
  const dismiss = useCallback(() => setRinging(null), []);

  return { alarm: snap.alarm, ringing: snap.ringing, nextAt, update, setOnceAt, dismiss };
}

export function useAlarmScheduler(timeZone) {
  const prevRef = useRef(Date.now());
  const ringTimerRef = useRef(null);
  const tzRef = useRef(timeZone);
  tzRef.current = timeZone;

  useEffect(() => installSetAlarmListener(), []);

  useEffect(() => {
    const stopRinging = () => {
      if (ringTimerRef.current) {
        clearInterval(ringTimerRef.current);
        ringTimerRef.current = null;
      }
    };

    const startRinging = (kind, state) => {
      stopRinging();
      const label = kind === 'once' && state.once.label ? state.once.label : '';
      const startedAt = Date.now();
      setRinging({ kind, at: startedAt, label });
      const settings = getAlertSettings();
      const tone = settings.alarm?.tone || 'chime';
      const volume = settings.volume ?? 0.5;
      const beep = () => {
        try {
          playTone(tone, volume);
        } catch {
          /* audio context not available */
        }
      };
      beep();
      ringTimerRef.current = setInterval(() => {
        if (!getRinging() || Date.now() - startedAt > RING_MAX_MS) {
          stopRinging();
          if (getRinging()) setRinging(null);
          return;
        }
        beep();
      }, RING_REPEAT_MS);
      if (settings.notifications) {
        const when = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        showAlertNotification({
          feedId: 'alarm',
          title: kind === 'once' ? 'Alarm (once)' : 'Daily alarm',
          body: [label, when].filter(Boolean).join(' · '),
          tag: `ohc-alarm-${kind}`,
        });
      }
    };

    const tick = () => {
      const now = Date.now();
      const prev = prevRef.current;
      prevRef.current = now;
      const state = getAlarmState();
      const due = dueAlarms(state, prev, now, { tz: tzRef.current });
      if (!due.length) return;
      // Ring the once-alarm in preference when both land on the same second.
      const kind = due.includes('once') ? 'once' : due[0];
      startRinging(kind, state);
      if (due.includes('once')) updateAlarm('once', { armed: false, at: null });
    };

    const id = setInterval(tick, 1000);
    const unsub = subscribeAlarm((snap) => {
      if (!snap.ringing) stopRinging();
    });
    return () => {
      clearInterval(id);
      unsub();
      stopRinging();
    };
  }, []);
}

export default useAlarmState;
