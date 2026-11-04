/**
 * Reachable Winlink gateways — pure logic behind the Winlink panel's
 * "Reachable" view, the Winlink Gateways map layer's reachability
 * colouring and the EmComm layout's gateway list.
 *
 * The question answered: "which RMS gateways can I reach on HF right now?"
 * For every HF gateway within range that is on the air at the display hour
 * we run ONE P.533 path prediction per required-SNR group (DE → gateway,
 * display-time UTC hour, the gateway's own published frequencies) and
 * classify the result. VHF/UHF gateways are not modelled — they are ranked
 * by distance with a line-of-sight hint.
 *
 * Everything here is synchronous and side-effect free except runBatched,
 * a generic concurrency-limited async pool with cancellation. The shared
 * runner (services/winlinkReachStore.js) owns the engine, cache and state.
 */
import { maidenheadToLatLon, calculateDistance, calculateBearing } from './geo.js';
import { P533_REF_SNR_DB, MODE_ADVANTAGE_DB } from './propagationAdjust.js';
import { winlinkModeFamily, winlinkModeLabel } from './winlinkModes.js';

// ── Tunables ───────────────────────────────────────────────────────────────

/** Default search radius for HF gateways. */
export const DEFAULT_RANGE_KM = 3000;
/** Range choices offered in the panel. */
export const RANGE_OPTIONS_KM = [500, 1000, 2000, 3000, 5000];
/** VHF/UHF gateways further away than this are not listed at all. */
export const PACKET_RANGE_KM = 300;
/** Hard cap on engine runs per refresh (browser WASM engine). */
export const MAX_PREDICTIONS_PER_REFRESH = 60;
/** Lower cap when the REST fallback is doing the work — it is a shared server. */
export const MAX_PREDICTIONS_REST = 20;
/** Parallel in-flight predictions (the worker is a singleton, this just pipelines). */
export const PREDICT_CONCURRENCY = 2;
/** Parallel in-flight REST fallback calls — the server allows 3 upstream; leave room. */
export const REST_CONCURRENCY = 1;
/**
 * Distance rings for sharing the prediction cap: each refresh takes gateways
 * round-robin from <500, <1000, <2000 km and beyond, nearest first in each.
 */
export const DISTANCE_RINGS_KM = [500, 1000, 2000, Infinity];
/** Distinct frequencies passed to one engine run for one gateway. */
export const MAX_FREQS_PER_JOB = 8;
/** Entries kept in the per-gateway+hour result cache. */
export const CACHE_MAX_ENTRIES = 1500;
/** Below 30 MHz is HF for our purposes (Winlink lists 60 m, MARS and 10 m channels too). */
export const HF_MAX_HZ = 30e6;
/**
 * Lowest believable HF channel. The live channel report carries a handful of
 * typos (145 Hz, 10146 Hz, 144000 Hz…); anything below 1.6 MHz is not a
 * real HF Winlink channel and is ignored.
 */
export const HF_MIN_HZ = 1.6e6;

// ── Status thresholds ──────────────────────────────────────────────────────

/**
 * Default status cut-offs; the Reachable view lets the operator change them.
 *   goodReliability      — reliability (%) at or above which a path is Good
 *   marginalReliability  — reliability (%) at or above which it is Marginal
 *   marginalSnrMargin    — median SNR margin (dB) over the mode's floor that
 *                          still counts as Marginal when reliability is lower
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  goodReliability: 50,
  marginalReliability: 20,
  marginalSnrMargin: -6,
});

/** Clamp/normalise user-entered thresholds; anything invalid falls back to the default. */
export function normalizeThresholds(t = {}) {
  const num = (v, d, lo, hi) => {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return d;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  // No cross-clamping (marginal ≤ good): classifyStatus checks Good first, and
  // clamping would rewrite the other field while the operator is mid-typing.
  return {
    goodReliability: num(t.goodReliability, DEFAULT_THRESHOLDS.goodReliability, 1, 99),
    marginalReliability: num(t.marginalReliability, DEFAULT_THRESHOLDS.marginalReliability, 0, 99),
    marginalSnrMargin: num(t.marginalSnrMargin, DEFAULT_THRESHOLDS.marginalSnrMargin, -30, 30),
  };
}

export const STATUS_ORDER = { good: 0, marginal: 1, closed: 2, offair: 3, unknown: 4 };

export const STATUS_COLORS = {
  good: '#22c55e',
  marginal: '#f59e0b',
  closed: '#ef4444',
  offair: '#8b5cf6',
  unknown: '#6b7280',
};

/**
 * Classify one predicted circuit.
 *   good      — reliability ≥ goodReliability
 *   marginal  — reliability ≥ marginalReliability, or median SNR margin ≥ marginalSnrMargin
 *   closed    — everything else
 *   unknown   — no prediction (engine failed / not run)
 * Off-the-air channels never reach this function — see summarizeGateway.
 */
export function classifyStatus(reliability, snrMargin = null, thresholds = DEFAULT_THRESHOLDS) {
  if (!Number.isFinite(reliability)) return 'unknown';
  if (reliability >= thresholds.goodReliability) return 'good';
  if (reliability >= thresholds.marginalReliability) return 'marginal';
  if (Number.isFinite(snrMargin) && snrMargin >= thresholds.marginalSnrMargin) return 'marginal';
  return 'closed';
}

// ── Mode → required SNR (one table, with sources) ──────────────────────────

/**
 * Required SNR per Winlink mode code — the SNR at which the mode can still
 * HOLD a link (its slowest speed level), in dB in the 3 kHz reference noise
 * bandwidth the P.533 engine uses (Path.BW 3000). It is passed to the engine
 * as Path.SNRr, so "reliability" reads as "share of days this hour the
 * circuit can hold a link in this mode", and the SNR margin is the headroom
 * above that floor (room for the faster speed levels).
 *
 * Sources (fetched 2026-10-15):
 *   [IONOS] T. Whiteside N5TW, "A comparison of Winlink digital mode
 *           performance based on simulation results using the Teensy IONOS
 *           Simulator", Winlink.org, 18 May 2020 — SCS DR-7800 modems and
 *           sound-card modes through a Watterson-model simulator, SNR in the
 *           simulator's 3 kHz bandwidth. Page 3 (wide modes, WGN): "All modes
 *           were able to operate over this range" 20 dB → −5 dB for PACTOR 4,
 *           VARA HF (2300), PACTOR 3, ARDOP and WINMOR; page 4 (500 Hz modes,
 *           WGN): VARA 500, PACTOR 2, ARDOP 500 and WINMOR 500 all still pass
 *           data at −5 dB. −5 dB was the LOWEST SNR TESTED, so these are
 *           conservative floors (the true floor may be lower). The "Take Two"
 *           edition (5 Jul 2020, noise tracking and multipath corrected with
 *           SCS's input) again ran 20 → −5 dB: "All modes were able to
 *           operate over this range". "Take Three" (2 Nov 2020, further
 *           re-calibrated) tested 30 → 0 dB; all modes still operated at 0 dB.
 *   [RPR]   Wavecom "Robust Packet Radio (RPR)" protocol sheet (decoder
 *           vendor documenting SCS's mode): "Signal-to-noise ratio typ. 7 to
 *           10 dB with AWGN-channel (3 Khz bandwidth)". The lower end, +7 dB,
 *           is used.
 *   [ARDOP] R. Muething KN6KB, M. Pitts N8OHU, J. Wiseman GM8BPQ, "ARDOP",
 *           ARRL/TAPR DCC 2015, Fig. 3 p.101: ARQ still passes data at −5 dB
 *           S:N (3 kHz) for 200 Hz and 2000 Hz bandwidth.
 *   [P4]    SCS P4dragon DR-7800 manual §3.3: "Minimum SNR: −19 dB required
 *           for maintaining a connection on AWGN channel". Applied to
 *           PACTOR-4-capable gateways (codes 17–19) ONLY when the operator
 *           says their modem supports PACTOR 4 (a link runs the best level
 *           both ends support); otherwise those gateways are scored as P3.
 *   [VARA]  EA5HVK, "VARA HF Modem Specification" rev 2.0.0 (2018) lists the
 *           speed levels but no SNR thresholds; the developer's only figure
 *           is full speed (5629 bps) at "S/N 14.5 dB @ 4 kHz"
 *           (rosmodem.wordpress.com, 2017-09-03) — a ceiling, not a floor.
 *
 * Still estimates (no published or measured figure found, searched again
 * 2026-10-15): VARA 2750 (in none of the three IONOS editions — scored like
 * VARA 2300), PACTOR 1-only operation (code 12 gateways also speak P2,
 * which was measured), and HF AX.25 (300 bd AFSK, no FEC, assumed +5 dB).
 *
 * `basis`: 'measured' (independent simulator measurement), 'vendor'
 * (manufacturer's specification) or 'estimate'.
 */
export const PACTOR4_FLOOR_DB = -19; // [P4]
const PACTOR4_CODES = new Set([17, 18, 19]);

const SRC_IONOS = 'Winlink IONOS simulator comparison, N5TW, May & Jul 2020 (lowest SNR tested)';
const SRC_ARDOP = 'ARDOP, TAPR DCC 2015 Fig. 3; Winlink IONOS comparison, May 2020';
const SRC_P4 = 'SCS P4dragon DR-7800 manual §3.3';
const HF_PACKET = { floorDb: 5, basis: 'estimate', source: 'HF AX.25 300 bd AFSK, no FEC — assumed' };

export const WINLINK_MODE_SNR = Object.freeze({
  // Packet (AX.25) — only reaches the engine when published below 30 MHz
  0: HF_PACKET,
  1: HF_PACKET,
  2: HF_PACKET,
  3: HF_PACKET,
  5: HF_PACKET,
  // PACTOR — P2 and P3 measured in [IONOS]; P4-capable codes use P3 unless the operator has P4
  12: { floorDb: -5, basis: 'measured', source: `PACTOR 2: ${SRC_IONOS}` },
  13: { floorDb: -5, basis: 'measured', source: `PACTOR 3: ${SRC_IONOS}` },
  14: { floorDb: -5, basis: 'measured', source: `PACTOR 2: ${SRC_IONOS}` },
  15: { floorDb: -5, basis: 'measured', source: `PACTOR 3: ${SRC_IONOS}` },
  16: { floorDb: -5, basis: 'measured', source: `PACTOR 3: ${SRC_IONOS}` },
  17: { floorDb: -5, basis: 'measured', source: `PACTOR 3 (no P4 modem): ${SRC_IONOS}` },
  18: { floorDb: -5, basis: 'measured', source: `PACTOR 3 (no P4 modem): ${SRC_IONOS}` },
  19: { floorDb: -5, basis: 'measured', source: `PACTOR 3 (no P4 modem): ${SRC_IONOS}` },
  // WINMOR (retired) — measured at 1600 and 500 Hz
  22: { floorDb: -5, basis: 'measured', source: `WINMOR: ${SRC_IONOS}` },
  // Robust Packet — no figure
  30: { floorDb: 7, basis: 'vendor', source: 'Robust Packet: Wavecom RPR sheet, typ. 7–10 dB AWGN in 3 kHz' },
  // ARDOP
  41: { floorDb: -5, basis: 'measured', source: SRC_ARDOP },
  42: { floorDb: -5, basis: 'measured', source: SRC_ARDOP },
  43: { floorDb: -5, basis: 'measured', source: SRC_ARDOP },
  // VARA HF
  50: { floorDb: -5, basis: 'measured', source: `VARA 2300: ${SRC_IONOS}` },
  53: { floorDb: -5, basis: 'measured', source: `VARA 500: ${SRC_IONOS}` },
  54: { floorDb: -5, basis: 'estimate', source: 'VARA 2750: not tested — scored like VARA 2300' },
});

const PACTOR4_ROW = Object.freeze({ floorDb: PACTOR4_FLOOR_DB, basis: 'vendor', source: `PACTOR 4: ${SRC_P4}` });

/**
 * Table row for a mode code. `pactor4` (the operator's modem supports
 * PACTOR 4) switches P4-capable gateways to the SCS figure. Unknown codes
 * are scored like SSB voice. `estimated` mirrors basis === 'estimate'.
 */
export function modeSnrInfo(modeInt, { pactor4 = false } = {}) {
  const row =
    pactor4 && PACTOR4_CODES.has(modeInt)
      ? PACTOR4_ROW
      : WINLINK_MODE_SNR[modeInt] || {
          floorDb: P533_REF_SNR_DB,
          basis: 'estimate',
          source: 'unknown mode — scored like SSB voice',
        };
  return { ...row, estimated: row.basis === 'estimate' };
}

/** Required SNR (dB, 3 kHz) the engine should score a channel's mode against. */
export function winlinkRequiredSNR(modeInt, opts) {
  return modeSnrInfo(modeInt, opts).floorDb;
}

/**
 * Closest conventional propagation mode for the REST fallback, whose
 * /api/propagation endpoint only knows the standard mode table: the mode
 * whose advantage over SSB is nearest to what this required SNR implies.
 */
export function restFallbackMode(requiredSNR) {
  const wanted = P533_REF_SNR_DB - (Number.isFinite(requiredSNR) ? requiredSNR : P533_REF_SNR_DB);
  let best = 'SSB';
  let bestD = Infinity;
  for (const [mode, adv] of Object.entries({ SSB: 0, ...MODE_ADVANTAGE_DB })) {
    const d = Math.abs(adv - wanted);
    if (d < bestD) {
      bestD = d;
      best = mode;
    }
  }
  return best;
}

// ── Operating hours ────────────────────────────────────────────────────────

/**
 * Parse a gateway's published operating hours (the channel report's
 * `Hours` field, UTC) into a 24-slot boolean mask, or null when the text
 * does not say anything usable (treated as "always on").
 *
 * Formats seen in the live list (Oct 2026, 4,780 channels): "00-23" (95 %),
 * "HH-HH" with UTC wrap-around ("06-04", "23-11"), "H-HH", comma lists
 * ("00-02,13-23"), "08:00-22:00", "0800/2000", "0-24", plus a few
 * free-text values ("Other", "1/7", "12/7", "23/7").
 *
 * Whole-hour ranges are INCLUSIVE of the end hour ("00-23" is all day,
 * "13-13" is the 13z hour). Ranges written with minutes ("08:00-22:00",
 * "0800/2000") end at that minute, so the end hour is excluded when the
 * minutes are 00. "24" means end of day.
 */
export function parseOperatingHours(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;
  const mask = new Array(24).fill(false);
  let any = false;
  for (const raw of s.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    // HH:MM-HH:MM, HHMM-HHMM, HHMM/HHMM (minute precision)
    let m = part.match(/^(\d{1,2}):?(\d{2})\s*[-/–]\s*(\d{1,2}):?(\d{2})$/);
    if (m && (part.includes(':') || part.length >= 9)) {
      const sh = Number(m[1]);
      const sm = Number(m[2]);
      const eh = Number(m[3]);
      const em = Number(m[4]);
      if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
      const start = sh % 24;
      // end is exclusive at the minute → last hour touched
      let endIncl = em > 0 ? eh : eh - 1;
      if (eh === 24 && em === 0) endIncl = 23;
      endIncl = ((endIncl % 24) + 24) % 24;
      if (sh === eh && sm === em) {
        mask.fill(true);
        any = true;
        continue;
      }
      fillRange(mask, start, endIncl);
      any = true;
      continue;
    }
    // HH-HH (whole hours, inclusive)
    m = part.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > 24 || b > 24) return null;
      // "0-24" / "00-23" / "23-22" all come out as the full day via wrap-around.
      fillRange(mask, a % 24, b === 24 ? 23 : b);
      any = true;
      continue;
    }
    // "24/7", "24", "24H" → all day; anything else is not understood
    if (/^24\s*(\/\s*7|h(rs?)?)?$/i.test(part)) {
      mask.fill(true);
      any = true;
      continue;
    }
    return null;
  }
  return any ? mask : null;
}

function fillRange(mask, start, endIncl) {
  let h = start;
  for (let i = 0; i < 24; i++) {
    mask[h] = true;
    if (h === endIncl) return;
    h = (h + 1) % 24;
  }
}

/**
 * What a gateway's published hours tell us:
 *   { kind: 'none' }                       — nothing published
 *   { kind: 'all' }                        — on the air all day
 *   { kind: 'partial', hoursPerDay }       — a schedule we can apply
 *   { kind: 'unknown', hoursPerDay?, text } — published, but which hours is not stated
 *
 * "N/7" follows the "24/7" idiom: N hours a day, 7 days a week. "24/7" is
 * all day; any other N (the live list has "1/7", "12/7", "23/7") says how
 * MANY hours, not WHICH, so the gateway may or may not be up at a given hour.
 * Other free text ("Other") is unknown too. Unknown never makes a gateway
 * Off the air — it gets an "hours unknown" badge instead.
 */
export function describeHours(text) {
  if (text == null || String(text).trim() === '') return { kind: 'none' };
  const s = String(text).trim();
  const perWeek = s.match(/^(\d{1,2})\s*\/\s*7$/);
  if (perWeek) {
    const n = Number(perWeek[1]);
    if (n >= 24) return { kind: 'all', hoursPerDay: 24 };
    if (n >= 1) return { kind: 'unknown', hoursPerDay: n, text: s };
  }
  const mask = parseOperatingHours(s);
  if (!mask) return { kind: 'unknown', text: s };
  const on = mask.filter(Boolean).length;
  return on === 24 ? { kind: 'all', hoursPerDay: 24 } : { kind: 'partial', hoursPerDay: on };
}

/** Is a channel with these published hours on the air at this UTC hour? Unknown hours → true. */
export function isOnAirAt(hoursText, utcHour) {
  const mask = parseOperatingHours(hoursText);
  if (!mask || !Number.isInteger(utcHour)) return true;
  return mask[((utcHour % 24) + 24) % 24];
}

// ── Gateway shaping ────────────────────────────────────────────────────────

/** True for the integer mode codes that are packet-family (AX.25 / Robust Packet). */
export function isPacketMode(modeInt) {
  const fam = winlinkModeFamily(modeInt);
  return !!fam && fam.id === 'packet';
}

/** True for VARA FM / VARA FM WIDE — VHF/UHF VARA, modelled like packet. */
export function isVaraFm(modeInt) {
  return modeInt === 51 || modeInt === 52;
}

export function isHfFrequency(freqHz) {
  return Number.isFinite(freqHz) && freqHz >= HF_MIN_HZ && freqHz < HF_MAX_HZ;
}

/**
 * An HF-modelled channel: anything published between 1.6 and 30 MHz except
 * VARA FM. Robust Packet and the odd HF AX.25 channel are HF circuits too,
 * so they go through the engine like Pactor/VARA.
 */
export function isHfChannel(channel) {
  if (!channel) return false;
  if (!isHfFrequency(channel.frequency)) return false;
  return !isVaraFm(channel.mode);
}

/** A VHF/UHF channel (≥ 30 MHz) — ranked by distance, never predicted. */
export function isVhfChannel(channel) {
  return !!channel && Number.isFinite(channel.frequency) && channel.frequency >= HF_MAX_HZ;
}

/**
 * Group raw channel rows (server proxy camelCase or rig-bridge PascalCase)
 * into one entry per callsign with a channels[] array. Rows without a
 * decodable grid square are dropped.
 */
export function aggregateGateways(rows) {
  const byCall = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const callsign = r.callsign || r.Callsign;
    const gridsquare = r.gridsquare || r.Gridsquare;
    if (!callsign || !gridsquare) continue;
    let entry = byCall.get(callsign);
    if (!entry) {
      const pos = maidenheadToLatLon(gridsquare);
      if (!pos) continue;
      entry = { callsign, gridsquare, lat: pos.lat, lon: pos.lon, channels: [] };
      byCall.set(callsign, entry);
    }
    const mode = Number(r.mode ?? r.Mode);
    entry.channels.push({
      frequency: Number(r.frequency ?? r.Frequency),
      mode: Number.isFinite(mode) ? mode : -1,
      modeLabel: winlinkModeLabel(mode),
      hours: r.hours ?? r.Hours ?? r.OperatingHours ?? null,
      baud: r.baud ?? r.Baud ?? null,
      serviceCode: r.serviceCode || r.ServiceCode || 'PUBLIC',
    });
  }
  return [...byCall.values()];
}

const BAND_EDGES_MHZ = [
  ['160m', 1.8, 2.0],
  ['80m', 3.5, 4.0],
  ['60m', 5.25, 5.45],
  ['40m', 7.0, 7.3],
  ['30m', 10.1, 10.15],
  ['20m', 14.0, 14.35],
  ['17m', 18.068, 18.168],
  ['15m', 21.0, 21.45],
  ['12m', 24.89, 24.99],
  ['10m', 28.0, 29.7],
  ['6m', 50, 54],
  ['2m', 144, 148],
  ['1.25m', 219, 225],
  ['70cm', 420, 450],
];

/** Amateur band label for a frequency in Hz, or null outside the ham bands (MARS etc.). */
export function freqHzToBand(freqHz) {
  const mhz = freqHz / 1e6;
  for (const [band, lo, hi] of BAND_EDGES_MHZ) {
    if (mhz >= lo && mhz <= hi) return band;
  }
  return null;
}

/**
 * Bands the server's /api/propagation endpoint reports, with the centre
 * frequency (MHz) used to pick the nearest one for an off-band channel.
 */
export const SERVER_BANDS = [
  ['160m', 1.9],
  ['80m', 3.75],
  ['40m', 7.15],
  ['30m', 10.125],
  ['20m', 14.175],
  ['17m', 18.118],
  ['15m', 21.225],
  ['12m', 24.94],
  ['10m', 28.85],
];

/**
 * Nearest server-reported band for an HF frequency. In-band channels map
 * exactly; 60 m and MARS / out-of-band channels map to the nearest band by
 * log-frequency (propagation scales with frequency ratio, not difference)
 * and are flagged approximate. VHF/UHF → null.
 */
export function nearestServerBand(freqHz) {
  if (!isHfFrequency(freqHz)) return null;
  const exact = freqHzToBand(freqHz);
  if (exact && SERVER_BANDS.some(([b]) => b === exact)) return { band: exact, approx: false };
  const lf = Math.log(freqHz / 1e6);
  let best = null;
  let bestD = Infinity;
  for (const [band, mhz] of SERVER_BANDS) {
    const d = Math.abs(Math.log(mhz) - lf);
    if (d < bestD) {
      bestD = d;
      best = band;
    }
  }
  return { band: best, approx: true };
}

/**
 * Dial (VFO) frequency for a channel — verified against Pat
 * (github.com/la5nta/pat @2e6a8d1, app/freq.go `Frequency.Dial`): Winlink
 * publishes the channel CENTRE frequency; Pat subtracts 1500 Hz for modes
 * containing "pactor", "ardop" or "vara", leaves anything containing "fm"
 * (VARA FM, ARDOP FM) unchanged, and applies NO offset to packet (AX.25 or
 * Robust Packet). WINMOR is no longer in Pat; it used the same 1500 Hz
 * centre convention as ARDOP, so it keeps the offset here.
 */
export function dialFrequencyHz(channel) {
  if (!channel || !Number.isFinite(channel.frequency)) return null;
  if (isVaraFm(channel.mode)) return channel.frequency;
  const fam = winlinkModeFamily(channel.mode);
  if (!fam || fam.id === 'packet') return channel.frequency;
  return channel.frequency - 1500;
}

/**
 * Pat connect URL for a gateway channel, built exactly like Pat's own RMS
 * list (github.com/la5nta/pat @2e6a8d1, app/rmslist.go `toURL`,
 * `addBandwidth`, `toTransport`):
 *   `<transport>:///<CALL>?freq=<dial kHz>` — freq is the DIAL frequency in
 *   kHz printed as the shortest number (Go %v: "7099.7", "14107", "145050");
 *   ARDOP adds bw=<width>MAX, VARA HF adds bw=500|2300|2750 (2300 when the
 *   mode says just "VARA"); VARA FM never sets bw. When bw is present Go's
 *   url.Values.Encode() sorts the keys, so it comes first.
 * Transports: packet → ax25, VARA FM → varafm, VARA → varahf, ardop, pactor.
 * Returns null for WINMOR (no Pat transport) and Robust Packet (Pat maps it
 * to ax25 with a "bug: we really don't know which transport" note — it needs
 * an SCS modem, so we do not offer a string that cannot work).
 */
export function patConnectUrl(callsign, channel) {
  if (!callsign || !channel) return null;
  const call = String(callsign).toUpperCase();
  const fam = winlinkModeFamily(channel.mode);
  if (!fam || channel.mode === 30) return null;
  const dial = dialFrequencyHz(channel);
  if (!Number.isFinite(dial)) return null;
  const kHz = String(Math.round(dial) / 1000);
  let transport;
  let bw = '';
  if (fam.id === 'packet') transport = 'ax25';
  else if (isVaraFm(channel.mode)) transport = 'varafm';
  else if (fam.id === 'vara') {
    transport = 'varahf';
    const width = String(winlinkModeLabel(channel.mode)).split(/\s+/)[1];
    bw = width || '2300';
  } else if (fam.id === 'ardop') {
    transport = 'ardop';
    const width = String(winlinkModeLabel(channel.mode)).split(/\s+/)[1];
    bw = width ? `${width}MAX` : '';
  } else if (fam.id === 'pactor') transport = 'pactor';
  else return null;
  const query = bw ? `bw=${bw}&freq=${kHz}` : `freq=${kHz}`;
  return `${transport}:///${call}?${query}`;
}

/**
 * Rig mode to request when tuning to a channel. Winlink HF is always upper
 * sideband data regardless of band (the 7 MHz LSB convention is for voice);
 * VHF/UHF channels are FM.
 */
export function rigModeForChannel(channel) {
  if (!channel || !isHfFrequency(channel.frequency)) return 'FM';
  if (isVaraFm(channel.mode)) return 'FM';
  return 'DATA-USB';
}

/** Line-of-sight hint for a VHF/UHF gateway, by great-circle distance. */
export function losHint(distanceKm) {
  if (!Number.isFinite(distanceKm)) return 'unknown';
  if (distanceKm <= 40) return 'los';
  if (distanceKm <= 120) return 'extended';
  return 'beyond';
}

// ── Candidate selection ────────────────────────────────────────────────────

function roundMHz(freqHz) {
  return Math.round(freqHz / 1000) / 1000; // 1 kHz resolution, in MHz
}

/**
 * Pick which gateways to predict. Returns:
 *   hf      — gateways with at least one HF channel within rangeKm, nearest
 *             first, capped at maxPredictions JOBS. A job is one engine run:
 *             (gateway, requiredSNR) → its frequency list. Channels that are
 *             off the air at `hour` get no job (offAirChannels); a gateway
 *             with every HF channel off the air costs nothing.
 *   packet  — VHF/UHF gateways within PACKET_RANGE_KM, nearest first, with a
 *             line-of-sight hint and an on-air flag. Never predicted.
 *   truncated — HF gateways inside range that did not fit under the cap.
 */
export function selectCandidates(
  gateways,
  de,
  {
    rangeKm = DEFAULT_RANGE_KM,
    maxPredictions = MAX_PREDICTIONS_PER_REFRESH,
    maxFreqs = MAX_FREQS_PER_JOB,
    hour = null,
    pactor4 = false,
  } = {},
) {
  const out = { hf: [], packet: [], truncated: 0, totalJobs: 0 };
  if (!de || !Number.isFinite(de.lat) || !Number.isFinite(de.lon)) return out;

  const hf = [];
  const packet = [];
  for (const gw of gateways || []) {
    if (!gw || !Number.isFinite(gw.lat) || !Number.isFinite(gw.lon)) continue;
    const distanceKm = calculateDistance(de.lat, de.lon, gw.lat, gw.lon);
    const bearing = Math.round(calculateBearing(de.lat, de.lon, gw.lat, gw.lon));
    const hfChannels = (gw.channels || []).filter(isHfChannel);
    const vhfChannels = (gw.channels || []).filter(isVhfChannel);

    if (hfChannels.length && distanceKm <= rangeKm) {
      const onAir = hfChannels.filter((c) => isOnAirAt(c.hours, hour));
      const offAirChannels = hfChannels.filter((c) => !isOnAirAt(c.hours, hour));
      // Group by required SNR so each engine run scores against one threshold.
      const bySnr = new Map();
      for (const c of onAir) {
        const snr = winlinkRequiredSNR(c.mode, { pactor4 });
        if (!bySnr.has(snr)) bySnr.set(snr, { requiredSNR: snr, channels: [], freqsMHz: [] });
        const job = bySnr.get(snr);
        job.channels.push(c);
        const f = roundMHz(c.frequency);
        if (!job.freqsMHz.includes(f) && job.freqsMHz.length < maxFreqs) job.freqsMHz.push(f);
      }
      const jobs = [...bySnr.values()].map((j) => ({ ...j, freqsMHz: j.freqsMHz.slice().sort((a, b) => a - b) }));
      hf.push({ gateway: gw, callsign: gw.callsign, distanceKm, bearing, channels: hfChannels, offAirChannels, jobs });
    }
    if (vhfChannels.length && distanceKm <= PACKET_RANGE_KM) {
      const sorted = vhfChannels.slice().sort((a, b) => a.frequency - b.frequency);
      packet.push({
        gateway: gw,
        callsign: gw.callsign,
        distanceKm,
        bearing,
        channels: sorted,
        los: losHint(distanceKm),
        onAir: sorted.some((c) => isOnAirAt(c.hours, hour)),
      });
    }
  }

  hf.sort((a, b) => a.distanceKm - b.distanceKm);
  packet.sort((a, b) => a.distanceKm - b.distanceKm);

  // Cap by jobs, keeping whole gateways; off-air-only gateways cost nothing.
  // The budget is shared round-robin across distance rings (nearest first
  // within each ring), so a dense local area cannot use it all up and the
  // list still covers the whole range.
  const rings = DISTANCE_RINGS_KM.map(() => []);
  for (const c of hf) {
    const i = DISTANCE_RINGS_KM.findIndex((edge) => c.distanceKm < edge);
    rings[i === -1 ? rings.length - 1 : i].push(c);
  }
  const ptr = rings.map(() => 0);
  let jobCount = 0;
  const kept = [];
  let truncated = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let r = 0; r < rings.length; r++) {
      while (ptr[r] < rings[r].length) {
        const c = rings[r][ptr[r]++];
        progressed = true;
        if (jobCount + c.jobs.length > maxPredictions) {
          truncated++;
          continue; // try the next gateway in this ring on this pass
        }
        jobCount += c.jobs.length;
        kept.push(c);
        break; // one gateway per ring per pass
      }
    }
  }
  kept.sort((a, b) => a.distanceKm - b.distanceKm);
  out.hf = kept;
  out.truncated = truncated;
  out.totalJobs = jobCount;
  out.packet = packet;
  return out;
}

// ── Cache keys & engine params ─────────────────────────────────────────────

/**
 * Cache key for one job. DE is rounded to 0.1° (~10 km, far below the
 * engine's resolution), SSN to the nearest 10 so a drifting daily index
 * does not invalidate everything each minute. Hour/month/year pin the run
 * to the display hour; power/antenna are the station settings that change
 * the circuit.
 */
export function cacheKey({ callsign, freqsMHz, requiredSNR, deLat, deLon, hour, month, year, ssn, power, antenna }) {
  const la = (Math.round(deLat * 10) / 10).toFixed(1);
  const lo = (Math.round(deLon * 10) / 10).toFixed(1);
  const s = Math.round((Number(ssn) || 0) / 10) * 10;
  const f = (freqsMHz || []).map((x) => x.toFixed(3)).join(',');
  return `${callsign}|${f}|${requiredSNR}|${la},${lo}|${year}-${month}-${hour}|${s}|${Number(power) || 100}|${antenna || 'isotropic'}`;
}

/** Hour key that changes once per UTC hour — the runner's recompute trigger. */
export function hourKeyFor(date = new Date()) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}T${date.getUTCHours()}`;
}

/**
 * Parameters for predictInWorker() for one job — the same call the
 * Prediction Check panel makes, with the gateway's own frequencies
 * instead of the fixed band list.
 */
export function buildPredictionParams(candidate, job, de, { hour, month, year, ssn, power, txGain }) {
  return {
    txLat: de.lat,
    txLon: de.lon,
    rxLat: candidate.gateway.lat,
    rxLon: candidate.gateway.lon,
    year,
    month,
    hour,
    ssn: Number.isFinite(ssn) ? ssn : 100,
    txPower: parseFloat(power) || 100,
    txGain: Number.isFinite(txGain) ? txGain : 0,
    requiredSNR: job.requiredSNR,
    frequencies: job.freqsMHz,
  };
}

/**
 * Engine-shaped result from a /api/propagation response for one job, at the
 * display hour: the endpoint returns all 24 hours (hourlyPredictions), so
 * the shifted hour is read straight from it. Off-band channels (60 m, MARS)
 * take the nearest band and are flagged approximate. Band-level only — no
 * SNR, so no SNR margin.
 */
export function restResultForJob(job, data, hour) {
  const frequencies = [];
  for (const c of job.channels) {
    const nb = nearestServerBand(c.frequency);
    if (!nb) continue;
    const series = data?.hourlyPredictions?.[nb.band];
    let rel = null;
    if (Array.isArray(series) && Number.isInteger(hour)) {
      const slot = series.find((h) => h && h.hour === hour) ?? series[hour];
      if (slot && Number.isFinite(slot.reliability)) rel = slot.reliability;
    }
    if (rel == null) {
      const cur = (data?.currentBands || []).find((b) => b.band === nb.band);
      if (cur && Number.isFinite(cur.reliability)) rel = cur.reliability;
    }
    if (rel != null) frequencies.push({ freq: roundMHz(c.frequency), reliability: rel, approx: nb.approx });
  }
  return frequencies;
}

// ── Scoring & ranking ──────────────────────────────────────────────────────

function nearestFreqResult(frequencies, mhz) {
  let best = null;
  let bestD = Infinity;
  for (const f of frequencies || []) {
    const d = Math.abs(f.freq - mhz);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return bestD <= 0.05 ? best : null;
}

/** Band label + whether it is only the nearest band (60 m, MARS). */
function bandFor(freqHz) {
  const exact = freqHzToBand(freqHz);
  if (exact) return { band: exact, bandApprox: false };
  const nb = nearestServerBand(freqHz);
  return nb ? { band: nb.band, bandApprox: true } : { band: null, bandApprox: false };
}

/**
 * Attach engine output to each channel of a job. Status is NOT set here —
 * it depends on the operator's thresholds (see summarizeGateway).
 * @returns {Array} {...channel, band, bandApprox, dialHz, reliability, snr, snrMargin, approx}
 */
export function scoreChannels(channels, frequencies, requiredSNR, { muf = null } = {}) {
  return (channels || []).map((c) => {
    const r = nearestFreqResult(frequencies, roundMHz(c.frequency));
    const reliability =
      r && Number.isFinite(r.reliability) ? Math.max(0, Math.min(99, Math.round(r.reliability))) : null;
    const snr = r && Number.isFinite(r.snr) ? Math.round(r.snr * 10) / 10 : null;
    const snrMargin = Number.isFinite(snr) ? Math.round((snr - requiredSNR) * 10) / 10 : null;
    return {
      ...c,
      ...bandFor(c.frequency),
      dialHz: dialFrequencyHz(c),
      requiredSNR,
      reliability,
      snr,
      snrMargin,
      approx: !!r?.approx,
      muf: Number.isFinite(muf) ? Math.round(muf * 10) / 10 : null,
      aboveMuf: Number.isFinite(muf) && c.frequency / 1e6 > muf,
    };
  });
}

/**
 * Pick the best scored channel: best status first (when statuses are set),
 * then highest reliability, SNR margin as tiebreak.
 */
export function bestChannel(scored) {
  const rank = (c) => (c.status ? (STATUS_ORDER[c.status] ?? 9) : 0);
  let best = null;
  for (const c of scored || []) {
    if (!best) {
      best = c;
      continue;
    }
    if (rank(c) !== rank(best)) {
      if (rank(c) < rank(best)) best = c;
      continue;
    }
    const cr = c.reliability ?? -1;
    const br = best.reliability ?? -1;
    if (cr > br || (cr === br && (c.snrMargin ?? -Infinity) > (best.snrMargin ?? -Infinity))) best = c;
  }
  return best;
}

/**
 * Build one result row for a gateway. `scoredChannels` are the on-air
 * channels with engine output (or nulls while pending); `offAirChannels`
 * are listed with status 'offair'. The gateway's status comes from its best
 * ON-AIR channel; a gateway with nothing on the air is 'offair' — never Good.
 */
export function summarizeGateway(
  candidate,
  scoredChannels,
  { engine = 'wasm', updatedAt = Date.now(), thresholds = DEFAULT_THRESHOLDS, offAirChannels = [] } = {},
) {
  // The engine's basic MUF is a monthly MEDIAN: above it the ionosphere
  // supports the frequency on half the days or fewer, so such a channel is
  // never Good, whatever reliability the above-MUF loss model still gives
  // (P.533 is optimistic there, especially on short/NVIS paths).
  const onAir = (scoredChannels || []).map((c) => {
    const st = classifyStatus(c.reliability, c.snrMargin, thresholds);
    return { ...c, status: c.aboveMuf && st === 'good' ? 'marginal' : st };
  });
  const offAir = (offAirChannels || []).map((c) => ({
    ...c,
    ...bandFor(c.frequency),
    dialHz: dialFrequencyHz(c),
    reliability: null,
    snr: null,
    snrMargin: null,
    status: 'offair',
  }));
  const channels = [...onAir, ...offAir].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (so !== 0) return so;
    return (b.reliability ?? -1) - (a.reliability ?? -1);
  });
  const best = bestChannel(onAir) || offAir[0] || null;
  let status = 'unknown';
  if (best) status = best.status;
  else if (offAir.length) status = 'offair';
  const bestHours = best ? describeHours(best.hours) : { kind: 'none' };
  return {
    callsign: candidate.callsign,
    lat: candidate.gateway.lat,
    lon: candidate.gateway.lon,
    gridsquare: candidate.gateway.gridsquare,
    distanceKm: candidate.distanceKm,
    bearing: candidate.bearing,
    channels,
    best,
    status,
    hoursUnknown: bestHours.kind === 'unknown',
    hoursNote: bestHours.kind === 'unknown' ? bestHours : null,
    reliability: best ? best.reliability : null,
    snrMargin: best ? best.snrMargin : null,
    approx: !!best?.approx,
    engine,
    updatedAt,
  };
}

/** Rank result rows: Good → Marginal → Closed → Off the air → Unknown, then reliability desc, then nearest. */
export function rankGateways(rows) {
  return (rows || []).slice().sort((a, b) => {
    const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (so !== 0) return so;
    const rd = (b.reliability ?? -1) - (a.reliability ?? -1);
    if (rd !== 0) return rd;
    return a.distanceKm - b.distanceKm;
  });
}

/**
 * Compact per-callsign view for the map layer and the EmComm list:
 * { CALL: { kind, status, reliability, snrMargin, band, freqHz, modeLabel } }.
 * HF rows carry their predicted status; VHF/UHF rows carry kind 'packet',
 * their line-of-sight hint and 'offair' status when outside their hours.
 */
export function buildReachSnapshot(rows, packet) {
  const byCall = {};
  for (const r of rows || []) {
    byCall[r.callsign] = {
      kind: 'hf',
      status: r.status,
      reliability: r.reliability,
      snrMargin: r.snrMargin,
      band: r.best?.band ?? null,
      freqHz: r.best?.frequency ?? null,
      modeLabel: r.best?.modeLabel ?? null,
      hoursUnknown: !!r.hoursUnknown,
      hoursText: r.hoursNote?.text ?? null,
    };
  }
  for (const p of packet || []) {
    if (byCall[p.callsign]) continue; // an HF prediction says more than a distance
    const h = describeHours(p.channels?.[0]?.hours);
    byCall[p.callsign] = {
      kind: 'packet',
      status: p.onAir === false ? 'offair' : 'unknown',
      los: p.los,
      distanceKm: p.distanceKm,
      hoursUnknown: h.kind === 'unknown',
      hoursText: h.kind === 'unknown' ? h.text : null,
    };
  }
  return byCall;
}

/**
 * Should a gateway be shown under a reachability filter?
 *   'all'        — everything
 *   'reachable'  — HF predicted Good/Marginal, plus on-air VHF/UHF within extended line of sight
 *   'good'       — HF predicted Good, plus on-air VHF/UHF within line of sight
 * Off-the-air gateways never pass a filter other than 'all'.
 */
export function passesReachFilter(entry, filter) {
  if (filter === 'all' || !filter) return true;
  if (!entry) return false;
  if (entry.status === 'offair') return false;
  if (entry.kind === 'packet') return filter === 'good' ? entry.los === 'los' : entry.los !== 'beyond';
  if (filter === 'good') return entry.status === 'good';
  return entry.status === 'good' || entry.status === 'marginal';
}

const LOS_STATUS = { los: 'good', extended: 'marginal', beyond: 'closed' };

/** Colour key for a snapshot entry: HF by predicted status, VHF/UHF by line of sight. */
export function reachColorKey(entry) {
  if (!entry) return 'unknown';
  if (entry.status === 'offair') return 'offair';
  if (entry.kind === 'packet') return LOS_STATUS[entry.los] || 'unknown';
  return STATUS_COLORS[entry.status] ? entry.status : 'unknown';
}

/**
 * Leaflet circleMarker style for the Winlink Gateways layer.
 *   byCall null  → reachability off: colour by mode family (modeColor), radius 4
 *   entry found  → status colour, radius 5
 *   not in byCall → grey dot, radius 3, faded (not predicted: out of range / over cap)
 */
export function reachMarkerStyle(byCall, callsign, { opacity = 0.85, modeColor = STATUS_COLORS.unknown } = {}) {
  if (!byCall) {
    return { fillColor: modeColor, radius: 4, opacity, fillOpacity: opacity * 0.85, dim: false };
  }
  const entry = byCall[callsign];
  if (!entry) {
    return {
      fillColor: STATUS_COLORS.unknown,
      radius: 3,
      opacity: opacity * 0.5,
      fillOpacity: opacity * 0.35,
      dim: true,
    };
  }
  return {
    fillColor: STATUS_COLORS[reachColorKey(entry)],
    radius: 5,
    opacity,
    fillOpacity: opacity * 0.85,
    dim: false,
  };
}

// ── Concurrency-limited runner ─────────────────────────────────────────────

/**
 * Run `fn(item, index)` over `items` with at most `concurrency` in flight.
 * Never rejects: each slot of the returned array is { ok, value } or
 * { ok: false, error }. Stops scheduling once isCancelled() is true (in
 * flight calls finish but their results are discarded by the caller).
 * onProgress(done, total) fires after every settled item.
 */
export async function runBatched(items, fn, { concurrency = PREDICT_CONCURRENCY, onProgress, isCancelled } = {}) {
  const list = items || [];
  const results = new Array(list.length);
  let next = 0;
  let done = 0;
  const cancelled = () => (typeof isCancelled === 'function' ? isCancelled() : false);

  async function lane() {
    while (true) {
      if (cancelled()) return;
      const i = next++;
      if (i >= list.length) return;
      try {
        const value = await fn(list[i], i);
        results[i] = { ok: true, value };
      } catch (error) {
        results[i] = { ok: false, error };
      }
      done++;
      if (!cancelled() && typeof onProgress === 'function') onProgress(done, list.length);
    }
  }

  const lanes = [];
  for (let k = 0; k < Math.max(1, Math.min(concurrency, list.length)); k++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

/** Insert into a bounded Map, evicting the oldest insertion when over `max`. */
export function cachePut(map, key, value, max = CACHE_MAX_ENTRIES) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  return map;
}
