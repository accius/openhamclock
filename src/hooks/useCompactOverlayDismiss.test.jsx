/**
 * A tap that closes a compact map popover must not also act on the map
 * (set DX, open a popup, start a pan).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useRef } from 'react';
import useCompactOverlayDismiss, { DISMISS_SWALLOW_MS } from './useCompactOverlayDismiss.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ open, onClose, onMapDown, onMapClick, onOutsideClick }) {
  const rootRef = useRef(null);
  useCompactOverlayDismiss({ open, rootRef, onClose });
  return (
    <div>
      <div ref={rootRef} data-testid="map">
        {/* stands in for the Leaflet surface: listens like the map does */}
        <div data-testid="surface" onPointerDown={onMapDown} onMouseDown={onMapDown} onClick={onMapClick} />
        <div data-compact-pop="menu">
          <button data-testid="inside">inside the popover</button>
        </div>
      </div>
      <button data-testid="outside" onClick={onOutsideClick}>
        elsewhere on the page
      </button>
    </div>
  );
}

const tap = (el) => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const spies = {
    onClose: vi.fn(),
    onMapDown: vi.fn(),
    onMapClick: vi.fn(),
    onOutsideClick: vi.fn(),
  };
  const render = (p) => act(() => root.render(<Harness {...spies} {...p} />));
  render(props);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, spies, render, q: (id) => container.querySelector(`[data-testid="${id}"]`) };
}

describe('useCompactOverlayDismiss', () => {
  it('a map tap that closes the popover never reaches the map', () => {
    const { spies, q, render } = mount({ open: true });
    tap(q('surface'));
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onMapDown).not.toHaveBeenCalled();
    expect(spies.onMapClick).not.toHaveBeenCalled();

    // Popover now closed: the next tap is an ordinary map tap again
    render({ open: false });
    tap(q('surface'));
    expect(spies.onMapClick).toHaveBeenCalledTimes(1);
  });

  it('the swallow window ends, so a later click is never lost', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { spies, q, render } = mount({ open: true });
    q('surface').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    render({ open: false });
    vi.advanceTimersByTime(DISMISS_SWALLOW_MS + 50);
    q('surface').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(spies.onMapClick).toHaveBeenCalledTimes(1);
  });

  it('taps inside the popover keep it open and work normally', () => {
    const { spies, q } = mount({ open: true });
    const onInside = vi.fn();
    q('inside').addEventListener('click', onInside);
    tap(q('inside'));
    expect(spies.onClose).not.toHaveBeenCalled();
    expect(onInside).toHaveBeenCalledTimes(1);
  });

  it('a tap outside the map closes the popover and still goes through', () => {
    const { spies, q } = mount({ open: true });
    tap(q('outside'));
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onOutsideClick).toHaveBeenCalledTimes(1);
  });

  it('Escape closes; nothing happens while closed', () => {
    const { spies, q, render } = mount({ open: true });
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    render({ open: false });
    tap(q('surface'));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onMapClick).toHaveBeenCalledTimes(1);
  });
});
