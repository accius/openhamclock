/**
 * useIBP Hook
 * Provides the live IBP beacon schedule, updated every second (countdown)
 * but only recalculating the schedule when the 10-second slot changes.
 */
import { useState, useEffect, useRef } from 'react';
import {
  getSchedule,
  getCurrentSlot,
  getSecondsRemainingInSlot,
  getSecondsRemainingInCycle,
  SLOT_SECONDS,
} from '../utils/ibp';

/**
 * @param {number|null} deLat  - operator latitude  (null = no bearing/distance)
 * @param {number|null} deLon  - operator longitude
 */
export const useIBP = (deLat = null, deLon = null) => {
  const now = new Date();
  const [slot, setSlot] = useState(() => getCurrentSlot(now));
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsRemainingInSlot(now));
  const [cycleSecondsLeft, setCycleSecondsLeft] = useState(() => getSecondsRemainingInCycle(now));
  const [schedule, setSchedule] = useState(() => getSchedule(now, deLat, deLon));
  const prevSlotRef = useRef(slot);

  // Store deLat/deLon in a ref so the interval doesn't need to be recreated
  // when the operator position changes.
  const deRef = useRef({ deLat, deLon });
  deRef.current = { deLat, deLon };

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const newSlot = getCurrentSlot(d);
      const newSecondsLeft = getSecondsRemainingInSlot(d);
      const newCycleLeft = getSecondsRemainingInCycle(d);

      setSecondsLeft(newSecondsLeft);
      setCycleSecondsLeft(newCycleLeft);

      if (newSlot !== prevSlotRef.current) {
        prevSlotRef.current = newSlot;
        setSlot(newSlot);
        setSchedule(getSchedule(d, deRef.current.deLat, deRef.current.deLon));
      }
    };

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // Interval is intentionally unconditional: both IBPPanel and useIBPLayer consume
    // this state, and a 1-second tick shared across all consumers is negligible overhead.
  }, []); // no deps — deRef keeps position current without re-subscribing

  // Recompute bearings/distances immediately when QTH changes
  useEffect(() => {
    setSchedule(getSchedule(new Date(), deLat, deLon));
  }, [deLat, deLon]);

  return {
    /** 0–17: current beacon slot within the 3-minute cycle */
    slot,
    /** Seconds left in the current 10-second transmission window (1–10) */
    secondsLeft,
    /** Seconds left in the current 3-minute cycle (1–180) */
    cycleSecondsLeft,
    /** Array of 5 entries, one per IBP band, with active beacon + geo info */
    schedule,
    /** Progress fraction through the current slot (0–1) */
    slotProgress: (SLOT_SECONDS - secondsLeft) / SLOT_SECONDS,
  };
};

export default useIBP;
