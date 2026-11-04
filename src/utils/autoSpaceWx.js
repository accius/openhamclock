/**
 * Auto space-weather map layer — pure decision logic.
 *
 * Given the current activity numbers (peak aurora probability %, D-RAP
 * highest affected frequency MHz) and the layers' current on/off state,
 * decide which layers to switch, with hysteresis so a value hovering at the
 * threshold does not flap the map every poll:
 *
 *   aurora: ON when peak ≥ 50 %,  OFF again only below 25 %
 *   drap:   ON when max ≥ 25 MHz, OFF again only below 15 MHz
 *
 * Layers the user has toggled by hand this session ("pinned") are never
 * touched. Everything here is synchronous and side-effect free; the hook in
 * src/hooks/app/useAutoSpaceWxLayers.js applies the result.
 */

export const AUTO_SPACE_WX_THRESHOLDS = {
  aurora: { on: 50, off: 25 }, // % probability
  drap: { on: 25, off: 15 }, // MHz
};

export const AUTO_SPACE_WX_LAYERS = ['aurora', 'drap'];

/**
 * Decide for one layer. Returns true (turn on), false (turn off) or null
 * (leave alone). `enabled` is the layer's current state.
 */
export function decideLayer(value, enabled, { on, off }) {
  if (!Number.isFinite(value)) return null;
  if (!enabled && value >= on) return true;
  if (enabled && value < off) return false;
  return null;
}

/**
 * @param {{ aurora?: number|null, drap?: number|null }} metrics
 * @param {{ aurora?: boolean, drap?: boolean }} enabled  current layer states
 * @param {Set<string>|string[]} pinned  layer ids the user toggled manually
 * @param {object} [thresholds]
 * @returns {{ id: string, enabled: boolean }[]} toggles to apply (may be empty)
 */
export function decideAutoLayers(metrics, enabled, pinned = new Set(), thresholds = AUTO_SPACE_WX_THRESHOLDS) {
  const pinnedSet = pinned instanceof Set ? pinned : new Set(pinned || []);
  const out = [];
  for (const id of AUTO_SPACE_WX_LAYERS) {
    if (pinnedSet.has(id)) continue;
    const want = decideLayer(metrics?.[id], !!enabled?.[id], thresholds[id]);
    if (want != null) out.push({ id, enabled: want });
  }
  return out;
}

/**
 * Reduce the /api/swpc/activity payload to the two numbers decideAutoLayers
 * wants. Missing halves become null (→ "leave alone").
 */
export function activityMetrics(payload) {
  return {
    aurora: Number.isFinite(payload?.aurora?.max) ? payload.aurora.max : null,
    drap: Number.isFinite(payload?.drap?.maxFreq) ? payload.drap.maxFreq : null,
  };
}
