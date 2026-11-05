/**
 * ClassicBandStrip — the Classic layout's band legend filters the map (#1269).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClassicBandStrip, bandKey, toggleBandFilter } from './ClassicBandStrip.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BANDS = ['160', '80', '40', '30', '20', '17', '15', '12', '10', '8', '6', '4'];

describe('band filter helpers', () => {
  it('writes the same keys as the WorldMap legend', () => {
    expect(['20', '20m', ' 20M ', '70cm', 'other', ''].map(bandKey)).toEqual(['20m', '20m', '20m', '70cm', null, null]);
  });

  it('adds a band, adds another, and removes one clicked again', () => {
    let f = toggleBandFilter([], '20');
    expect(f).toEqual(['20m']);
    f = toggleBandFilter(f, '40');
    expect(f.sort()).toEqual(['20m', '40m']);
    expect(toggleBandFilter(f, '20m')).toEqual(['40m']);
    expect(toggleBandFilter(null, '15')).toEqual(['15m']);
  });
});

describe('ClassicBandStrip', () => {
  let container;
  let root;
  let latest;

  function Harness({ initial = [] }) {
    const [filter, setFilter] = useState(initial);
    latest = filter;
    return <ClassicBandStrip bands={BANDS} mapBandFilter={filter} onMapBandFilterChange={setFilter} />;
  }

  const btn = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  const click = (label) => act(() => btn(label).click());

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders every band as a button, with no ALL while unfiltered', () => {
    act(() => root.render(<Harness />));
    expect(BANDS.every((b) => btn(b)?.tagName === 'BUTTON')).toBe(true);
    expect(btn('ALL')).toBeUndefined();
  });

  it('filters the map to the clicked bands and ALL clears it', () => {
    act(() => root.render(<Harness />));
    click('20');
    expect(latest).toEqual(['20m']);
    expect(btn('20').getAttribute('aria-pressed')).toBe('true');
    expect(btn('40').style.opacity).toBe('0.35');

    click('40');
    expect([...latest].sort()).toEqual(['20m', '40m']);
    click('20');
    expect(latest).toEqual(['40m']);

    click('ALL');
    expect(latest).toEqual([]);
    expect(btn('ALL')).toBeUndefined();
    expect(btn('40').style.opacity).toBe('1');
  });

  it('shows a filter set in another layout', () => {
    act(() => root.render(<Harness initial={['15m']} />));
    expect(btn('15').getAttribute('aria-pressed')).toBe('true');
    expect(btn('ALL')).toBeDefined();
  });
});
