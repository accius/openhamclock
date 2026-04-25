// @vitest-environment node
//
// The integration test imports wasm-build/dist/p533.mjs, whose Emscripten
// loader resolves the sibling .wasm via new URL(..., import.meta.url). Under
// jsdom, vitest rewrites import.meta.url to a non-file:// URL and the load
// fails. The unit tests in this file don't touch the DOM either, so running
// the whole suite under Node is fine.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildInputConfig, parseReport, predict } from './predict.js';

// ── buildInputConfig ────────────────────────────────────────────────────────

describe('buildInputConfig', () => {
  const base = {
    txLat: 33.749,
    txLon: -84.388,
    rxLat: 51.5074,
    rxLon: -0.1278,
    year: 2025,
    month: 1,
    hour: 17,
    ssn: 120,
    txPower: 100,
  };

  it('emits an ITURHFProp config with coordinates + MEMFS paths', () => {
    const cfg = buildInputConfig(base);
    expect(cfg).toMatch(/Path\.L_tx\.lat 33\.7490/);
    expect(cfg).toMatch(/Path\.L_tx\.lng -84\.3880/);
    expect(cfg).toMatch(/Path\.L_rx\.lat 51\.5074/);
    expect(cfg).toMatch(/Path\.year 2025/);
    expect(cfg).toMatch(/Path\.month 1/);
    expect(cfg).toMatch(/Path\.hour 17/);
    expect(cfg).toMatch(/Path\.SSN 120/);
    expect(cfg).toMatch(/DataFilePath "\/data\/"/);
    expect(cfg).toMatch(/RptFilePath "\/tmp\/"/);
  });

  it('converts txPower (W) to dBW via 10*log10', () => {
    // 100 W = 20 dBW
    expect(buildInputConfig({ ...base, txPower: 100 })).toMatch(/Path\.txpower 20\.0/);
    // 1000 W = 30 dBW
    expect(buildInputConfig({ ...base, txPower: 1000 })).toMatch(/Path\.txpower 30\.0/);
  });

  it('remaps hour 0 → 24 to match ITURHFProp semantics (and REST wrapper)', () => {
    expect(buildInputConfig({ ...base, hour: 0 })).toMatch(/Path\.hour 24/);
    expect(buildInputConfig({ ...base, hour: 5 })).toMatch(/Path\.hour 5/);
  });

  it('defaults frequencies to the nine HF amateur bands', () => {
    const cfg = buildInputConfig(base);
    // Spot-check a couple: 7.1 MHz and 28.1 MHz should both appear
    expect(cfg).toMatch(/Path\.frequency .*7\.100/);
    expect(cfg).toMatch(/Path\.frequency .*28\.100/);
  });

  it('rejects out-of-range month', () => {
    expect(() => buildInputConfig({ ...base, month: 0 })).toThrow(/month must be 1-12/);
    expect(() => buildInputConfig({ ...base, month: 13 })).toThrow(/month must be 1-12/);
  });

  it('rejects non-finite coordinates', () => {
    expect(() => buildInputConfig({ ...base, txLat: NaN })).toThrow(/txLat.*finite/);
  });
});

// ── parseReport ─────────────────────────────────────────────────────────────

describe('parseReport', () => {
  it('parses the "Calculated Parameters" block into {freq, sdbw, snr, reliability}', () => {
    const report = `
***********************
* HF Propagation Report
***********************

Calculated Parameters
 Month,  Hour,  Freq,      Pr,    SNR,    BCR
   01,    17,   3.500, -150.21,  -45.04,   0.00
   01,    17,   7.100, -140.29,  -16.04,  42.30
   01,    17,  14.100, -125.10,   22.15,  95.70
End Calculated Parameters
`;
    const parsed = parseReport(report);
    expect(parsed.frequencies).toHaveLength(3);
    expect(parsed.frequencies[0]).toEqual({ freq: 3.5, sdbw: -150.21, snr: -45.04, reliability: 0 });
    expect(parsed.frequencies[2].reliability).toBeCloseTo(95.7);
  });

  it('picks up a MUF value from the header when present', () => {
    const report = `
Operational MUF: 18.4 MHz
Calculated Parameters
   01,    12,  14.100, -120.00,  10.00,  80.00
End Calculated Parameters
`;
    expect(parseReport(report).muf).toBeCloseTo(18.4);
  });

  it('returns empty frequencies on malformed or empty input', () => {
    expect(parseReport('').frequencies).toEqual([]);
    expect(parseReport('garbage text').frequencies).toEqual([]);
  });

  it('skips non-data lines inside the Calculated block (comments / dashes)', () => {
    const report = `
Calculated Parameters
-----------------
* comment line
   01,    17,   7.100, -140.29, -16.04,  42.30
End Calculated Parameters
`;
    expect(parseReport(report).frequencies).toHaveLength(1);
  });
});

// ── predict argument validation ─────────────────────────────────────────────

describe('predict argument validation', () => {
  const okParams = {
    txLat: 40,
    txLon: -74,
    rxLat: 51,
    rxLon: 0,
    year: 2025,
    month: 6,
    hour: 12,
    ssn: 100,
    txPower: 100,
  };

  it('rejects a missing createModule', async () => {
    await expect(
      predict({ createModule: null, params: okParams, dataFiles: [{ name: 'x', bytes: new Uint8Array() }] }),
    ).rejects.toThrow(/createModule/);
  });

  it('rejects an empty dataFiles array', async () => {
    await expect(predict({ createModule: vi.fn(), params: okParams, dataFiles: [] })).rejects.toThrow(/dataFiles/);
  });
});

// ── integration: real WASM + local data-local files ─────────────────────────
//
// Skipped when wasm-build/dist/ or data-local/ is absent (CI or fresh clone).
// When present, proves the full MEMFS-mount + callMain + parseReport path
// matches the Phase-A regression expectations (Atlanta→London midday Jan 2025).

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../../wasm-build/dist/p533.mjs');
const DATA_DIR = resolve(HERE, '../../../wasm-build/data-local');
const INTEGRATION_FILES = ['ionos01.bin', 'COEFF01W.txt', 'P1239-3 Decile Factors.txt'];
const INTEGRATION_READY = existsSync(DIST) && INTEGRATION_FILES.every((n) => existsSync(resolve(DATA_DIR, n)));

describe.skipIf(!INTEGRATION_READY)('predict (integration)', () => {
  let createModule;
  afterAll(() => {
    createModule = null; // let GC drop the ~300 KB module
  });

  it('runs Atlanta→London Jan 2025 SSN 120 across five HF bands', async () => {
    const { default: factory } = await import(/* @vite-ignore */ DIST);
    createModule = factory;

    const dataFiles = await Promise.all(
      INTEGRATION_FILES.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(resolve(DATA_DIR, name))) })),
    );

    // vitest+jsdom transforms `import.meta.url` inside the imported WASM loader
    // in a way that breaks Emscripten's default new URL(.wasm, import.meta.url)
    // resolution. Feed the raw bytes in via `wasmBinary` so the loader never
    // touches the URL path.
    const wasmPath = resolve(HERE, '../../../wasm-build/dist/p533.wasm');
    const wasmBinary = new Uint8Array(await readFile(wasmPath));
    const result = await predict({
      createModule,
      dataFiles,
      moduleOptions: { wasmBinary },
      params: {
        txLat: 33.749,
        txLon: -84.388,
        rxLat: 51.5074,
        rxLon: -0.1278,
        year: 2025,
        month: 1,
        hour: 17, // ~noon local over mid-Atlantic
        ssn: 120,
        txPower: 100,
        // Match the smoke-test-e2e scenario: 5 bands so the test stays fast.
        frequencies: [3.5, 7.1, 14.1, 21.1, 28.1],
      },
    });

    expect(result.engine).toBe('wasm-p533');
    expect(result.model).toBe('ITU-R P.533-14');
    expect(result.elapsed).toBeGreaterThan(0);
    expect(result.frequencies).toHaveLength(5);

    // Physics sanity (matches Phase-A regression expectations):
    //  - 80m (3.5) midday over 7000 km: D-layer absorption should crush it
    //  - 15m (21.1) at SFI/SSN 120 midday: a usable opening
    const by = Object.fromEntries(result.frequencies.map((r) => [r.freq, r]));
    expect(by[3.5].reliability).toBeLessThan(20); // essentially closed
    expect(by[21.1].reliability).toBeGreaterThan(40); // decent opening

    // Pr (dBW) should be negative and finite on every band
    for (const r of result.frequencies) {
      expect(Number.isFinite(r.sdbw)).toBe(true);
      expect(r.sdbw).toBeLessThan(0);
    }
  }, 30000); // callMain over 5 bands takes ~30 ms locally; 30 s cap just in case

  // Doug n4hnhradio-ai's problem paths (issue #887, reopened 2026-04-24).
  // The Phase-A heuristic predicted these wrong. P.533 is supposed to be
  // physically correct here — these tests pin the behavior so we know if
  // future upstream changes regress it.

  it("Doug's Kuwait case: US → 9K2ES daytime 80m should be ~closed", async () => {
    const { default: factory } = await import(/* @vite-ignore */ DIST);
    const dataFiles = await Promise.all(
      INTEGRATION_FILES.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(resolve(DATA_DIR, name))) })),
    );
    const wasmBinary = new Uint8Array(await readFile(resolve(HERE, '../../../wasm-build/dist/p533.wasm')));

    const result = await predict({
      createModule: factory,
      dataFiles,
      moduleOptions: { wasmBinary },
      params: {
        // US East Coast → Kuwait City — ~10,500 km, half in UTC daytime.
        txLat: 33.749, // Atlanta stand-in for US East
        txLon: -84.388,
        rxLat: 29.37, // Kuwait City
        rxLon: 47.98,
        year: 2025,
        month: 1,
        hour: 14, // 14 UTC = mid-afternoon Kuwait, morning US East — strong D-layer both ends
        ssn: 120,
        txPower: 100,
        frequencies: [3.5, 7.1, 14.1],
      },
    });

    const by = Object.fromEntries(result.frequencies.map((r) => [r.freq, r]));
    // Heuristic falsely showed 80m green on this path. P.533 should show it
    // as ~closed — D-layer absorption over 10,000 km of daytime path is brutal.
    // This is the concrete bug Doug flagged; the other bands are just sanity.
    expect(by[3.5].reliability).toBeLessThan(20);
    for (const r of result.frequencies) {
      expect(r.reliability).toBeGreaterThanOrEqual(0);
      expect(r.reliability).toBeLessThanOrEqual(99);
    }
  }, 30000);

  it("Doug's Fiji case: US → 3D2JK 30m opens ~06-15Z, closed rest of day", async () => {
    // On a US East → Yasawa Is. Fiji path (~12,500 km) the 30m band has a
    // distinct open window — US-night hours when the mid-Pacific path sees
    // minimal D-layer absorption. Outside that window 30m is effectively
    // dead. Doug flagged "30 red" on his HamClock, which was consistent
    // with checking during his daytime (18Z-03Z); the WASM engine agrees.
    // This test pins both halves of the pattern so a future coefficient or
    // build change that flattens one or the other doesn't slip through.
    const { default: factory } = await import(/* @vite-ignore */ DIST);
    const dataFiles = await Promise.all(
      INTEGRATION_FILES.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(resolve(DATA_DIR, name))) })),
    );
    const wasmBinary = new Uint8Array(await readFile(resolve(HERE, '../../../wasm-build/dist/p533.wasm')));

    async function reliabilityAt(hour, freq) {
      const r = await predict({
        createModule: factory,
        dataFiles,
        moduleOptions: { wasmBinary },
        params: {
          txLat: 33.749,
          txLon: -84.388,
          rxLat: -16.77,
          rxLon: 177.03,
          year: 2025,
          month: 1,
          hour,
          ssn: 120,
          txPower: 100,
          frequencies: [freq],
        },
      });
      return r.frequencies[0].reliability;
    }

    // Closed hours (US evening/pre-dawn): 30m is absorbed hard.
    for (const hour of [0, 21]) {
      const rel = await reliabilityAt(hour, 10.1);
      expect(rel).toBeLessThan(15);
    }
    // Open hours (US night / Fiji dusk-to-dawn): 30m is the money band.
    for (const hour of [9, 12]) {
      const rel = await reliabilityAt(hour, 10.1);
      expect(rel).toBeGreaterThan(40);
    }

    // And the heuristic's original over-promise on 40m at 06Z: should not
    // come back as a near-certainty (this was the other half of Doug's flag).
    const fortyAt6 = await reliabilityAt(6, 7.1);
    expect(fortyAt6).toBeLessThan(85);
    expect(fortyAt6).toBeGreaterThanOrEqual(0);
  }, 60000); // 6 sequential predict calls — up the cap.
});
