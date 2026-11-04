/**
 * useWinlinkReach — React access to the shared reachable-gateway runner
 * (services/winlinkReachStore.js).
 *
 *   useWinlinkReach({ id, active, priority, deLocation, propConfig, ssn })
 *
 * While `active`, the component registers demand under `id`; the store runs
 * (or reuses from cache) one P.533 prediction per nearby HF gateway and
 * every consumer — panel, map layer, EmComm list — reads the same result.
 * Two consumers never cause two runs.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  REACH_PRIORITY,
  getReachState,
  refreshReach,
  requestReach,
  releaseReach,
  setReachPactor4,
  setReachRange,
  setReachThresholds,
  subscribeReach,
} from '../services/winlinkReachStore.js';
import useDisplayTime from './app/useDisplayTime.js';

export { REACH_PRIORITY };

const noopSubscribe = () => () => {};
const getNothing = () => null;

export function useWinlinkReach({
  id = 'panel',
  active = true,
  priority = REACH_PRIORITY.panel,
  deLocation = null,
  propConfig = null,
  ssn = null,
  throttleMs = 0,
} = {}) {
  const throttle = throttleMs > 0;
  const live = useSyncExternalStore(
    throttle ? noopSubscribe : subscribeReach,
    throttle ? getNothing : getReachState,
    throttle ? getNothing : getReachState,
  );
  // Throttled consumers (big layouts) re-render at most once per throttleMs
  // while predictions stream in, instead of once per finished prediction.
  const [throttled, setThrottled] = useState(getReachState);
  useEffect(() => {
    if (!(throttleMs > 0)) return undefined;
    let timer = null;
    setThrottled(getReachState());
    const unsub = subscribeReach(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setThrottled(getReachState());
      }, throttleMs);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [throttleMs]);
  const state = throttle ? throttled : live;
  const { offsetMs } = useDisplayTime();

  const deLat = deLocation?.lat;
  const deLon = deLocation?.lon;
  const power = propConfig?.power;
  const antenna = propConfig?.antenna;

  useEffect(() => {
    if (!active) return undefined;
    requestReach(id, {
      priority,
      deLocation: Number.isFinite(deLat) && Number.isFinite(deLon) ? { lat: deLat, lon: deLon } : null,
      propConfig: power != null || antenna != null ? { power, antenna } : null,
      ssn: Number.isFinite(Number(ssn)) && ssn != null ? Number(ssn) : null,
    });
  }, [id, active, priority, deLat, deLon, power, antenna, ssn]);

  useEffect(() => {
    if (!active) return undefined;
    return () => releaseReach(id);
  }, [id, active]);

  const refresh = useCallback(() => refreshReach(), []);
  const setRange = useCallback((km) => setReachRange(km), []);
  const setThresholds = useCallback((t) => setReachThresholds(t), []);
  const setPactor4 = useCallback((on) => setReachPactor4(on), []);

  return {
    ...state,
    timeShifted: offsetMs !== 0,
    refresh,
    setRange,
    setThresholds,
    setPactor4,
  };
}

export default useWinlinkReach;
