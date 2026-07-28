import { detectMode, getBandFromFreq, getCallsignInfo } from './callsign';

/**
 * dxClusterFilters.js : DXCluster Filtering Utilities
 */

/**
 * Contest presets for the "Contest" filter tab. Cluster spots carry no
 * contest metadata, so each preset is a comment-signature regex — for Field
 * Day that's "FD", "Field Day", or a class+section exchange ("3A MO").
 * Word boundaries keep short tokens like FD from matching inside callsigns.
 */
export const CONTEST_PRESETS = [
  {
    key: 'field-day',
    label: 'ARRL Field Day',
    pattern: /\bFD\b|FIELD\s*DAY|\b\d{1,2}[A-F]\s+[A-Z]{2,3}\b/i,
  },
  {
    key: 'winter-field-day',
    label: 'Winter Field Day',
    pattern: /\bWFD\b|WINTER\s*FIELD\s*DAY/i,
  },
  {
    key: 'cqww',
    label: 'CQ WW',
    pattern: /\bCQ\s*WW\b|\bCQWW\b/i,
  },
  {
    key: 'wpx',
    label: 'CQ WPX',
    pattern: /\bWPX\b/i,
  },
  {
    key: 'generic-contest',
    label: 'Any contest',
    pattern: /\bTEST\b|\bCONTEST\b|\bCQWW\b|\bWPX\b|\bFD\b|\bWFD\b/i,
  },
];

/**
 * Applies the WatchList filter, which is specified in the UI 'Watchlist' tab of the DXCluster's 'Filters' dialog
 * Includes only spots with a callsign that matches the Watchlist (applied only if 'watchlistOnly' is true
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 *
 * @param {Object} filters - Filter configuration
 * @param {string} dxCall - the DX (spot's) callsign
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applyWatchlistFilter = (filters, dxCall) => {
  if (filters.watchlistOnly && filters.watchlist?.length > 0) {
    const matchesWatchlist = filters.watchlist.some((w) => dxCall?.toUpperCase().startsWith(w.toUpperCase()));
    if (!matchesWatchlist) return false;
  }
  return true;
};

/**
 * Applies the Spotter (DE) inclusion filters, which are specified in the UI 'Zones' tab of the DXCluster's 'Filters' dialog
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 * @param {Object} filters - Filter configuration
 *
 * @param {Object} spotterInfo - CQ zone, ITU zone, and continent from the spotter's (DE) callsign
 * @param {number} spotterInfo.cqZone - the spotter's CQ zone
 * @param {number} spotterInfo.ituZone - the spotter's ITU zone
 * @param {string} spotterInfo.continent - the spotter's continent
 *
 * @param {Object} dxInfo - CQ zone, ITU zone, and continent from the spot's (DX) callsign
 * @param {number} dxInfo.cqZone - the spot's CQ zone
 * @param {number} dxInfo.ituZone - the spot's ITU zone
 * @param {string} dxInfo.continent - the spot's continent
 *
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applySpotterInclusionFilters = (filters, spotterInfo, dxInfo) => {
  // DE Continent 'include' filter - filter by SPOTTER's continent
  // Also excludes domestic spots (DX in same continent as spotter)
  if (filters.continents?.length > 0) {
    // Spotter must be FROM one of the selected continents
    if (!spotterInfo.continent || !filters.continents.includes(spotterInfo.continent)) {
      return false;
    }
    // DX must be OUTSIDE the selected continents (exclude domestic spots)
    if (dxInfo.continent && filters.continents.includes(dxInfo.continent)) {
      return false;
    }
  }

  // DE CQ Zone 'include' filter - filter by SPOTTER's zone
  if (filters.cqZones?.length > 0) {
    if (!spotterInfo.cqZone || !filters.cqZones.includes(spotterInfo.cqZone)) {
      return false;
    }
  }

  // DE ITU Zone 'include' filter - filter by SPOTTER's zone
  if (filters.ituZones?.length > 0) {
    if (!spotterInfo.ituZone || !filters.ituZones.includes(spotterInfo.ituZone)) {
      return false;
    }
  }

  return true;
};

/**
 * Applies the Spot (DX) exclusion filters, which are specified in the UI 'Exclude' tab of the DXCluster's 'Filters' dialog
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 *
 * @param {Object} filters - Filter configuration
 * @param {string} spotter - spotter's (DE) callsign
 * @param {string} dxCall - spot's (DX) callsign
 *
 * @param {Object} dxInfo - CQ zone, ITU zone, and continent from the spot's (DX) callsign
 * @param {number} dxInfo.cqZone - the spot's CQ zone
 * @param {number} dxInfo.ituZone - the spot's ITU zone
 * @param {string} dxInfo.continent - the spot's continent
 *
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applySpotExclusionFilters = (filters, spotter, dxCall, dxInfo) => {
  // DX (spot) Continent 'exclude' filter
  if (filters.excludeContinents?.length > 0) {
    if (dxInfo.continent && filters.excludeContinents.includes(dxInfo.continent)) {
      return false;
    }
  }

  // DX (spot) CQ Zone 'exclude' filter
  if (filters.excludeCqZones?.length > 0) {
    if (dxInfo.cqZone && filters.excludeCqZones.includes(dxInfo.cqZone)) {
      return false;
    }
  }

  // DX (spot) ITU Zone 'exclude' filter
  if (filters.excludeItuZones?.length > 0) {
    if (dxInfo.ituZone && filters.excludeItuZones.includes(dxInfo.ituZone)) {
      return false;
    }
  }

  // DX (spot) Callsign 'exclude' filter - hide matching calls (prefix match)
  if (filters.excludeDXCallList?.length > 0) {
    const isExcluded = filters.excludeDXCallList.some((exc) => dxCall?.toUpperCase().startsWith(exc.toUpperCase()));
    if (isExcluded) return false;
  }

  // DE (spotter) Callsign 'exclude' filter - hide matching calls (prefix match)
  if (filters.excludeDECallList?.length > 0) {
    const isExcluded = filters.excludeDECallList.some((exc) => spotter?.toUpperCase().startsWith(exc.toUpperCase()));
    if (isExcluded) return false;
  }

  // Legacy excludeList support (for backwards compatibility)
  if (filters.excludeList?.length > 0) {
    const isExcluded = filters.excludeList.some((exc) => dxCall?.toUpperCase().startsWith(exc.toUpperCase()));
    if (isExcluded) return false;
  }

  return true;
};

/**
 * Applies the Band filter, which is specified in the UI 'Bands' tab of the DXCluster's 'Filters' dialog
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 *
 * @param {Object} item - The spot or path to filter
 * @param {string} item.dxCall - DX station callsign (or item.call for legacy format)
 * @param {string} item.spotter - Spotter/DE callsign
 * @param {number|string} item.freq - Frequency in MHz
 * @param {string} item.comment - Spot comment (for mode detection)
 *
 * @param {Object} filters - Filter configuration
 *
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applyBandFilter = (item, filters) => {
  if (filters.bands?.length > 0) {
    const band = getBandFromFreq(parseFloat(item.freq) * 1000);
    if (!filters.bands.includes(band)) return false;
  }
  return true;
};

/**
 * Applies the Mode filter, which is specified in the UI 'Modes' tab of the DXCluster's 'Filters' dialog
 * Detects mode from comment first, then falls back to frequency-based inference (known calling frequencies).
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 *
 * @param {Object} item - The spot or path to filter
 * @param {string} item.dxCall - DX station callsign (or item.call for legacy format)
 * @param {string} item.spotter - Spotter/DE callsign
 * @param {number|string} item.freq - Frequency in MHz
 * @param {string} item.comment - Spot comment (for mode detection)
 *
 * @param {Object} filters - Filter configuration
 *
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applyModeFilter = (item, filters) => {
  if (filters.modes?.length > 0) {
    // detectMode() prioritizes comment but falls back to known calling frequencies (e.g., 14.074 → FT8)
    const mode = detectMode(item.comment, item.freq);
    if (!mode || !filters.modes.includes(mode)) return false;
  }
  return true;
};

/**
 * Applies the Mode filter, which is specified in the UI 'Modes' tab of the DXCluster's 'Filters' dialog
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 * @param {Object} filters - Filter configuration
 * @param {string} dxCall - the DX (spot's) callsign
 * @param {string} spotter - the DE (spotter's) callsign
 *
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
/**
 * Applies the Comment Text filter, which is specified in the UI 'Text' tab of the DXCluster's 'Filters' dialog
 * Includes only spots whose comment contains at least one of the search keywords (OR logic).
 * <br/>
 * **Used internally only, by applyDXFilters, do not export.**
 *
 * @param {Object} filters - Filter configuration
 * @param {string} comment - the spot's comment text
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
const applyCommentTextFilter = (filters, comment) => {
  if (filters.commentText?.length > 0) {
    const upper = (comment || '').toUpperCase();
    const matchesAny = filters.commentText.some((kw) => upper.includes(kw.toUpperCase()));
    if (!matchesAny) return false;
  }
  return true;
};

const applyQuickSearchFilter = (filters, dxCall, spotter) => {
  if (filters.callsign && filters.callsign.trim()) {
    const search = filters.callsign.trim().toUpperCase();
    const matchesCall = dxCall?.toUpperCase().includes(search);
    const matchesSpotter = spotter?.toUpperCase().includes(search);
    if (!matchesCall && !matchesSpotter) return false;
  }

  return true;
};

/**
 * Apply DX filters to a single spot/path item
 * This is the SINGLE SOURCE OF TRUTH for all DX filtering logic.
 * <br/>
 * Used by: useDXCluster.js, useDXClusterData.js, filterDXPaths()
 *
 * @param {Object} item - The spot or path to filter
 * @param {Object} filters - Filter configuration
 * @returns {boolean} - true if item passes filters, false if filtered out
 */
export const applyDXFilters = (item, filters) => {
  if (!filters || Object.keys(filters).length === 0) return true;

  const spotter = item.spotter;
  const spotterInfo = getCallsignInfo(spotter);

  const dxCall = item.dxCall || item.call;
  const dxInfo = getCallsignInfo(dxCall);

  if (!applyWatchlistFilter(filters, dxCall)) {
    return false;
  }

  // DXpeditions-only: keep just spots the server tagged against the active
  // DXpedition list (NG3K data). Untagged items (e.g. from sources that skip
  // the paths enrichment) are treated as non-DXpeditions.
  if (filters.dxpeditionsOnly && !item.isDXpedition) {
    return false;
  }

  // Contest filter: keep only spots whose comment matches the selected
  // contest's signature (see CONTEST_PRESETS).
  if (filters.contest) {
    const preset = CONTEST_PRESETS.find((p) => p.key === filters.contest);
    if (preset && !preset.pattern.test(item.comment || '')) {
      return false;
    }
  }

  if (!applySpotterInclusionFilters(filters, spotterInfo, dxInfo)) {
    return false;
  }

  if (!applySpotExclusionFilters(filters, spotter, dxCall, dxInfo)) {
    return false;
  }

  if (!applyBandFilter(item, filters)) {
    return false;
  }

  if (!applyModeFilter(item, filters)) {
    return false;
  }

  if (!applyCommentTextFilter(filters, item.comment)) {
    return false;
  }

  if (!applyQuickSearchFilter(filters, dxCall, spotter)) {
    return false;
  }

  // item passes (gets included)
  return true;
};

/**
 * Pick a mode-balanced display window from a spot list.
 *
 * The cluster feed is dominated by RBN skimmer spots, and FT8/FT4 churn keeps
 * the newest entries almost exclusively digital — a plain "newest N" slice
 * shows no SSB at all, because SSB only exists as human spots (skimmers can't
 * decode phone) and those age past the window within minutes. Mirrors the
 * server-side balancing in ohc-cluster/lib/store.js: reserve a slice of the
 * window for voice-mode spots, cap FT8/FT4, give unused slots back to the
 * pool. Returns spots in their original (newest-first) feed order.
 *
 * Classification goes through detectMode (comment keywords, then band-plan
 * frequency inference) rather than source/spotter markers: the paths endpoint
 * strips the -# skimmer suffix and drops the mode/source fields, so comment
 * and frequency are the only signals that survive every feed shape.
 */
export const balanceSpotWindow = (spots, limit, { voiceReserveShare = 0.25, ft8Ft4CapShare = 0.5 } = {}) => {
  if (!Array.isArray(spots) || spots.length <= limit) return spots || [];

  const voice = [];
  const ft8ft4 = [];
  const other = [];
  spots.forEach((spot, i) => {
    const entry = [spot, i];
    const mode = spot.mode || detectMode(spot.comment, spot.freq);
    if (mode === 'FT8' || mode === 'FT4') {
      ft8ft4.push(entry);
    } else if (mode === 'SSB' || mode === 'AM' || mode === 'FM' || !mode) {
      // Voice modes and mode-unknown spots — the human-spotted traffic that
      // skimmer churn otherwise pushes out of the window
      voice.push(entry);
    } else {
      other.push(entry);
    }
  });

  const voiceReserve = Math.ceil(limit * voiceReserveShare);
  const out = voice.slice(0, voiceReserve);
  out.push(...ft8ft4.slice(0, Math.min(Math.ceil(limit * ft8Ft4CapShare), limit - out.length)));
  out.push(...other.slice(0, limit - out.length));

  // Backfill with the remaining freshest spots if any group ran short
  if (out.length < limit) {
    const chosen = new Set(out.map(([, i]) => i));
    for (let i = 0; i < spots.length && out.length < limit; i++) {
      if (!chosen.has(i)) out.push([spots[i], i]);
    }
  }

  return out.sort((a, b) => a[1] - b[1]).map(([spot]) => spot);
};

/**
 * Collapse re-spots of the same station into one row: same call within
 * ~2 kHz keeps only the first (newest, given newest-first input) occurrence.
 * Accumulator dedupe keys on spotter, so every extra spotter of a POTA
 * activator otherwise produces another visible row. A larger QSY stays a
 * separate row — the station moving is real information. Mirrors the
 * server-side collapseDuplicateDXPaths in utils/dxClusterPathIdentity.js.
 */
export const collapseDuplicateSpots = (spots) => {
  if (!Array.isArray(spots)) return spots || [];
  const kept = [];
  const freqsByCall = new Map();
  for (const s of spots) {
    const call = String(s.dxCall || s.call || '')
      .trim()
      .toUpperCase();
    const f = parseFloat(s.freq);
    const khz = Number.isFinite(f) ? (f > 1000 ? f : f * 1000) : NaN;
    if (!call || !Number.isFinite(khz)) {
      kept.push(s);
      continue;
    }
    const freqs = freqsByCall.get(call);
    if (freqs) {
      if (freqs.some((k) => Math.abs(k - khz) < 2)) continue;
      freqs.push(khz);
    } else {
      freqsByCall.set(call, [khz]);
    }
    kept.push(s);
  }
  return kept;
};

/**
 * Filter an array of DX spots/paths
 * Wrapper around applyDXFilters for filtering arrays
 */
export const filterDXPaths = (paths, filters) => {
  if (!paths || !filters) return paths;
  if (Object.keys(filters).length === 0) return paths;

  return paths.filter((item) => applyDXFilters(item, filters));
};
