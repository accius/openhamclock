'use strict';
/**
 * hamalertParser.js — HamAlert telnet line parser (CommonJS copy of
 * src/utils/hamalertParser.js, also at rig-bridge/lib/hamalert-parser.js; the vitest parity
 * test in this directory fails if they drift).
 *
 * HamAlert's telnet destination (hamalert.org:7300) speaks DX-cluster
 * dialect: after "login:" / "password:" prompts it greets you and then
 * pushes one line per matched alert:
 *
 *   DX de HAMALERT: 14074.0  DL1ABC   FT8 -12 dB [pskreporter]    1234Z
 *   DX de HAMALERT: 7032.0   OE5XYZ   CW SOTA OE/OO-123 (sotawatch) 0915Z JN68
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

function isHamAlertLine(line) {
  return typeof line === 'string' && /^DX de\s/i.test(line.trim());
}
function isLoginPrompt(line) {
  return typeof line === 'string' && /login\s*:?\s*$/i.test(line.trim());
}
function isPasswordPrompt(line) {
  return typeof line === 'string' && /password\s*:?\s*$/i.test(line.trim());
}
function isWelcomeLine(line) {
  return typeof line === 'string' && /this is hamalert|hello\s+\S+,?\s+this is/i.test(line);
}

function extractMode(comment) {
  if (!comment) return null;
  const upper = String(comment).toUpperCase();
  for (const mode of MODE_TOKENS) {
    if (new RegExp(`(^|[^A-Z0-9])${mode}([^A-Z0-9]|$)`).test(upper)) return mode;
  }
  return null;
}

function extractSource(comment) {
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

function hhmmToTimestamp(hhmm, now = Date.now()) {
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

function parseHamAlertLine(line, now = Date.now()) {
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
    freq: (freqKhz / 1000).toFixed(3),
    mode: extractMode(comment),
    source: extractSource(comment),
    comment,
    time: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}z`,
    timestamp: hhmmToTimestamp(hhmm, now),
    grid,
    raw: trimmed,
  };
}

function hamAlertKey(alert) {
  if (!alert) return '';
  return `${alert.call}|${Math.round((alert.freqKhz || 0) * 100)}|${alert.time || ''}`;
}

module.exports = {
  isHamAlertLine,
  isLoginPrompt,
  isPasswordPrompt,
  isWelcomeLine,
  extractMode,
  extractSource,
  hhmmToTimestamp,
  parseHamAlertLine,
  hamAlertKey,
};
