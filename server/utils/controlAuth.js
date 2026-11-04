'use strict';
/**
 * Authorization for the remote-control API (server/routes/control.js).
 *
 * Two keys open a display:
 *   • the server's global API_WRITE_KEY (master key, as for every write
 *     endpoint) — when it is unset the server is open, as elsewhere;
 *   • the display's own *pairing secret*: a random string the browser
 *     generates next to its controlId and registers with its first state
 *     report / stream subscription. The server keeps only a SHA-256 hash.
 *     The QR code in Settings → Station carries it, so a phone can drive its
 *     own display on a server whose API_WRITE_KEY it must never see.
 *
 * Pure functions, no I/O; comparisons are constant-time.
 */

const crypto = require('crypto');

const CONTROL_SECRET_RE = /^[A-Za-z0-9_-]{24,128}$/;

/** Is this a usable pairing secret (the browser's `controlSecret`)? */
function isValidControlSecret(s) {
  return typeof s === 'string' && CONTROL_SECRET_RE.test(s);
}

/** SHA-256 hex of a secret — the only form the server stores. */
function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

/** Constant-time equality of two strings (lengths may differ). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Does a presented secret match a stored hash? */
function secretMatches(secret, secretHash) {
  if (!secretHash || typeof secret !== 'string' || !secret) return false;
  return safeEqual(hashSecret(secret), secretHash);
}

/**
 * Bearer token / pairing key a *client* (phone, curl) presents:
 * `Authorization: Bearer <key>`, `X-Control-Secret: <key>` or `?key=`.
 * @param {{ headers?: object, query?: object }} req
 */
function extractClientToken(req) {
  const auth = req?.headers?.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim();
    if (t) return t;
  }
  const hdr = req?.headers?.['x-control-secret'];
  if (typeof hdr === 'string' && hdr.trim()) return hdr.trim();
  const q = req?.query?.key;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return '';
}

/**
 * Secret a *display* presents on its own endpoints (report / stream /
 * capture upload): body `secret`, `?secret=` or `X-Control-Secret`.
 */
function extractDisplaySecret(req) {
  const b = req?.body?.secret;
  if (typeof b === 'string' && b) return b;
  const q = req?.query?.secret;
  if (typeof q === 'string' && q) return q;
  const h = req?.headers?.['x-control-secret'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return '';
}

/**
 * Decide whether a client may command / read a display.
 *
 * @param {object} o
 * @param {string} o.token        what the client presented ('' when nothing)
 * @param {string} o.apiWriteKey  server master key ('' when unset = open server)
 * @param {string|null} o.target  display id, or null for broadcast
 * @param {string|null} o.secretHash  the target's registered pairing hash (null when unregistered/unknown)
 * @returns {{ ok: true, via: 'open'|'master'|'pairing' } | { ok: false, status: number, error: string }}
 */
function authorizeControl({ token = '', apiWriteKey = '', target = null, secretHash = null } = {}) {
  if (apiWriteKey && safeEqual(token, apiWriteKey)) return { ok: true, via: 'master' };
  if (target && secretMatches(token, secretHash)) return { ok: true, via: 'pairing' };
  if (!apiWriteKey) return { ok: true, via: 'open' }; // no master key configured = open (local installs)

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: target
        ? 'Unauthorized — send the display’s pairing key (Settings → Station) or the server’s API_WRITE_KEY as Authorization: Bearer <key>'
        : 'Unauthorized — broadcast commands need Authorization: Bearer <API_WRITE_KEY>; or pass ?target=<controlId> with its pairing key',
    };
  }
  if (target && !secretHash) {
    return { ok: false, status: 403, error: 'Display has not paired yet (it has not reported) — key not accepted' };
  }
  return { ok: false, status: 403, error: target ? 'Wrong pairing key for this display' : 'Wrong API key' };
}

/**
 * Decide whether a display may register / use its own channel.
 * First registration claims the id; afterwards the same secret is required.
 *
 * @returns {{ ok: true, claim: string|null } | { ok: false, status: number, error: string }}
 *   `claim` is the hash to store when this call registers a new secret.
 */
function authorizeDisplay({ secret = '', secretHash = null } = {}) {
  if (secretHash) {
    if (secretMatches(secret, secretHash)) return { ok: true, claim: null };
    return {
      ok: false,
      status: 403,
      error: secret
        ? 'This display id is paired with another browser — choose “New id” in Settings → Station'
        : 'This display id is paired — the display must send its pairing secret',
    };
  }
  if (!secret) return { ok: true, claim: null }; // unpaired display (older client)
  if (!isValidControlSecret(secret)) {
    return { ok: false, status: 400, error: 'secret must be 24–128 url-safe characters' };
  }
  return { ok: true, claim: hashSecret(secret) };
}

module.exports = {
  CONTROL_SECRET_RE,
  isValidControlSecret,
  hashSecret,
  safeEqual,
  secretMatches,
  extractClientToken,
  extractDisplaySecret,
  authorizeControl,
  authorizeDisplay,
};
