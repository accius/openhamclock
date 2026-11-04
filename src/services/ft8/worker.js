// FT8 Web Worker — loads the ft8_lib WASM (public/wasm/ft8.mjs, fetched by
// scripts/fetch-wasm.js) and runs the receive chain (engine.js) off the main
// thread. Spawned by client.js.
//
// main → worker:  { type: 'init', wasmUrl, emitAtSec? }
//                 { type: 'audio', samples: Float32Array, sampleRate, endTimeMs }
//                 { type: 'reset' }
// worker → main:  { type: 'ready' }
//                 { type: 'unavailable', message }   (WASM not installed / failed to load)
//                 { type: 'slot', slotStartMs, decodes, decodeMs, error? }
//                 { type: 'level', fill, bufferStartMs }
import { createFt8Decoder } from '../../utils/ft8Wasm.js';
import { Ft8Engine } from './engine.js';

let engine = null;
let loading = null;
let lastLevel = 0;

async function init(wasmUrl, emitAtSec) {
  if (loading) return loading;
  loading = (async () => {
    try {
      // Full URL so Vite dev does not route a public/ file through its transform
      // pipeline (same reason as the P.533 worker).
      const url = new URL(wasmUrl, self.location.href).href;
      const { default: createFt8Module } = await import(/* @vite-ignore */ url);
      const mod = await createFt8Module();
      engine = new Ft8Engine({
        decoder: createFt8Decoder(mod),
        emitAtSec,
        onSlot: (r) => self.postMessage({ type: 'slot', ...r }),
        onLevel: (l) => {
          const now = Date.now();
          if (now - lastLevel < 500) return;
          lastLevel = now;
          self.postMessage({ type: 'level', ...l });
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      loading = null;
      self.postMessage({ type: 'unavailable', message: err?.message || String(err) });
    }
  })();
  return loading;
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') init(msg.wasmUrl, msg.emitAtSec);
  else if (msg.type === 'audio' && engine) engine.push(msg.samples, msg.sampleRate, msg.endTimeMs);
  else if (msg.type === 'reset' && engine) engine.reset();
};
