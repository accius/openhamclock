'use strict';

import { useState, useEffect } from 'react';

/**
 * Responsive breakpoint hook.
 * Returns 'mobile' (<768), 'tablet' (768–1024), or 'desktop' (>1024).
 * Also returns the raw width for fine-grained decisions.
 */
export default function useBreakpoint() {
  const getBreakpoint = (w) => {
    if (w < 768) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
  };

  const [state, setState] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    breakpoint: typeof window !== 'undefined' ? getBreakpoint(window.innerWidth) : 'desktop',
  }));

  useEffect(() => {
    let raf;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = window.innerWidth;
        setState((prev) => {
          const bp = getBreakpoint(w);
          if (prev.width === w && prev.breakpoint === bp) return prev;
          return { width: w, breakpoint: bp };
        });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return state;
}
