import { describe, it, expect } from 'vitest';
import {
  shouldUseCompactMapControls,
  shouldOverflowCompactDock,
  compactDockHeight,
  COMPACT_MAP_CONTROLS_MAX_WIDTH,
  COMPACT_MAP_MIN_MAP_WIDTH,
  FULL_DOCK_MIN_MAP_HEIGHT,
} from './useCompactMapControls.js';

describe('shouldUseCompactMapControls', () => {
  it('turns on automatically below the phone breakpoint', () => {
    expect(shouldUseCompactMapControls(undefined, 390)).toBe(true);
    expect(shouldUseCompactMapControls(undefined, 360)).toBe(true);
    expect(shouldUseCompactMapControls(undefined, COMPACT_MAP_CONTROLS_MAX_WIDTH)).toBe(false);
    expect(shouldUseCompactMapControls(undefined, 768)).toBe(false);
    expect(shouldUseCompactMapControls(undefined, 1440)).toBe(false);
    expect(shouldUseCompactMapControls(undefined, 0)).toBe(false);
  });

  it('turns on for a small map on a big screen (a Dockable map panel)', () => {
    expect(shouldUseCompactMapControls(undefined, 1440, 420, 800)).toBe(true);
    expect(shouldUseCompactMapControls(undefined, 1440, COMPACT_MAP_MIN_MAP_WIDTH, 800)).toBe(false);
  });

  it('turns on for a map too short for the full control column', () => {
    // 800x480 kiosk, Classic: map 360x242 with a 56 px button row at the bottom
    expect(shouldUseCompactMapControls(undefined, 800, 360, 242, 56)).toBe(true);
    // Modern at 800x480: wide but only 280 px tall
    expect(shouldUseCompactMapControls(undefined, 800, 748, 280)).toBe(true);
    expect(shouldUseCompactMapControls(undefined, 1440, 900, FULL_DOCK_MIN_MAP_HEIGHT)).toBe(false);
    // the host's bottom row counts against the height
    expect(shouldUseCompactMapControls(undefined, 1440, 900, FULL_DOCK_MIN_MAP_HEIGHT, 20)).toBe(true);
  });

  it('leaves normal desktop map sizes alone', () => {
    // measured [width, height, host inset]
    const desktop = [
      [820, 830, 0], // Modern 1440x900
      [769, 804, 0], // Dockable 1440x900
      [1000, 662, 56], // Classic 1440x900
      [1120, 848, 66], // Tablet 1440x900
      [972, 346, 0], // Modern 1024x768
      [535, 653, 0], // Dockable 1024x768
      [584, 530, 56], // Classic 1024x768
      [601, 657, 0], // Modern 1280x720
    ];
    for (const [w, h, inset] of desktop) expect(shouldUseCompactMapControls(undefined, 1440, w, h, inset)).toBe(false);
  });

  it('an unmeasured map never triggers compact', () => {
    expect(shouldUseCompactMapControls(undefined, 1440, 0, 0)).toBe(false);
  });

  it('an explicit prop wins over everything', () => {
    expect(shouldUseCompactMapControls(true, 1440, 900, 900)).toBe(true);
    expect(shouldUseCompactMapControls(false, 390, 300, 200)).toBe(false);
  });
});

describe('compact dock overflow', () => {
  it('measures the compact column', () => {
    expect(compactDockHeight(4)).toBe(10 + 42 + 5 + 10 + 4 * 36 + 3 * 5);
    expect(compactDockHeight(5)).toBeGreaterThan(compactDockHeight(4));
  });

  it('folds into "⋯" only when the column would run into the host row', () => {
    // Classic kiosk 800x480: 242 px map minus 56 px row → overflow
    expect(shouldOverflowCompactDock(242, 56, 4)).toBe(true);
    // Mobile layout portrait map (~338 px), no host row → fits
    expect(shouldOverflowCompactDock(338, 0, 4)).toBe(false);
    expect(shouldOverflowCompactDock(338, 0, 5)).toBe(false);
    // Unmeasured → never
    expect(shouldOverflowCompactDock(0, 56, 4)).toBe(false);
  });
});
