import { describe, it, expect } from 'vitest';
import { buildWindyEmbedUrl, WINDY_OVERLAYS, isWindyOverlay } from './windyEmbed.js';

describe('buildWindyEmbedUrl', () => {
  it('centres on the location with the requested overlay', () => {
    const url = new URL(buildWindyEmbedUrl({ lat: 42.36, lon: -71.06, overlay: 'rain', zoom: 6 }));
    expect(url.origin + url.pathname).toBe('https://embed.windy.com/embed.html');
    expect(url.searchParams.get('lat')).toBe('42.360');
    expect(url.searchParams.get('lon')).toBe('-71.060');
    expect(url.searchParams.get('overlay')).toBe('rain');
    expect(url.searchParams.get('zoom')).toBe('6');
    expect(url.searchParams.get('metricWind')).toBe('kt');
  });
  it('falls back to wind for unknown overlays and clamps zoom', () => {
    const url = new URL(buildWindyEmbedUrl({ lat: 0, lon: 0, overlay: 'lava', zoom: 99 }));
    expect(url.searchParams.get('overlay')).toBe('wind');
    expect(url.searchParams.get('zoom')).toBe('11');
  });
  it('switches units for imperial', () => {
    const url = new URL(buildWindyEmbedUrl({ lat: 0, lon: 0, units: 'imperial' }));
    expect(url.searchParams.get('metricWind')).toBe('mph');
    expect(url.searchParams.get('metricTemp')).toBe('°F');
  });
  it('returns null without a location', () => {
    expect(buildWindyEmbedUrl({ lat: null, lon: 1 })).toBeNull();
  });
  it('exposes the six overlays the panel offers', () => {
    expect(WINDY_OVERLAYS.map((o) => o.id)).toEqual(['wind', 'rain', 'clouds', 'temp', 'pressure', 'waves']);
    expect(isWindyOverlay('waves')).toBe(true);
    expect(isWindyOverlay('snow')).toBe(false);
  });
});
