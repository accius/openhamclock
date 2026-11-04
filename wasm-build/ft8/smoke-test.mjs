/**
 * CI smoke test for the FT8 WASM build (wasm-build/dist/ft8.{mjs,wasm}).
 *
 * Runs the built module through the app's own JS glue
 * (src/utils/ft8Wasm.js) on ft8_lib's test WAVs, scores the decodes against
 * WSJT-X's reference output with compare.mjs (recall must stay ≥ 72 %), and checks that repeated
 * decodes do not grow WASM memory (every call frees what it allocates).
 * Exits non-zero on any failure so the workflow never publishes a bad asset.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { createFt8Decoder } from '../../src/utils/ft8Wasm.js';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, '..', 'dist', 'ft8.mjs');
if (!existsSync(distPath)) {
  console.error(`smoke-test: no build at ${distPath} — run ./build.sh first`);
  process.exit(1);
}
const srcRoot = resolve(here, '..', 'src');
const libDir = readdirSync(srcRoot).find((d) => d.startsWith('ft8_lib-'));
const wavDir = join(srcRoot, libDir, 'test', 'wav');

/** 16-bit mono PCM WAV → Float32Array (the test set's format). */
function readWav(path) {
  const b = readFileSync(path);
  let off = 12;
  let rate = 12000;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  const pcm = new Float32Array(data.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return { pcm, rate };
}

const { default: createFt8Module } = await import(distPath);
const mod = await createFt8Module();
const dec = createFt8Decoder(mod);

const wavs = readdirSync(wavDir)
  .filter((f) => f.endsWith('.wav'))
  .sort();
const lines = [];
// Memory: pass 1 may grow the heap to its working size; passes 2 and 3 are
// identical, so any growth between them means per-call memory is not freed.
let heapAfterSecondPass = 0;
for (let pass = 0; pass < 3; pass++) {
  for (const f of wavs) {
    const { pcm, rate } = readWav(join(wavDir, f));
    dec.reset();
    const decodes = dec.decode(pcm, rate);
    if (pass === 0) lines.push(JSON.stringify({ file: join(wavDir, f), rate, decodes }));
  }
  if (pass === 1) heapAfterSecondPass = mod.HEAPU8.length;
}
const heapEnd = mod.HEAPU8.length;
console.log(`decoded ${wavs.length} WAVs × 3; heap after pass 2 ${heapAfterSecondPass}, after pass 3 ${heapEnd} bytes`);
if (heapEnd > heapAfterSecondPass) {
  console.error('smoke-test: WASM memory grew across identical passes — something is not freed');
  process.exit(1);
}

const results = resolve(here, '..', 'dist', 'ft8-smoke-results.jsonl');
writeFileSync(results, lines.join('\n') + '\n');
execFileSync(process.execPath, [resolve(here, 'compare.mjs'), results], {
  stdio: 'inherit',
  env: { ...process.env, MIN_RECALL: process.env.MIN_RECALL || '0.72' },
});
console.log('smoke-test: OK');
