/**
 * Mic-E type bytes, removed from RF stations in the browser (#1245).
 *
 * Mic-E radios wrap their comment in a type byte and, on newer radios, a
 * two-character manufacturer code: `_% (Yaesu FTM-400), ]…= (Kenwood TM-D710)
 * and so on. The server strips them for the stations it serves
 * (server/utils/aprsDeviceId.js), but RF stations reach this browser straight
 * from Rig Bridge and were shown with the bytes as stray punctuation. Same
 * rules and the same vendored aprs-deviceid table (only its Mic-E parts are
 * bundled).
 */
import { mice as MICE, micelegacy as MICE_LEGACY, classes as CLASSES } from '../../server/utils/aprs-deviceid.json';

const known = (v) => (v && !/^unknown$/i.test(String(v).trim()) ? String(v).trim() : '');
const shown = (entry) => {
  if (!entry) return null;
  const vendor = known(entry.vendor);
  const model = known(entry.model);
  if (!vendor && !model) return null;
  const out = {};
  if (vendor) out.vendor = vendor;
  if (model) out.model = model;
  if (entry.class) {
    out.class = entry.class;
    if (CLASSES?.[entry.class]) out.shown = CLASSES[entry.class];
  }
  return out;
};

/** { device, comment } with the Mic-E type bytes taken off `comment`. */
export function identifyMice(comment) {
  if (typeof comment !== 'string' || !comment) return { device: null, comment: comment || '' };
  const prefix = comment.charAt(0);
  const rest = comment.slice(1);
  if (prefix === '`' || prefix === "'") {
    if (rest.length >= 2) {
      const hit = MICE?.[rest.slice(-2)];
      if (hit) return { device: shown(hit), comment: rest.slice(0, -2).trim() };
    }
    return { device: null, comment: rest.trim() };
  }
  if (prefix === '>' || prefix === ']') {
    if (rest.length >= 1) {
      const withSuffix = MICE_LEGACY?.[prefix + rest.slice(-1)];
      if (withSuffix) return { device: shown(withSuffix), comment: rest.slice(0, -1).trim() };
    }
    return { device: shown(MICE_LEGACY?.[prefix]) || null, comment: rest.trim() };
  }
  return { device: null, comment };
}

/**
 * Base-91 comment telemetry ("|" + 2-char sequence + 1–5 channels, plus an
 * optional bits pair, + "|"), e.g. "|!)&2\"`|" (#1245). Same rule as
 * parseCommentTelemetry in server/utils/aprsParser.js, which Rig Bridge 2.6.1+
 * already applies; older bridges send the block in the comment.
 */
const COMMENT_TELEMETRY_RE = /\|[\x21-\x7b]{2}(?:[\x21-\x7b]{2}){1,6}\|/;
export function stripCommentTelemetry(comment) {
  if (typeof comment !== 'string' || !comment) return comment || '';
  const m = comment.match(COMMENT_TELEMETRY_RE);
  if (!m) return comment;
  return `${comment.slice(0, m.index).trimEnd()} ${comment.slice(m.index + m[0].length).trimStart()}`.trim();
}

/**
 * An RF station as Rig Bridge sent it, with the Mic-E bytes (Mic-E packets)
 * and any base-91 telemetry block (every packet type) removed from `comment`
 * and `cleanComment`, and the radio filled in as `device` when the bridge did
 * not already name it. Packets with neither are returned unchanged.
 */
export function cleanRfStation(pkt) {
  if (!pkt) return pkt;
  const mice = pkt.packetType === 'mic-e';
  const clean = (text) => stripCommentTelemetry(mice ? identifyMice(text).comment : text);
  const comment = clean(pkt.comment);
  const cleanComment = typeof pkt.cleanComment === 'string' ? clean(pkt.cleanComment) : pkt.cleanComment;
  if (!mice && comment === (pkt.comment || '') && cleanComment === pkt.cleanComment) return pkt;
  const out = { ...pkt, comment };
  if (typeof pkt.cleanComment === 'string') out.cleanComment = cleanComment;
  if (mice && !pkt.device) {
    const { device } = identifyMice(pkt.comment);
    if (device) out.device = device;
  }
  return out;
}
