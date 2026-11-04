/**
 * HamAlert telnet line parser (shared with rig-bridge/lib/hamalert-parser.js —
 * keep the two in sync; the rig-bridge copy is CommonJS).
 *
 * HamAlert's telnet destination (hamalert.org:7300) speaks DX-cluster
 * dialect: after "login:" / "password:" prompts it greets you and then
 * pushes one line per matched alert:
 *
 *   DX de HAMALERT: 14074.0  DL1ABC   FT8 -12 dB [pskreporter]    1234Z
 *   DX de HAMALERT: 7032.0   OE5XYZ   CW SOTA OE/OO-123 (sotawatch) 0915Z JN68
 *
 * Frequency is kHz, the comment carries whatever HamAlert put together
 * (mode, signal report, source in brackets/parentheses, SOTA/POTA/IOTA
 * references…), then the UTC time and an optional locator. The parser is
 * deliberately tolerant: anything after the call up to the trailing time is
 * the comment, and mode/source are best-effort extractions from it.
 */

const LINE_RE =
  /^DX de\s+([A-Z0-9/\-#]+?):?\s+(\d+(?:\.\d+)?)\s+([A-Z0-9/\-]+)\s*(.*?)\s*(\d{4})Z?(?:\s+([A-R]{2}\d{2}(?:[A-X]{2})?))?\s*$/i;

const MODE_TOKENS = [
  'FT8',
  'FT4',
  'FT2',
  'CW',
  'SSB',
  'USB',
  'LSB',
  'RTTY',
  'PSK31',
  'PSK63',
  'PSK',
  'JS8',
  'MSK144',
  'JT65',
  'JT9',
  'Q65',
  'WSPR',
  'FM',
  'AM',
  'DIGI',
  'SSTV',
  'OLIVIA',
  'HELL',
  'FSK441',
  'DMR',
  'DSTAR',
  'C4FM',
];

const SOURCE_PATTERNS = [
  [/\bsotawatch\b|\bsota\b/i, 'sota'],
  [/\bpota\b|\bparks on the air\b/i, 'pota'],
  [/\bwwff\b/i, 'wwff'],
  [/\bpskreporter\b|\bpsk\s*reporter\b/i, 'pskreporter'],
  [/\brbn\b|\bskimmer\b|\breverse beacon\b/i, 'rbn'],
  [/\bwspr(?:net)?\b/i, 'wsprnet'],
  [/\bcluster\b|\bdxcluster\b|\bdx\s*cluster\b/i, 'cluster'],
  [/\bdxw\b|\bdx-?world\b/i, 'dxworld'],
  [/\biota\b/i, 'iota'],
];

/** True when a line looks like a HamAlert (or any DX-cluster) spot line. */
export function isHamAlertLine(line) {
  return typeof line === 'string' && /^DX de\s/i.test(line.trim());
}

/** Telnet handshake helpers. */
export function isLoginPrompt(line) {
  return typeof line === 'string' && /login\s*:?\s*$/i.test(line.trim());
}
export function isPasswordPrompt(line) {
  return typeof line === 'string' && /password\s*:?\s*$/i.test(line.trim());
}
export function isWelcomeLine(line) {
  return typeof line === 'string' && /this is hamalert|hello\s+\S+,?\s+this is/i.test(line);
}

/** Mode keyword from a comment, uppercased, or null. */
export function extractMode(comment) {
  if (!comment) return null;
  const upper = String(comment).toUpperCase();
  for (const mode of MODE_TOKENS) {
    if (new RegExp(`(^|[^A-Z0-9])${mode}([^A-Z0-9]|$)`).test(upper)) return mode;
  }
  return null;
}

/**
 * Source hint from a comment: bracketed/parenthesised tag first
 * ("[pskreporter]", "(sotawatch)"), then known keywords anywhere.
 * Returns a lowercase token or null.
 */
export function extractSource(comment) {
  if (!comment) return null;
  const tag = /[[(]\s*([a-z0-9 _\-.]+?)\s*[\])]/i.exec(comment);
  if (tag) {
    const t = tag[1].trim();
    for (const [re, name] of SOURCE_PATTERNS) if (re.test(t)) return name;
    return t.toLowerCase().slice(0, 20);
  }
  for (const [re, name] of SOURCE_PATTERNS) if (re.test(comment)) return name;
  return null;
}

/**
 * UTC timestamp (ms) for an HHMM token relative to `now`: today at that
 * time, or yesterday if that would be more than 5 minutes in the future.
 */
export function hhmmToTimestamp(hhmm, now = Date.now()) {
  const m = /^(\d{2})(\d{2})$/.exec(hhmm || '');
  if (!m) return now;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return now;
  const d = new Date(now);
  let ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm, 0, 0);
  if (ts - now > 5 * 60 * 1000) ts -= 24 * 60 * 60 * 1000;
  return ts;
}

/**
 * Parse one telnet line into an alert, or null when it isn't a spot line.
 *
 * @returns {{
 *   spotter: string, call: string, freqKhz: number, freq: string,
 *   mode: string|null, source: string|null, comment: string,
 *   time: string, timestamp: number, grid: string|null, raw: string
 * }|null}
 */
export function parseHamAlertLine(line, now = Date.now()) {
  if (typeof line !== 'string') return null;
  const trimmed = line.replace(/\s+$/, '').replace(/^\s+/, '');
  const m = LINE_RE.exec(trimmed);
  if (!m) return null;
  const freqKhz = parseFloat(m[2]);
  if (!Number.isFinite(freqKhz) || freqKhz <= 0) return null;
  const call = m[3].toUpperCase();
  const comment = (m[4] || '').replace(/\s+/g, ' ').trim();
  const hhmm = m[5];
  const grid = m[6] ? m[6].toUpperCase() : null;
  return {
    spotter: m[1].toUpperCase(),
    call,
    freqKhz,
    freq: (freqKhz / 1000).toFixed(3), // MHz string, same shape as DX cluster spots
    mode: extractMode(comment),
    source: extractSource(comment),
    comment,
    time: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}z`,
    timestamp: hhmmToTimestamp(hhmm, now),
    grid,
    raw: trimmed,
  };
}

/** Stable identity for de-duplication: call + freq (10 Hz) + minute. */
export function hamAlertKey(alert) {
  if (!alert) return '';
  return `${alert.call}|${Math.round((alert.freqKhz || 0) * 100)}|${alert.time || ''}`;
}
