/**
 * QsoForm — the DX marker follows the typed call (country) or grid, and goes
 * back where it was when the form closes without saving.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && opts.defaultValue) || key }),
}));
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => ({ connected: false }) }));
// Stand-in for cty.dat: JA → Japan, W → USA.
vi.mock('../utils/ctyLookup.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isCtyLoaded: () => true,
  initCtyLookup: () => {},
  ctyLookup: (call) =>
    call.startsWith('JA')
      ? { lat: 36, lon: 138, entity: 'Japan' }
      : call.startsWith('W')
        ? { lat: 43, lon: -87.9, entity: 'United States' }
        : null,
}));

import { QsoForm } from './QsoForm.jsx';
import { DX_FOLLOW_DELAY_MS } from '../hooks/useQsoDxFollow.js';

const ORIGIN = { lat: 51.1, lon: 4.4 };

let container;
let root;
let onDXChange;

const field = (label) => container.querySelector(`input[aria-label="${label}"]`);
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);

const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// Type a call key by key, as an operator would.
const typeCall = (call) => {
  for (let i = 1; i <= call.length; i++) type(field('Callsign'), call.slice(0, i));
};

const pause = () => act(() => vi.advanceTimersByTime(DX_FOLLOW_DELAY_MS + 10));

const mount = (props = {}) => {
  act(() => {
    root.render(
      <QsoForm
        prefill={{}}
        onSaved={() => {}}
        onCancel={() => {}}
        onDXChange={onDXChange}
        dxLocation={ORIGIN}
        dxCallsign="PREV"
        {...props}
      />,
    );
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  onDXChange = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('QsoForm moves the DX marker while typing', () => {
  it('moves to the call’s country once typing pauses, not per keystroke', () => {
    mount();
    typeCall('JA1XYZ');
    expect(onDXChange).not.toHaveBeenCalled(); // still typing
    pause();
    expect(onDXChange).toHaveBeenCalledTimes(1);
    expect(onDXChange).toHaveBeenCalledWith({ lat: 36, lon: 138, callsign: 'JA1XYZ' });
  });

  it('refines to the grid square once a valid grid is typed', () => {
    mount();
    typeCall('W1AW');
    pause();
    type(field('Gridsquare'), 'FN31');
    pause();
    const last = onDXChange.mock.calls.at(-1)[0];
    expect(last.callsign).toBe('W1AW');
    expect(last.lat).toBeCloseTo(41.5);
    expect(last.lon).toBeCloseTo(-73);
  });

  it('does nothing for a call it cannot place', () => {
    mount();
    typeCall('ZZ9');
    pause();
    expect(onDXChange).not.toHaveBeenCalled();
  });

  it('puts the marker back on Cancel', () => {
    mount();
    typeCall('JA1XYZ');
    pause();
    act(() => button('Cancel').click());
    expect(onDXChange).toHaveBeenLastCalledWith({ lat: ORIGIN.lat, lon: ORIGIN.lon, callsign: 'PREV' });
  });

  it('puts the marker back when the form closes without saving', () => {
    mount();
    typeCall('JA1XYZ');
    pause();
    act(() => root.unmount());
    expect(onDXChange).toHaveBeenLastCalledWith({ lat: ORIGIN.lat, lon: ORIGIN.lon, callsign: 'PREV' });
    root = createRoot(container); // afterEach unmounts again
  });

  it('leaves the marker on the station once the QSO is saved', () => {
    mount();
    typeCall('JA1XYZ');
    pause();
    act(() => button('Log QSO').click());
    act(() => root.unmount());
    expect(onDXChange).toHaveBeenCalledTimes(1);
    expect(onDXChange).toHaveBeenLastCalledWith({ lat: 36, lon: 138, callsign: 'JA1XYZ' });
    root = createRoot(container);
  });

  it('does not move for a prefilled call until it is edited', () => {
    mount({ prefill: { call: 'JA1XYZ' } });
    pause();
    expect(onDXChange).not.toHaveBeenCalled();
    act(() => root.unmount()); // nothing moved → nothing to restore
    expect(onDXChange).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('stays off without onDXChange', () => {
    mount({ onDXChange: undefined });
    typeCall('JA1XYZ');
    pause();
    expect(onDXChange).not.toHaveBeenCalled();
  });
});
