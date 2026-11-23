/**
 * SidebarPanelsSettings (#1272) — show/hide and size the Modern layout's
 * sidebar panels from Settings instead of a hand-edited config.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import SidebarPanelsSettings, { sizeStep, LEFT_PANELS, RIGHT_PANELS } from './SidebarPanelsSettings.jsx';
import { DEFAULT_CONFIG } from '../utils/config.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;

function render(panels) {
  latest = panels;
  const onChange = (next) => {
    latest = next;
    act(() => root.render(<SidebarPanelsSettings panels={latest} onChange={onChange} />));
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SidebarPanelsSettings panels={panels} onChange={onChange} />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SidebarPanelsSettings', () => {
  it('lists every sidebar panel; only right-column panels have a size', () => {
    render(DEFAULT_CONFIG.panels);
    for (const id of [...LEFT_PANELS, ...RIGHT_PANELS]) {
      expect(container.querySelector(`#sidebar-panel-${id}`)).not.toBeNull();
    }
    expect(container.querySelectorAll('select')).toHaveLength(RIGHT_PANELS.length);
  });

  it('hides a panel and keeps its size', () => {
    render(DEFAULT_CONFIG.panels);
    act(() => container.querySelector('#sidebar-panel-dxpeditions').click());
    expect(latest.dxpeditions).toEqual({ visible: false, size: 0.6 });
    expect(container.querySelector('#sidebar-panel-dxpeditions').checked).toBe(false);
  });

  it('sizes PSK Reporter as a multiple of its default share', () => {
    render(DEFAULT_CONFIG.panels);
    const selects = container.querySelectorAll('select');
    const psk = selects[RIGHT_PANELS.indexOf('pskReporter')];
    act(() => {
      psk.value = '3';
      psk.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.pskReporter).toEqual({ visible: true, size: 3.6 });
    expect(latest.dxCluster).toEqual(DEFAULT_CONFIG.panels.dxCluster);
  });

  it('fills in defaults for a panel missing from an old saved config', () => {
    render({ dxCluster: { visible: true, size: 2 } });
    act(() => container.querySelector('#sidebar-panel-contests').click());
    expect(latest.contests).toEqual({ visible: false, size: 0.8 });
  });

  it('maps a hand-edited size to the nearest step', () => {
    expect(sizeStep('pskReporter', 1.2)).toBe(1);
    expect(sizeStep('pskReporter', 2.5)).toBe(2);
    expect(sizeStep('pskReporter', undefined)).toBe(1);
    expect(sizeStep('contests', 0.3)).toBe(0.5);
  });
});
