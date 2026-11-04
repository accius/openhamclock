/**
 * useWinlinkReach + services/winlinkReachStore — Vitest + React 18
 *
 * Engine and network are mocked: predictInWorker returns a canned P.533
 * result, apiFetch serves a small gateway list, solar indices and the
 * /api/propagation 24-hour series. The clock is pinned (Date only) so the
 * display hour — and therefore who is on the air — is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const mocks = vi.hoisted(() => ({ fetch: null, predict: null }));
vi.mock('../utils/apiFetch.js', () => ({
  apiFetch: (...args) => mocks.fetch(...args),
}));
vi.mock('../services/p533/predictInWorker.js', () => ({
  predictInWorker: (...args) => mocks.predict(...args),
}));

import { useWinlinkReach, REACH_PRIORITY } from './useWinlinkReach.js';
import {
  __resetWinlinkReachStoreForTests,
  getReachState,
  requestReach,
  releaseReach,
  setReachPactor4,
  setReachThresholds,
} from '../services/winlinkReachStore.js';
import { resetDisplayTime, setDisplayOffsetMs, HOUR_MS } from '../utils/displayTime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GATEWAYS = [
  { callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 7101200, mode: 50, hours: '00-23' },
  { callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 145050000, mode: 0, hours: '00-23' },
  { callsign: 'W1AW-10', gridsquare: 'FN31', frequency: 14108500, mode: 43, hours: '00-23' },
  { callsign: 'K0NIGHT', gridsquare: 'DM78', frequency: 3590000, mode: 16, hours: '00-11' },
  { callsign: 'JA1FAR', gridsquare: 'PM95', frequency: 7101200, mode: 50, hours: '00-23' },
];

const DE = { lat: 39.75, lon: -104.99 };
const PROP = { mode: 'SSB', power: 100, antenna: 'dipole' };

let roots = [];
let latest;

function Harness(props) {
  latest = useWinlinkReach(props);
  return null;
}

function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness active deLocation={DE} propConfig={PROP} ssn={120} {...props} />);
  });
  roots.push({ root, container });
  return root;
}

function unmountAll() {
  for (const { root, container } of roots) {
    act(() => root.unmount());
    container.remove();
  }
  roots = [];
}

const settle = async () => {
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const restCalls = () => mocks.fetch.mock.calls.filter(([u]) => u.startsWith('/api/propagation?'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T15:20:00Z')); // 15z: K0NIGHT (00-11) is off the air
  resetDisplayTime();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  __resetWinlinkReachStoreForTests();
  mocks.fetch = vi.fn(async (url) => {
    if (url === '/api/winlink/gateways') {
      return { ok: true, status: 200, json: async () => ({ gateways: GATEWAYS }) };
    }
    if (url === '/api/solar-indices') {
      return { ok: true, status: 200, json: async () => ({ ssn: { current: 118 } }) };
    }
    if (url.startsWith('/api/propagation?')) {
      const series = (f) => Array.from({ length: 24 }, (_, h) => ({ hour: h, reliability: f(h) }));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'Built-in estimation',
          currentBands: [{ band: '40m', reliability: 1 }],
          hourlyPredictions: { '40m': series((h) => h), '20m': series((h) => 3 * h) },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  // 40 m strong from Denver to anywhere, 20 m weak.
  mocks.predict = vi.fn(async (params) => ({
    frequencies: params.frequencies.map((f) =>
      f < 10 ? { freq: f, snr: 12, reliability: 85 } : { freq: f, snr: -9, reliability: 10 },
    ),
  }));
});

afterEach(() => {
  unmountAll();
  __resetWinlinkReachStoreForTests();
  resetDisplayTime();
  vi.useRealTimers();
});

describe('useWinlinkReach / shared store', () => {
  it('predicts on-air HF gateways in range, ranks them, and marks off-air ones', async () => {
    mount();
    await settle();
    expect(latest.running).toBe(false);
    // JA1FAR out of range; K0NIGHT off the air (no engine run); 2 m port not predicted.
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    expect(latest.rows.map((r) => r.callsign)).toEqual(['K0NEAR', 'W1AW-10', 'K0NIGHT']);
    expect(latest.rows[0]).toMatchObject({ status: 'good', reliability: 85, engine: 'wasm' });
    expect(latest.rows[1].status).toBe('marginal'); // 10 % but SNR −9 vs −5 floor → −4 dB margin
    expect(latest.rows[2].status).toBe('offair');
    expect(latest.byCall['K0NIGHT'].status).toBe('offair');
    expect(latest.hour).toBe(15);
    const params = mocks.predict.mock.calls[0][0];
    expect(params).toMatchObject({ txPower: 100, requiredSNR: -5, hour: 15, ssn: 120 });
    expect(params.txGain).toBeCloseTo(2.15);
  });

  it('runs once for several consumers (panel + layer + EmComm) and serves remounts from cache', async () => {
    mount();
    mount({ id: 'emcomm', priority: REACH_PRIORITY.emcomm, throttleMs: 1000 });
    requestReach('layer', { priority: REACH_PRIORITY.layer, deLocation: DE, propConfig: PROP });
    await settle();
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    releaseReach('layer');
    unmountAll();
    mount();
    await settle();
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    expect(latest.rows[0].status).toBe('good');
  });

  it('lets the map layer run on its own, fetching the SSN first', async () => {
    requestReach('layer', { priority: REACH_PRIORITY.layer, deLocation: DE, propConfig: PROP });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await settle();
    const s = getReachState();
    expect(s.active).toBe(true);
    expect(s.byCall['K0NEAR']).toMatchObject({ kind: 'hf', status: 'good' });
    expect(mocks.fetch.mock.calls.some(([u]) => u === '/api/solar-indices')).toBe(true);
    // Ran once, at the fetched SSN (118 → bucket 120) — not once at a guess and again.
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    expect(mocks.predict.mock.calls[0][0].ssn).toBe(120);
    releaseReach('layer');
    await settle();
    expect(getReachState().active).toBe(false);
  });

  it('re-classifies on a threshold change without new engine work', async () => {
    mount();
    await settle();
    act(() => setReachThresholds({ goodReliability: 90, marginalReliability: 20, marginalSnrMargin: -6 }));
    await settle();
    expect(latest.rows[0].status).toBe('marginal');
    expect(mocks.predict).toHaveBeenCalledTimes(2);
  });

  it('follows the display time: a shifted hour puts the night gateway back on the air', async () => {
    mount();
    await settle();
    act(() => {
      setDisplayOffsetMs(-12 * HOUR_MS); // 03z
    });
    await settle();
    expect(latest.hour).toBe(3);
    expect(latest.rows.find((r) => r.callsign === 'K0NIGHT').status).not.toBe('offair');
    expect(mocks.predict.mock.calls.at(-1)[0].hour).toBe(3);
  });

  it('falls back to the server series at the display hour when the WASM engine fails', async () => {
    mocks.predict = vi.fn(async () => {
      throw new Error('no wasm');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    await settle();
    warn.mockRestore();
    expect(restCalls()).toHaveLength(2);
    expect(latest.engine).toBe('est');
    // 20 m series is 3·h → 45 at 15z; no SNR from the server, so no margin.
    expect(latest.rows.find((r) => r.callsign === 'W1AW-10')).toMatchObject({
      reliability: 45,
      snrMargin: null,
      status: 'marginal',
    });
    // Server mode chosen from the −5 dB floor.
    expect(restCalls()[0][0]).toMatch(/mode=OLIVIA/);
  });

  it('sends the display-time month to the server fallback', async () => {
    mocks.predict = vi.fn(async () => {
      throw new Error('no wasm');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDisplayOffsetMs(-20 * 24 * HOUR_MS); // 15 Oct → 25 Sep
    mount();
    await settle();
    warn.mockRestore();
    expect(restCalls().length).toBeGreaterThan(0);
    for (const [url] of restCalls()) expect(url).toMatch(/[?&]month=9(&|$)/);
  });

  it("runs a shifted month with that month's smoothed SSN from the solar-cycle feed", async () => {
    const base = mocks.fetch;
    mocks.fetch = vi.fn(async (url) =>
      url === '/api/solar-cycle'
        ? {
            ok: true,
            status: 200,
            json: async () => ({ observed: [], predicted: [{ t: '2026-09', min: 60, max: 80 }] }),
          }
        : base(url),
    );
    // Current month: today's SSN, and the cycle feed is not even fetched.
    mount();
    await settle();
    expect(mocks.predict.mock.calls.at(-1)[0].ssn).toBe(120);
    expect(latest.ssnSource).toBe('current');
    expect(mocks.fetch.mock.calls.some(([u]) => u === '/api/solar-cycle')).toBe(false);
    // Shift into September: SSN 70 (predicted midpoint) → bucket 70.
    act(() => {
      setDisplayOffsetMs(-20 * 24 * HOUR_MS);
    });
    await settle();
    expect(latest.ssnSource).toBe('solar-cycle');
    expect(latest.ssnUsed).toBe(70);
    expect(mocks.predict.mock.calls.at(-1)[0]).toMatchObject({ ssn: 70, month: 9 });
  });

  it('keeps the current SSN when the solar-cycle feed is unavailable', async () => {
    setDisplayOffsetMs(-20 * 24 * HOUR_MS);
    mount();
    await settle();
    expect(mocks.fetch.mock.calls.some(([u]) => u === '/api/solar-cycle')).toBe(true);
    expect(latest.ssnSource).toBe('current');
    expect(mocks.predict.mock.calls.at(-1)[0]).toMatchObject({ ssn: 120, month: 9 });
  });

  it('re-scores PACTOR-4 gateways when the operator says their modem supports P4', async () => {
    const p4Only = [{ callsign: 'K0P4', gridsquare: 'DM79', frequency: 7102000, mode: 17, hours: '00-23' }];
    const base = mocks.fetch;
    mocks.fetch = vi.fn(async (url) =>
      url === '/api/winlink/gateways' ? { ok: true, status: 200, json: async () => ({ gateways: p4Only }) } : base(url),
    );
    mount();
    await settle();
    expect(mocks.predict.mock.calls.at(-1)[0].requiredSNR).toBe(-5);
    act(() => setReachPactor4(true));
    await settle();
    expect(latest.pactor4).toBe(true);
    expect(mocks.predict.mock.calls.at(-1)[0].requiredSNR).toBe(-19);
    const n = mocks.predict.mock.calls.length;
    act(() => setReachPactor4(false));
    await settle();
    expect(mocks.predict.mock.calls.length).toBe(n); // P3 result still cached
  });

  it('stays idle when inactive or without a station location', async () => {
    mount({ active: false });
    await settle();
    expect(mocks.fetch).not.toHaveBeenCalled();
    unmountAll();
    mount({ deLocation: null });
    await settle();
    expect(mocks.predict).not.toHaveBeenCalled();
    expect(latest.hasDe).toBe(false);
  });
});
