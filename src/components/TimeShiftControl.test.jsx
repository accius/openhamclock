/**
 * TimeShiftControl — playback transport (Play/Pause, slower/faster) and the
 * fine ±3 h slider. Drives the real utils/displayTime.js store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const s = (opts && opts.defaultValue) || key;
      return opts && opts.n != null ? s.replace('{{n}}', opts.n) : s;
    },
  }),
}));
vi.mock('../plugins/layers/makeDraggable.js', () => ({ makeDraggable: () => {} }));
vi.mock('../plugins/layers/addMinimizeToggle.js', () => ({ addMinimizeToggle: () => {} }));

import { TimeShiftControl } from './TimeShiftControl.jsx';
import {
  DEFAULT_PLAYBACK_SPEED,
  HOUR_MS,
  PLAYBACK_TICK_MS,
  getDisplayOffsetMs,
  isPlaying,
  getPlaybackSpeed,
  resetDisplayTime,
  setPlaybackSpeed,
  stopPlayback,
} from '../utils/displayTime.js';

let container;
let root;

const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
const slider = (labelStart) =>
  [...container.querySelectorAll('input[type="range"]')].find((i) =>
    i.getAttribute('aria-label').startsWith(labelStart),
  );
const click = (el) => act(() => el.click());
const slide = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetDisplayTime();
  setPlaybackSpeed(DEFAULT_PLAYBACK_SPEED);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TimeShiftControl onClose={() => {}} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopPlayback({ silent: true });
  resetDisplayTime();
  vi.useRealTimers();
});

describe('TimeShiftControl playback', () => {
  it('plays forward and pauses', () => {
    click(button('Play forward'));
    expect(isPlaying()).toBe(true);
    act(() => vi.advanceTimersByTime(1000)); // default 1 min/s
    expect(getDisplayOffsetMs()).toBe(60_000);
    click(button('Pause'));
    expect(isPlaying()).toBe(false);
  });

  it('steps the speed with slower / faster and shows it', () => {
    expect(container.textContent).toContain('1 min/s');
    click(button('Play faster'));
    expect(getPlaybackSpeed()).toBe(600);
    expect(container.textContent).toContain('10 min/s');
    click(button('Play faster'));
    expect(getPlaybackSpeed()).toBe(3600);
    expect(container.textContent).toContain('1 h/s');
    expect(button('Play faster').disabled).toBe(true);
    click(button('Play slower'));
    click(button('Play slower'));
    click(button('Play slower'));
    expect(getPlaybackSpeed()).toBe(6);
    expect(container.textContent).toContain('6 s/s');
    expect(button('Play slower').disabled).toBe(true);
  });

  it('a nudge pauses playback', () => {
    click(button('Play forward'));
    act(() => vi.advanceTimersByTime(PLAYBACK_TICK_MS));
    click(button('timeShift.plusHour'));
    expect(isPlaying()).toBe(false);
  });

  it('closing the control stops playback', () => {
    click(button('Play forward'));
    act(() => root.unmount());
    expect(isPlaying()).toBe(false);
    root = createRoot(container); // afterEach unmounts again
  });
});

describe('TimeShiftControl fine slider', () => {
  it('sets the offset in minutes around the current hour', () => {
    slide(slider('Fine display time'), 25);
    expect(getDisplayOffsetMs()).toBe(25 * 60_000);
    slide(slider('Fine display time'), -90);
    expect(getDisplayOffsetMs()).toBe(-90 * 60_000);
  });

  it('re-centres on the new hour after a big coarse move', () => {
    slide(slider('timeShift.slider'), 48); // +48 h on the ±30 day slider
    expect(getDisplayOffsetMs()).toBe(48 * HOUR_MS);
    slide(slider('Fine display time'), 10);
    expect(getDisplayOffsetMs()).toBe(48 * HOUR_MS + 10 * 60_000);
  });
});
