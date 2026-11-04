/**
 * IOTA (Islands On The Air) helpers.
 *
 * DX cluster and activation spots carry IOTA references only as free text
 * in the comment ("IOTA EU-005", "eu005", "NA-067 lighthouse"). These
 * helpers pull the reference out, normalise it to the canonical "EU-005"
 * form, and look up the island-group name from the bundled reference list
 * (src/utils/iotaRefs.json — RSGB IOTA group list, ref → [name, lat, lon]
 * with the group's bounding-box centre, compact so it ships in the bundle).
 */
import IOTA_REFS from './iotaRefs.json';

export const IOTA_CONTINENTS = ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'];

// "EU-005", "EU 005", "EU005" — word-bounded so callsign fragments like
// "NA1" or "EU7" can't match, and 3 digits exactly.
const IOTA_RE = /\b(AF|AN|AS|EU|NA|OC|SA)[-\s]?(\d{3})\b/i;

/**
 * First IOTA reference in a string, normalised ("EU-005"), or null.
 * Only references that exist in the bundled list are returned, so stray
 * tokens that merely look like a reference (e.g. "AS-999") don't tag a spot.
 */
export function extractIota(text) {
  if (!text || typeof text !== 'string') return null;
  const m = IOTA_RE.exec(text);
  if (!m) return null;
  const ref = `${m[1].toUpperCase()}-${m[2]}`;
  return IOTA_REFS[ref] ? ref : null;
}

/** Island group name for a reference, or null. */
export function iotaName(ref) {
  const entry = ref ? IOTA_REFS[String(ref).toUpperCase()] : null;
  return entry ? entry[0] : null;
}

/** Approximate centre of the island group { lat, lon }, or null. */
export function iotaLocation(ref) {
  const entry = ref ? IOTA_REFS[String(ref).toUpperCase()] : null;
  if (!entry || !Number.isFinite(entry[1]) || !Number.isFinite(entry[2])) return null;
  return { lat: entry[1], lon: entry[2] };
}

/** IOTA reference for a spot (DX cluster `comment` or activation `comments`), or null. */
export function spotIota(spot) {
  if (!spot) return null;
  return extractIota(spot.comment) || extractIota(spot.comments) || null;
}

/** Number of references in the bundled list (for the manual / tests). */
export const IOTA_REF_COUNT = Object.keys(IOTA_REFS).length;
