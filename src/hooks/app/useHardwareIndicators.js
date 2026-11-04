/**
 * useHardwareIndicators — tell the Rig Bridge what the display is showing so
 * hardware plugins (GPIO LEDs) can mirror it: satellite visible / seconds to
 * AOS / seconds to LOS, the ID-timer countdown state, whether an alarm
 * (ID timer expired) is ringing, and — only when this browser drives the
 * lightning relay — the lightning guard level and relay request
 * (`lightning`, `lightningRelay`; see hooks/useLightningGuard.js).
 *
 * POSTs <rig-bridge>/api/indicators every 15 s and within 1 s of a change;
 * in Cloud Relay mode the same payload goes through the server as an
 * `indicators` relay command, which the bridge's cloud-relay plugin hands to
 * its local /api/indicators. Silent when rig control is disabled or the
 * bridge is unreachable (backs off to once a minute after 3 failures).
 *
 * Lightning reports carry a stable per-browser `displayId`, so the bridge can
 * hold a claim per display (engaged while ANY display wants protection) and
 * keep a quiet display's claim for its `lightningAllClearMin`; `lightningGuard`
 * (radii, all-clear, hysteresis, repeat alerts, relay level, location) keeps
 * the bridge's headless guard in step with this display's settings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildRigUrl } from '../../contexts/RigContext.jsx';
import { getRelaySessionId, isRelayConfigured } from '../../utils/relaySession.js';
import { sendRelayCommand, newRelayRequestId, waitForRelayAnswer } from '../../utils/relaySign.js';

/** How long a relayed lightning-relay report waits for Rig Bridge's answer. */
export const RELAY_ACK_TIMEOUT_MS = 15000;

const PUSH_INTERVAL_MS = 15000;
const CHANGE_DEBOUNCE_MS = 1000;
const BACKOFF_MS = 60000;

const DISPLAY_ID_KEY = 'ohc_display_id';

/** Stable random id for this browser (8–24 chars, [a-z0-9]). */
export function getDisplayId() {
  try {
    const v = localStorage.getItem(DISPLAY_ID_KEY);
    if (v && /^[a-z0-9]{8,24}$/.test(v)) return v;
    const id = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 16);
    localStorage.setItem(DISPLAY_ID_KEY, id);
    return id;
  } catch {
    return 'display';
  }
}

/** Window event the ID timer fires: detail = { state: 'off'|'running'|'expired' } */
export const COUNTDOWN_STATE_EVENT = 'ohc-countdown-state';

/** Pure: derive satellite indicator fields from the satellites hook output. */
export function deriveSatIndicators(satellites, now = Date.now()) {
  let satVisible = false;
  let satAosInSec = null;
  let satLosInSec = null;
  for (const sat of satellites || []) {
    const starts = sat.nextPassStartTimes || [];
    const ends = sat.nextPassEndTimes || [];
    if (sat.isVisible) {
      satVisible = true;
      for (const e of ends) {
        const end = new Date(e).getTime();
        if (Number.isFinite(end) && end > now) {
          const s = Math.round((end - now) / 1000);
          if (satLosInSec == null || s < satLosInSec) satLosInSec = s;
          break;
        }
      }
    } else {
      for (const st of starts) {
        const start = new Date(st).getTime();
        if (Number.isFinite(start) && start > now) {
          const s = Math.round((start - now) / 1000);
          if (satAosInSec == null || s < satAosInSec) satAosInSec = s;
          break;
        }
      }
    }
  }
  return { satVisible, satAosInSec, satLosInSec };
}

/**
 * Pure: the body POSTed to /api/indicators. Lightning fields are added only
 * when `lightning.relay` is a boolean — a display that does not drive the
 * relay leaves the bridge's lightning state alone.
 */
export function buildIndicatorPayload(sat, countdown, lightning, displayId) {
  const payload = { ...sat, countdown, alarm: countdown === 'expired' };
  if (lightning && typeof lightning.relay === 'boolean') {
    payload.lightningRelay = lightning.relay;
    if (lightning.level === 'clear' || lightning.level === 'warn' || lightning.level === 'alarm') {
      payload.lightning = lightning.level;
    }
    if (Number.isFinite(lightning.allClearMin)) payload.lightningAllClearMin = lightning.allClearMin;
    if (lightning.override === 'on' || lightning.override === 'off') payload.lightningOverride = lightning.override;
    if (displayId) payload.displayId = displayId;
    // Settings + location for the bridge's headless guard (it applies changes)
    if (lightning.guard && typeof lightning.guard === 'object') payload.lightningGuard = lightning.guard;
  }
  return payload;
}

export default function useHardwareIndicators({ satellites, rigConfig, lightning, onLightningAck }) {
  const [countdown, setCountdown] = useState('off');
  const failuresRef = useRef(0);
  const timerRef = useRef(null);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const onState = (e) => {
      const s = e?.detail?.state;
      if (s === 'off' || s === 'running' || s === 'expired') setCountdown(s);
    };
    window.addEventListener(COUNTDOWN_STATE_EVENT, onState);
    return () => window.removeEventListener(COUNTDOWN_STATE_EVENT, onState);
  }, []);

  const viaRelay = isRelayConfigured();
  const enabled = !!rigConfig?.enabled;
  const rigUrl = buildRigUrl(rigConfig);
  const [displayId] = useState(getDisplayId);
  const apiToken = rigConfig?.apiToken?.trim() || '';

  const sat = useMemo(() => deriveSatIndicators(satellites), [satellites]);
  const lightningLevel = lightning?.level;
  const lightningRelay = lightning?.relay;
  const lightningAllClear = lightning?.allClearMin;
  const lightningOverride = lightning?.override;
  const lightningGuard = lightning?.guard || null;
  const payload = useMemo(
    () =>
      buildIndicatorPayload(
        sat,
        countdown,
        {
          level: lightningLevel,
          relay: lightningRelay,
          allClearMin: lightningAllClear,
          override: lightningOverride,
          guard: lightningGuard,
        },
        displayId,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sat.satVisible,
      sat.satAosInSec,
      sat.satLosInSec,
      countdown,
      lightningLevel,
      lightningRelay,
      lightningAllClear,
      lightningOverride,
      lightningGuard,
      displayId,
    ],
  );
  const ackRef = useRef(onLightningAck);
  ackRef.current = onLightningAck;
  // Coarse key: AOS/LOS seconds change every tick; only re-push on meaningful changes
  const key = `${payload.satVisible}|${payload.countdown}|${payload.satAosInSec != null && payload.satAosInSec <= 90}|${payload.satLosInSec != null && payload.satLosInSec <= 90}|${payload.lightning ?? ''}|${payload.lightningRelay ?? ''}|${payload.lightningAllClearMin ?? ''}|${payload.lightningOverride ?? ''}|${payload.lightningGuard ? JSON.stringify(payload.lightningGuard) : ''}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const push = async () => {
      if (!active) return;
      try {
        const relayReport = typeof payload.lightningRelay === 'boolean' ? payload.lightningRelay : undefined;
        if (viaRelay) {
          // Through the Cloud Relay the command is signed with this browser's
          // relay command key (utils/relaySign.js). The server accepting it
          // only means it was queued: a lightning-relay report is acknowledged
          // only when Rig Bridge itself answers that it applied it — not on a
          // refusal or a timeout (the report is simply sent again next push).
          const requestId = relayReport !== undefined ? newRelayRequestId('ind') : null;
          const answer = requestId ? waitForRelayAnswer(requestId, RELAY_ACK_TIMEOUT_MS) : null;
          const res = await sendRelayCommand(
            getRelaySessionId() || '',
            'indicators',
            requestId ? { ...payload, requestId } : payload,
          );
          failuresRef.current = res.ok ? 0 : failuresRef.current + 1;
          if (answer) {
            answer.then((r) => {
              if (r.ok && active) ackRef.current?.(relayReport);
            });
          }
        } else {
          const res = await fetch(`${rigUrl}/api/indicators`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-RigBridge-Token': apiToken } : {}) },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(4000),
          });
          failuresRef.current = res.ok ? 0 : failuresRef.current + 1;
          // Direct to Rig Bridge: its OK is the bridge's own answer
          if (res.ok && relayReport !== undefined) ackRef.current?.(relayReport);
        }
      } catch {
        failuresRef.current += 1;
      }
      if (!active) return;
      const delay = failuresRef.current >= 3 ? BACKOFF_MS : PUSH_INTERVAL_MS;
      timerRef.current = setTimeout(push, delay);
    };
    const changed = key !== lastKeyRef.current;
    lastKeyRef.current = key;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(push, changed ? CHANGE_DEBOUNCE_MS : PUSH_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(timerRef.current);
    };
  }, [enabled, viaRelay, rigUrl, apiToken, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return payload;
}
