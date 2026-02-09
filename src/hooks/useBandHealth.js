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

    // Filter to window + mode
    const filtered = (dxSpots || []).filter(s => {
      const ts = s?.timestamp || now;
      if (ts < cutoff) return false;

      if (desiredMode === "ALL") return true;

      const m = detectMode(s?.comment) || null;
      return m === desiredMode;
    });

    // Group spots by band
    const byBand = new Map();
    for (const s of filtered) {
      const f = parseFloat(s?.freq); // kHz or MHz (getBandFromFreq handles both)
      if (!Number.isFinite(f)) continue;

      const band = getBandFromFreq(f);
      if (!band || !bands.includes(band)) continue;

      if (!byBand.has(band)) byBand.set(band, []);
      byBand.get(band).push(s);
    }

    // Build result for each band (always include all bands, even if 0)
    const results = bands.map(band => {
      const spots = byBand.get(band) || [];
      const count = spots.length;

      const uniquesSet = new Set();
      for (const s of spots) {
        if (s?.call) uniquesSet.add(String(s.call).toUpperCase());
      }
      const uniques = uniquesSet.size;
      const diversity = count > 0 ? uniques / count : 0;

      const trend = computeTrend(spots, now, windowMs);
      const baseLevel = baseLevelFromCount(count);
      const level = scoreToLevel(baseLevel, { diversity, trend });

      return {
        band,
        mode: desiredMode,
        windowMinutes: Math.round(windowMs / 60000),
        count,
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
