import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useLightningAnnouncements } from './useLightningAnnouncements';

// Helper: mount the hook in a real DOM node and read its output via a testid div
function mountHook() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let root;
  function Harness() {
    const { announcement } = useLightningAnnouncements();
    return <div data-testid="out">{announcement}</div>;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Harness />);
  });

  return {
    getText: () => container.querySelector('[data-testid="out"]')?.textContent ?? '',
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fireProximity(distanceKm = 8, distanceMiles = 5.0, direction = 'north-west') {
  act(() => {
    document.dispatchEvent(
      new CustomEvent('lightning:proximity', {
        detail: { distanceKm, distanceMiles, direction },
      }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useLightningAnnouncements', () => {
  it('starts with no announcement', () => {
    const { getText, unmount } = mountHook();
    expect(getText()).toBe('');
    unmount();
  });

  it('announces closest strike in km by default', () => {
    const { getText, unmount } = mountHook();
    fireProximity(12, 7.5, 'south');
    expect(getText()).toBe('Lightning alert: strike 12 kilometres south');
    unmount();
  });

  it('announces in miles when imperial units configured', () => {
    localStorage.setItem('openhamclock_config', JSON.stringify({ units: { dist: 'imperial' } }));
    const { getText, unmount } = mountHook();
    fireProximity(12, 7.5, 'north-east');
    expect(getText()).toBe('Lightning alert: strike 7.5 miles north-east');
    unmount();
  });

  it('clears after 10 seconds', () => {
    const { getText, unmount } = mountHook();
    fireProximity(5, 3.1, 'east');
    expect(getText()).not.toBe('');
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(getText()).toBe('');
    unmount();
  });

  it('throttles repeated events within 30 seconds', () => {
    const { getText, unmount } = mountHook();
    fireProximity(5, 3.1, 'north');
    const first = getText();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireProximity(2, 1.2, 'south');
    expect(getText()).toBe(first); // second event suppressed — still the first text
    unmount();
  });

  it('announces again after throttle window expires', () => {
    const { getText, unmount } = mountHook();
    fireProximity(5, 3.1, 'north');
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    fireProximity(3, 1.9, 'west');
    expect(getText()).toBe('Lightning alert: strike 3 kilometres west');
    unmount();
  });

  it('ignores events when lightning plugin is not dispatching (no announcement emitted)', () => {
    const { getText, unmount } = mountHook();
    // No event fired
    expect(getText()).toBe('');
    unmount();
  });
});
