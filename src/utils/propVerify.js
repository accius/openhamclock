/**
 * Prediction-vs-Reality helpers — pure comparison logic behind
 * PropVerifyPanel ("Prediction Check").
 *
 * Predicted side: per-band P.533 reliability from DE to one representative
 * gridpoint per continent (same engine + inputs as the VOACAP panel), taken
 * as the MAX across continents — "the model says this band should be open to
 * SOMEWHERE". Observed side: live spots involving DE's continent in the last
 * 15 minutes, per band, normalized so OBSERVED_CAP spots ≈ full activity.
 *
 * This whole comparison is a HEURISTIC. Spot counts measure where operators
 * are, not path reliability; a quiet band on a Tuesday morning is not model
 * error. The verdict thresholds are deliberately wide (±25 points) and the
 * panel says so in its footnote.
 */
import { getBandFromFreq, getCallsignInfo } from './callsign.js';
import { calculateDistance } from './geo.js';

/** HF bands compared, low → high (matches the VOACAP panel's band list). */
export const VERIFY_BANDS = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

/**
 * One representative gridpoint per continent — roughly the ham-population
 * centroid, good enough for a continent-coarse comparison.
 */
export const CONTINENT_POINTS = {
  NA: { lat: 39, lon: -98 },
  SA: { lat: -15, lon: -55 },
  EU: { lat: 50, lon: 10 },
  AF: { lat: 5, lon: 20 },
  AS: { lat: 35, lon: 105 },
  OC: { lat: -25, lon: 135 },
};

/** Spots in a 15-min window that count as "fully active" for a band. */
export const OBSERVED_CAP = 15;

/** Verdict tolerance in reliability points (predicted and observed are both 0-99). */
export const VERDICT_TOLERANCE = 25;

export const OBSERVED_WINDOW_MS = 15 * 60 * 1000;

/** Continent whose representative point is nearest to a lat/lon (fallback when DE has no callsign). */
export function nearestContinent(lat, lon) {
  let best = 'NA';
  let bestDist = Infinity;
  for (const [cont, p] of Object.entries(CONTINENT_POINTS)) {
    const d = calculateDistance(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = cont;
    }
  }
  return best;
}

/**
 * Count spots per band that involve DE's continent within the window.
 *
 * Accepted spot shapes (superset of the cluster + PSKReporter feeds):
 *   { freq | band, timestamp, spotter?, call?, involvesDe? }
 * `involvesDe: true` short-circuits the continent check — PSKReporter
 * reports are already filtered to the user's own station, so both sides of
 * every report involve DE by construction.
 *
 * @returns {Object} { band: count } for every VERIFY_BANDS entry
 */
export function countObservedByBand(spots, { deContinent, now = Date.now(), windowMs = OBSERVED_WINDOW_MS } = {}) {
  const counts = {};
  for (const b of VERIFY_BANDS) counts[b] = 0;
  if (!Array.isArray(spots)) return counts;

  const cutoff = now - windowMs;
  for (const spot of spots) {
    if (!spot) continue;
    if (!Number.isFinite(spot.timestamp) || spot.timestamp < cutoff || spot.timestamp > now + 60_000) continue;

    const band = VERIFY_BANDS.includes(spot.band) ? spot.band : getBandFromFreq(spot.freq);
    if (!VERIFY_BANDS.includes(band)) continue;

    let involves = spot.involvesDe === true;
    if (!involves && deContinent) {
      const sCont = spot.spotter ? getCallsignInfo(spot.spotter)?.continent : null;
      const dCont = spot.call ? getCallsignInfo(spot.call)?.continent : null;
      involves = sCont === deContinent || dCont === deContinent;
    }
    if (involves) counts[band]++;
  }
  return counts;
}

/** Normalize a spot count to the same 0-99 scale as P.533 reliability. */
export function observedScore(count, cap = OBSERVED_CAP) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(99, Math.round((count / cap) * 99));
}

/**
 * Collapse a { band: { continent: reliability } } matrix to the per-band max —
 * a band is "predicted open" if it is open to any continent.
 */
export function maxAcrossContinents(matrix) {
  const out = {};
  if (!matrix) return out;
  for (const [band, byCont] of Object.entries(matrix)) {
    let max = null;
    for (const rel of Object.values(byCont || {})) {
      if (Number.isFinite(rel)) max = max == null ? rel : Math.max(max, rel);
    }
    out[band] = max;
  }
  return out;
}

/**
 * Verdict for one band. Deliberately generous thresholds — see file header.
 *   'nodata'  — no prediction available for this band
 *   'agrees'  — |observed − predicted| ≤ tolerance, or both flat-out closed
 *   'better'  — observed activity beats the prediction by > tolerance
 *   'worse'   — band is predicted open but nobody's being heard
 */
export function verdictFor(predicted, count, { cap = OBSERVED_CAP, tolerance = VERDICT_TOLERANCE } = {}) {
  if (!Number.isFinite(predicted)) return 'nodata';
  const obs = observedScore(count, cap);
  if (predicted < 15 && count === 0) return 'agrees'; // both say closed
  const diff = obs - predicted;
  if (diff > tolerance) return 'better';
  if (diff < -tolerance) return 'worse';
  return 'agrees';
}

/**
 * Verdict for an already-normalized 0-99 observed score (third source:
 * measured beacon SNR from a KiwiSDR beacon monitor, see ibpMeasured.js).
 * Same tolerance as verdictFor; "both closed" is score < 15 (≈ SNR ≤ −4 dB).
 */
export function verdictForScore(predicted, score, { tolerance = VERDICT_TOLERANCE } = {}) {
  if (!Number.isFinite(predicted) || !Number.isFinite(score)) return 'nodata';
  if (predicted < 15 && score < 15) return 'agrees';
  const diff = score - predicted;
  if (diff > tolerance) return 'better';
  if (diff < -tolerance) return 'worse';
  return 'agrees';
}

/**
 * Assemble the panel's row model.
 *
 * @param {Object} predictedByBand  { band: reliability|null } (already maxed across continents)
 * @param {Object} counts           { band: spotCount }
 * @param {Object} [beaconsByBand]  { band: { maxSnr, score, n } } from measuredBandSummary — optional
 *                                  third source; rows get `beacon: { maxSnr, score, n, verdict }` or null
 * @returns {Array<{band, predicted, count, observed, verdict, beacon}>} in VERIFY_BANDS order
 */
export function buildComparison(predictedByBand = {}, counts = {}, beaconsByBand = null) {
  return VERIFY_BANDS.map((band) => {
    const predicted = Number.isFinite(predictedByBand[band]) ? predictedByBand[band] : null;
    const count = counts[band] ?? 0;
    const b = beaconsByBand && beaconsByBand[band];
    const beacon =
      b && Number.isFinite(b.score)
        ? { maxSnr: b.maxSnr, score: b.score, n: b.n ?? 0, verdict: verdictForScore(predicted, b.score) }
        : null;
    return {
      band,
      predicted,
      count,
      observed: observedScore(count),
      verdict: verdictFor(predicted, count),
      beacon,
    };
  });
}

/**
 * Reliability of the heatmap cell nearest a target point — used by the REST
 * fallback when the browser WASM engine is unavailable. Cells are
 * { lat, lon, r }; nearest is by degree distance with longitude wrap.
 */
export function pickCellReliability(cells, lat, lon) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const c of cells) {
    const dLat = c.lat - lat;
    let dLon = Math.abs(c.lon - lon) % 360;
    if (dLon > 180) dLon = 360 - dLon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return Number.isFinite(best?.r) ? best.r : null;
}

// ─── DE → DX path mode (the panel's primary view since 26.11) ────────────────
//
// The best-continent comparison above answers "is this band open to anywhere";
// operators want "is this band open to where I am pointing". These helpers
// score the actual DE→DX path: one P.533 prediction for that circuit, spots
// between the two continents, and beacons near the DX end.

/** Spots between the two continents needed for a path to count as evidence. */
export const PATH_CONFIRM_COUNT = 3;
/** Beacons within this distance of DX count as "near DX" (km). */
export const BEACON_NEAR_DX_KM = 4000;

/**
 * Continent for a station: callsign prefix first (cty.dat), then the nearest
 * continent point for a lat/lon, else null.
 */
export function continentOf(call, lat, lon) {
  const fromCall = call ? getCallsignInfo(call)?.continent : null;
  if (fromCall) return fromCall;
  if (Number.isFinite(lat) && Number.isFinite(lon)) return nearestContinent(lat, lon);
  return null;
}

/**
 * Count spots per band whose two ends sit on the DE and DX continents (either
 * direction). Spot shape: { freq | band, timestamp, spotter?, call?, dxLat?,
 * dxLon?, spotterLat?, spotterLon?, deContinentEnd?: true, otherCall?,
 * otherLat?, otherLon? } — `deContinentEnd` marks feeds already filtered to
 * the user's own station (PSKReporter), where only the far end needs a check.
 * Spots whose continents cannot be resolved are skipped (not guessed).
 */
export function countPathSpotsByBand(
  spots,
  { deContinent, dxContinent, now = Date.now(), windowMs = OBSERVED_WINDOW_MS } = {},
) {
  const counts = {};
  for (const b of VERIFY_BANDS) counts[b] = 0;
  if (!Array.isArray(spots) || !deContinent || !dxContinent) return counts;
  const cutoff = now - windowMs;
  for (const spot of spots) {
    if (!spot) continue;
    if (!Number.isFinite(spot.timestamp) || spot.timestamp < cutoff || spot.timestamp > now + 60_000) continue;
    const band = VERIFY_BANDS.includes(spot.band) ? spot.band : getBandFromFreq(spot.freq);
    if (!VERIFY_BANDS.includes(band)) continue;

    let matches = false;
    if (spot.deContinentEnd === true) {
      const far = continentOf(spot.otherCall, spot.otherLat, spot.otherLon);
      matches = far === dxContinent;
    } else {
      const a = continentOf(spot.spotter, spot.spotterLat, spot.spotterLon);
      const b = continentOf(spot.call, spot.dxLat, spot.dxLon);
      if (!a || !b) continue;
      matches = (a === deContinent && b === dxContinent) || (a === dxContinent && b === deContinent);
    }
    if (matches) counts[band]++;
  }
  return counts;
}

/**
 * Plain-language status for one band on the DE→DX path.
 *   'open-confirmed'   model says open AND people are being spotted across the path
 *   'open-unconfirmed' model says open, nobody spotted across the path yet
 *   'open-surprise'    model says closed but the path is busy — the model is pessimistic
 *   'marginal'         model between 15 and 50 %, or mixed evidence
 *   'closed'           model says closed and nothing heard
 *   'nodata'           no prediction for this band
 * A measured beacon score (0–99) near DX, when present, counts as evidence
 * the same way spots do (score ≥ 50 ≈ beacon clearly heard).
 */
export function pathStatus(predicted, count, beaconScore = null, { confirm = PATH_CONFIRM_COUNT } = {}) {
  if (!Number.isFinite(predicted)) return 'nodata';
  const heard = (Number.isFinite(count) && count >= confirm) || (Number.isFinite(beaconScore) && beaconScore >= 50);
  const some = (Number.isFinite(count) && count > 0) || (Number.isFinite(beaconScore) && beaconScore >= 30);
  if (predicted >= 50) return heard || some ? 'open-confirmed' : 'open-unconfirmed';
  if (predicted < 15) return heard ? 'open-surprise' : some ? 'marginal' : 'closed';
  return heard ? 'open-confirmed' : 'marginal';
}

/**
 * Row model for the path view. `predictedByBand` is { band: reliability } for
 * the single DE→DX circuit; `counts` from countPathSpotsByBand; `beaconsByBand`
 * from measuredBandSummary over beacons near DX (optional).
 */
export function buildPathComparison(predictedByBand = {}, counts = {}, beaconsByBand = null) {
  return VERIFY_BANDS.map((band) => {
    const predicted = Number.isFinite(predictedByBand[band]) ? predictedByBand[band] : null;
    const count = counts[band] ?? 0;
    const b = beaconsByBand && beaconsByBand[band];
    const beacon = b && Number.isFinite(b.score) ? { maxSnr: b.maxSnr, score: b.score, n: b.n ?? 0 } : null;
    return {
      band,
      predicted,
      count,
      observed: observedScore(count),
      beacon,
      status: pathStatus(predicted, count, beacon ? beacon.score : null),
    };
  });
}

/** Filter beacon measurements to beacons within BEACON_NEAR_DX_KM of a point. */
export function measurementsNear(measurements, beacons, lat, lon, maxKm = BEACON_NEAR_DX_KM) {
  if (!Array.isArray(measurements) || !Array.isArray(beacons) || !Number.isFinite(lat) || !Number.isFinite(lon))
    return [];
  const near = new Set(
    beacons.filter((b) => calculateDistance(lat, lon, b.lat, b.lon) <= maxKm).map((b) => b.callsign),
  );
  if (near.size === 0) return [];
  return measurements.filter((m) => m && near.has(m.beacon));
}

export default {
  VERIFY_BANDS,
  CONTINENT_POINTS,
  OBSERVED_CAP,
  OBSERVED_WINDOW_MS,
  VERDICT_TOLERANCE,
  nearestContinent,
  countObservedByBand,
  observedScore,
  maxAcrossContinents,
  verdictFor,
  verdictForScore,
  buildComparison,
  pickCellReliability,
};
