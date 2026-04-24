// Browser-side loader for ITU-R P.533 coefficient tables.
//
// Fetches gzip'd coefficient files from a GitHub Release, decompresses them in
// the browser via DecompressionStream, and caches the raw bytes in IndexedDB
// keyed by (version, filename). Callers get Uint8Arrays ready to write into
// Emscripten MEMFS at `/data/<filename>` with the canonical P.533 names.
//
// Monthly files (~11.3 MB uncompressed per month) are fetched lazily — the
// active month is requested on first prediction, remaining months on idle
// prefetch (see prewarmMonth). The decile-factors file (month-independent) is
// fetched once and reused.
//
// The release asset names use hyphens instead of spaces for URL sanity; we
// rename back to the canonical name (e.g. "P1239-3 Decile Factors.txt") before
// returning so callers never have to know the transport detail.

const DEFAULT_VERSION = 'v14.3';
const DEFAULT_BASE_URL = `https://github.com/accius/openhamclock/releases/download/p533-data-${DEFAULT_VERSION}/`;

const BASE_URL = normaliseBaseUrl(import.meta.env?.VITE_P533_DATA_URL || DEFAULT_BASE_URL);
const VERSION = import.meta.env?.VITE_P533_DATA_VERSION || DEFAULT_VERSION;

const DB_NAME = 'p533-data';
const DB_VERSION = 1;
const STORE = 'files';

const CANONICAL_DECILE_NAME = 'P1239-3 Decile Factors.txt';
const DECILE_ASSET = 'P1239-3-Decile-Factors.txt.gz';

// In-flight de-duplication: if two callers request the same file at once,
// both await the same fetch. Keyed by asset filename (transport name, not
// canonical).
const inFlight = new Map();

// Cached manifest promise — one network fetch per session regardless of
// how many files we end up loading.
let manifestPromise = null;

function normaliseBaseUrl(url) {
  return url.endsWith('/') ? url : url + '/';
}

function padMonth(month) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`p533 dataLoader: invalid month ${month} (expected 1-12)`);
  }
  return String(m).padStart(2, '0');
}

function assetsForMonth(month) {
  const mm = padMonth(month);
  return [
    { asset: `ionos${mm}.bin.gz`, canonical: `ionos${mm}.bin` },
    { asset: `COEFF${mm}W.txt.gz`, canonical: `COEFF${mm}W.txt` },
  ];
}

// ── IndexedDB wrapper ────────────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(asset) {
  return `${VERSION}/${asset}`;
}

async function idbGet(asset) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(asset));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null; // cache is best-effort; fall through to network
  }
}

async function idbPut(asset, bytes) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, cacheKey(asset));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Quota exceeded, private mode, etc. — caching is best-effort.
  }
}

// ── Network fetch + decompression + integrity ───────────────────────────────

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const res = await fetch(BASE_URL + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) {
        manifestPromise = null; // don't cache failure — next call retries
        throw new Error(`p533 manifest fetch failed: ${res.status}`);
      }
      return await res.json();
    })();
  }
  return manifestPromise;
}

async function expectedSha256For(asset) {
  try {
    const manifest = await fetchManifest();
    const entry = manifest.files?.find((f) => f.name === asset);
    return entry?.sha256 ?? null;
  } catch {
    return null; // manifest unavailable → skip integrity check
  }
}

async function gunzip(bytes) {
  // Response.body gives us a ReadableStream in both browsers and Node 22+;
  // Blob.stream() would be the shorter path but jsdom's Blob lacks it.
  const source = new Response(bytes).body;
  const decoded = source.pipeThrough(new DecompressionStream('gzip'));
  const ab = await new Response(decoded).arrayBuffer();
  return new Uint8Array(ab);
}

async function fetchAndDecompress(asset) {
  const url = BASE_URL + asset;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`p533 fetch ${asset} failed: ${res.status} ${res.statusText}`);
  }
  const gz = new Uint8Array(await res.arrayBuffer());
  const expected = await expectedSha256For(asset);
  if (expected) {
    const actual = await sha256Hex(gz);
    if (actual !== expected) {
      throw new Error(`p533 ${asset}: sha256 mismatch (expected ${expected}, got ${actual})`);
    }
  }
  return await gunzip(gz);
}

async function loadAsset(asset) {
  const cached = await idbGet(asset);
  if (cached) return cached;

  if (inFlight.has(asset)) return inFlight.get(asset);
  const promise = fetchAndDecompress(asset).then(async (bytes) => {
    await idbPut(asset, bytes);
    return bytes;
  });
  inFlight.set(asset, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(asset);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the two month-keyed coefficient files required for a P.533 prediction.
 * Cached in IndexedDB across sessions.
 *
 * @param {number} month  1..12
 * @returns {Promise<Array<{name: string, bytes: Uint8Array}>>}
 */
export async function getMonthFiles(month) {
  const spec = assetsForMonth(month);
  const bytes = await Promise.all(spec.map((s) => loadAsset(s.asset)));
  return spec.map((s, i) => ({ name: s.canonical, bytes: bytes[i] }));
}

/**
 * Get the month-independent P.1239-3 decile factors file. Cached for the life
 * of the session and in IndexedDB across sessions.
 *
 * @returns {Promise<{name: string, bytes: Uint8Array}>}
 */
export async function getDecileFactors() {
  const bytes = await loadAsset(DECILE_ASSET);
  return { name: CANONICAL_DECILE_NAME, bytes };
}

/**
 * Fire-and-forget prefetch for a month's files. Used for idle-time warming
 * (e.g. fetch next month when user scrubs the timeline).
 */
export function prewarmMonth(month) {
  const spec = assetsForMonth(month);
  for (const s of spec) {
    loadAsset(s.asset).catch(() => {}); // swallow — this is opportunistic
  }
}

/**
 * Drop all cached P.533 files. Used for manual invalidation or version migration.
 */
export async function clearCache() {
  manifestPromise = null;
  inFlight.clear();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}

// Re-exports for tests and diagnostics.
export const __internal = {
  BASE_URL,
  VERSION,
  cacheKey,
  assetsForMonth,
  padMonth,
  gunzip,
  sha256Hex,
};
