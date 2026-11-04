'use strict';
/**
 * logged-adif.js — parse "QSO logged" ADIF packets broadcast by loggers (CommonJS)
 *
 * Loggers with N1MM-compatible UDP output (RUMlogNG's "Contact info ADIF",
 * for example) send one packet per newly logged QSO:
 *
 *   <QsoLoggedInfoAdif>
 *     <AppVersion>…</AppVersion>
 *     <ADIF>&lt;call:5&gt;AA1AA … &lt;eor&gt;</ADIF>
 *   </QsoLoggedInfoAdif>
 *
 * The ADIF record is XML-escaped inside the element. N1MM <contactinfo>,
 * <contactreplace> and <contactdelete> packets are not ADIF and are ignored.
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode XML character and entity references in a single pass. */
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/**
 * Extract the ADIF record from a QsoLoggedInfoAdif packet.
 * @param {string|Buffer} packet - raw UDP payload
 * @returns {string|null} the unescaped ADIF record ending in <eor>, or null
 */
function parseLoggedAdifPacket(packet) {
  const text = Buffer.isBuffer(packet) ? packet.toString('utf8') : String(packet || '');
  if (!/<QsoLoggedInfoAdif\b/.test(text)) return null;
  const m = text.match(/<ADIF>([\s\S]*?)<\/ADIF>/);
  if (!m) return null;
  const adif = unescapeXml(m[1]).trim();
  if (!/<eor>/i.test(adif) || !/<call:\d+>/i.test(adif)) return null;
  return adif;
}

/** Value of one ADIF field, or '' when absent. */
function adifField(adif, name) {
  const m = adif.match(new RegExp(`<${name}:(\\d+)(?::[^>]*)?>`, 'i'));
  if (!m) return '';
  const start = m.index + m[0].length;
  return adif.slice(start, start + parseInt(m[1], 10));
}

/** Short "CALL DATE TIME BAND MODE" summary for log lines. */
function describeAdif(adif) {
  return ['call', 'qso_date', 'time_on', 'band', 'mode']
    .map((f) => adifField(adif, f))
    .filter(Boolean)
    .join(' ');
}

module.exports = { parseLoggedAdifPacket, describeAdif, adifField };
