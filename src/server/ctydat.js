/**
 * cty.dat Parser — DXCC Entity Database
 *
 * Parses the AD1C/Jim Reisert cty.dat file (the standard amateur radio
 * callsign prefix → DXCC entity database) into a fast lookup structure.
 *
 * Source: https://www.country-files.com/big-cty/
 * Format: https://www.country-files.com/cty-dat-format/
 *
 * Used for: DX cluster filtering, callsign entity identification,
 *           continent/zone mapping, prefix-estimated coordinates.
 */
let fetch;
try { fetch = require('node-fetch'); } catch { fetch = globalThis.fetch; }

const CTY_URL = 'https://www.country-files.com/bigcty/cty.dat';
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

let ctyCache = null;   // { prefixes: {}, exact: {}, entities: [], timestamp }
let fetchTimer = null;

/**
 * Parse the cty.dat format into structured data.
 *
 * Entity header line (colon-separated):
 *   Entity Name:  CQ:  ITU:  Cont:  Lat:  Lon:  UTC_offset:  Primary_Prefix:
 *
 * Alias lines (indented, comma-separated, block ends with semicolon):
 *   prefix, prefix(cq_override)[itu_override], =EXACTCALL, ...;
 *
 * Prefix modifiers:
 *   (nn)  — CQ zone override
 *   [nn]  — ITU zone override
 *   {XX}  — continent override (rare)
 *   <nn/nn> — lat/lon override (rare)
 */
function parseCtyDat(text) {
  const prefixes = {};   // prefix string → entity info
  const exact = {};      // exact callsign → entity info
  const entities = [];   // list of all entities

  // Normalize line endings and split into entity blocks.
  // Each block starts at column 0 (header) and continues with
  // indented alias lines until a semicolon.
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Join continuation lines: alias lines are indented (start with space/tab)
  // Combine into blocks separated by semicolons
  const blocks = raw.split(';').filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n');

    // Find the header line (first non-empty, non-indented line)
    let headerLine = '';
    let aliasText = '';
    let foundHeader = false;

    for (const line of lines) {
      if (!foundHeader && line.length > 0 && line[0] !== ' ' && line[0] !== '\t') {
        headerLine = line;
        foundHeader = true;
      } else if (foundHeader) {
        aliasText += ' ' + line;
      }
    }

    if (!headerLine) continue;

    // Parse header: split by colon
    const parts = headerLine.split(':').map(s => s.trim());
    if (parts.length < 8) continue;

    const entityName = parts[0];
    const cqZone = parseInt(parts[1]) || 0;
    const ituZone = parseInt(parts[2]) || 0;
    const continent = parts[3] || '';
    const lat = parseFloat(parts[4]) || 0;
    // cty.dat longitude is WEST-positive, we need EAST-positive
    const lon = -(parseFloat(parts[5]) || 0);
    const utcOffset = parseFloat(parts[6]) || 0;
    const primaryPrefix = parts[7] || '';

    const entityInfo = {
      entity: entityName,
      dxcc: primaryPrefix,
      cq: cqZone,
      itu: ituZone,
      cont: continent,
      lat,
      lon,
    };

    entities.push(entityInfo);

    // Register primary prefix
    if (primaryPrefix) {
      prefixes[primaryPrefix.toUpperCase()] = { ...entityInfo };
    }

    // Parse alias prefixes
    const aliasList = aliasText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const alias of aliasList) {
      // Parse modifiers: (cq)[itu]{cont}<lat/lon>
      let token = alias;
      let overrideCQ = cqZone;
      let overrideITU = ituZone;
      let overrideCont = continent;
      let overrideLat = lat;
      let overrideLon = lon;

      // Extract CQ zone override (nn)
      const cqMatch = token.match(/\((\d+)\)/);
      if (cqMatch) {
        overrideCQ = parseInt(cqMatch[1]);
        token = token.replace(cqMatch[0], '');
      }

      // Extract ITU zone override [nn]
      const ituMatch = token.match(/\[(\d+)\]/);
      if (ituMatch) {
        overrideITU = parseInt(ituMatch[1]);
        token = token.replace(ituMatch[0], '');
      }

      // Extract continent override {XX}
      const contMatch = token.match(/\{([A-Z]{2})\}/);
      if (contMatch) {
        overrideCont = contMatch[1];
        token = token.replace(contMatch[0], '');
      }

      // Extract lat/lon override <lat/lon>
      const llMatch = token.match(/<([^>]+)>/);
      if (llMatch) {
        const llParts = llMatch[1].split('/');
        if (llParts.length === 2) {
          overrideLat = parseFloat(llParts[0]) || lat;
          overrideLon = -(parseFloat(llParts[1]) || -lon);
        }
        token = token.replace(llMatch[0], '');
      }

      // Strip any remaining whitespace
      token = token.trim().toUpperCase();
      if (!token) continue;

      const info = {
        entity: entityName,
        dxcc: primaryPrefix,
        cq: overrideCQ,
        itu: overrideITU,
        cont: overrideCont,
        lat: overrideLat,
        lon: overrideLon,
      };

      // Exact callsign match (prefixed with =)
      if (token.startsWith('=')) {
        const callsign = token.substring(1);
        if (callsign) exact[callsign] = info;
      } else {
        // Regular prefix — handle # (IOTA) prefix by stripping it
        const cleanPrefix = token.replace(/^#/, '');
        if (cleanPrefix) prefixes[cleanPrefix] = info;
      }
    }
  }

  return { prefixes, exact, entities, timestamp: Date.now() };
}

/**
 * Fetch and parse cty.dat from country-files.com
 */
async function fetchAndParse() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(CTY_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'OpenHamClock' },
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const parsed = parseCtyDat(text);

    const prefixCount = Object.keys(parsed.prefixes).length;
    const exactCount = Object.keys(parsed.exact).length;
    const entityCount = parsed.entities.length;

    console.log(`[CTY] Loaded ${entityCount} entities, ${prefixCount} prefixes, ${exactCount} exact calls`);

    ctyCache = parsed;
    return true;
  } catch (err) {
    console.warn('[CTY] Failed to fetch cty.dat:', err.message);
    return false;
  }
}

/**
 * Initialize: fetch on startup and schedule periodic refresh
 */
async function initCtyData() {
  await fetchAndParse();

  // Refresh every 24 hours
  if (fetchTimer) clearInterval(fetchTimer);
  fetchTimer = setInterval(fetchAndParse, REFRESH_INTERVAL);
}

/**
 * Get the cached parsed data (for API endpoint)
 */
function getCtyData() {
  return ctyCache;
}

/**
 * Look up a callsign in the parsed data (server-side helper)
 */
function lookupCall(call) {
  if (!ctyCache || !call) return null;
  const upper = call.toUpperCase().replace(/[^A-Z0-9/]/g, '');

  // Handle compound calls: W1/DL5ABC, DL5ABC/W1, etc.
  // Use the prefix part (shorter segment, or segment before /)
  let lookupBase = upper;
  if (upper.includes('/')) {
    const parts = upper.split('/');
    // Common patterns:
    //   DL/W1ABC → DL is the entity (visiting DL)
    //   W1ABC/P, W1ABC/M, W1ABC/QRP → ignore /P /M /QRP suffix
    //   W1ABC/7 → still W1ABC entity (call area override)
    const suffixes = ['P', 'M', 'MM', 'AM', 'QRP', 'A', 'B', 'LH', 'R'];
    if (parts.length === 2) {
      if (suffixes.includes(parts[1]) || /^\d$/.test(parts[1])) {
        lookupBase = parts[0]; // suffix is modifier, use main call
      } else if (parts[0].length <= 4 && parts[1].length > 4) {
        lookupBase = parts[0]; // prefix/call format: DL/W1ABC → DL
      } else if (parts[1].length <= 4 && parts[0].length > 4) {
        lookupBase = parts[1]; // call/prefix format: W1ABC/DL → DL
      } else {
        lookupBase = parts[0]; // fallback: use first part
      }
    }
  }

  // 1. Exact callsign match
  if (ctyCache.exact[lookupBase]) {
    return ctyCache.exact[lookupBase];
  }

  // 2. Longest prefix match (try up to 6 characters, then shorten)
  const maxLen = Math.min(lookupBase.length, 6);
  for (let len = maxLen; len >= 1; len--) {
    const prefix = lookupBase.substring(0, len);
    if (ctyCache.prefixes[prefix]) {
      return ctyCache.prefixes[prefix];
    }
  }

  return null;
}

module.exports = { initCtyData, getCtyData, lookupCall, parseCtyDat };
