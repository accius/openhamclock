// Main-thread handle on the FT8 worker (worker.js). One worker per listening
// session: created on Start, terminated on Stop.
//
// The WASM comes from the same origin by default (public/wasm/ft8.mjs,
// installed by scripts/fetch-wasm.js); VITE_FT8_WASM_URL points elsewhere.
const DEFAULT_WASM_URL = import.meta.env?.VITE_FT8_WASM_URL || '/wasm/ft8.mjs';

/**
 * @param {{ onSlot?: Function, onStatus?: (s: 'loading'|'ready'|'unavailable', message?: string) => void,
 *           onLevel?: Function, wasmUrl?: string, WorkerImpl?: typeof Worker }} opts
 */
export function createFt8Client({ onSlot, onStatus, onLevel, wasmUrl = DEFAULT_WASM_URL, WorkerImpl, emitAtSec } = {}) {
  // Keep the literal `new Worker(new URL(...))` form: that is what Vite
  // recognises to bundle worker.js (and its imports) into its own chunk.
  const worker = WorkerImpl
    ? new WorkerImpl('ft8-worker')
    : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let ready = false;
  onStatus?.('loading');
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'ready') {
      ready = true;
      onStatus?.('ready');
    } else if (m.type === 'unavailable') onStatus?.('unavailable', m.message);
    else if (m.type === 'slot') onSlot?.(m);
    else if (m.type === 'level') onLevel?.(m);
  };
  worker.onerror = (e) => onStatus?.('unavailable', e?.message || 'FT8 worker failed');
  worker.postMessage({ type: 'init', wasmUrl, ...(emitAtSec ? { emitAtSec } : {}) });
  return {
    get ready() {
      return ready;
    },
    push(samples, sampleRate, endTimeMs) {
      if (!ready) return;
      worker.postMessage({ type: 'audio', samples, sampleRate, endTimeMs }, [samples.buffer]);
    },
    reset() {
      worker.postMessage({ type: 'reset' });
    },
    terminate() {
      worker.terminate();
    },
  };
}
