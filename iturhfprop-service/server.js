/**
 * ITURHFProp Service
 *
 * REST API wrapper for the ITURHFProp HF propagation prediction engine
 * Implements ITU-R P.533-14 "Method for the prediction of the performance of HF circuits"
 *
 * Endpoints:
 *   GET /api/predict - Single point prediction
 *   GET /api/predict/hourly - 24-hour prediction
 *   GET /api/health - Health check
 */

const express = require('express');
const cors = require('cors');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths to ITURHFProp - DATA points to root which contains Data/ and IonMap/ subdirs
const ITURHFPROP_PATH = process.env.ITURHFPROP_PATH || '/opt/iturhfprop/ITURHFProp';
const ITURHFPROP_DATA = process.env.ITURHFPROP_DATA || '/opt/iturhfprop';

// Temp directory for input/output files
const TEMP_DIR = '/tmp/iturhfprop';

// === CACHING AND CIRCUIT BREAKER ===
const predictionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;

// Circuit breaker state
let circuitBreakerOpen = false;
let consecutiveFailures = 0;
let lastFailureTime = 0;
let lastLogTime = 0;
const FAILURE_THRESHOLD = 3; // Open after 3 failures
const CIRCUIT_RESET_TIME = 5 * 60 * 1000; // 5 minutes before retry
const LOG_INTERVAL = 5 * 60 * 1000; // Only log every 5 minutes

function getCacheKey(params) {
  // Round coordinates to 1 decimal place for better cache hits
  const key = `${params.txLat.toFixed(1)},${params.txLon.toFixed(1)}-${params.rxLat.toFixed(1)},${params.rxLon.toFixed(1)}-${params.month}-${params.hour}-${params.ssn}`;
  return key;
}

function getFromCache(key) {
  const cached = predictionCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  predictionCache.delete(key);
  return null;
}

function setCache(key, data) {
  // Enforce max cache size
  if (predictionCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = predictionCache.keys().next().value;
    predictionCache.delete(oldestKey);
  }
  predictionCache.set(key, { data, timestamp: Date.now() });
}

function shouldLog() {
  const now = Date.now();
  if (now - lastLogTime > LOG_INTERVAL) {
    lastLogTime = now;
    return true;
  }
  return false;
}

function checkCircuitBreaker() {
  if (!circuitBreakerOpen) return false;

  // Check if enough time has passed to try again
  if (Date.now() - lastFailureTime > CIRCUIT_RESET_TIME) {
    circuitBreakerOpen = false;
    consecutiveFailures = 0;
    if (shouldLog()) {
      console.log('[Circuit Breaker] Reset - allowing requests');
    }
    return false;
  }
  return true;
}

function recordFailure() {
  consecutiveFailures++;
  lastFailureTime = Date.now();

  if (consecutiveFailures >= FAILURE_THRESHOLD && !circuitBreakerOpen) {
    circuitBreakerOpen = true;
    if (shouldLog()) {
      console.log(
        `[Circuit Breaker] OPEN after ${consecutiveFailures} failures - pausing for ${CIRCUIT_RESET_TIME / 1000}s`,
      );
    }
  }
}

function recordSuccess() {
  consecutiveFailures = 0;
  circuitBreakerOpen = false;
}

// Middleware
app.use(cors());
app.use(express.json());

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// HF band frequencies (MHz) - P.533 valid range is 2-30 MHz
const HF_BANDS = {
  '160m': 2.0, // Adjusted from 1.9 to meet P.533 minimum of 2 MHz
  '80m': 3.5,
  '60m': 5.3,
  '40m': 7.1,
  '30m': 10.1,
  '20m': 14.1,
  '17m': 18.1,
  '15m': 21.1,
  '12m': 24.9,
  '10m': 28.1,
  // Note: 11m (27 MHz) excluded - too close to P.533 upper limit, use built-in calculation
  // Note: 6m (50 MHz) excluded - outside P.533 HF range (2-30 MHz)
};

/**
 * Generate ITURHFProp input file
 */
function generateInputFile(params) {
  const {
    txLat,
    txLon,
    rxLat,
    rxLon,
    year,
    month,
    hour,
    ssn = 100,
    txPower = 100, // Watts
    txGain = 0, // dBi
    rxGain = 0, // dBi
    frequencies = Object.values(HF_BANDS),
    manMadeNoise = 'RESIDENTIAL', // CITY, RESIDENTIAL, RURAL, QUIET
    requiredReliability = 90,
    requiredSNR = 15, // dB for SSB
  } = params;

  // Convert coordinates to ITURHFProp format (decimal degrees)
  const txLatStr = txLat >= 0 ? `${txLat.toFixed(2)} N` : `${Math.abs(txLat).toFixed(2)} S`;
  const txLonStr = txLon >= 0 ? `${txLon.toFixed(2)} E` : `${Math.abs(txLon).toFixed(2)} W`;
  const rxLatStr = rxLat >= 0 ? `${rxLat.toFixed(2)} N` : `${Math.abs(rxLat).toFixed(2)} S`;
  const rxLonStr = rxLon >= 0 ? `${rxLon.toFixed(2)} E` : `${Math.abs(rxLon).toFixed(2)} W`;

  // Format frequencies - comma-separated per ITURHFProp docs
  const freqList = frequencies.map((f) => f.toFixed(3)).join(', ');

  // ITURHFProp input file format - complete version with all required fields
  const input = `PathName "OpenHamClock"
PathTXName "TX"
Path.L_tx.lat ${txLat.toFixed(4)}
Path.L_tx.lng ${txLon.toFixed(4)}
TXAntFilePath "ISOTROPIC"
TXGOS 0.0
PathRXName "RX"
Path.L_rx.lat ${rxLat.toFixed(4)}
Path.L_rx.lng ${rxLon.toFixed(4)}
RXAntFilePath "ISOTROPIC"
RXGOS 0.0
AntennaOrientation "TX2RX"
Path.year ${year}
Path.month ${month}
Path.hour ${isNaN(hour) ? 12 : hour === 0 ? 24 : hour}
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
DataFilePath "${ITURHFPROP_DATA}/Data/"
RptFilePath "/tmp/"
RptFileFormat "RPT_PR | RPT_SNR | RPT_BCR"
`;

  return input;
}

/**
 * Parse ITURHFProp output file
 */
function parseOutputFile(outputPath) {
  try {
    const output = fs.readFileSync(outputPath, 'utf8');
    const lines = output.split('\n');

    const results = {
      frequencies: [],
      raw: output.substring(0, 3000), // Include raw for debugging
    };

    let inDataSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Look for "Calculated Parameters" section
      if (trimmed.includes('Calculated Parameters') && !trimmed.includes('End')) {
        inDataSection = true;
        continue;
      }

      // Stop at end of data
      if (trimmed.includes('End Calculated') || trimmed.includes('*****')) {
        if (inDataSection && results.frequencies.length > 0) {
          break;
        }
      }

      // Parse data lines: "02, 05,    2.000,-120.29, -16.04,   0.00"
      // Format: Month, Hour, Freq, Pr, SNR, BCR
      if (inDataSection && trimmed && !trimmed.startsWith('*') && !trimmed.startsWith('-')) {
        const parts = trimmed.split(',').map((p) => p.trim());

        if (parts.length >= 6) {
          const freq = parseFloat(parts[2]);
          const pr = parseFloat(parts[3]);
          const snr = parseFloat(parts[4]);
          const bcr = parseFloat(parts[5]);

          if (!isNaN(freq) && freq > 0) {
            results.frequencies.push({
              freq: freq,
              sdbw: pr,
              snr: snr,
              reliability: bcr,
            });
          }
        }
      }
    }

    // Extract MUF from header section
    const mufMatch = output.match(/(?:BMUF|MUF|Operational MUF)\s*[:=]?\s*([\d.]+)/i);
    if (mufMatch) {
      results.muf = parseFloat(mufMatch[1]);
    }

    return results;
  } catch (err) {
    // File doesn't exist - this is expected when ITURHFProp fails
    return { error: err.message, frequencies: [] };
  }
}

/**
 * Run ITURHFProp prediction
 */
async function runPrediction(params) {
  // Check circuit breaker first - return immediately if open
  if (checkCircuitBreaker()) {
    return { error: 'Circuit breaker open', frequencies: [], circuitBreakerOpen: true };
  }

  // Check cache
  const cacheKey = getCacheKey(params);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(TEMP_DIR, `input_${id}.txt`);
  const outputPath = path.join(TEMP_DIR, `output_${id}.txt`);

  // Ensure temp dir exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  try {
    // Generate input file
    const inputContent = generateInputFile(params);
    fs.writeFileSync(inputPath, inputContent);

    // Run ITURHFProp
    const startTime = Date.now();
    const cmd = `${ITURHFPROP_PATH} ${inputPath} ${outputPath}`;

    let execStdout = '';
    try {
      execStdout = execSync(cmd, {
        timeout: 30000,
        encoding: 'utf8',
        env: { ...process.env, LD_LIBRARY_PATH: '/opt/iturhfprop:' + (process.env.LD_LIBRARY_PATH || '') },
      });
    } catch (execError) {
      recordFailure();

      // Only log occasionally
      if (shouldLog()) {
        console.error(
          `[ITURHFProp] Failed (exit ${execError.status}), failures: ${consecutiveFailures}, circuit: ${circuitBreakerOpen ? 'OPEN' : 'closed'}`,
        );
      }

      // Cache the error to prevent repeated attempts
      const errorResult = { error: `Exit code ${execError.status}`, frequencies: [] };
      setCache(cacheKey, errorResult);
      return errorResult;
    }

    const elapsed = Date.now() - startTime;

    // Parse output
    const results = parseOutputFile(outputPath);

    if (results.frequencies.length === 0) {
      recordFailure();
      const errorResult = { error: 'No frequency results', frequencies: [], elapsed };
      setCache(cacheKey, errorResult);
      return errorResult;
    }

    // Success!
    recordSuccess();
    results.elapsed = elapsed;
    results.params = {
      txLat: params.txLat,
      txLon: params.txLon,
      rxLat: params.rxLat,
      rxLon: params.rxLon,
      hour: params.hour,
      month: params.month,
      ssn: params.ssn,
    };

    // Cache successful result
    setCache(cacheKey, results);

    if (shouldLog()) {
      console.log(`[ITURHFProp] Success: ${results.frequencies.length} freqs, MUF=${results.muf || 'N/A'}`);
    }

    return results;
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  const binaryExists = fs.existsSync(ITURHFPROP_PATH);
  const dataExists = fs.existsSync(ITURHFPROP_DATA);
  const dataSubExists = fs.existsSync(ITURHFPROP_DATA + '/Data');

  // Check for shared libraries
  const libp533Exists = fs.existsSync('/opt/iturhfprop/libp533.so');
  const libp372Exists = fs.existsSync('/opt/iturhfprop/libp372.so');

  // Check for ionospheric data (ionos12.bin in Data folder)
  const ionosDataExists = fs.existsSync(ITURHFPROP_DATA + '/Data/ionos12.bin');

  res.json({
    status:
      binaryExists && dataSubExists && libp533Exists && ionosDataExists && !circuitBreakerOpen ? 'healthy' : 'degraded',
    service: 'iturhfprop',
    version: '1.0.0',
    engine: 'ITURHFProp (ITU-R P.533-14)',
    binary: binaryExists ? 'found' : 'missing',
    libp533: libp533Exists ? 'found' : 'missing',
    libp372: libp372Exists ? 'found' : 'missing',
    dataDir: dataSubExists ? 'found' : 'missing',
    ionosData: ionosDataExists ? 'found' : 'missing',
    circuitBreaker: {
      open: circuitBreakerOpen,
      consecutiveFailures,
      cacheSize: predictionCache.size,
    },
    paths: {
      binary: ITURHFPROP_PATH,
      data: ITURHFPROP_DATA,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Diagnostic endpoint - test binary execution
 */
app.get('/api/diag', async (req, res) => {
  const results = {
    binary: {},
    libraries: {},
    data: {},
    testRun: {},
  };

  // Check binary
  try {
    const stats = fs.statSync(ITURHFPROP_PATH);
    results.binary = {
      exists: true,
      size: stats.size,
      mode: stats.mode.toString(8),
      path: ITURHFPROP_PATH,
    };
  } catch (e) {
    results.binary = { exists: false, error: e.message };
  }

  // Check libraries
  try {
    const libs = fs.readdirSync('/opt/iturhfprop').filter((f) => f.endsWith('.so'));
    results.libraries = { found: libs };
  } catch (e) {
    results.libraries = { error: e.message };
  }

  // Check data files
  try {
    const dataFiles = fs.readdirSync(ITURHFPROP_DATA + '/Data').slice(0, 15);
    results.data.dataDir = dataFiles;
  } catch (e) {
    results.data.dataDir = { error: e.message };
  }

  // Check for ionospheric data
  try {
    const ionosExists = fs.existsSync(ITURHFPROP_DATA + '/Data/ionos12.bin');
    results.data.ionosData = ionosExists ? 'found' : 'missing';
  } catch (e) {
    results.data.ionosData = { error: e.message };
  }

  // Try running ldd on the binary
  try {
    const { execSync } = require('child_process');
    const lddOutput = execSync(`ldd ${ITURHFPROP_PATH} 2>&1`, { encoding: 'utf8' });
    results.testRun.ldd = lddOutput.split('\n').slice(0, 10);
  } catch (e) {
    results.testRun.ldd = { error: e.message };
  }

  // Try running the binary with no args to see usage
  try {
    const { execSync } = require('child_process');
    const output = execSync(`${ITURHFPROP_PATH} 2>&1 || true`, {
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: '/opt/iturhfprop' },
    });
    results.testRun.usage = output.split('\n').slice(0, 10);
  } catch (e) {
    results.testRun.usage = { error: e.message, stderr: e.stderr?.toString(), stdout: e.stdout?.toString() };
  }

  // List ALL files in Data directory
  try {
    const allDataFiles = fs.readdirSync(ITURHFPROP_DATA + '/Data');
    results.data.allFiles = allDataFiles;
    results.data.hasIonos = allDataFiles.some((f) => f.includes('ionos'));
    results.data.hasAnt = allDataFiles.some((f) => f.endsWith('.ant'));
    results.data.fileCount = allDataFiles.length;
  } catch (e) {
    results.data.allFiles = { error: e.message };
  }

  // Create a minimal test input file and try to run
  try {
    const { execSync } = require('child_process');
    const testInput = `PathName "Test"
PathTXName "TX"
Path.L_tx.lat 40.0
Path.L_tx.lng -75.0
TXAntFilePath "ISOTROPIC"
TXGOS 0.0
PathRXName "RX"
Path.L_rx.lat 51.0
Path.L_rx.lng 0.0
RXAntFilePath "ISOTROPIC"
RXGOS 0.0
AntennaOrientation "TX2RX"
Path.year 2025
Path.month 6
Path.hour 12
Path.SSN 100
Path.frequency 14.0
Path.txpower 20.0
Path.BW 3000
Path.SNRr 15
Path.SNRXXp 90
Path.ManMadeNoise "RESIDENTIAL"
Path.Modulation ANALOG
Path.SorL SHORTPATH
LL.lat 51.0
LL.lng 0.0
LR.lat 51.0
LR.lng 0.0
UL.lat 51.0
UL.lng 0.0
UR.lat 51.0
UR.lng 0.0
DataFilePath "${ITURHFPROP_DATA}/Data/"
RptFilePath "/tmp/"
RptFileFormat "RPT_PR | RPT_SNR | RPT_BCR"
`;
    fs.writeFileSync('/tmp/test_input.txt', testInput);
    results.testRun.inputFile = testInput.split('\n');

    const testOutput = execSync(
      `${ITURHFPROP_PATH} /tmp/test_input.txt /tmp/test_output.txt 2>&1 || echo "Exit code: $?"`,
      {
        encoding: 'utf8',
        env: { ...process.env, LD_LIBRARY_PATH: '/opt/iturhfprop' },
      },
    );
    results.testRun.testExec = testOutput.split('\n').slice(0, 20);

    // Check if output was created
    if (fs.existsSync('/tmp/test_output.txt')) {
      const output = fs.readFileSync('/tmp/test_output.txt', 'utf8');
      results.testRun.testOutput = output.split('\n').slice(0, 20);
    } else {
      results.testRun.testOutput = 'No output file created';
    }
  } catch (e) {
    results.testRun.testExec = { error: e.message, stderr: e.stderr?.toString(), stdout: e.stdout?.toString() };
  }

  res.json(results);
});

/**
 * Single point prediction
 *
 * GET /api/predict?txLat=40&txLon=-74&rxLat=51&rxLon=0&month=1&hour=12&ssn=100
 */
app.get('/api/predict', async (req, res) => {
  try {
    const {
      txLat,
      txLon,
      rxLat,
      rxLon,
      month,
      hour,
      ssn,
      year = new Date().getFullYear(),
      txPower,
      frequencies,
    } = req.query;

    // Validate required params
    if (!txLat || !txLon || !rxLat || !rxLon) {
      return res.status(400).json({ error: 'Missing required coordinates (txLat, txLon, rxLat, rxLon)' });
    }

    const params = {
      txLat: parseFloat(txLat),
      txLon: parseFloat(txLon),
      rxLat: parseFloat(rxLat),
      rxLon: parseFloat(rxLon),
      year: parseInt(year),
      month: parseInt(month) || new Date().getMonth() + 1,
      hour: parseInt(hour) || new Date().getUTCHours() || 12,
      ssn: parseInt(ssn) || 100,
      txPower: parseInt(txPower) || 100,
    };

    if (frequencies) {
      params.frequencies = frequencies.split(',').map((f) => parseFloat(f));
    }

    const results = await runPrediction(params);

    res.json({
      model: 'ITU-R P.533-14',
      engine: 'ITURHFProp',
      ...results,
    });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 24-hour prediction
 *
 * GET /api/predict/hourly?txLat=40&txLon=-74&rxLat=51&rxLon=0&month=1&ssn=100
 */
app.get('/api/predict/hourly', async (req, res) => {
  try {
    const { txLat, txLon, rxLat, rxLon, month, ssn, year = new Date().getFullYear() } = req.query;

    // Validate required params
    if (!txLat || !txLon || !rxLat || !rxLon) {
      return res.status(400).json({ error: 'Missing required coordinates (txLat, txLon, rxLat, rxLon)' });
    }

    const baseParams = {
      txLat: parseFloat(txLat),
      txLon: parseFloat(txLon),
      rxLat: parseFloat(rxLat),
      rxLon: parseFloat(rxLon),
      year: parseInt(year),
      month: parseInt(month) || new Date().getMonth() + 1,
      ssn: parseInt(ssn) || 100,
    };

    // Run predictions for each hour (0-23 UTC)
    const hourlyResults = [];

    for (let hour = 0; hour < 24; hour++) {
      const params = { ...baseParams, hour };
      try {
        const result = await runPrediction(params);
        hourlyResults.push({
          hour,
          muf: result.muf,
          frequencies: result.frequencies,
        });
      } catch (err) {
        hourlyResults.push({
          hour,
          error: err.message,
        });
      }
    }

    res.json({
      model: 'ITU-R P.533-14',
      engine: 'ITURHFProp',
      path: {
        tx: { lat: baseParams.txLat, lon: baseParams.txLon },
        rx: { lat: baseParams.rxLat, lon: baseParams.rxLon },
      },
      month: baseParams.month,
      year: baseParams.year,
      ssn: baseParams.ssn,
      hourly: hourlyResults,
    });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Band conditions (simplified format for OpenHamClock)
 *
 * GET /api/bands?txLat=40&txLon=-74&rxLat=51&rxLon=0
 */
app.get('/api/bands', async (req, res) => {
  try {
    const { txLat, txLon, rxLat, rxLon, month, hour, ssn } = req.query;

    if (!txLat || !txLon || !rxLat || !rxLon) {
      return res.status(400).json({ error: 'Missing required coordinates' });
    }

    const params = {
      txLat: parseFloat(txLat),
      txLon: parseFloat(txLon),
      rxLat: parseFloat(rxLat),
      rxLon: parseFloat(rxLon),
      year: new Date().getFullYear(),
      month: parseInt(month) || new Date().getMonth() + 1,
      hour: parseInt(hour) || new Date().getUTCHours() || 12,
      ssn: parseInt(ssn) || 100,
      frequencies: Object.values(HF_BANDS),
    };

    const results = await runPrediction(params);

    // Map to band names
    const bands = {};
    const bandFreqs = Object.entries(HF_BANDS);

    for (const freqResult of results.frequencies) {
      const bandEntry = bandFreqs.find(([name, freq]) => Math.abs(freq - freqResult.freq) < 1);

      if (bandEntry) {
        const [bandName] = bandEntry;
        bands[bandName] = {
          freq: freqResult.freq,
          reliability: freqResult.reliability,
          snr: freqResult.snr,
          sdbw: freqResult.sdbw,
          status: freqResult.reliability >= 70 ? 'GOOD' : freqResult.reliability >= 40 ? 'FAIR' : 'POOR',
        };
      }
    }

    res.json({
      model: 'ITU-R P.533-14',
      muf: results.muf,
      bands,
      debug: {
        rawOutput: results.raw,
        freqCount: results.frequencies.length,
        parsedFreqs: results.frequencies,
        execStdout: results.execStdout,
        execStderr: results.execStderr,
        inputContent: results.inputContent?.substring(0, 1000),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`ITURHFProp Service running on port ${PORT}`);
  console.log(`Binary: ${ITURHFPROP_PATH}`);
  console.log(`Data: ${ITURHFPROP_DATA}`);
});
