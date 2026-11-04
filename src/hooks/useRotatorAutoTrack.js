/**
 * useRotatorAutoTrack — drives the rotator at the DX bearing or at the
 * selected satellite.
 *
 * Runs once (DockableApp). Mode and satellite come from the automation
 * store; the hook ticks once a second, works out the target, and sends a
 * command through `send({ az, el })` only when the target has moved by more
 * than the configured step (default 2°) and at most once per second.
 *
 *  - DX: short-path bearing DE→DX (long path when the store says so), el 0.
 *  - Satellite: az/el while the bird is above the horizon; swing to the AOS
 *    azimuth `prepositionMins` before the pass. If the rotator can go over
 *    the top (rotatorMaxEl = 180) and the pass crosses the mechanical stop,
 *    the whole pass is run flipped (az + 180, el mirrored) so the rotator
 *    never has to unwind mid-pass. The flip decision is made once per pass
 *    from the predicted azimuth path.
 *
 * The commanded target is published to the store (`rotatorTarget`) so the
 * panels and the map can show it.
 */
import { useEffect, useRef } from 'react';
import { calculateBearing } from '../utils/geo.js';
import { satrecFor } from '../utils/satRelay.js';
import { observerFromLocation, lookAnglesAt, computePassSkyPath } from '../utils/satelliteSkyPath.js';
import { decideFlip, longPathAz, planRotatorCommand, satelliteTarget } from '../utils/rotatorTrack.js';
import { getSatAutomation, setSatAutomationLive, subscribeSatAutomation } from '../utils/satAutomationStore.js';

const TICK_MS = 1000;

export default function useRotatorAutoTrack({
  satellites,
  deLocation,
  dxLocation,
  rotator, // { available, azimuth, elevation, hasElevation }
  send, // async ({az, el}) => void
  settings, // config.satellite
} = {}) {
  const refs = useRef({});
  refs.current = { satellites, deLocation, dxLocation, rotator, send, settings };

  const lastCmdRef = useRef({ cmd: null, at: 0 });
  const passRef = useRef({ key: null, sky: null, flip: false }); // per-pass flip decision cache

  useEffect(() => {
    let timer = null;
    let busy = false;

    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const nextPassOf = (sat, now) => {
      const starts = sat.nextPassStartTimes || [];
      const ends = sat.nextPassEndTimes || [];
      for (let i = 0; i < starts.length; i++) {
        const aos = new Date(starts[i]).getTime();
        const los = new Date(ends[i]).getTime();
        if (!Number.isFinite(aos) || !Number.isFinite(los)) continue;
        if (los < now) continue;
        return { aos, los };
      }
      return null;
    };

    const computeTarget = (auto, now) => {
      const { satellites: sats, deLocation: de, dxLocation: dx, settings: cfg } = refs.current;
      if (!de || !Number.isFinite(de.lat) || !Number.isFinite(de.lon)) return null;

      if (auto.rotatorMode === 'dx') {
        if (!dx || !Number.isFinite(dx.lat) || !Number.isFinite(dx.lon)) return null;
        let az = calculateBearing(de.lat, de.lon, dx.lat, dx.lon);
        if (auto.longPath) az = longPathAz(az);
        return { az: Math.round(az * 10) / 10, el: 0, flip: false, phase: 'tracking', source: 'dx' };
      }

      if (auto.rotatorMode === 'sat') {
        const sat = (sats || []).find((s) => s.name === auto.satName);
        if (!sat?.omm) return null;
        const satrec = satrecFor(sat.omm);
        const obs = observerFromLocation(de);
        if (!satrec || !obs) return null;
        const look = lookAnglesAt(satrec, obs, new Date(now));
        const pass = nextPassOf(sat, now);

        // Flip decision, once per pass, from the predicted azimuth path.
        let flip = false;
        let aosAz = null;
        if (pass) {
          const key = `${sat.name}|${pass.aos}`;
          if (passRef.current.key !== key) {
            const sky = computePassSkyPath(satrec, obs, pass.aos, pass.los, 20);
            const dec = decideFlip({
              azimuths: sky?.points?.map((p) => p.az) || [],
              stopAz: Number(cfg?.rotatorStopAz ?? 0),
              maxEl: Number(cfg?.rotatorMaxEl ?? 90),
            });
            passRef.current = { key, sky, flip: dec.flip };
          }
          flip = passRef.current.flip;
          aosAz = passRef.current.sky?.aos?.az ?? null;
        }

        const t = satelliteTarget({
          look,
          nextPass: pass && aosAz != null ? { aosMs: pass.aos, aosAz } : null,
          now,
          prepositionMins: Number(cfg?.rotatorPrepositionMins ?? 10),
          flip,
        });
        if (!t)
          return {
            az: null,
            el: null,
            flip,
            phase: 'idle',
            source: 'sat',
            satName: sat.name,
            nextAos: pass?.aos ?? null,
          };
        return { ...t, flip, source: 'sat', satName: sat.name, nextAos: pass?.aos ?? null };
      }
      return null;
    };

    const tick = async () => {
      if (busy) return;
      const auto = getSatAutomation();
      if (auto.rotatorMode === 'off') {
        if (auto.rotatorTarget) setSatAutomationLive({ rotatorTarget: null });
        return;
      }
      const now = Date.now();
      const target = computeTarget(auto, now);
      const { rotator: rot, send: sendFn, settings: cfg } = refs.current;

      let sent = false;
      if (target && Number.isFinite(target.az) && rot?.available && typeof sendFn === 'function') {
        const current = {
          az: Number.isFinite(rot.azimuth) ? rot.azimuth : null,
          el: rot.hasElevation && Number.isFinite(rot.elevation) ? rot.elevation : null,
        };
        const plan = planRotatorCommand({
          target: { az: target.az, el: rot.hasElevation ? target.el : undefined },
          lastCommand: lastCmdRef.current.cmd,
          current,
          stepDeg: Number(cfg?.rotatorStepDeg ?? 2),
          now,
          lastSentAt: lastCmdRef.current.at,
        });
        if (plan.send) {
          busy = true;
          try {
            await sendFn({ az: target.az, el: target.el });
            lastCmdRef.current = { cmd: { az: target.az, el: target.el }, at: now };
            sent = true;
          } catch (err) {
            console.warn('[RotatorAutoTrack] command failed:', err?.message || err);
            lastCmdRef.current.at = now; // still rate-limit the retry
          } finally {
            busy = false;
          }
        }
      }

      setSatAutomationLive({
        rotatorTarget: target
          ? {
              ...target,
              commandedAz: lastCmdRef.current.cmd?.az ?? null,
              commandedEl: lastCmdRef.current.cmd?.el ?? null,
              lastSentAt: lastCmdRef.current.at,
              justSent: sent,
              rotatorAvailable: !!rot?.available,
              updatedAt: now,
            }
          : null,
      });
    };

    const sync = () => {
      const auto = getSatAutomation();
      const want = auto.rotatorMode !== 'off';
      if (want && !timer) {
        lastCmdRef.current = { cmd: null, at: 0 };
        passRef.current = { key: null, sky: null, flip: false };
        tick();
        timer = setInterval(tick, TICK_MS);
      } else if (!want && timer) {
        stopTimer();
        if (auto.rotatorTarget) setSatAutomationLive({ rotatorTarget: null });
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
