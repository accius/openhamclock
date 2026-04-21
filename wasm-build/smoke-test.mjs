/**
 * Smoke test for the P.533 WASM build (B1).
 *
 * Verifies:
 *   - the .mjs factory loads
 *   - the WASM instance initializes successfully
 *   - callMain() runs ITURHFProp's main() with --help-style args and exits
 *     cleanly (the actual data-file wiring happens in B3)
 *
 * Intentionally does NOT run a real prediction — coefficient files aren't
 * packaged yet. The point of B1 is to prove the compile works.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, 'dist', 'p533.mjs');

try {
  await readFile(distPath);
} catch {
  console.error(`smoke-test: no build at ${distPath} — run ./build.sh first`);
  process.exit(1);
}

const { default: createP533Module } = await import(distPath);

let stdout = '';
let stderr = '';

const Module = await createP533Module({
  noInitialRun: true,
  print: (text) => (stdout += text + '\n'),
  printErr: (text) => (stderr += text + '\n'),
});

console.log('smoke-test: WASM module loaded');
console.log(`  HEAP8 size:       ${(Module.HEAP8.length / (1024 * 1024)).toFixed(2)} MB`);
console.log(
  `  exported methods: ${['callMain', 'FS', 'ccall', 'cwrap'].filter((m) => typeof Module[m] === 'function').join(', ')}`,
);

// ITURHFProp exits non-zero without an input file. That's fine — we're checking
// that main() runs and the runtime is intact, not that the program succeeds.
let exitCode;
try {
  exitCode = Module.callMain([]);
} catch (err) {
  if (err?.name === 'ExitStatus' || typeof err?.status === 'number') {
    exitCode = err.status;
  } else {
    console.error('smoke-test: callMain threw:', err);
    process.exit(1);
  }
}

console.log(`smoke-test: ITURHFProp main() returned ${exitCode}`);
if (stdout.trim()) console.log('  stdout:', stdout.trim().split('\n')[0]);
if (stderr.trim()) console.log('  stderr:', stderr.trim().split('\n')[0]);

// Any clean exit (success or documented-error) proves the binary is functional.
// Runtime aborts from a broken build would have thrown above.
console.log('smoke-test: OK');
