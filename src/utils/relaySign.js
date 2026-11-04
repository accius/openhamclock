/**
 * relaySign — sign Cloud Relay commands in the browser.
 *
 * Connect Cloud Relay generates a random 256-bit "command key" here and puts
 * it in the settings the user pastes into Rig Bridge; it is never sent to the
 * OpenHamClock server. Each relay command then carries an HMAC-SHA256 over a
 * canonical form of the command, which Rig Bridge checks before acting — so
 * neither the hosted server nor anyone who learns the session id can tune,
 * key or transmit. Same rules as rig-bridge/lib/relay-sign.js (a test checks
 * both agree).
 *
 * Web Crypto is used when available; pages served over plain HTTP from
 * another host have no crypto.subtle, so a small SHA-256 fallback is included.
 */

const KEY_STORAGE = 'ohc-relay-command-key';
const PREFIX = 'ohc-relay-cmd-v1';
const KEY_RE = /^[0-9a-f]{64}$/;

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

/** JSON with object keys sorted at every level. */
export function canonicalJson(v) {
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

export function signedText(session, ts, nonce, type, payload) {
  return [PREFIX, String(session), String(ts), String(nonce), String(type), canonicalJson(payload ?? {})].join('\n');
}

// ── SHA-256 / HMAC fallback (FIPS 180-4, RFC 2104) ──────────────────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export function sha256(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

export function hmacSha256Fallback(keyBytes, msgBytes) {
  let key = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
  const k = new Uint8Array(64);
  k.set(key);
  const inner = new Uint8Array(64 + msgBytes.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(msgBytes, 64);
  outer.set(sha256(inner), 64);
  key = null;
  return sha256(outer);
}

/** HMAC-SHA256 over bytes → bytes (Web Crypto when available). */
async function hmacBytes(keyBytes, msg) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return new Uint8Array(await subtle.sign('HMAC', k, msg));
    } catch {
      /* fall through to the pure-JS version */
    }
  }
  return hmacSha256Fallback(keyBytes, msg);
}

/** HMAC-SHA256(key hex, text) → lowercase hex. */
export async function hmacHex(keyHex, text) {
  return toHex(await hmacBytes(fromHex(keyHex), new TextEncoder().encode(text)));
}

/**
 * The relay read token: HKDF-SHA256 (RFC 5869, no salt) of the command key
 * with info "ohc-relay-read-v1\n" + session, 32 bytes, as hex. Rig Bridge
 * registers its hash with the server; this browser presents the token.
 */
export async function deriveReadToken(keyHex, session) {
  if (!KEY_RE.test(keyHex || '')) return '';
  const prk = await hmacBytes(new Uint8Array(32), fromHex(keyHex));
  const info = new TextEncoder().encode(`ohc-relay-read-v1\n${session}`);
  const msg = new Uint8Array(info.length + 1);
  msg.set(info);
  msg[info.length] = 1;
  return toHex(await hmacBytes(prk, msg));
}

const readTokenCache = new Map(); // `${key}|${session}` → Promise<token>

/** Headers proving this browser may read the relay session ({} without a key). */
export async function relayReadHeaders(session) {
  const key = getCommandKey();
  if (!key || !session) return {};
  const id = `${key}|${session}`;
  if (!readTokenCache.has(id)) readTokenCache.set(id, deriveReadToken(key, session));
  const token = await readTokenCache.get(id);
  return token ? { 'X-Relay-Read': token } : {};
}

/**
 * URL for the relay's live stream. With a command key, first buys a one-time
 * ticket with the read token (so no secret ever goes in a URL); without one,
 * the plain session URL (accepted only for unpaired sessions, until the grace
 * date).
 * @returns {Promise<{ url: string|null, error?: string, status?: number }>}
 */
export async function relayStreamUrl(session) {
  const base = `/api/rig-bridge/relay/stream?session=${encodeURIComponent(session)}`;
  const headers = await relayReadHeaders(session);
  if (!headers['X-Relay-Read']) return { url: base };
  try {
    const res = await fetch(`/api/rig-bridge/relay/stream-ticket?session=${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
    if (res.status === 404) return { url: base }; // older server without tickets
    if (!res.ok) return { url: null, status: res.status, error: 'refused' };
    const { ticket } = await res.json();
    return { url: `${base}&ticket=${encodeURIComponent(ticket)}` };
  } catch {
    return { url: null, error: 'unreachable' };
  }
}

function randomHex(nBytes) {
  const b = new Uint8Array(nBytes);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

/** A fresh 256-bit command key (64 hex chars). */
export function generateCommandKey() {
  return randomHex(32);
}

export function getCommandKey() {
  try {
    const k = localStorage.getItem(KEY_STORAGE) || '';
    return KEY_RE.test(k) ? k : '';
  } catch {
    return '';
  }
}

export function setCommandKey(key) {
  try {
    if (key && KEY_RE.test(key)) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Sign a relay command.
 * @returns {Promise<{ v: 1, ts: number, nonce: string, sig: string } | null>} null without a key
 */
export async function signRelayCommand(session, type, payload, { key = getCommandKey(), ts = Date.now() } = {}) {
  if (!KEY_RE.test(key || '')) return null;
  const nonce = randomHex(12);
  return { v: 1, ts, nonce, sig: await hmacHex(key, signedText(session, ts, nonce, type, payload)) };
}

let relayRequestSeq = 0;
/** A requestId for a relayed command whose outcome the caller wants to hear about. */
export function newRelayRequestId(prefix = 'rq') {
  return `${prefix}-${Date.now().toString(36)}-${(relayRequestSeq++).toString(36)}`;
}

/**
 * Wait for Rig Bridge's answer to a relayed command that carried `requestId`:
 * a 'relay-cmd-result' (done, ok or not) or a 'relay-cmd-refused' (signature
 * refused) plugin event arriving over the relay stream. Resolves with
 * { ok, status?, reason?, timeout? } — never rejects.
 */
export function waitForRelayAnswer(requestId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (r) => {
      clearTimeout(timer);
      window.removeEventListener('rig-plugin-data', onData);
      resolve(r);
    };
    const onData = (e) => {
      const d = e?.detail;
      if (d?.type !== 'plugin' || d.data?.requestId !== requestId) return;
      if (d.event === 'relay-cmd-result') finish({ ok: !!d.data.ok, status: d.data.status });
      else if (d.event === 'relay-cmd-refused') finish({ ok: false, status: 401, reason: d.data.reason });
    };
    window.addEventListener('rig-plugin-data', onData);
    timer = setTimeout(() => finish({ ok: false, timeout: true }), timeoutMs);
  });
}

/**
 * Queue a command for Rig Bridge through the hosted server, signed when this
 * browser holds the command key.
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function sendRelayCommand(session, type, payload) {
  const auth = await signRelayCommand(session, type, payload);
  try {
    const res = await fetch(`/api/rig-bridge/relay/command?session=${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload, ...(auth ? { auth } : {}) }),
    });
    if (res.ok) return { ok: true, signed: !!auth };
    const data = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: data.error || `HTTP ${res.status}`, signed: !!auth };
  } catch {
    return { ok: false, error: 'unreachable', signed: !!auth };
  }
}
