// Main-thread convenience that runs P.533 predictions in a dedicated Web
// Worker, so the UI stays responsive across the ~30-300 ms WASM + MEMFS call.
//
// Uses a single long-lived worker per page (singleton) — module instantiation
// is the expensive part and we want to pay it once. Callers who need a fresh
// worker can call terminateWorker() first (handy for tests or manual reset).
//
// Public API:
//   predictInWorker(params)        → Promise<result>
//   predictInWorker(params, opts)  → opts.wasmUrl overrides the module URL
//   terminateWorker()              → stops the worker and fails any pending calls

// Default to the same-origin asset bundled by scripts/fetch-wasm.sh.
// Self-hosters without a local WASM artifact can point this at the public
// wasm-latest release or their own mirror via VITE_P533_WASM_URL.
const DEFAULT_WASM_URL = import.meta.env?.VITE_P533_WASM_URL || '/wasm/p533.mjs';

let worker = null;
let nextId = 1;
const pending = new Map();

function handleMessage(ev) {
  const { id, type, data, message } = ev.data || {};
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (type === 'result') entry.resolve(data);
  else entry.reject(new Error(message || 'worker returned without a result'));
}

function handleError(ev) {
  // The worker crashed hard — fail every pending call and drop the worker so
  // the next predictInWorker() call spins up a fresh one.
  const msg = ev && ev.message ? ev.message : 'p533 worker error';
  for (const { reject } of pending.values()) reject(new Error(msg));
  pending.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = handleMessage;
  worker.onerror = handleError;
  return worker;
}

/**
 * Run a P.533 prediction in a Web Worker.
 *
 * @param {Object}  params          See buildInputConfig in predict.js.
 * @param {Object}  [opts]
 * @param {string}  [opts.wasmUrl]  Override the URL the worker dynamically
 *                                   imports for the Emscripten module.
 * @returns {Promise<Object>}  REST-compatible result (see predict()).
 */
export async function predictInWorker(params, opts = {}) {
  const w = ensureWorker();
  const id = nextId++;
  const wasmUrl = opts.wasmUrl || DEFAULT_WASM_URL;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type: 'predict', params, wasmUrl });
  });
}

/**
 * Tear down the worker and reject any in-flight predictions. Next call to
 * predictInWorker spins up a fresh worker.
 */
export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const { reject } of pending.values()) reject(new Error('p533 worker terminated'));
  pending.clear();
}

// Re-exports for tests that want to inject a fake Worker.
export const __internal = { handleMessage, handleError };
