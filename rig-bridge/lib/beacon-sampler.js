'use strict';
/**
 * beacon-sampler.js — turn a stream of KiwiSDR S-meter readings into
 * per-(beacon, band, slot) SNR measurements. Pure logic, no timers or I/O.
 *
 * Measurement model
 *   • The monitor listens to ONE band per 10-second IBP slot and rotates
 *     through the configured bands slot by slot (see bandForSlot). 18 slots
 *     and 5 bands are coprime, so every (beacon, band) pair is sampled once
 *     per 5 cycles (15 min) with all five bands enabled.
 *   • Within a slot only samples taken during seconds 1–9 count (second 0
 *     covers the retune + AGC settle, the last second the beacon's 0.1 W
 *     dash fading into nothing).
 *   • Signal level = 95th percentile of the window (the beacon's 100 W
 *     callsign + first dash dominate; a single static crash does not).
 *   • Noise floor per band = median of the quietest 20 % of all samples on
 *     that band over the last cycle (180 s), including samples from slots
 *     where nothing was heard. Falls back to the current slot's own
 *     quietest 20 % while the history is still filling.
 *   • snrDb = level − noise.
 */

const { IBP_BANDS, SLOT_MS, CYCLE_MS, slotAt, beaconFor, findBand } = require('./ibp-schedule');

const SAMPLE_WINDOW_START_MS = 1000;
const SAMPLE_WINDOW_END_MS = 9000;
const QUIET_FRACTION = 0.2;
const DEFAULT_RING_MAX = 5000; // ≈ 3.5 days of one measurement per slot

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function median(values) {
  if (!values || !values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return percentile(s, 0.5);
}

/** Median of the quietest `fraction` of samples (noise-floor estimator). */
function noiseFloor(samples, fraction = QUIET_FRACTION) {
  if (!samples || !samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const n = Math.max(1, Math.floor(s.length * fraction));
  return percentile(s.slice(0, n), 0.5);
}

/**
 * Resolve the user's band list to IBP band definitions, in IBP order.
 * Accepts labels ('20m'), MHz numbers or a comma-separated string; unknown
 * entries are dropped; empty → all five bands.
 */
function resolveBands(bands) {
  let list = bands;
  if (typeof list === 'string') list = list.split(/[\s,]+/).filter(Boolean);
  if (!Array.isArray(list) || !list.length) return [...IBP_BANDS];
  const wanted = new Set(list.map((b) => findBand(b)).filter(Boolean));
  const ordered = IBP_BANDS.filter((b) => wanted.has(b));
  return ordered.length ? ordered : [...IBP_BANDS];
}

/**
 * Which band to listen on during the slot starting at `slotStart`.
 * Uses the absolute slot index since the epoch so the rotation keeps its
 * phase across restarts, and so (slot, band) pairs cycle through all
 * combinations over bands.length cycles.
 */
function bandForSlot(slotStart, bands) {
  const list = bands && bands.length ? bands : IBP_BANDS;
  const absSlot = Math.floor(slotStart / SLOT_MS);
  return list[absSlot % list.length];
}

class BeaconSampler {
  /**
   * @param {Object} opts
   * @param {Array}  opts.bands     resolved IBP band definitions (resolveBands)
   * @param {number} opts.ringMax   max retained measurements
   */
  constructor({ bands, ringMax = DEFAULT_RING_MAX } = {}) {
    this.bands = resolveBands(bands);
    this.ringMax = ringMax;
    this.measurements = []; // oldest → newest
    this.current = null; // { slotStart, band, beacon, samples: [{t, dbm}] }
    this.bandHistory = new Map(); // band label → [{t, dbm}] (last cycle)
  }

  /** Band + beacon the monitor should be on for the slot containing `ms`. */
  targetFor(ms) {
    const slotStart = Math.floor(ms / SLOT_MS) * SLOT_MS;
    const band = bandForSlot(slotStart, this.bands);
    const beacon = beaconFor(slotAt(slotStart), band);
    return { slotStart, band, beacon };
  }

  /**
   * Begin a new slot. Finalizes the previous one (if any) and returns its
   * measurement, or null when the previous slot had no usable samples.
   */
  beginSlot(ms) {
    const target = this.targetFor(ms);
    if (this.current && this.current.slotStart === target.slotStart) return null;
    const finished = this.finishSlot();
    this.current = { ...target, samples: [] };
    return finished;
  }

  /** Feed one S-meter reading (dBm) taken at time `t` (Unix ms). */
  addSample(dbm, t = Date.now()) {
    if (!Number.isFinite(dbm)) return;
    if (!this.current) return;
    // Ignore readings that arrive after the slot ended (late frames) or
    // before it started (clock skew) — they belong to another beacon.
    const rel = t - this.current.slotStart;
    if (rel < 0 || rel >= SLOT_MS) return;
    this.current.samples.push({ t, dbm });

    const label = this.current.band.label;
    let hist = this.bandHistory.get(label);
    if (!hist) {
      hist = [];
      this.bandHistory.set(label, hist);
    }
    hist.push({ t, dbm });
    // Bound: drop anything older than one cycle.
    const cutoff = t - CYCLE_MS;
    let drop = 0;
    while (drop < hist.length && hist[drop].t < cutoff) drop++;
    if (drop) hist.splice(0, drop);
  }

  /** Noise floor for a band from the last cycle's history (dBm) or null. */
  noiseFor(bandLabel) {
    const hist = this.bandHistory.get(bandLabel);
    if (!hist || hist.length < 20) return null;
    return noiseFloor(hist.map((s) => s.dbm));
  }

  /**
   * Close the current slot and compute its measurement:
   *   { beacon, band, t, snrDb, levelDbm, noiseDbm, medianDbm, n }
   * Returns null (and records nothing) when fewer than 5 samples fell in
   * the 1–9 s window — a retune that never settled is not a "not heard".
   */
  finishSlot() {
    const cur = this.current;
    this.current = null;
    if (!cur) return null;
    const inWindow = cur.samples
      .filter((s) => {
        const rel = s.t - cur.slotStart;
        return rel >= SAMPLE_WINDOW_START_MS && rel < SAMPLE_WINDOW_END_MS;
      })
      .map((s) => s.dbm);
    if (inWindow.length < 5) return null;

    const sorted = [...inWindow].sort((a, b) => a - b);
    const levelDbm = percentile(sorted, 0.95);
    const medianDbm = percentile(sorted, 0.5);
    const noiseDbm = this.noiseFor(cur.band.label) ?? noiseFloor(sorted);
    const snrDb = Math.round((levelDbm - noiseDbm) * 10) / 10;

    const m = {
      beacon: cur.beacon.callsign,
      band: cur.band.label,
      mhz: cur.band.mhz,
      t: cur.slotStart,
      snrDb,
      levelDbm: Math.round(levelDbm * 10) / 10,
      noiseDbm: Math.round(noiseDbm * 10) / 10,
      medianDbm: Math.round(medianDbm * 10) / 10,
      n: inWindow.length,
    };
    this.measurements.push(m);
    if (this.measurements.length > this.ringMax) {
      this.measurements.splice(0, this.measurements.length - this.ringMax);
    }
    return m;
  }

  /** Measurements newer than `sinceMs`, optionally for one band label. */
  query({ sinceMs = 0, band = null, limit = 5000 } = {}) {
    const out = [];
    for (let i = this.measurements.length - 1; i >= 0 && out.length < limit; i--) {
      const m = this.measurements[i];
      if (m.t < sinceMs) break;
      if (band && m.band !== band) continue;
      out.push(m);
    }
    return out.reverse();
  }
}

module.exports = {
  BeaconSampler,
  bandForSlot,
  resolveBands,
  noiseFloor,
  median,
  percentile,
  SAMPLE_WINDOW_START_MS,
  SAMPLE_WINDOW_END_MS,
  QUIET_FRACTION,
};
