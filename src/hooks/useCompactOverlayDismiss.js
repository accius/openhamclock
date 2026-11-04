import { useEffect, useRef } from 'react';

/** How long after a dismissing tap its follow-up events are swallowed. */
export const DISMISS_SWALLOW_MS = 400;

// Every event a single tap or click can produce after its pointerdown.
const FOLLOW_UP_EVENTS = ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerup', 'click', 'dblclick'];

/**
 * Close-on-outside-tap for the map's compact popovers, without tap-through.
 *
 * While `open`, a pointerdown outside any `[data-compact-pop]` element, or
 * an Escape key, calls `onClose`. When that tap lands on the map
 * (`rootRef`), the tap is consumed: its pointerdown and every follow-up
 * event up to and including the click (within DISMISS_SWALLOW_MS) are
 * stopped in the capture phase, so closing a menu never sets DX, opens a
 * popup or starts a pan. A tap outside the map closes the popover and
 * goes through normally. Listeners exist only while `enabled`.
 */
export default function useCompactOverlayDismiss({ enabled = true, open, rootRef, onClose }) {
  const swallowUntilRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Swallow the rest of a dismissing tap
  useEffect(() => {
    if (!enabled) return undefined;
    const swallow = (e) => {
      if (performance.now() > swallowUntilRef.current) return;
      if (!rootRef.current?.contains(e.target)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (e.type === 'click') swallowUntilRef.current = 0; // the tap is over
    };
    const opts = { capture: true, passive: false };
    for (const t of FOLLOW_UP_EVENTS) document.addEventListener(t, swallow, opts);
    return () => {
      for (const t of FOLLOW_UP_EVENTS) document.removeEventListener(t, swallow, opts);
    };
  }, [enabled, rootRef]);

  useEffect(() => {
    if (!enabled || !open) return undefined;
    const onPointerDown = (e) => {
      if (e.target?.closest?.('[data-compact-pop]')) return;
      onCloseRef.current?.();
      if (rootRef.current?.contains(e.target)) {
        swallowUntilRef.current = performance.now() + DISMISS_SWALLOW_MS;
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [enabled, open, rootRef]);
}
