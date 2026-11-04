/**
 * Kiosk lock — a 4–8 digit PIN that, while locked, keeps casual visitors
 * out of Settings, layout changes and the command palette on a touch
 * display in a club room or hamfest booth.
 *
 * Storage (browser-local, never synced to the server):
 *   openhamclock_kioskPin     {"salt":"…","hash":"…"}  — SHA-256(salt:pin), hex
 *   openhamclock_kioskLocked  "true" while locked
 *
 * URL parameters for kiosk launch scripts (scripts/setup-pi.sh --lock-pin):
 *   ?lock=1        lock on load (a PIN must already be set, or be given below)
 *   ?lockpin=NNNN  set/replace the PIN first (stripped from the address bar)
 *
 * Pure helpers here; the React side is hooks/app/useKioskLock.js. The hash
 * is a compact synchronous SHA-256 so it works everywhere (crypto.subtle is
 * async and unavailable on plain-http LAN origins in some browsers).
 */

export const PIN_KEY = 'openhamclock_kioskPin';
export const LOCKED_KEY = 'openhamclock_kioskLocked';
export const KIOSK_LOCK_EVENT = 'ohc:kiosk-lock';
export const PIN_RE = /^\d{4,8}$/;

// ── SHA-256 (FIPS 180-4), synchronous, ~40 lines ───────────────────────
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

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 of a string (UTF-8) → lowercase hex. */
export function sha256Hex(str) {
  const bytes =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str)
      : Uint8Array.from(unescape(encodeURIComponent(str)), (c) => c.charCodeAt(0));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, (w) => w.toString(16).padStart(8, '0')).join('');
}

// ── PIN record helpers (pure) ──────────────────────────────────────────
export function isValidPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

export function makePinRecord(pin, salt = randomSalt()) {
  if (!isValidPin(pin)) throw new Error('PIN must be 4–8 digits');
  return { salt, hash: sha256Hex(`${salt}:${pin}`) };
}

export function verifyPinRecord(record, pin) {
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  if (!isValidPin(pin)) return false;
  return sha256Hex(`${record.salt}:${pin}`) === record.hash;
}

function randomSalt() {
  try {
    const arr = new Uint8Array(8);
    (globalThis.crypto || window.crypto).getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(16).slice(2, 18);
  }
}

// ── localStorage-backed state ──────────────────────────────────────────
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

const emit = () => {
  try {
    window.dispatchEvent(new CustomEvent(KIOSK_LOCK_EVENT, { detail: getKioskState() }));
  } catch {
    /* non-browser */
  }
};

export function getPinRecord() {
  try {
    const raw = read(PIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const hasPin = () => !!getPinRecord();
export const isLocked = () => read(LOCKED_KEY) === 'true';
export const getKioskState = () => ({ locked: isLocked(), hasPin: hasPin() });

/** Set (or replace) the PIN. → true on success */
export function setPin(pin) {
  if (!isValidPin(pin)) return false;
  write(PIN_KEY, JSON.stringify(makePinRecord(pin)));
  emit();
  return true;
}

/** Remove the PIN (requires the current PIN unless none is set). → true on success */
export function clearPin(currentPin) {
  const rec = getPinRecord();
  if (rec && !verifyPinRecord(rec, currentPin)) return false;
  write(PIN_KEY, null);
  write(LOCKED_KEY, null);
  emit();
  return true;
}

/** Lock the display. Needs a PIN to be set. → true on success */
export function lock() {
  if (!hasPin()) return false;
  write(LOCKED_KEY, 'true');
  emit();
  return true;
}

/** Unlock with a PIN. → true on success */
export function unlock(pin) {
  if (!isLocked()) return true;
  if (!verifyPinRecord(getPinRecord(), pin)) return false;
  write(LOCKED_KEY, null);
  emit();
  return true;
}

/**
 * Honour `?lock=1` / `?lockpin=NNNN` on a URL. Returns what was applied so
 * the caller can strip the parameters from the address bar.
 * → { setPin: boolean, locked: boolean }
 */
export function applyUrlParams(search) {
  const out = { setPin: false, locked: false };
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return out;
  }
  const pin = params.get('lockpin');
  if (pin && isValidPin(pin)) out.setPin = setPin(pin);
  const lockParam = params.get('lock');
  if (lockParam && ['1', 'true', 'yes'].includes(lockParam.toLowerCase())) out.locked = lock();
  return out;
}
