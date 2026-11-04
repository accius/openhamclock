/**
 * QsoForm — the NEW / BAND / DUPE / ✓ label on the call field (SpotBadge),
 * driven by the same award and worked-before lookups as the DX cluster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && opts.defaultValue) || key }),
}));
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => ({ connected: false }) }));

// Log stand-in: Japan never worked; the USA worked on 20 m only; W1AW
// already logged on 20 m SSB.
const awardCalls = [];
vi.mock('../hooks/useAwards.js', () => ({
  useAwards: () => ({
    getSpotStatus: (call, freq) => {
      awardCalls.push([call, freq]);
      if (call.startsWith('JA')) return 'new';
      if (call.startsWith('W') && freq && (freq < 14 || freq > 14.35)) return 'new-band';
      return null;
    },
  }),
}));
vi.mock('../hooks/useWorkedBefore.js', () => ({
  useWorkedBefore: () => ({
    getStatus: (call, freq, mode) => {
      if (call !== 'W1AW') return null;
      return freq >= 14 && freq <= 14.35 && mode === 'SSB' ? 'dupe' : 'worked';
    },
  }),
}));

import { QsoForm } from './QsoForm.jsx';

let container;
let root;

const field = (label) => container.querySelector(`input[aria-label="${label}"]`);
const badgeText = () => {
  const span = field('Callsign').parentElement.querySelector('span[title]');
  return span ? span.textContent : null;
};
const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const mount = (props = {}) =>
  act(() => root.render(<QsoForm prefill={{}} onSaved={() => {}} onCancel={() => {}} {...props} />));

beforeEach(() => {
  awardCalls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QsoForm call label', () => {
  it('shows nothing until a call is typed', () => {
    mount();
    expect(badgeText()).toBe(null);
  });

  it('shows NEW for an entity not in the log', () => {
    mount();
    type(field('Callsign'), 'ja1xyz');
    expect(badgeText()).toBe('NEW');
  });

  it('shows BAND for a worked entity on a new band, from the form frequency', () => {
    mount();
    type(field('Callsign'), 'W2ABC');
    type(field('Frequency in MHz'), '7.030');
    expect(badgeText()).toBe('BAND');
    expect(awardCalls.at(-1)).toEqual(['W2ABC', 7.03]);
  });

  it('shows DUPE for the same call, band and mode, and ✓ on another band', () => {
    mount();
    type(field('Callsign'), 'W1AW');
    type(field('Frequency in MHz'), '14.250');
    expect(badgeText()).toBe('DUPE');
    type(field('Frequency in MHz'), '18.130');
    expect(badgeText()).toBe('BAND'); // new-band outranks worked
  });

  it('shows ✓ for a call worked before when nothing award-worthy applies', () => {
    mount();
    type(field('Callsign'), 'W1AW');
    type(field('Frequency in MHz'), '14.250');
    type(field('Mode'), 'CW');
    expect(badgeText()).toBe('✓');
  });

  it('shows no label while editing an existing QSO', () => {
    mount({ prefill: undefined, editQso: { call: 'JA1XYZ', qso_date: '20261009', time_on: '0812', mode: 'CW' } });
    expect(badgeText()).toBe(null);
  });
});
