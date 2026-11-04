/**
 * incidentAuth — ids, join keys and key verification for shared incidents.
 *
 * An incident is addressed by a short random id and guarded by a join key
 * that is handed out exactly once, at creation. The server keeps only a
 * salted SHA-256 of the key, so the persisted incidents file never contains
 * anything that lets a reader join. Verification hashes the presented key
 * with the stored salt and compares digests with crypto.timingSafeEqual, so
 * a wrong key costs the same time whatever its first differing character.
 *
 * Alphabet: 31 symbols without the I/L/O/0/1 lookalikes, because ids and
 * keys get read over a radio and typed on a phone.
 */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 8; // 31^8 ≈ 8.5e11
const KEY_LENGTH = 16; // 31^16 ≈ 7.3e23
const SALT_BYTES = 16;

/** Uniform random string over ALPHABET (rejection-sampled, no modulo bias). */
function randomToken(length) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

const makeIncidentId = () => randomToken(ID_LENGTH);
const makeJoinKey = () => randomToken(KEY_LENGTH);

/** Normalise user input: trim, upper-case, drop separators people add for readability. */
function normaliseToken(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const isValidIncidentId = (id) => typeof id === 'string' && new RegExp(`^[${ALPHABET}]{${ID_LENGTH}}$`).test(id);

/** @returns {{ salt: string, hash: string }} hex-encoded */
function hashJoinKey(key, salt = crypto.randomBytes(SALT_BYTES).toString('hex')) {
  const hash = crypto
    .createHash('sha256')
    .update(`${salt}:${normaliseToken(key)}`)
    .digest('hex');
  return { salt, hash };
}

/** Constant-time check of a presented key against a stored salt + hash. */
function verifyJoinKey(presented, salt, hash) {
  if (typeof salt !== 'string' || typeof hash !== 'string' || !presented) return false;
  const candidate = hashJoinKey(presented, salt).hash;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * A plausible amateur callsign (prefix with a digit, 1–4 letter suffix,
 * optional portable designator). Placeholder calls are refused: the hosted
 * site uses this to tie each new incident to a real-looking station.
 */
function isValidCallsign(call) {
  const c = String(call || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{1,3}\d[A-Z]{1,4}(\/[A-Z0-9]{1,4})?$/.test(c)) return false;
  return !/^N0CALL\b|^NOCALL\b|^MYCALL\b/.test(c);
}

/**
 * The join key, sealed so only an admin can read it back: AES-256-GCM under a
 * key derived (HKDF-SHA256, per-seal random salt) from the admin key. The
 * server never stores the join key in plaintext and cannot open the seal
 * without an admin presenting their key. Admin keys carry ~79 bits of
 * entropy, so a fast KDF is enough.
 */
function sealJoinKey(joinKey, adminKey) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(crypto.hkdfSync('sha256', normaliseToken(adminKey), salt, 'ohc-incident-join-key', 32));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(normaliseToken(joinKey), 'utf8'), cipher.final()]);
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ct: ct.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

/** → the join key, or null when the admin key is wrong or the seal is damaged. */
function openJoinKey(sealed, adminKey) {
  if (!sealed?.salt || !sealed?.iv || !sealed?.ct || !sealed?.tag || !adminKey) return null;
  try {
    const key = Buffer.from(
      crypto.hkdfSync('sha256', normaliseToken(adminKey), Buffer.from(sealed.salt, 'hex'), 'ohc-incident-join-key', 32),
    );
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Random opaque token for one-time stream tickets (url-safe, 32 chars). */
const makeTicket = () => crypto.randomBytes(24).toString('base64url');

module.exports = {
  ALPHABET,
  isValidCallsign,
  makeTicket,
  sealJoinKey,
  openJoinKey,
  ID_LENGTH,
  KEY_LENGTH,
  randomToken,
  makeIncidentId,
  makeJoinKey,
  normaliseToken,
  isValidIncidentId,
  hashJoinKey,
  verifyJoinKey,
};
