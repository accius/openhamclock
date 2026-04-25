// Run a P.533 prediction end-to-end from the wrapper's perspective: build the
// ITURHFProp input config, mount coefficient data into the WASM's MEMFS, drive
// main(), parse the report back out. The caller supplies (1) an Emscripten
// module factory (createP533Module from wasm-build/dist/p533.mjs) and (2)
// already-fetched coefficient bytes (see dataLoader.js). We produce a plain
// object that mirrors iturhfprop-service/server.js's REST response so
// usePropagation can treat this engine interchangeably with the REST fallback.
//
// Split points:
//   buildInputConfig(params) — pure, exercised by unit tests
//   parseReport(text)        — pure, exercised by unit tests
//   predict(opts)            — mounts + runs + parses; integration tested
//                              against the real WASM artifact in dist/.

const HF_BANDS_MHZ = [1.8, 3.5, 7.1, 10.1, 14.1, 18.1, 21.1, 24.9, 28.1];

/**
 * Translate the REST-style `runPrediction` params into the text config that
 * ITURHFProp's main() expects. Kept byte-compatible with the server.js
 * generator where possible so the REST fallback and the WASM engine produce
 * comparable outputs — the few differences (DataFilePath + RptFilePath)
 * reflect the MEMFS layout the WASM driver uses.
 *
 * ITURHFProp treats `Path.hour = 0` as midnight local meaning "24 hours" —
 * the REST wrapper rewrites 0 → 24; we match that quirk so the two engines
 * agree on hour=0.
 */
export function buildInputConfig(params) {
  const {
    txLat,
    txLon,
    rxLat,
    rxLon,
    year,
    month,
    hour,
    ssn = 100,
    txPower = 100,
    txGain = 0,
    rxGain = 0,
    frequencies = HF_BANDS_MHZ,
    manMadeNoise = 'RESIDENTIAL',
    requiredReliability = 90,
    requiredSNR = 15,
    pathName = 'OpenHamClock',
  } = params;

  for (const k of ['txLat', 'txLon', 'rxLat', 'rxLon', 'year', 'month']) {
    if (!Number.isFinite(params[k])) {
      throw new Error(`predict: params.${k} must be a finite number (got ${params[k]})`);
    }
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`predict: params.month must be 1-12 (got ${month})`);
  }
  const hourInt = Number.isFinite(hour) ? Math.trunc(hour) : 12;
  const hourForConfig = hourInt === 0 ? 24 : hourInt;
  const freqList = frequencies.map((f) => f.toFixed(3)).join(', ');

  return `PathName "${pathName}"
PathTXName "TX"
Path.L_tx.lat ${txLat.toFixed(4)}
Path.L_tx.lng ${txLon.toFixed(4)}
TXAntFilePath "ISOTROPIC"
TXGOS ${txGain.toFixed(1)}
PathRXName "RX"
Path.L_rx.lat ${rxLat.toFixed(4)}
Path.L_rx.lng ${rxLon.toFixed(4)}
RXAntFilePath "ISOTROPIC"
RXGOS ${rxGain.toFixed(1)}
AntennaOrientation "TX2RX"
Path.year ${year}
Path.month ${month}
Path.hour ${hourForConfig}
Path.SSN ${ssn}
Path.frequency ${freqList}
Path.txpower ${(10 * Math.log10(txPower)).toFixed(1)}
Path.BW 3000
Path.SNRr ${requiredSNR}
Path.SNRXXp ${requiredReliability}
Path.ManMadeNoise "${manMadeNoise}"
Path.Modulation ANALOG
Path.SorL SHORTPATH
LL.lat ${rxLat.toFixed(4)}
LL.lng ${rxLon.toFixed(4)}
LR.lat ${rxLat.toFixed(4)}
LR.lng ${rxLon.toFixed(4)}
UL.lat ${rxLat.toFixed(4)}
UL.lng ${rxLon.toFixed(4)}
UR.lat ${rxLat.toFixed(4)}
UR.lng ${rxLon.toFixed(4)}
DataFilePath "/data/"
RptFilePath "/tmp/"
RptFileFormat "RPT_BMUF | RPT_PR | RPT_SNR | RPT_BCR"
`;
}

/**
 * Parse the ITURHFProp text report into the same shape the REST wrapper emits.
 *
 * ITURHFProp prints a `Column NN: NAME ...` line per requested RPT_* flag, so
 * we discover positions by name instead of hard-coding indices — that way the
 * parser keeps working if RptFileFormat in buildInputConfig is changed.
 *
 * Data fields we need from each per-frequency row:
 *   Frequency (MHz), Pr (dBW), SNR (dB), BCR (% reliability)
 * Plus path-level BMUF (MHz) — same value on every row of one hour's run.
 */
export function parseReport(text) {
  const out = { frequencies: [] };
  if (!text) return out;
  const lines = text.split('\n');

  // Build column-name → 0-based index map from "Column NN: NAME ..." lines.
  const cols = {};
  for (const raw of lines) {
    const m = raw.match(/^Column\s+(\d+):\s*(\S+)/);
    if (m) cols[m[2]] = parseInt(m[1], 10) - 1;
  }
  const idx = {
    freq: cols.Frequency ?? 2,
    pr: cols.Pr ?? 3,
    snr: cols.SNR ?? 4,
    bcr: cols.BCR ?? 5,
    bmuf: cols.BMUF, // undefined if RPT_BMUF wasn't requested
  };

  let inData = false;
  for (const raw of lines) {
    const line = raw.trim();

    if (line.includes('Calculated Parameters') && !line.includes('End')) {
      inData = true;
      continue;
    }
    if (inData && (line.includes('End Calculated') || line.startsWith('*****'))) {
      if (out.frequencies.length > 0) break;
    }
    if (inData && line && !line.startsWith('*') && !line.startsWith('-') && !line.startsWith('Column')) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length >= 6) {
        const freq = parseFloat(parts[idx.freq]);
        const sdbw = parseFloat(parts[idx.pr]);
        const snr = parseFloat(parts[idx.snr]);
        const reliability = parseFloat(parts[idx.bcr]);
        if (Number.isFinite(freq) && freq > 0) {
          out.frequencies.push({ freq, sdbw, snr, reliability });
        }
        if (idx.bmuf != null && out.muf == null) {
          const muf = parseFloat(parts[idx.bmuf]);
          if (Number.isFinite(muf)) out.muf = muf;
        }
      }
    }
  }

  // Fallback for older reports / fixtures that put MUF in a header line
  // instead of a per-row column.
  if (out.muf == null) {
    const mufMatch = text.match(/(?:Operational MUF|BMUF|MUF)\s*[:=]\s*([\d.]+)/i);
    if (mufMatch) {
      const muf = parseFloat(mufMatch[1]);
      if (Number.isFinite(muf)) out.muf = muf;
    }
  }

  return out;
}

/**
 * Drive the WASM module to produce a prediction.
 *
 * @param {Object}   opts
 * @param {Function} opts.createModule   Emscripten factory (createP533Module).
 * @param {Object}   opts.params         See buildInputConfig for shape.
 * @param {Array<{name:string, bytes:Uint8Array}>} opts.dataFiles
 *                   Coefficient files for MEMFS, written at /data/<name>.
 *                   Typically the result of dataLoader.getMonthFiles(month)
 *                   concatenated with dataLoader.getDecileFactors().
 * @param {Object}   [opts.moduleOptions]  Extra Emscripten options merged into
 *                   the createModule() call — e.g. locateFile to override the
 *                   default .wasm resolution when the factory was imported
 *                   from a non-standard path (tests, custom bundlers).
 * @returns {Promise<Object>} REST-compatible result.
 */
export async function predict({ createModule, params, dataFiles, moduleOptions = {} }) {
  if (typeof createModule !== 'function') {
    throw new Error('predict: createModule factory is required');
  }
  if (!Array.isArray(dataFiles) || dataFiles.length === 0) {
    throw new Error('predict: dataFiles must be a non-empty array');
  }

  const input = buildInputConfig(params);

  let stdout = '';
  let stderr = '';
  const Module = await createModule({
    noInitialRun: true,
    noExitRuntime: true,
    print: (t) => {
      stdout += t + '\n';
    },
    printErr: (t) => {
      stderr += t + '\n';
    },
    ...moduleOptions,
  });

  const { FS } = Module;
  // /data/ must match DataFilePath in the input config; /tmp/ likewise for RptFilePath.
  FS.mkdirTree('/data');
  FS.mkdirTree('/tmp');
  for (const f of dataFiles) {
    FS.writeFile(`/data/${f.name}`, f.bytes);
  }
  FS.writeFile('/input.txt', input);

  const started = Date.now();
  let rc;
  try {
    rc = Module.callMain(['/input.txt', '/tmp/output.txt']);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`predict: callMain threw: ${msg}\n--- stderr ---\n${stderr}`);
  }
  const elapsed = Date.now() - started;

  if (rc !== 0) {
    throw new Error(`predict: main() returned ${rc}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }

  let report;
  try {
    report = new TextDecoder().decode(FS.readFile('/tmp/output.txt'));
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`predict: no report file written: ${msg}`);
  }

  const parsed = parseReport(report);
  return {
    model: 'ITU-R P.533-14',
    engine: 'wasm-p533',
    elapsed,
    params: {
      txLat: params.txLat,
      txLon: params.txLon,
      rxLat: params.rxLat,
      rxLon: params.rxLon,
      hour: params.hour,
      month: params.month,
      year: params.year,
      ssn: params.ssn,
    },
    ...parsed,
  };
}

// Re-exports for tests and diagnostics.
export const __internal = { HF_BANDS_MHZ };
