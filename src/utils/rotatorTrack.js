/**
 * Rotator auto-track planning — pure helpers shared by the auto-track hook,
 * the Rotator panel and the tests.
 *
 * All angles in degrees. Azimuth 0 = north, clockwise. Elevation 0 = horizon.
 *
 * "Flip" mode: rotators whose elevation axis travels to 180° (Yaesu G-5500
 * and friends) can track a pass that crosses the azimuth stop without the
 * long unwind — point the antenna "over the top" by adding 180° to the
 * azimuth and mirroring the elevation. The decision is made once per pass
 * from the predicted azimuth path.
 */

export const DEFAULT_STEP_DEG = 2;
export const MIN_STEP_DEG = 0.5;
export const MAX_STEP_DEG = 15;
export const MIN_COMMAND_INTERVAL_MS = 1000;
export const DEFAULT_PREPOSITION_MINS = 10;

export const wrap360 = (deg) => ((Number(deg) % 360) + 360) % 360;

/** Shortest signed azimuth delta from → to in [-180, 180). */
export function shortestDelta(fromAz, toAz) {
  return ((wrap360(toAz) - wrap360(fromAz) + 540) % 360) - 180;
}

/** Long-path bearing is the reciprocal of the short-path one. */
export const longPathAz = (az) => wrap360(az + 180);

export function clampStep(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STEP_DEG;
  return Math.min(MAX_STEP_DEG, Math.max(MIN_STEP_DEG, n));
}

/**
 * Does the azimuth path cross the rotator's mechanical stop?
 * Consecutive samples are assumed to be close together (< 180° apart), so a
 * jump across the stop shows up as a wrap in stop-relative coordinates.
 */
export function pathCrossesStop(azimuths, stopAz = 0) {
  const list = (Array.isArray(azimuths) ? azimuths : []).map(Number).filter(Number.isFinite);
  if (list.length < 2) return false;
  const rel = list.map((az) => wrap360(az - stopAz));
  for (let i = 1; i < rel.length; i++) {
    if (Math.abs(rel[i] - rel[i - 1]) > 180) return true;
  }
  return false;
}

/**
 * Decide whether to run a pass in flip mode.
 * @param {object} o
 * @param {number[]} o.azimuths predicted azimuth samples for the pass (AOS→LOS)
 * @param {number}   o.stopAz   rotator stop azimuth (0 = north stop, 180 = south stop)
 * @param {number}   o.maxEl    rotator's elevation travel (90 = normal, 180 = flip capable)
 * @returns {{flip:boolean, crossesStop:boolean}}
 */
export function decideFlip({ azimuths, stopAz = 0, maxEl = 90 } = {}) {
  const crossesStop = pathCrossesStop(azimuths, stopAz);
  const flipCapable = Number(maxEl) >= 180;
  return { flip: crossesStop && flipCapable, crossesStop };
}

/** Convert true az/el into rotator coordinates, applying the flip if set. */
export function toRotatorCoords(az, el, flip = false) {
  const a = wrap360(az);
  const e = Math.max(0, Number(el) || 0);
  if (!flip) return { az: a, el: e };
  return { az: wrap360(a + 180), el: Math.min(180, 180 - e) };
}

/**
 * Decide whether a command should go out this tick.
 * @param {object} o
 * @param {{az:number, el?:number}} o.target     desired rotator coordinates
 * @param {{az:number, el?:number}|null} o.lastCommand what we last sent
 * @param {{az:number|null, el?:number|null}|null} o.current rotator's reported position
 * @param {number} o.stepDeg   minimum movement worth a command
 * @param {number} o.now       ms
 * @param {number} o.lastSentAt ms of the last command (0 = never)
 * @param {number} o.minIntervalMs
 * @returns {{send:boolean, reason:string}}
 */
export function planRotatorCommand({
  target,
  lastCommand = null,
  current = null,
  stepDeg = DEFAULT_STEP_DEG,
  now = Date.now(),
  lastSentAt = 0,
  minIntervalMs = MIN_COMMAND_INTERVAL_MS,
} = {}) {
  if (!target || !Number.isFinite(target.az)) return { send: false, reason: 'no-target' };
  if (now - lastSentAt < minIntervalMs) return { send: false, reason: 'rate-limit' };
  const step = clampStep(stepDeg);

  // Compare against where the rotator actually is when we know it; a
  // rotator that is still travelling to the last command should not be
  // re-commanded for a tiny change, so also require the delta to the last
  // command to exceed the step.
  const ref = Number.isFinite(current?.az) ? current : lastCommand;
  if (!ref || !Number.isFinite(ref.az)) return { send: true, reason: 'first' };

  const dAz = Math.abs(shortestDelta(ref.az, target.az));
  const refEl = Number.isFinite(ref.el) ? ref.el : null;
  const dEl = refEl == null || !Number.isFinite(target.el) ? 0 : Math.abs(target.el - refEl);
  if (dAz < step && dEl < step) return { send: false, reason: 'within-step' };

  if (lastCommand && Number.isFinite(lastCommand.az)) {
    const cAz = Math.abs(shortestDelta(lastCommand.az, target.az));
    const cEl =
      Number.isFinite(lastCommand.el) && Number.isFinite(target.el) ? Math.abs(target.el - lastCommand.el) : 0;
    if (cAz < step && cEl < step) return { send: false, reason: 'same-command' };
  }
  return { send: true, reason: 'moved' };
}

/**
 * Work out the auto-track target for a satellite at this instant.
 * @param {object} o
 * @param {{azimuth:number, elevation:number}|null} o.look current look angles
 * @param {{aosMs:number, aosAz:number, azimuths:number[]}|null} o.nextPass upcoming pass summary
 * @param {number} o.now ms
 * @param {number} o.prepositionMins minutes before AOS to swing to the AOS azimuth
 * @param {boolean} o.flip flip mode for this pass
 * @returns {{az:number, el:number, phase:'tracking'|'preposition'|'idle'}|null}
 */
export function satelliteTarget({
  look,
  nextPass,
  now = Date.now(),
  prepositionMins = DEFAULT_PREPOSITION_MINS,
  flip = false,
}) {
  if (look && Number.isFinite(look.elevation) && look.elevation >= 0 && Number.isFinite(look.azimuth)) {
    const c = toRotatorCoords(look.azimuth, look.elevation, flip);
    return { ...c, phase: 'tracking' };
  }
  if (nextPass && Number.isFinite(nextPass.aosMs) && Number.isFinite(nextPass.aosAz)) {
    const until = nextPass.aosMs - now;
    if (until > 0 && until <= Math.max(0, prepositionMins) * 60 * 1000) {
      const c = toRotatorCoords(nextPass.aosAz, 0, flip);
      return { ...c, phase: 'preposition' };
    }
  }
  return null;
}

export default {
  shortestDelta,
  longPathAz,
  pathCrossesStop,
  decideFlip,
  toRotatorCoords,
  planRotatorCommand,
  satelliteTarget,
};
