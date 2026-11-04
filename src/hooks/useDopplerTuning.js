/**
 * useDopplerTuning — keeps the rig on a satellite's Doppler-corrected downlink.
 *
 * Runs once (DockableApp). Reads the operator's choices from the automation
 * store (satellite, enabled, remembered transmitter), recomputes the range
 * rate itself every second from the element set (useSatellites only
 * refreshes every 5 s), and sends a new frequency through the rig hook when
 * the correction has moved by more than the configured step (default 20 Hz).
 * The transmitter's mode is sent once when tuning starts or the pick changes.
 *
 * Rig Bridge has no split/sub-VFO API, so only the downlink is tuned; the
 * corrected uplink is computed and shown for the operator to set by hand.
 *
 * Below the horizon the tuner pre-sets the AOS frequency once the pass is
 * within `prepositionMins`, so the radio is already on frequency at AOS.
 */
import { useEffect, useRef } from 'react';
import { satrecFor } from '../utils/satRelay.js';
import { observerFromLocation, lookAnglesAt } from '../utils/satelliteSkyPath.js';
import {
  computeDopplerState,
  pickTransmitter,
  shouldRetune,
  transmitterKey,
  transmitterLabel,
} from '../utils/doppler.js';
import { getSatAutomation, setSatAutomationLive, subscribeSatAutomation } from '../utils/satAutomationStore.js';

const TICK_MS = 1000;

export default function useDopplerTuning({ satellites, deLocation, rig, settings } = {}) {
  const satsRef = useRef(satellites);
  satsRef.current = satellites;
  const deRef = useRef(deLocation);
  deRef.current = deLocation;
  const rigRef = useRef(rig);
  rigRef.current = rig;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const lastSentRef = useRef({ hz: null, at: 0, txKey: null, mode: null, satName: null });

  useEffect(() => {
    let timer = null;

    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const tick = () => {
      const auto = getSatAutomation();
      const r = rigRef.current;
      if (!auto.doppler || !auto.satName) {
        if (auto.dopplerLive) setSatAutomationLive({ dopplerLive: null });
        return;
      }
      const sat = (satsRef.current || []).find((s) => s.name === auto.satName);
      const txList = sat?.transmitters?.length ? sat.transmitters : sat?.relayTransmitters || [];
      const tx = pickTransmitter(txList, auto.transmitterBySat?.[auto.satName]);
      if (!sat?.omm || !tx) {
        setSatAutomationLive({
          dopplerLive: { active: false, reason: !sat ? 'no-satellite' : !sat.omm ? 'no-elements' : 'no-transmitter' },
        });
        return;
      }

      const satrec = satrecFor(sat.omm);
      const obs = observerFromLocation(deRef.current);
      const now = Date.now();
      const look = satrec && obs ? lookAnglesAt(satrec, obs, new Date(now)) : null;

      // Evaluate at "now" when the bird is up; otherwise at the next AOS if
      // it is close enough to be worth pre-setting the radio.
      let evalMs = null;
      let phase = 'idle';
      if (look && look.elevation >= 0) {
        evalMs = now;
        phase = 'tracking';
      } else {
        const prepMs = Math.max(0, Number(settingsRef.current?.rotatorPrepositionMins ?? 10)) * 60 * 1000;
        const starts = sat.nextPassStartTimes || [];
        const ends = sat.nextPassEndTimes || [];
        for (let i = 0; i < starts.length; i++) {
          const aos = new Date(starts[i]).getTime();
          const los = new Date(ends[i]).getTime();
          if (Number.isFinite(los) && los < now) continue;
          if (Number.isFinite(aos) && aos - now <= prepMs) {
            evalMs = aos;
            phase = 'preposition';
          }
          break;
        }
      }

      const rangeRate = evalMs == null ? 0 : (lookAnglesAt(satrec, obs, new Date(evalMs))?.rangeRateKmS ?? 0);
      const state = computeDopplerState(tx, rangeRate);
      const txKey = transmitterKey(tx, txList.indexOf(tx));
      const stepHz = settingsRef.current?.dopplerStepHz;

      let sent = false;
      let reason = phase;
      const canSend = !!r?.enabled && typeof r?.setFreq === 'function' && evalMs != null;
      if (canSend && Number.isFinite(state.downlinkCorrectedHz)) {
        const last = lastSentRef.current;
        const pickChanged = last.txKey !== txKey || last.satName !== auto.satName;
        if (pickChanged && state.mode && typeof r.setMode === 'function' && last.mode !== state.mode) {
          r.setMode(state.mode);
          last.mode = state.mode;
        }
        if (pickChanged || shouldRetune(last.hz, state.downlinkCorrectedHz, stepHz)) {
          r.setFreq(state.downlinkCorrectedHz);
          last.hz = state.downlinkCorrectedHz;
          last.at = now;
          sent = true;
        }
        last.txKey = txKey;
        last.satName = auto.satName;
      } else if (!r?.enabled) {
        reason = 'rig-disabled';
      }

      setSatAutomationLive({
        dopplerLive: {
          active: canSend,
          phase,
          reason,
          satName: auto.satName,
          txKey,
          txLabel: transmitterLabel(tx),
          elevation: look ? Math.round(look.elevation * 10) / 10 : null,
          azimuth: look ? Math.round(look.azimuth) : null,
          ...state,
          lastSentHz: lastSentRef.current.hz,
          lastSentAt: lastSentRef.current.at,
          justSent: sent,
          updatedAt: now,
        },
      });
    };

    const sync = () => {
      const auto = getSatAutomation();
      const want = auto.doppler && !!auto.satName;
      if (want && !timer) {
        lastSentRef.current = { hz: null, at: 0, txKey: null, mode: null, satName: null };
        tick();
        timer = setInterval(tick, TICK_MS);
      } else if (!want && timer) {
        stopTimer();
        if (auto.dopplerLive) setSatAutomationLive({ dopplerLive: null });
      }
    };

    sync();
    const unsub = subscribeSatAutomation(sync);
    return () => {
      unsub();
      stopTimer();
    };
  }, []);
}
