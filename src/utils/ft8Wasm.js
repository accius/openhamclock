/**
 * ft8Wasm.js — JS glue for the ft8_lib WebAssembly module
 * (wasm-build/ft8/ft8_wrapper.c, built by wasm-build/ft8/build.sh and fetched
 * to public/wasm/ft8.{mjs,wasm} by scripts/fetch-wasm.js).
 *
 * Pure: takes an instantiated Emscripten module, so the same code runs in the
 * FT8 Web Worker, in the CI smoke test (node) and in vitest against a fake
 * module. Every call frees what it allocated.
 */

/** Default audio range searched for FT8 signals (Hz). */
export const FT8_F_MIN = 200;
export const FT8_F_MAX = 3000;
export const FT8_SAMPLE_RATE = 12000;
export const FT8_SLOT_SECONDS = 15;

function heapF32(mod) {
  if (mod.HEAPF32) return mod.HEAPF32;
  const buf = mod.wasmMemory?.buffer || mod.asm?.memory?.buffer || mod.wasmExports?.memory?.buffer;
  if (!buf) throw new Error('ft8: module exposes no heap');
  return new Float32Array(buf);
}

/**
 * @param {object} mod  instantiated module (await createFt8Module())
 * @returns {{ decode(pcm: Float32Array, sampleRate?: number, fMin?: number, fMax?: number): Array<{snr:number,dt:number,freq:number,text:string}>, reset(): void }}
 */
export function createFt8Decoder(mod) {
  if (!mod || typeof mod._ft8_decode !== 'function') throw new Error('ft8: not an ft8 module');
  return {
    decode(pcm, sampleRate = FT8_SAMPLE_RATE, fMin = FT8_F_MIN, fMax = FT8_F_MAX) {
      if (!(pcm instanceof Float32Array) || pcm.length === 0) return [];
      const bytes = pcm.length * 4;
      const inPtr = mod._malloc(bytes);
      if (!inPtr) throw new Error('ft8: out of memory');
      let outPtr = 0;
      try {
        // Re-read the view after malloc: memory growth replaces the buffer.
        heapF32(mod).set(pcm, inPtr >> 2);
        outPtr = mod._ft8_decode(inPtr, pcm.length, sampleRate, fMin, fMax);
        if (!outPtr) throw new Error('ft8: decoder ran out of memory');
        const json = mod.UTF8ToString(outPtr);
        const list = JSON.parse(json);
        return Array.isArray(list) ? list : [];
      } finally {
        if (outPtr) mod._ft8_free(outPtr);
        mod._free(inPtr);
      }
    },
    reset() {
      mod._ft8_reset?.();
    },
  };
}
