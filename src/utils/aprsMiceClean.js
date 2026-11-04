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
 * An RF station as Rig Bridge sent it, with the Mic-E bytes removed from
 * `comment` and `cleanComment` and the radio filled in as `device` when the
 * bridge did not already name it. Non-Mic-E packets are returned unchanged.
 */
export function cleanRfStation(pkt) {
  if (!pkt || pkt.packetType !== 'mic-e') return pkt;
  const c = identifyMice(pkt.comment);
  const out = { ...pkt, comment: c.comment };
  if (typeof pkt.cleanComment === 'string') out.cleanComment = identifyMice(pkt.cleanComment).comment;
  if (!pkt.device && c.device) out.device = c.device;
  return out;
}
