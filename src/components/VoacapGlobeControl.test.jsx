/**
 * VoacapGlobeControl — the VOACAP settings panel on the 3D globe writes the
 * shared settings (so the flat map's panel and Globe3D follow) and shows the
 * globe's last response in its status line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../plugins/layers/makeDraggable.js', () => ({ makeDraggable: () => {} }));
vi.mock('../plugins/layers/addMinimizeToggle.js', () => ({ addMinimizeToggle: () => {} }));

import { VoacapGlobeControl } from './VoacapGlobeControl.jsx';
import {
  VOACAP_DATA_EVENT,
  getVoacapSettings,
  setVoacapSettings,
  subscribeVoacapSettings,
} from '../utils/voacapHeatmap.js';

let container;
let root;

const select = (label) =>
  [...container.querySelectorAll('label')].find((l) => l.textContent.startsWith(label)).querySelector('select');
const choose = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  act(() => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<VoacapGlobeControl onClose={() => {}} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe('VoacapGlobeControl', () => {
  it('starts from the shared settings', () => {
    expect(select('Band').value).toBe('4'); // 20m
    expect(select('Mode').value).toBe('SSB');
  });

  it('writes band, mode, power and grid to the shared settings and announces them', () => {
    const fn = vi.fn();
    const unsub = subscribeVoacapSettings(fn);
    choose(select('Band'), 2);
    choose(select('Mode'), 'CW');
    choose(select('Power'), 50);
    choose(select('Grid Resolution'), 10);
    expect(getVoacapSettings()).toEqual({ bandIndex: 2, grid: 10, mode: 'CW', power: 50 });
    expect(fn).toHaveBeenCalledTimes(4);
    unsub();
  });

  it('follows changes made by the flat map’s panel', () => {
    act(() => {
      setVoacapSettings({ bandIndex: 8 });
    });
    expect(select('Band').value).toBe('8'); // 10m
  });

  it('shows the globe’s last response in the status line', () => {
    expect(container.textContent).toContain('Loading...');
    act(() => {
      window.dispatchEvent(
        new CustomEvent(VOACAP_DATA_EVENT, { detail: { mode: 'CW', power: 100, solarData: { sfi: 150, kIndex: 2 } } }),
      );
    });
    expect(container.textContent).toContain('CW 100W | SFI: 150 K: 2');
  });
});
