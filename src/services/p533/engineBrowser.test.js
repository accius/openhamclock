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

  it('applies signal margin (FT8 @ 100W = +34dB) to raw P.533 reliability', async () => {
    predictMock.mockResolvedValue(fakeHourResult({ reliability: 50 }));

    const ssb = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'SSB', power: 100 });
    const ft8 = await runBrowserEngine({ deLocation: DE, dxLocation: DX, mode: 'FT8', power: 100 });

    // Same 50% raw reliability → higher number under FT8 margin
    const ssbRel = ssb.currentBands[0].reliability;
    const ft8Rel = ft8.currentBands[0].reliability;
    expect(ft8Rel).toBeGreaterThan(ssbRel);
    expect(ssb.signalMargin).toBe(0);
    expect(ft8.signalMargin).toBe(34);
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
