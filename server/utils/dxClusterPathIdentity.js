function normalizeCall(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeFreq(value) {
  return String(value || '').trim();
}

function buildDXPathIdentityKey(path = {}) {
  const dxCall = normalizeCall(path.dxCall || path.call);
  const freq = normalizeFreq(path.freq);
  const spotter = normalizeCall(path.spotter);

  if (!dxCall || !freq || !spotter) return '';

  return `${dxCall}|${freq}|${spotter}`;
}

function areDXPathsDuplicate(existing = {}, candidate = {}, now = Date.now(), dedupWindowMs = 120000) {
  const existingKey = buildDXPathIdentityKey(existing);
  const candidateKey = buildDXPathIdentityKey(candidate);

  if (!existingKey || !candidateKey || existingKey !== candidateKey) return false;

  return now - (existing.timestamp || 0) < dedupWindowMs;
}

/**
 * Collapse re-spots of the same station into one row: same DX call within
 * ~2 kHz keeps only the first (newest, given newest-first input) occurrence.
 * The spotter-keyed duplicate check above can't catch these — every extra
 * spotter of a POTA activator produced another visible row. A larger QSY
 * stays a separate row; the station moving is real information.
 */
function collapseDuplicateDXPaths(paths) {
  const kept = [];
  const freqsByCall = new Map();
  for (const p of paths) {
    const call = normalizeCall(p.dxCall || p.call);
    const f = parseFloat(p.freq);
    const khz = Number.isFinite(f) ? (f > 1000 ? f : f * 1000) : NaN;
    if (!call || !Number.isFinite(khz)) {
      kept.push(p);
      continue;
    }
    const freqs = freqsByCall.get(call);
    if (freqs) {
      if (freqs.some((k) => Math.abs(k - khz) < 2)) continue;
      freqs.push(khz);
    } else {
      freqsByCall.set(call, [khz]);
    }
    kept.push(p);
  }
  return kept;
}

module.exports = {
  buildDXPathIdentityKey,
  areDXPathsDuplicate,
  collapseDuplicateDXPaths,
};
