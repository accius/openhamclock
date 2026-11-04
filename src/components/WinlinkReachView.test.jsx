/**
 * WinlinkReachView — component test.
 *
 * Real store + view; the engine, network and rig are mocked. Checks the
 * status chips (Good / Marginal / Off the air), the Tune and Pat buttons,
 * click-to-set-DX-and-tune, the Show filter, and the cut-off editor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const mocks = vi.hoisted(() => ({ fetch: null, predict: null, rig: null }));
vi.mock('../utils/apiFetch.js', () => ({
  apiFetch: (...args) => mocks.fetch(...args),
}));
vi.mock('../services/p533/predictInWorker.js', () => ({
  predictInWorker: (...args) => mocks.predict(...args),
}));
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => mocks.rig }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts = {}) =>
      String(opts.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')),
  }),
}));

import WinlinkReachView from './WinlinkReachView.jsx';
import { __resetWinlinkReachStoreForTests } from '../services/winlinkReachStore.js';
import { resetDisplayTime } from '../utils/displayTime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GATEWAYS = [
  { callsign: 'K0GOOD', gridsquare: 'DM79', frequency: 7101200, mode: 43, hours: '00-23' },
  { callsign: 'W1MARG', gridsquare: 'FN31', frequency: 14108500, mode: 50, hours: '00-23' },
  { callsign: 'K0NIGHT', gridsquare: 'DM78', frequency: 3590000, mode: 16, hours: '00-11' },
  { callsign: 'K0VHF', gridsquare: 'DM79', frequency: 145050000, mode: 0, hours: '00-23' },
];
const DE = { lat: 39.75, lon: -104.99 };

let root;
let container;
let onSelect;

function render(props = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <WinlinkReachView
        deLocation={DE}
        propConfig={{ power: 100, antenna: 'dipole' }}
        solarIndices={{ data: { ssn: { current: 120 } } }}
        units="metric"
        onSelectGateway={onSelect}
        {...props}
      />,
    );
  });
}

const settle = async () => {
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const row = (call) => container.querySelector(`[data-testid="reach-row-${call}"]`);
const chip = (call) => row(call)?.querySelector('[data-status]')?.getAttribute('data-status');
const buttons = (el, label) => [...el.querySelectorAll('button')].filter((b) => b.textContent === label);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T15:20:00Z'));
  resetDisplayTime();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  __resetWinlinkReachStoreForTests();
  onSelect = vi.fn();
  mocks.rig = { enabled: true, connected: true, tuneTo: vi.fn() };
  mocks.fetch = vi.fn(async (url) =>
    url === '/api/winlink/gateways'
      ? { ok: true, status: 200, json: async () => ({ gateways: GATEWAYS }) }
      : { ok: false, status: 404, json: async () => ({}) },
  );
  mocks.predict = vi.fn(async (params) => ({
    frequencies: params.frequencies.map((f) =>
      f < 10 ? { freq: f, snr: 12, reliability: 85 } : { freq: f, snr: -2, reliability: 30 },
    ),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetWinlinkReachStoreForTests();
  vi.useRealTimers();
});

describe('WinlinkReachView', () => {
  it('renders Good, Marginal and Off-the-air chips in rank order, plus the VHF list', async () => {
    render();
    await settle();
    expect(chip('K0GOOD')).toBe('good');
    expect(chip('W1MARG')).toBe('marginal');
    expect(chip('K0NIGHT')).toBe('offair');
    expect(row('K0NIGHT').textContent).toContain('Off the air');
    const order = [...container.querySelectorAll('[data-testid^="reach-row-"]')].map((el) =>
      el.getAttribute('data-testid').replace('reach-row-', ''),
    );
    expect(order).toEqual(['K0GOOD', 'W1MARG', 'K0NIGHT']);
    expect(container.querySelector('[data-testid="reach-packet-K0VHF"]').textContent).toContain('Line of sight');
  });

  it('shows Tune and Pat for on-air gateways only, and copies the Pat string', async () => {
    render();
    await settle();
    expect(buttons(row('K0GOOD'), 'Tune')).toHaveLength(1);
    expect(buttons(row('K0GOOD'), 'Pat')).toHaveLength(1);
    expect(buttons(row('K0NIGHT'), 'Tune')).toHaveLength(0);
    expect(buttons(row('K0NIGHT'), 'Pat')).toHaveLength(0);
    await act(async () => {
      buttons(row('K0GOOD'), 'Pat')[0].click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ardop:///K0GOOD?bw=2000MAX&freq=7099.7');
    expect(container.textContent).toContain('Copied ardop:///K0GOOD');
    expect(onSelect).not.toHaveBeenCalled(); // the button must not also select the row
  });

  it('hides Tune when rig control is not connected', async () => {
    mocks.rig = { enabled: true, connected: false, tuneTo: vi.fn() };
    render();
    await settle();
    expect(buttons(row('K0GOOD'), 'Tune')).toHaveLength(0);
    expect(buttons(row('K0GOOD'), 'Pat')).toHaveLength(1);
  });

  it('click sets DX and tunes the dial frequency in DATA-USB; off-air click only sets DX', async () => {
    render();
    await settle();
    act(() => {
      row('K0GOOD').querySelector('[role="button"]').click();
    });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ callsign: 'K0GOOD' }));
    expect(mocks.rig.tuneTo).toHaveBeenCalledWith(7099700, 'DATA-USB');
    mocks.rig.tuneTo.mockClear();
    act(() => {
      row('K0NIGHT').querySelector('[role="button"]').click();
    });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ callsign: 'K0NIGHT' }));
    expect(mocks.rig.tuneTo).not.toHaveBeenCalled();
  });

  it('filters to reachable / good-only', async () => {
    render();
    await settle();
    const select = container.querySelector('select[aria-label="Which gateways to show"]');
    const choose = (v) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, v);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    choose('reachable');
    expect(row('K0GOOD')).toBeTruthy();
    expect(row('W1MARG')).toBeTruthy();
    expect(row('K0NIGHT')).toBeNull();
    choose('good');
    expect(row('K0GOOD')).toBeTruthy();
    expect(row('W1MARG')).toBeNull();
    expect(container.querySelector('[data-testid="reach-packet-K0VHF"]')).toBeTruthy(); // line of sight passes
  });

  it('shows an "hours ?" badge when the published hours do not say when the gateway is on', async () => {
    const base = mocks.fetch;
    mocks.fetch = vi.fn(async (url) =>
      url === '/api/winlink/gateways'
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              gateways: [{ callsign: 'K0PART', gridsquare: 'DM79', frequency: 7101200, mode: 43, hours: '12/7' }],
            }),
          }
        : base(url),
    );
    render();
    await settle();
    expect(chip('K0PART')).toBe('good'); // unknown hours never force Off the air
    const badge = row('K0PART').querySelector('[data-testid="hours-unknown"]');
    expect(badge.textContent).toBe('hours ?');
    expect(badge.getAttribute('title')).toMatch(/about 12 h a day/);
  });

  it('has a PACTOR-4 modem setting under Cut-offs', async () => {
    render();
    await settle();
    act(() => {
      buttons(container, 'Cut-offs')[0].click();
    });
    const label = [...container.querySelectorAll('label')].find((l) =>
      l.textContent.includes('My modem supports PACTOR 4'),
    );
    const box = label.querySelector('input[type="checkbox"]');
    expect(box.checked).toBe(false);
    act(() => {
      box.click();
    });
    await settle();
    expect(box.checked).toBe(true);
    expect(localStorage.getItem('ohc_winlinkReachPactor4')).toBe('1');
  });

  it('applies edited cut-offs without re-running predictions', async () => {
    render();
    await settle();
    const calls = mocks.predict.mock.calls.length;
    act(() => {
      buttons(container, 'Cut-offs')[0].click();
    });
    const input = container.querySelectorAll('input[type="number"]')[0];
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '90');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(chip('K0GOOD')).toBe('marginal');
    expect(mocks.predict.mock.calls.length).toBe(calls);
    act(() => {
      buttons(container, 'Defaults')[0].click();
    });
    await settle();
    expect(chip('K0GOOD')).toBe('good');
  });
});
