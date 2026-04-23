/**
 * End-to-end smoke test for the P.533 WASM build.
 *
 * Unlike smoke-test.mjs (which only verifies the runtime loads), this one
 * actually runs a prediction by mounting coefficient files into Emscripten's
 * MEMFS, writing an input config, calling ITURHFProp's main(), and parsing
 * the report back out of MEMFS.
 *
 * Scenario: 40m Atlanta→London midday January 2025, SSN 120 — the same case
 * covered by propagationPhysics.test.js so we can cross-check against the
 * fallback model.
 *
 * Expects data-local/ to contain (fetched manually from upstream v14.3):
 *   - ionos01.bin                    (~11 MB, month-01 ionosphere)
 *   - COEFF01W.txt                   (~290 KB, month-01 noise coefficients)
 *   - P1239-3 Decile Factors.txt     (~72 KB, month-independent variability)
 * …and dist/ to contain the CI-built WASM artifact.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, 'dist', 'p533.mjs');
const dataDir = resolve(here, 'data-local');

const DATA_FILES = ['ionos01.bin', 'COEFF01W.txt', 'P1239-3 Decile Factors.txt'];

// Load the artifact and data files in parallel before any WASM init.
async function loadInputs() {
  await readFile(distPath).catch(() => {
    console.error(`smoke-test-e2e: no build at ${distPath} — run ./build.sh (or pull from CI)`);
    process.exit(1);
  });
  const loaded = {};
  await Promise.all(
    DATA_FILES.map(async (name) => {
      try {
        loaded[name] = await readFile(resolve(dataDir, name));
      } catch {
        console.error(`smoke-test-e2e: missing ${name} in data-local/ — see header comment`);
        process.exit(1);
      }
    }),
  );
  return loaded;
}

// ITURHFProp input file — matches iturhfprop-service/server.js format so we're
// exercising the same config shape the REST wrapper ships. DataFilePath points
// at MEMFS; RptFilePath gets overridden by argv[2] anyway.
function buildInputConfig() {
  return `PathName "SmokeTest"
PathTXName "Atlanta"
Path.L_tx.lat 33.7490
Path.L_tx.lng -84.3880
TXAntFilePath "ISOTROPIC"
TXGOS 0.0
PathRXName "London"
Path.L_rx.lat 51.5074
Path.L_rx.lng -0.1278
RXAntFilePath "ISOTROPIC"
RXGOS 0.0
AntennaOrientation "TX2RX"
Path.year 2025
Path.month 1
Path.hour 17
Path.SSN 120
Path.frequency 3.5, 7.1, 14.1, 21.1, 28.1
Path.txpower 20.0
Path.BW 3000
Path.SNRr 15
Path.SNRXXp 90
Path.ManMadeNoise "RESIDENTIAL"
Path.Modulation ANALOG
Path.SorL SHORTPATH
LL.lat 51.5074
LL.lng -0.1278
LR.lat 51.5074
LR.lng -0.1278
UL.lat 51.5074
UL.lng -0.1278
UR.lat 51.5074
UR.lng -0.1278
DataFilePath "/data/"
RptFilePath "/tmp/"
RptFileFormat "RPT_PR | RPT_SNR | RPT_BCR"
`;
}

const inputs = await loadInputs();
const { default: createP533Module } = await import(distPath);

let stdout = '';
let stderr = '';

const Module = await createP533Module({
  noInitialRun: true,
  noExitRuntime: true,
  print: (t) => (stdout += t + '\n'),
  printErr: (t) => (stderr += t + '\n'),
});

const { FS } = Module;

// Populate MEMFS. Upstream readers glue DataFilePath + "{file}" directly, so
// the trailing slash in DataFilePath is load-bearing — keep it.
FS.mkdirTree('/data');
FS.mkdirTree('/tmp');
for (const [name, bytes] of Object.entries(inputs)) {
  FS.writeFile(`/data/${name}`, bytes);
}
FS.writeFile('/input.txt', buildInputConfig());

const started = Date.now();
let rc;
try {
  rc = Module.callMain(['/input.txt', '/tmp/output.txt']);
} catch (err) {
  console.error('smoke-test-e2e: callMain threw:', err.message || err);
  console.error('\n--- stdout ---\n' + stdout);
  console.error('\n--- stderr ---\n' + stderr);
  process.exit(1);
}
const elapsed = Date.now() - started;

if (rc !== 0) {
  console.error(`smoke-test-e2e: main() returned ${rc}`);
  console.error('\n--- stdout ---\n' + stdout);
  console.error('\n--- stderr ---\n' + stderr);
  process.exit(1);
}

let output;
try {
  output = new TextDecoder().decode(FS.readFile('/tmp/output.txt'));
} catch (err) {
  console.error('smoke-test-e2e: no report file written:', err.message || err);
  console.error('\n--- stdout ---\n' + stdout);
  process.exit(1);
}

// Parse the same way iturhfprop-service/server.js does so any REST comparison
// is apples-to-apples. Data section: "Month, Hour, Freq, Pr, SNR, BCR" CSV.
const results = [];
let inData = false;
for (const raw of output.split('\n')) {
  const line = raw.trim();
  if (line.includes('Calculated Parameters') && !line.includes('End')) {
    inData = true;
    continue;
  }
  if (line.includes('End Calculated') || line.includes('*****')) {
    if (inData && results.length > 0) break;
  }
  if (inData && line && !line.startsWith('*') && !line.startsWith('-')) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length >= 6) {
      const [, , f, pr, snr, bcr] = parts.map(parseFloat);
      if (!isNaN(f) && f > 0) results.push({ freq: f, sdbw: pr, snr, reliability: bcr });
    }
  }
}

console.log(`smoke-test-e2e: main() ok in ${elapsed} ms`);
console.log(`  bytes in report: ${output.length}`);
console.log(`  parsed rows:     ${results.length}`);
if (results.length) {
  for (const r of results) {
    console.log(
      `    ${r.freq.toFixed(3)} MHz:  Pr=${r.sdbw.toFixed(2)} dBW  SNR=${r.snr.toFixed(2)} dB  BCR=${r.reliability.toFixed(1)}%`,
    );
  }
}

if (results.length === 0) {
  console.error('\n--- stdout ---\n' + stdout);
  console.error('\n--- raw report head ---\n' + output.slice(0, 2000));
  process.exit(1);
}
