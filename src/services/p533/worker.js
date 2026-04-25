// Dedicated Web Worker that runs P.533 predictions off the main thread.
//
// Spawned by predictInWorker.js via
//   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
// so Vite tree-shakes and code-splits this file into its own chunk.
//
// Message protocol (main → worker):
//   { id, type: 'predict', params, wasmUrl }
// Response (worker → main):
//   { id, type: 'result', data }            // params echoed inside data.params
//   { id, type: 'error',  message }
//
// wasmUrl is passed per-message so self-hosters can override the WASM origin
// without rebuilding the app. The resolved factory is cached after first
// load — the WASM binary is 200 KB so we only pay that once per worker.
//
// Data files are fetched via dataLoader.js (IndexedDB-cached). The worker has
// its own dataLoader scope, independent of any main-thread cache; IndexedDB
// is the shared persistence layer.

import { getDecileFactors, getMonthFiles } from './dataLoader.js';
import { predict } from './predict.js';

let createModulePromise = null;

async function loadCreateModule(wasmUrl) {
  if (!createModulePromise) {
    createModulePromise = import(/* @vite-ignore */ wasmUrl)
      .then((m) => m.default)
      .catch((err) => {
        createModulePromise = null; // retry on next call rather than poison-caching
        throw err;
      });
  }
  return createModulePromise;
}

self.onmessage = async (e) => {
  const { id, type, params, wasmUrl } = e.data || {};
  if (type !== 'predict') {
    self.postMessage({ id, type: 'error', message: `worker: unknown message type "${type}"` });
    return;
  }
  if (!wasmUrl) {
    self.postMessage({ id, type: 'error', message: 'worker: wasmUrl is required' });
    return;
  }
  try {
    const createModule = await loadCreateModule(wasmUrl);
    const [monthFiles, decile] = await Promise.all([getMonthFiles(params.month), getDecileFactors()]);
    const dataFiles = [...monthFiles, decile];
    const result = await predict({ createModule, params, dataFiles });
    self.postMessage({ id, type: 'result', data: result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
