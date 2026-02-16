/**
 * Callsign and Band Utilities
 * Band detection, mode detection, callsign parsing
 */
import { ctyLookup } from './ctyLookup.js';

/**
 * HF Amateur Bands
 */
export const HF_BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '11m', '10m', '6m', '2m', '70cm'];

/**
 * Continents for DX filtering
 */
export const CONTINENTS = [
  { code: 'NA', name: 'North America' },
  { code: 'SA', name: 'South America' },
  { code: 'EU', name: 'Europe' },
  { code: 'AF', name: 'Africa' },
  { code: 'AS', name: 'Asia' },
  { code: 'OC', name: 'Oceania' },
  { code: 'AN', name: 'Antarctica' }
];

/**
 * Digital/Voice Modes
 */
export const MODES = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY', 'PSK', 'AM', 'FM'];

/**
 * Get band from frequency (in kHz)
 */
export const getBandFromFreq = (freq) => {
  const f = parseFloat(freq);
  // Handle MHz input (convert to kHz)
  const freqKhz = f < 1000 ? f * 1000 : f;
  if (freqKhz >= 1800 && freqKhz <= 2000) return '160m';
  if (freqKhz >= 3500 && freqKhz <= 4000) return '80m';
  if (freqKhz >= 5330 && freqKhz <= 5405) return '60m';
  if (freqKhz >= 7000 && freqKhz <= 7300) return '40m';
  if (freqKhz >= 10100 && freqKhz <= 10150) return '30m';
  if (freqKhz >= 14000 && freqKhz <= 14350) return '20m';
  if (freqKhz >= 18068 && freqKhz <= 18168) return '17m';
  if (freqKhz >= 21000 && freqKhz <= 21450) return '15m';
  if (freqKhz >= 24890 && freqKhz <= 24990) return '12m';
  if (freqKhz >= 26000 && freqKhz <= 28000) return '11m'; // CB band
  if (freqKhz >= 28000 && freqKhz <= 29700) return '10m';
  if (freqKhz >= 50000 && freqKhz <= 54000) return '6m';
  if (freqKhz >= 144000 && freqKhz <= 148000) return '2m';
  if (freqKhz >= 420000 && freqKhz <= 450000) return '70cm';
  return 'other';
};

/**
 * Get band color for map visualization
 */
export const getBandColor = (freq) => {
  const f = parseFloat(freq);
  if (f >= 1.8 && f < 2) return '#ff6666';      // 160m - red
  if (f >= 3.5 && f < 4) return '#ff9966';      // 80m - orange
  if (f >= 7 && f < 7.5) return '#ffcc66';      // 40m - yellow
  if (f >= 10 && f < 10.5) return '#99ff66';    // 30m - lime
  if (f >= 14 && f < 14.5) return '#66ff99';    // 20m - green
  if (f >= 18 && f < 18.5) return '#66ffcc';    // 17m - teal
  if (f >= 21 && f < 21.5) return '#66ccff';    // 15m - cyan
  if (f >= 24 && f < 25) return '#6699ff';      // 12m - blue
  if (f >= 26 && f < 28) return '#8866ff';      // 11m - violet (CB band)
  if (f >= 28 && f < 30) return '#9966ff';      // 10m - purple
  if (f >= 50 && f < 54) return '#ff66ff';      // 6m - magenta
  return '#4488ff';                              // default blue
};

/**
 * Detect mode from comment text
 */
export const detectMode = (comment) => {
  if (!comment) return null;
  const upper = comment.toUpperCase();
  if (upper.includes('FT8')) return 'FT8';
  if (upper.includes('FT4')) return 'FT4';
  if (upper.includes('CW')) return 'CW';
  if (upper.includes('SSB') || upper.includes('LSB') || upper.includes('USB')) return 'SSB';
  if (upper.includes('RTTY')) return 'RTTY';
  if (upper.includes('PSK')) return 'PSK';
  if (upper.includes('AM')) return 'AM';
  if (upper.includes('FM')) return 'FM';
  return null;
};

/**
 * Callsign prefix to CQ/ITU zone and continent mapping
 */
export const PREFIX_MAP = {
  // North America
  'W': { cq: 5, itu: 8, cont: 'NA' }, 'K': { cq: 5, itu: 8, cont: 'NA' }, 
  'N': { cq: 5, itu: 8, cont: 'NA' }, 'AA': { cq: 5, itu: 8, cont: 'NA' },
  'VE': { cq: 5, itu: 4, cont: 'NA' }, 'VA': { cq: 5, itu: 4, cont: 'NA' },
  'XE': { cq: 6, itu: 10, cont: 'NA' }, 'XF': { cq: 6, itu: 10, cont: 'NA' },
  // Europe
  'G': { cq: 14, itu: 27, cont: 'EU' }, 'M': { cq: 14, itu: 27, cont: 'EU' },
  'F': { cq: 14, itu: 27, cont: 'EU' }, 'DL': { cq: 14, itu: 28, cont: 'EU' },
  'DJ': { cq: 14, itu: 28, cont: 'EU' }, 'DK': { cq: 14, itu: 28, cont: 'EU' },
  'PA': { cq: 14, itu: 27, cont: 'EU' }, 'ON': { cq: 14, itu: 27, cont: 'EU' },
  'EA': { cq: 14, itu: 37, cont: 'EU' }, 'I': { cq: 15, itu: 28, cont: 'EU' },
  'SP': { cq: 15, itu: 28, cont: 'EU' }, 'OK': { cq: 15, itu: 28, cont: 'EU' },
  'OM': { cq: 15, itu: 28, cont: 'EU' }, 'HA': { cq: 15, itu: 28, cont: 'EU' },
  'OE': { cq: 15, itu: 28, cont: 'EU' }, 'HB': { cq: 14, itu: 28, cont: 'EU' },
  'SM': { cq: 14, itu: 18, cont: 'EU' }, 'LA': { cq: 14, itu: 18, cont: 'EU' },
  'OH': { cq: 15, itu: 18, cont: 'EU' }, 'OZ': { cq: 14, itu: 18, cont: 'EU' },
  'UA': { cq: 16, itu: 29, cont: 'EU' }, 'RA': { cq: 16, itu: 29, cont: 'EU' },
  'RU': { cq: 16, itu: 29, cont: 'EU' }, 'RW': { cq: 16, itu: 29, cont: 'EU' },
  'UR': { cq: 16, itu: 29, cont: 'EU' }, 'UT': { cq: 16, itu: 29, cont: 'EU' },
  'YU': { cq: 15, itu: 28, cont: 'EU' }, 'YT': { cq: 15, itu: 28, cont: 'EU' },
  'LY': { cq: 15, itu: 29, cont: 'EU' }, 'ES': { cq: 15, itu: 29, cont: 'EU' },
  'YL': { cq: 15, itu: 29, cont: 'EU' }, 'EI': { cq: 14, itu: 27, cont: 'EU' },
  'GI': { cq: 14, itu: 27, cont: 'EU' }, 'GW': { cq: 14, itu: 27, cont: 'EU' },
  'GM': { cq: 14, itu: 27, cont: 'EU' }, 'CT': { cq: 14, itu: 37, cont: 'EU' },
  'SV': { cq: 20, itu: 28, cont: 'EU' }, '9A': { cq: 15, itu: 28, cont: 'EU' },
  'S5': { cq: 15, itu: 28, cont: 'EU' }, 'LZ': { cq: 20, itu: 28, cont: 'EU' },
  'YO': { cq: 20, itu: 28, cont: 'EU' },
  // Asia
  'JA': { cq: 25, itu: 45, cont: 'AS' }, 'JH': { cq: 25, itu: 45, cont: 'AS' },
  'JR': { cq: 25, itu: 45, cont: 'AS' }, 'JE': { cq: 25, itu: 45, cont: 'AS' },
  'JF': { cq: 25, itu: 45, cont: 'AS' }, 'JG': { cq: 25, itu: 45, cont: 'AS' },
  'JI': { cq: 25, itu: 45, cont: 'AS' }, 'JJ': { cq: 25, itu: 45, cont: 'AS' },
  'JK': { cq: 25, itu: 45, cont: 'AS' }, 'JL': { cq: 25, itu: 45, cont: 'AS' },
  'JM': { cq: 25, itu: 45, cont: 'AS' }, 'JN': { cq: 25, itu: 45, cont: 'AS' },
  'JO': { cq: 25, itu: 45, cont: 'AS' }, 'JP': { cq: 25, itu: 45, cont: 'AS' },
  'JQ': { cq: 25, itu: 45, cont: 'AS' }, 'JS': { cq: 25, itu: 45, cont: 'AS' },
  'HL': { cq: 25, itu: 44, cont: 'AS' }, 'DS': { cq: 25, itu: 44, cont: 'AS' },
  'BY': { cq: 24, itu: 44, cont: 'AS' }, 'BV': { cq: 24, itu: 44, cont: 'AS' },
  'VU': { cq: 22, itu: 41, cont: 'AS' }, 
  'DU': { cq: 27, itu: 50, cont: 'OC' }, '9M': { cq: 28, itu: 54, cont: 'AS' },
  'HS': { cq: 26, itu: 49, cont: 'AS' }, 'XV': { cq: 26, itu: 49, cont: 'AS' },
  // Oceania
  'VK': { cq: 30, itu: 59, cont: 'OC' },
  'ZL': { cq: 32, itu: 60, cont: 'OC' }, 'FK': { cq: 32, itu: 56, cont: 'OC' },
  'VK9': { cq: 30, itu: 60, cont: 'OC' }, 'YB': { cq: 28, itu: 51, cont: 'OC' },
  'KH6': { cq: 31, itu: 61, cont: 'OC' }, 'KH2': { cq: 27, itu: 64, cont: 'OC' },
  // South America  
  'LU': { cq: 13, itu: 14, cont: 'SA' }, 'PY': { cq: 11, itu: 15, cont: 'SA' },
  'CE': { cq: 12, itu: 14, cont: 'SA' }, 'CX': { cq: 13, itu: 14, cont: 'SA' },
  'HK': { cq: 9, itu: 12, cont: 'SA' }, 'YV': { cq: 9, itu: 12, cont: 'SA' },
  'HC': { cq: 10, itu: 12, cont: 'SA' }, 'OA': { cq: 10, itu: 12, cont: 'SA' },
  // Africa
  'ZS': { cq: 38, itu: 57, cont: 'AF' }, '5N': { cq: 35, itu: 46, cont: 'AF' },
  'EA8': { cq: 33, itu: 36, cont: 'AF' }, 'CN': { cq: 33, itu: 37, cont: 'AF' },
  '7X': { cq: 33, itu: 37, cont: 'AF' }, 'SU': { cq: 34, itu: 38, cont: 'AF' },
  'ST': { cq: 34, itu: 47, cont: 'AF' }, 'ET': { cq: 37, itu: 48, cont: 'AF' },
  '5Z': { cq: 37, itu: 48, cont: 'AF' }, '5H': { cq: 37, itu: 53, cont: 'AF' },
  // Caribbean
  'VP5': { cq: 8, itu: 11, cont: 'NA' }, 'PJ': { cq: 9, itu: 11, cont: 'SA' },
  'HI': { cq: 8, itu: 11, cont: 'NA' }, 'CO': { cq: 8, itu: 11, cont: 'NA' },
  'KP4': { cq: 8, itu: 11, cont: 'NA' }, 'FG': { cq: 8, itu: 11, cont: 'NA' },
  // Antarctica
  'DP0': { cq: 38, itu: 67, cont: 'AN' }, 'VP8': { cq: 13, itu: 73, cont: 'AN' },
  'KC4': { cq: 13, itu: 67, cont: 'AN' }
};

/**
 * Fallback mapping based on first character
 */
const FALLBACK_MAP = {
  'A': { cq: 21, itu: 39, cont: 'AS' },
  'B': { cq: 24, itu: 44, cont: 'AS' },
  'C': { cq: 14, itu: 27, cont: 'EU' },
  'D': { cq: 14, itu: 28, cont: 'EU' },
  'E': { cq: 14, itu: 27, cont: 'EU' },
  'F': { cq: 14, itu: 27, cont: 'EU' },
  'G': { cq: 14, itu: 27, cont: 'EU' },
  'H': { cq: 14, itu: 27, cont: 'EU' },
  'I': { cq: 15, itu: 28, cont: 'EU' },
  'J': { cq: 25, itu: 45, cont: 'AS' },
  'K': { cq: 5, itu: 8, cont: 'NA' },
  'L': { cq: 13, itu: 14, cont: 'SA' },
  'M': { cq: 14, itu: 27, cont: 'EU' },
  'N': { cq: 5, itu: 8, cont: 'NA' },
  'O': { cq: 15, itu: 18, cont: 'EU' },
  'P': { cq: 11, itu: 15, cont: 'SA' },
  'R': { cq: 16, itu: 29, cont: 'EU' },
  'S': { cq: 15, itu: 28, cont: 'EU' },
  'T': { cq: 37, itu: 48, cont: 'AF' },
  'U': { cq: 16, itu: 29, cont: 'EU' },
  'V': { cq: 5, itu: 4, cont: 'NA' },
  'W': { cq: 5, itu: 8, cont: 'NA' },
  'X': { cq: 6, itu: 10, cont: 'NA' },
  'Y': { cq: 15, itu: 28, cont: 'EU' },
  'Z': { cq: 38, itu: 57, cont: 'AF' }
};

/**
 * Get CQ zone, ITU zone, continent, and entity info from callsign.
 *
 * Uses the cty.dat database (loaded from server on startup) for comprehensive
 * DXCC entity identification with thousands of prefix patterns and exact
 * callsign matches. Falls back to the built-in PREFIX_MAP if cty.dat
 * hasn't loaded yet.
 */
export const getCallsignInfo = (call) => {
  if (!call) return { cqZone: null, ituZone: null, continent: null, entity: null, lat: null, lon: null, dxcc: null };

  // Try cty.dat lookup first (comprehensive: ~400 entities, thousands of prefixes)
  const cty = ctyLookup(call);
  if (cty) {
    return {
      cqZone: cty.cq,
      ituZone: cty.itu,
      continent: cty.cont,
      entity: cty.entity,
      dxcc: cty.dxcc,
      lat: cty.lat,
      lon: cty.lon,
    };
  }

  // Fallback to built-in PREFIX_MAP (used before cty.dat loads or if fetch fails)
  const upper = call.toUpperCase();

  // Try to match prefix (longest match first)
  for (let len = 4; len >= 1; len--) {
    const prefix = upper.substring(0, len);
    if (PREFIX_MAP[prefix]) {
      return {
        cqZone: PREFIX_MAP[prefix].cq,
        ituZone: PREFIX_MAP[prefix].itu,
        continent: PREFIX_MAP[prefix].cont,
        entity: null,
        dxcc: null,
        lat: null,
        lon: null,
      };
    }
  }

  // Fallback based on first character
  const firstChar = upper[0];
  if (FALLBACK_MAP[firstChar]) {
    return {
      cqZone: FALLBACK_MAP[firstChar].cq,
      ituZone: FALLBACK_MAP[firstChar].itu,
      continent: FALLBACK_MAP[firstChar].cont,
      entity: null,
      dxcc: null,
      lat: null,
      lon: null,
    };
  }

  return { cqZone: null, ituZone: null, continent: null, entity: null, lat: null, lon: null, dxcc: null };
};

export default {
  HF_BANDS,
  CONTINENTS,
  MODES,
  getBandFromFreq,
  getBandColor,
  detectMode,
  PREFIX_MAP,
  getCallsignInfo,
};
