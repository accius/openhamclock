import { describe, it, expect } from 'vitest';
import {
  categoryColor,
  markerSize,
  categoryBadge,
  hurricaneSvg,
  formatWind,
  formatMovement,
  formatPosition,
  basinName,
  sortStorms,
  formatValidAt,
} from './tropical.js';

describe('tropical presentation helpers', () => {
  it('colours and sizes scale with category', () => {
    expect(categoryColor('TD')).not.toBe(categoryColor('5'));
    expect(categoryColor('bogus')).toBe(categoryColor('?'));
    expect(markerSize('5')).toBeGreaterThan(markerSize('1'));
    expect(markerSize('1')).toBeGreaterThan(markerSize('TD'));
  });
  it('badges', () => {
    expect(categoryBadge({ category: { code: 'TS' } })).toBe('TS');
    expect(categoryBadge({ category: { code: '3' } })).toBe('CAT 3');
    expect(categoryBadge({ category: { code: '?' } })).toBe('—');
  });
  it('hurricane symbol is an SVG, mirrored for the southern hemisphere', () => {
    const n = hurricaneSvg({ size: 30, color: '#f00' });
    expect(n.startsWith('<svg')).toBe(true);
    expect(n).toContain('width="30"');
    expect(n).toContain('#f00');
    expect(n).not.toContain('scale(-1,1)');
    expect(hurricaneSvg({ southern: true })).toContain('scale(-1,1)');
  });
  it('formats wind, movement and position in both unit systems', () => {
    expect(formatWind(55)).toBe('55 kt (102 km/h)');
    expect(formatWind(55, 'imperial')).toBe('55 kt (63 mph)');
    expect(formatWind(null)).toBe('—');
    expect(formatMovement({ movementText: 'WNW', movementKt: 9, movementDeg: 300 })).toBe('WNW 9 kt (17 km/h)');
    expect(formatMovement({ movementText: 'WNW', movementKt: null })).toBe('WNW');
    expect(formatPosition(11.9, -100)).toBe('11.9°N 100.0°W');
    expect(formatPosition(-20.25, 160.5)).toBe('20.3°S 160.5°E');
  });
  it('basin names and sorting', () => {
    expect(basinName('WP')).toBe('W. Pacific');
    expect(basinName('XX')).toBe('XX');
    const sorted = sortStorms([{ windKt: 30 }, { windKt: 100 }, { windKt: null }]);
    expect(sorted.map((s) => s.windKt)).toEqual([100, 30, null]);
  });
  it('formats forecast valid times', () => {
    expect(formatValidAt('2026-10-15T06:00:00.000Z')).toMatch(/06Z$/);
    expect(formatValidAt('12:00 PM CST October 19, 2026')).toBe('October 19, 2026');
    expect(formatValidAt(null)).toBe('');
  });
});
