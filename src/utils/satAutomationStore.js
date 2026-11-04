/**
 * Shared state for satellite automation (Doppler tuning + rotator
 * auto-track). A tiny external store rather than props: the controls live in
 * the Satellite Passes panel, the Rotator panel, the 3D telemetry window and
 * the Leaflet info window, while the hooks that actually talk to the rig and
 * rotator run once in DockableApp. useSyncExternalStore keeps every reader in
 * step without threading props through WorldMap → Globe3D.
 *
 * Persisted (localStorage): the operator's choices.
 * Live (memory only): what the hooks last computed, for the readouts.
 */
import { useSyncExternalStore } from 'react';

const LS_KEY = 'ohc_sat_automation';

export const ROTATOR_MODES = ['off', 'dx', 'sat'];

const defaults = () => ({
  satName: null, // satellite under automation (shared by Doppler and rotator)
  doppler: false, // Doppler tuning enabled
  transmitterBySat: {}, // satName → transmitter key
  rotatorMode: 'off', // 'off' | 'dx' | 'sat'
  longPath: false, // DX mode: point along the long path
});

let persisted = defaults();
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      persisted = { ...persisted, ...parsed };
      if (!ROTATOR_MODES.includes(persisted.rotatorMode)) persisted.rotatorMode = 'off';
      // Never resume moving hardware on reload without the operator asking.
      persisted.rotatorMode = 'off';
      persisted.doppler = false;
    }
  }
} catch {}

let state = {
  ...persisted,
  dopplerLive: null, // { downlinkNominalHz, downlinkCorrectedHz, uplinkNominalHz, uplinkCorrectedHz, mode, txLabel, lastSentHz, lastSentAt, active, reason }
  rotatorTarget: null, // { az, el, flip, phase, source: 'dx'|'sat', satName }
};

const listeners = new Set();

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

function persist() {
  try {
    const { satName, doppler, transmitterBySat, rotatorMode, longPath } = state;
    localStorage.setItem(LS_KEY, JSON.stringify({ satName, doppler, transmitterBySat, rotatorMode, longPath }));
  } catch {}
}

export function getSatAutomation() {
  return state;
}

export function setSatAutomation(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next || typeof next !== 'object') return;
  state = { ...state, ...next };
  if (!ROTATOR_MODES.includes(state.rotatorMode)) state.rotatorMode = 'off';
  persist();
  emit();
}

/** Live values from the hooks — not persisted, no-op when unchanged. */
export function setSatAutomationLive(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch || {})) {
    if (state[k] !== v) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emit();
}

export const setAutomationSat = (satName) => setSatAutomation({ satName: satName || null });
export const setDopplerEnabled = (on, satName) =>
  setSatAutomation((s) => ({ doppler: !!on, satName: satName ?? s.satName }));
export const setRotatorMode = (mode, satName) =>
  setSatAutomation((s) => ({
    rotatorMode: ROTATOR_MODES.includes(mode) ? mode : 'off',
    satName: mode === 'sat' && satName ? satName : s.satName,
  }));
export const setLongPath = (on) => setSatAutomation({ longPath: !!on });
export const rememberTransmitter = (satName, key) =>
  setSatAutomation((s) => ({ transmitterBySat: { ...s.transmitterBySat, [satName]: key } }));

export function subscribeSatAutomation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the whole automation state, re-rendering on any change. */
export function useSatAutomation() {
  return useSyncExternalStore(subscribeSatAutomation, getSatAutomation, getSatAutomation);
}

/** Test helper. */
export function _resetSatAutomation() {
  state = { ...defaults(), dopplerLive: null, rotatorTarget: null };
  emit();
}

export default useSatAutomation;
