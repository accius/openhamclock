/**
 * icsChirp — CHIRP generic CSV export/import for the ICS 205 channel plan.
 *
 * CHIRP's generic CSV (File → Import / Export in CHIRP) uses these columns:
 *   Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,
 *   DtcsPolarity,Mode,TStep,Skip,Comment,URCALL,RPT1CALL,RPT2CALL
 *
 * Mapping from an ICS 205 row (RX = what the radio listens on, TX = what it
 * transmits on):
 *   Frequency  = RX
 *   Duplex     = '' (simplex), '+' / '-' (TX above / below RX by ≤ 25 MHz),
 *                'split' (cross-band or larger: Offset holds the TX frequency),
 *                'off' (receive only — no TX frequency)
 *   Offset     = |TX − RX| (or the TX frequency for 'split')
 *   Tone       = ''      no tones
 *                'Tone'  TX CTCSS only (rToneFreq)
 *                'TSQL'  same CTCSS both ways (cToneFreq)
 *                'DTCS'  DCS code, e.g. "D023N" (DtcsCode / DtcsPolarity)
 *                'Cross' different TX and RX CTCSS (rToneFreq TX, cToneFreq RX)
 *   Mode       = FM / NFM from N/W for analog; DV, DMR, DN, DIG for digital
 */
import { csvEscape } from './emcommEventLog.js';
import { newIcs205Row, formatPlanFreq, numberChannels } from './icsForms.js';

export const CHIRP_COLUMNS = [
  'Location',
  'Name',
  'Frequency',
  'Duplex',
  'Offset',
  'Tone',
  'rToneFreq',
  'cToneFreq',
  'DtcsCode',
  'DtcsPolarity',
  'Mode',
  'TStep',
  'Skip',
  'Comment',
  'URCALL',
  'RPT1CALL',
  'RPT2CALL',
];

const DEFAULT_TONE = '88.5';
const DEFAULT_DTCS = '023';
/** Largest TX/RX difference written as +/- duplex; beyond this it's a split. */
const MAX_DUPLEX_MHZ = 25;

const mhz6 = (n) => (Number.isFinite(n) ? n.toFixed(6) : '');

/** Parse a CTCSS tone ("100.0", "100 Hz") → "100.0", or '' if none. */
export function parseCtcss(value) {
  const m = /^\s*(\d{2,3}(?:\.\d)?)\s*(?:hz)?\s*$/i.exec(String(value || ''));
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 60 && n <= 260 ? n.toFixed(1) : '';
}

/** Parse a DCS code ("D023N", "023", "DCS 754I") → { code: '023', polarity: 'N'|'R' } or null. */
export function parseDcs(value) {
  const m = /^\s*(?:DCS\s*)?D?\s*([0-7]{3})\s*([NIR])?\s*$/i.exec(String(value || ''));
  if (!m || !/^\s*(?:DCS|D)/i.test(String(value || ''))) return null;
  const pol = (m[2] || 'N').toUpperCase();
  return { code: m[1], polarity: pol === 'N' ? 'N' : 'R' };
}

/** CHIRP mode for a 205 row. */
export function chirpMode(row) {
  const name = String(row.modeName || '').toUpperCase();
  if (row.mode === 'D' || row.mode === 'M') {
    if (/D-?STAR|\bDV\b/.test(name)) return 'DV';
    if (/DMR/.test(name)) return 'DMR';
    if (/YSF|FUSION|C4FM|\bDN\b/.test(name)) return 'DN';
    if (row.mode === 'D') return 'DIG';
  }
  if (/\bAM\b/.test(name)) return 'AM';
  return row.rxNW === 'N' ? 'NFM' : 'FM';
}

/** One CHIRP CSV record (array in CHIRP_COLUMNS order) for a 205 row, or null if it has no RX frequency. */
export function chirpRecord(row, location) {
  const rx = Number(row.rxFreq);
  if (!Number.isFinite(rx) || rx <= 0) return null;
  const txRaw = String(row.txFreq ?? '').trim();
  const tx = Number(txRaw);
  let duplex = '';
  let offset = 0;
  if (!txRaw) {
    duplex = 'off';
  } else if (Number.isFinite(tx) && tx > 0 && Math.abs(tx - rx) > 1e-6) {
    const diff = tx - rx;
    if (Math.abs(diff) <= MAX_DUPLEX_MHZ) {
      duplex = diff > 0 ? '+' : '-';
      offset = Math.abs(diff);
    } else {
      duplex = 'split';
      offset = tx;
    }
  }

  let tone = '';
  let rTone = DEFAULT_TONE;
  let cTone = DEFAULT_TONE;
  let dtcs = DEFAULT_DTCS;
  let pol = 'NN';
  const txCt = parseCtcss(row.txTone);
  const rxCt = parseCtcss(row.rxTone);
  const txDcs = parseDcs(row.txTone);
  const rxDcs = parseDcs(row.rxTone);
  if (txDcs || rxDcs) {
    tone = 'DTCS';
    dtcs = (txDcs || rxDcs).code;
    pol = `${(txDcs || rxDcs).polarity}${(rxDcs || txDcs).polarity}`;
  } else if (txCt && rxCt && txCt === rxCt) {
    tone = 'TSQL';
    cTone = rxCt;
    rTone = txCt;
  } else if (txCt && rxCt) {
    tone = 'Cross';
    rTone = txCt;
    cTone = rxCt;
  } else if (txCt) {
    tone = 'Tone';
    rTone = txCt;
  }

  const comment = [row.function, row.assignment, row.remarks].filter((s) => String(s || '').trim()).join(' · ');
  return [
    String(location),
    String(row.name || ''),
    mhz6(rx),
    duplex,
    mhz6(offset),
    tone,
    rTone,
    cTone,
    dtcs,
    pol,
    chirpMode(row),
    '5.00',
    '',
    comment,
    '',
    '',
    '',
  ];
}

/**
 * CHIRP generic CSV for the plan. Location is the row's numeric Ch # when
 * every row has a distinct one, otherwise the row order starting at 1.
 */
export function ics205ToChirpCsv(rows) {
  const numbered = numberChannels(rows || []);
  const chs = numbered.map((r) => Number(r.ch));
  const useCh = chs.every((n) => Number.isInteger(n) && n >= 0) && new Set(chs).size === chs.length;
  const lines = [CHIRP_COLUMNS.join(',')];
  numbered.forEach((r, i) => {
    const rec = chirpRecord(r, useCh ? chs[i] : i + 1);
    if (rec) lines.push(rec.map(csvEscape).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

/** Minimal RFC 4180 CSV parser → array of string arrays. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const raw = String(text || '');
  const s = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // drop a UTF-8 byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const MODE_TO_ICS = { FM: 'A', NFM: 'A', WFM: 'A', AM: 'A', USB: 'A', LSB: 'A', CW: 'A' };

/**
 * ICS 205 rows from a CHIRP generic CSV (inverse of ics205ToChirpCsv).
 * Throws when the header has no Frequency column.
 */
export function chirpCsvToIcs205Rows(text) {
  const table = parseCsv(text);
  if (!table.length) return [];
  const head = table[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  if (col('Frequency') < 0) throw new Error('Not a CHIRP CSV: no Frequency column');
  const get = (r, name) => {
    const i = col(name);
    return i >= 0 ? String(r[i] ?? '').trim() : '';
  };
  const out = [];
  for (const r of table.slice(1)) {
    const rx = Number(get(r, 'Frequency'));
    if (!Number.isFinite(rx) || rx <= 0) continue;
    const duplex = get(r, 'Duplex').toLowerCase();
    const offset = Number(get(r, 'Offset')) || 0;
    let tx = rx;
    if (duplex === '+') tx = rx + offset;
    else if (duplex === '-') tx = rx - offset;
    else if (duplex === 'split') tx = offset || rx;
    else if (duplex === 'off') tx = null;

    const toneMode = get(r, 'Tone');
    const rTone = parseCtcss(get(r, 'rToneFreq'));
    const cTone = parseCtcss(get(r, 'cToneFreq'));
    const code = get(r, 'DtcsCode') || DEFAULT_DTCS;
    const pol = (get(r, 'DtcsPolarity') || 'NN').toUpperCase();
    let txTone = '';
    let rxTone = '';
    if (toneMode === 'Tone') txTone = rTone;
    else if (toneMode === 'TSQL') txTone = rxTone = cTone || rTone;
    else if (toneMode === 'DTCS') {
      const p = (c) => (c === 'R' ? 'I' : 'N');
      txTone = `D${code.padStart(3, '0')}${p(pol[0])}`;
      rxTone = `D${code.padStart(3, '0')}${p(pol[1] || pol[0])}`;
    } else if (toneMode === 'Cross') {
      txTone = rTone;
      rxTone = cTone;
    }

    const chirpModeName = get(r, 'Mode').toUpperCase();
    const mode = MODE_TO_ICS[chirpModeName] || (chirpModeName ? 'D' : 'A');
    const nw = chirpModeName === 'NFM' ? 'N' : 'W';
    out.push(
      newIcs205Row({
        ch: get(r, 'Location'),
        function: duplex === '' ? 'Simplex' : duplex === 'off' ? 'Receive only' : 'Repeater',
        name: get(r, 'Name'),
        rxFreq: formatPlanFreq(rx),
        rxNW: nw,
        rxTone,
        txFreq: tx == null ? '' : formatPlanFreq(tx),
        txNW: nw,
        txTone,
        mode,
        modeName: chirpModeName,
        remarks: get(r, 'Comment'),
        source: 'chirp',
      }),
    );
  }
  return out;
}
