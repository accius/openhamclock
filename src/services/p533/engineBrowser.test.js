import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the worker module before importing engineBrowser — predictInWorker
// pulls in Web Worker APIs that aren't usable in the node test runner.
const predictMock = vi.fn();
vi.mock('./predictInWorker.js', () => ({
  predictInWorker: (...args) => predictMock(...args),
}));

const { runBrowserEngine, __internal } = await import('./engineBrowser.js');
const { freqToBand, BANDS, summarizeTimings } = __internal;

const DE = { lat: 33.75, lon: -84.39 }; // Atlanta
const DX = { lat: 51.5, lon: -0.12 }; // London

// Simulated ITURHFProp output — 9 bands at the frequencies predict.js uses.
function fakeHourResult({ reliability = 70, muf = 20 } = {}) {
  const FREQS = [1.8, 3.5, 7.1, 10.1, 14.1, 18.1, 21.1, 24.9, 28.1];
  return {
    frequencies: FREQS.map((freq) => ({ freq, reliability, sdbw: -100, snr: 10 })),
    muf,
  };
}

beforeEach(() => {
  predictMock.mockReset();
});

describe('freqToBand', () => {
  it('maps ITURHFProp center frequencies to UI bands', () => {
    expect(freqToBand(1.8)).toBe('160m');
    expect(freqToBand(3.5)).toBe('80m');
    expect(freqToBand(7.1)).toBe('40m'); // 7.1 not 7.0 — same 2 MHz window as server
    expect(freqToBand(10.1)).toBe('30m');
    expect(freqToBand(14.1)).toBe('20m');
    expect(freqToBand(18.1)).toBe('17m');
    expect(freqToBand(21.1)).toBe('15m');
    expect(freqToBand(24.9)).toBe('12m');
    expect(freqToBand(28.1)).toBe('10m');
  });

  it('returns null for frequencies outside the tolerance window', () => {
    expect(freqToBand(50)).toBe(null); // 22 MHz above highest UI band
    expect(freqToBand(12)).toBe(null); // midpoint of the 10m↔30m gap — exactly 2 MHz from each
  });
});

describe('runBrowserEngine', () => {
  it('calls predictInWorker once per hour (24 times)', async () => {
    predictMock.mockResolvedValue(fakeHourResult());

    await runBrowserEngine({ deLocation: DE, dxLocation: DX });

    expect(predictMock).toHaveBeenCalledTimes(24);
    const hours = predictMock.mock.calls.map((c) => c[0].hour).sort((a, b) => a - b);
    expect(hours).toEqual([...Array(24).keys()]);
  });

  it('builds the same response shape as /api/propagation', async () => {
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 60 }));

    const result = await runBrowserEngine({ deLocation: DE, dxLocation: DX });

    expect(result.model).toBe('ITU-R P.533-14');
    expect(result.engine).toBe('wasm');
    expect(result.iturhfprop).toEqual({ enabled: true, available: true });
    expect(result.signalMargin).toBe(0); // SSB 100W 0dBi
    expect(result.antenna).toEqual({ key: 'isotropic', name: 'Isotropic', gain: 0 });

    // currentBands: 9 entries, sorted by reliability desc
    expect(result.currentBands).toHaveLength(9);
    const rels = result.currentBands.map((b) => b.reliability);
    expect(rels).toEqual([...rels].sort((a, b) => b - a));

    // hourlyPredictions: all 9 bands × 24 hours
    for (const band of BANDS) {
      expect(result.hourlyPredictions[band]).toHaveLength(24);
      expect(result.hourlyPredictions[band][0]).toMatchObject({
        hour: 0,
        reliability: expect.any(Number),
        snr: expect.any(String),
      });
    }
  });

  it('passes the mode decode threshold into the engine as requiredSNR (FT8 = -19, SSB = 15)', async () => {
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 50 }));

    const ssb = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'SSB', power: 100 });
    const ssbSNRs = new Set(predictMock.mock.calls.map((c) => c[0].requiredSNR));
    expect(ssbSNRs).toEqual(new Set([15]));

    predictMock.mockClear();
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 50 }));
    const ft8 = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'FT8', power: 100 });
    const ft8SNRs = new Set(predictMock.mock.calls.map((c) => c[0].requiredSNR));
    expect(ft8SNRs).toEqual(new Set([15 - 34]));

    // The margin badge still reflects the mode for the UI.
    expect(ssb.signalMargin).toBe(0);
    expect(ft8.signalMargin).toBe(34);
  });

  it('does NOT post-process the engine BCR — mode lives in the engine input now', async () => {
    // Regression for the FT8 restricted-coverage bug: a post-hoc +34 dB bump
    // could never reopen a band the engine scored 0% at the SSB threshold,
    // and it distorted non-zero bands. The engine runs at the FT8 threshold
    // instead, so its output must be passed through untouched.
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 50 }));

    const ft8 = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'FT8', power: 100 });
    expect(ft8.currentBands[0].reliability).toBe(50);
  });

  it('does NOT double-count power: 1000W and 100W produce identical reliability', async () => {
    // Regression for the "1000W floods everything green" bug. ITURHFProp
    // already consumed Path.txpower when it produced this raw 5% BCR, so
    // bumping the user-facing power knob from 100W to 1000W must not change
    // the post-processed reliability — only the WASM input changes.
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 5 }));

    const at100 = await runBrowserEngine({
      deLocation: DE,
      dxLocation: DX,
      mode: 'SSB',
      power: 100,
      antenna: 'vert-qw',
    });
    const at1000 = await runBrowserEngine({
      deLocation: DE,
      dxLocation: DX,
      mode: 'SSB',
      power: 1000,
      antenna: 'vert-qw',
    });

    const rel100 = at100.currentBands[0].reliability;
    const rel1000 = at1000.currentBands[0].reliability;
    // Raw 5% with mode-only adjustment (SSB = 0 dB) → reliability stays 5.
    expect(rel100).toBe(5);
    expect(rel1000).toBe(5);
    // Reported margin still reflects power+antenna for the UI badge.
    expect(at100.signalMargin).toBe(1.5);
    expect(at1000.signalMargin).toBe(11.5);
  });

  it('does NOT double-count antenna gain across antenna choices', async () => {
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 30 }));

    const iso = await runBrowserEngine({
      deLocation: DE,
      dxLocation: DX,
      mode: 'SSB',
      power: 100,
      antenna: 'isotropic',
    });
    const yagi = await runBrowserEngine({
      deLocation: DE,
      dxLocation: DX,
      mode: 'SSB',
      power: 100,
      antenna: 'yagi5',
    });

    // SSB (mode advantage 0). Raw 30% should land at 30 regardless of antenna
    // because gain is fed into ITURHFProp via TXGOS, not the post-processor.
    expect(iso.currentBands[0].reliability).toBe(30);
    expect(yagi.currentBands[0].reliability).toBe(30);
  });

  it('picks MUF from the current-hour result', async () => {
    const currentHour = new Date().getUTCHours();
    predictMock.mockImplementation((params) =>
      Promise.resolve(fakeHourResult({ muf: params.hour === currentHour ? 17.5 : 10 })),
    );

    const result = await runBrowserEngine({ deLocation: DE, dxLocation: DX });
    expect(result.muf).toBe(17.5);
  });

  it('propagates predictInWorker errors (caller falls back to REST)', async () => {
    predictMock.mockRejectedValueOnce(new Error('WASM unavailable'));
    await expect(runBrowserEngine({ deLocation: DE, dxLocation: DX })).rejects.toThrow('WASM unavailable');
  });

  it('aborts when the AbortSignal is triggered mid-loop', async () => {
    const controller = new AbortController();
    let callCount = 0;
    predictMock.mockImplementation(() => {
      callCount++;
      if (callCount === 3) controller.abort();
      return Promise.resolve(fakeHourResult());
    });

    await expect(runBrowserEngine({ deLocation: DE, dxLocation: DX, signal: controller.signal })).rejects.toThrow(
      'aborted',
    );
    // 3 calls completed, then we abort before the 4th
    expect(callCount).toBe(3);
  });

  it('requires deLocation and dxLocation', async () => {
    await expect(runBrowserEngine({})).rejects.toThrow(/deLocation and dxLocation/);
    await expect(runBrowserEngine({ deLocation: DE })).rejects.toThrow(/deLocation and dxLocation/);
  });

  it('forwards wasmUrl override to predictInWorker', async () => {
    predictMock.mockResolvedValue(fakeHourResult());
    await runBrowserEngine({ deLocation: DE, dxLocation: DX, wasmUrl: '/custom/p533.mjs' });
    expect(predictMock).toHaveBeenCalledWith(expect.any(Object), { wasmUrl: '/custom/p533.mjs' });
  });

  it('reports progress after each hour', async () => {
    predictMock.mockResolvedValue(fakeHourResult());
    const progress = [];
    await runBrowserEngine({ deLocation: DE, dxLocation: DX, onProgress: (p) => progress.push(p) });
    expect(progress).toHaveLength(24);
    expect(progress[0]).toEqual({ hour: 1, total: 24 });
    expect(progress[23]).toEqual({ hour: 24, total: 24 });
  });

  it('returns a benchmark summary', async () => {
    predictMock.mockResolvedValue(fakeHourResult());
    const result = await runBrowserEngine({ deLocation: DE, dxLocation: DX });
    expect(result.benchmark).toBeDefined();
    expect(result.benchmark.samples).toBe(24);
    // Each field is a non-negative integer (ms).
    for (const k of ['totalMs', 'firstCallMs', 'warmMinMs', 'warmMaxMs', 'warmP50Ms', 'warmP90Ms', 'warmTotalMs']) {
      expect(Number.isInteger(result.benchmark[k])).toBe(true);
      expect(result.benchmark[k]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('summarizeTimings', () => {
  it('treats the first call as cold start and the rest as warm samples', () => {
    const timings = [500, 40, 35, 50, 45, 38, 42, 36, 48, 39]; // 500ms cold + 9 warm
    const b = summarizeTimings(timings);
    expect(b.samples).toBe(10);
    expect(b.firstCallMs).toBe(500);
    expect(b.warmMinMs).toBe(35);
    expect(b.warmMaxMs).toBe(50);
    expect(b.warmTotalMs).toBe(373); // sum of warm samples
    expect(b.totalMs).toBe(873);
  });

  it('computes p50 / p90 from the warm samples', () => {
    // 20 sorted samples: 1..20
    const timings = [100, ...Array.from({ length: 20 }, (_, i) => i + 1)];
    const b = summarizeTimings(timings);
    expect(b.warmP50Ms).toBe(11); // index floor(20 * 0.5) = 10 → sorted[10] = 11
    expect(b.warmP90Ms).toBe(19); // index floor(20 * 0.9) = 18 → sorted[18] = 19
  });

  it('handles a single-sample run without crashing', () => {
    const b = summarizeTimings([42]);
    expect(b.samples).toBe(1);
    expect(b.firstCallMs).toBe(42);
    // With no warm samples these degrade to 0.
    expect(b.warmMinMs).toBe(0);
    expect(b.warmP50Ms).toBe(0);
  });
});

describe('LUF from the engine bands (W3AAX report)', () => {
  // Per-band reliabilities as in W3AAX's panel: 160m open at 75% under FT8.
  const REL = { 1.8: 75, 3.5: 99, 7.1: 99, 10.1: 91, 14.1: 19, 18.1: 0, 21.1: 0, 24.9: 0, 28.1: 0 };
  const hour = (rel) => ({
    frequencies: Object.entries(rel).map(([freq, reliability]) => ({
      freq: Number(freq),
      reliability,
      sdbw: -100,
      snr: 10,
    })),
    muf: 8.35,
  });

  it('reports the lowest band at or above 50%, matching the bars', async () => {
    predictMock.mockResolvedValue(hour(REL));
    const result = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'FT8', power: 25 });
    expect(result.currentBands.find((b) => b.band === '160m').reliability).toBe(75);
    expect(result.luf).toBe(1.8);
  });

  it('is null when nothing reaches 50%, so the hook falls back to the estimate', async () => {
    predictMock.mockResolvedValue(hour(Object.fromEntries(Object.keys(REL).map((f) => [f, 10]))));
    const result = await runBrowserEngine({ deLocation: DE, dxLocation: DX });
    expect(result.luf).toBeNull();
  });
});
