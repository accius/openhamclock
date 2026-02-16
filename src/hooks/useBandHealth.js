// src/hooks/useBandHealth.js
/**
 * useBandHealth
 *
 * Computes a "real-world" HF band health view from DX Cluster spot activity.
 * This is NOT VOACAP/MUF based — it reflects observed spots in a time window.
 *
 * Input is an array of DX cluster spots (from useDXClusterData().spots).
 */

import { useMemo } from "react";
import { getBandFromFreq, detectMode } from "../utils/callsign.js";

const DEFAULT_BANDS = [
  "160m","80m","60m","40m","30m","20m","17m","15m","12m","10m","6m","2m","70cm"
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// --- V2: Mode inference for "other" DX spots (frequency-only, Pi-safe) ---
//
// Goals:
// - Only run when the spot mode is missing/unusable.
// - Use frequency-only inference (no callsign lookups, no async).
// - Be conservative and explainable.
// - Provide a confidence value for potential weighting.

const CONF_HIGH = "high";
const CONF_MED = "medium";

function freqToMHz(rawFreq) {
  const f = parseFloat(rawFreq);
  if (!Number.isFinite(f) || f <= 0) return null;
  // DX feeds vary: MHz (14.074) or kHz (14074)
  return f > 1000 ? f / 1000 : f;
}

// Narrow "digital islands" (center freq) with small tolerance.
// Tolerance is intentionally small to avoid misclassification.
const ISLAND_TOL_MHZ = 0.003; // ~3 kHz
const ISLANDS = [
  // FT8
  { mhz: 3.573,  mode: "FT8" },
  { mhz: 7.074,  mode: "FT8" },
  { mhz: 10.136, mode: "FT8" },
  { mhz: 14.074, mode: "FT8" },
  { mhz: 18.100, mode: "FT8" },
  { mhz: 21.074, mode: "FT8" },
  { mhz: 24.915, mode: "FT8" },
  { mhz: 28.074, mode: "FT8" },
  // FT4
  { mhz: 3.575,  mode: "FT4" },
  { mhz: 7.0475, mode: "FT4" },
  { mhz: 10.140, mode: "FT4" },
  { mhz: 14.080, mode: "FT4" },
  { mhz: 18.104, mode: "FT4" },
  { mhz: 21.080, mode: "FT4" },
  { mhz: 24.919, mode: "FT4" },
  { mhz: 28.080, mode: "FT4" },
];

function inferModeFromFrequency(rawFreq) {
  const mhz = freqToMHz(rawFreq);
  if (!mhz) return null;

  // 1) High-confidence islands
  for (const isl of ISLANDS) {
    if (Math.abs(mhz - isl.mhz) <= ISLAND_TOL_MHZ) {
      return { mode: isl.mode, confidence: CONF_HIGH, inferredBy: "band-plan" };
    }
  }

  // 2) Coarse band-plan segments (medium confidence)
  const band = getBandFromFreq(mhz);
  if (!band) return null;

  switch (band) {
    case "160m":
      if (mhz >= 1.8 && mhz < 1.84) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 1.84 && mhz <= 2.0) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "80m":
      if (mhz >= 3.5 && mhz < 3.6) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 3.6 && mhz <= 4.0) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "40m":
      if (mhz >= 7.0 && mhz < 7.05) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 7.05 && mhz <= 7.3) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "30m":
      // 30m is mixed CW/digital; only islands are high-confidence.
      if (mhz >= 10.1 && mhz <= 10.15) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "20m":
      if (mhz >= 14.0 && mhz < 14.07) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 14.07 && mhz <= 14.35) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "17m":
      if (mhz >= 18.068 && mhz < 18.095) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 18.11 && mhz <= 18.168) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      // 18.095–18.110 is intentionally left ambiguous (digital/other)
      return null;

    case "15m":
      if (mhz >= 21.0 && mhz < 21.07) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 21.07 && mhz <= 21.45) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      return null;

    case "12m":
      if (mhz >= 24.89 && mhz < 24.915) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 24.93 && mhz <= 24.99) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      // 24.915–24.93 left ambiguous
      return null;

    case "10m":
      if (mhz >= 28.0 && mhz < 28.07) return { mode: "CW", confidence: CONF_MED, inferredBy: "band-plan" };
      if (mhz >= 28.3 && mhz <= 29.7) return { mode: "SSB", confidence: CONF_MED, inferredBy: "band-plan" };
      // 28.07–28.3 left ambiguous (digital/other)
      return null;

    default:
      // VHF/UHF and 60m: too region/usage-dependent; do not infer in V2.
      return null;
  }
}

/**
 * classifySpotMode
 * Returns the best-known mode for a spot:
 * - explicit mode (from comment) if present
 * - otherwise inferred mode (frequency-only) if high/medium confidence
 */
export function classifySpotMode(spot) {
  const explicit = normalizeMode(detectMode(spot?.comment) || null);
  if (explicit && explicit !== "ALL") {
    return { mode: explicit, inferred: false, confidence: null, inferredBy: null };
  }

  const inferred = inferModeFromFrequency(spot?.freq);
  if (inferred?.mode) {
    return { mode: inferred.mode, inferred: true, confidence: inferred.confidence, inferredBy: inferred.inferredBy };
  }

  return { mode: null, inferred: false, confidence: null, inferredBy: null };
}

function normalizeMode(mode) {
  if (!mode) return "ALL";
  const m = String(mode).toUpperCase();
  return m === "ALL" ? "ALL" : m;
}

function scoreToLevel(baseLevel, { diversity, trend }) {
  // diversity: uniques/spots (0..1)
  // trend: rising|steady|falling
  let level = baseLevel;

  // If it's mostly the same station being spotted repeatedly, treat as "busy but not diverse"
  if (diversity < 0.35 && baseLevel >= 2) level -= 1;

  // Trend nudges one step
  if (trend === "rising") level += 1;
  if (trend === "falling") level -= 1;

  return clamp(level, 0, 4);
}

// level 0..4
const LEVELS = [
  { key: "closed",    label: "CLOSED"    },
  { key: "quiet",     label: "QUIET"     },
  { key: "usable",    label: "USABLE"    },
  { key: "good",      label: "GOOD"      },
  { key: "excellent", label: "EXCELLENT" },
];

function baseLevelFromCount(spots) {
  if (spots <= 0) return 0;     // closed
  if (spots < 5)  return 1;     // quiet
  if (spots < 15) return 2;     // usable
  if (spots < 40) return 3;     // good
  return 4;                     // excellent
}

function computeTrend(spots, now, windowMs) {
  const mid = now - windowMs / 2;
  let older = 0;
  let newer = 0;

  for (const s of spots) {
    const ts = s.timestamp || now;
    if (ts < mid) older++;
    else newer++;
  }

  if (older === 0 && newer === 0) return "steady";
  // Rising if second half is 25%+ higher, falling if 25%+ lower
  if (newer > older * 1.25) return "rising";
  if (older > newer * 1.25) return "falling";
  return "steady";
}

export function useBandHealth(dxSpots = [], options = {}) {
  const {
    mode = "ALL",
    windowMinutes = 15,
    bands = DEFAULT_BANDS
  } = options;

  return useMemo(() => {
    const now = Date.now();
    const windowMs = Math.max(5, Number(windowMinutes) || 15) * 60_000;
    const cutoff = now - windowMs;

    const desiredMode = normalizeMode(mode);

    // Filter to window + mode.
    // V2: If the spot doesn't declare a mode, attempt a conservative frequency-based inference.
    // We keep the filtering logic simple and deterministic.
    const filtered = [];
    for (const s of dxSpots || []) {
      const ts = s?.timestamp || now;
      if (ts < cutoff) continue;

      if (desiredMode === "ALL") {
        filtered.push({ spot: s, weight: 1, inferred: false });
        continue;
      }

      const cls = classifySpotMode(s);
      if (!cls?.mode) continue;
      if (cls.mode !== desiredMode) continue;

      // Optional weighting to reduce inflation from broad, medium-confidence segments.
      // - HIGH confidence (digital islands) => full weight
      // - MED confidence (segments) => half weight
      const weight = cls.inferred ? (cls.confidence === CONF_MED ? 0.5 : 1) : 1;
      filtered.push({ spot: s, weight, inferred: !!cls.inferred });
    }

    // Group spots by band
    const byBand = new Map();
    for (const item of filtered) {
      const s = item.spot;
      const f = parseFloat(s?.freq); // kHz or MHz (getBandFromFreq handles both)
      if (!Number.isFinite(f)) continue;

      const band = getBandFromFreq(f);
      if (!band || !bands.includes(band)) continue;

      if (!byBand.has(band)) byBand.set(band, []);
      byBand.get(band).push(item);
    }

    // Build result for each band (always include all bands, even if 0)
    const results = bands.map(band => {
      const items = byBand.get(band) || [];
      const rawCount = items.length;

      let scoreCount = 0;
      let inferredCount = 0;
      const spots = [];
      for (const it of items) {
        scoreCount += Number(it.weight) || 0;
        if (it.inferred) inferredCount += 1;
        spots.push(it.spot);
      }

      const uniquesSet = new Set();
      for (const s of spots) {
        if (s?.call) uniquesSet.add(String(s.call).toUpperCase());
      }
      const uniques = uniquesSet.size;
      const diversity = rawCount > 0 ? uniques / rawCount : 0;

      const trend = computeTrend(spots, now, windowMs);
      const baseLevel = baseLevelFromCount(scoreCount);
      const level = scoreToLevel(baseLevel, { diversity, trend });

      return {
        band,
        mode: desiredMode,
        windowMinutes: Math.round(windowMs / 60000),
        count: rawCount,
        scoreCount: Number.isFinite(scoreCount) ? scoreCount : rawCount,
        inferredCount,
        uniques,
        diversity: Number.isFinite(diversity) ? diversity : 0,
        trend,
        level,
        activity: LEVELS[level].key,
        label: LEVELS[level].label
      };
    });

    return {
      updatedAt: now,
      mode: desiredMode,
      windowMinutes: Math.round(windowMs / 60000),
      bands: results
    };
  }, [dxSpots, mode, windowMinutes, bands]);
}

export default useBandHealth;
