/**
 * The Mobile layout's EmComm card: polls only while mounted, and summarises
 * alerts (worst first), the nearest shelters and the net roster.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const emcommCalls = [];
vi.mock('../hooks/useEmcommData.js', () => ({
  useEmcommData: (opts) => {
    emcommCalls.push(opts);
    return {
      alerts: [
        { id: 'a1', severity: 'Minor', event: 'Frost Advisory', headline: 'Frost tonight' },
        {
          id: 'a2',
          severity: 'Severe',
          event: 'Severe Thunderstorm Warning',
          headline: 'Storms',
          instruction: 'Go inside',
        },
      ],
      shelters: [
        { id: 's-far', name: 'Far School', lat: 45.5, lon: -93, status: 'OPEN' },
        { id: 's-near', name: 'Town Hall', lat: 44.38, lon: -93.04, status: 'FULL' },
      ],
      disasters: [],
      loading: false,
    };
  },
}));

import MobileEmcommCard from './MobileEmcommCard.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  emcommCalls.length = 0;
});

describe('MobileEmcommCard — APRS shelter reports', () => {
  it('shows RF-heard reports: their own entry, or attached to the FEMA site they match', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes('/api/aprs/shelters')
          ? {
              shelters: [
                // matches Town Hall's position → attached to the FEMA entry
                {
                  from: 'W0TH-1',
                  lat: 44.38,
                  lon: -93.04,
                  text: 'Town Hall full, no beds',
                  source: 'rf',
                  timestamp: 2,
                },
                // a church nobody in FEMA knows about → its own entry
                {
                  from: 'K0CHR',
                  lat: 44.4,
                  lon: -93.1,
                  text: 'Church open accepting families',
                  source: 'rf',
                  timestamp: 1,
                },
              ],
            }
          : { roster: [] },
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<MobileEmcommCard location={{ lat: 44.37, lon: -93.04 }} allUnits={{ dist: 'metric' }} />);
    });
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/api/aprs/shelters'))).toBe(true);
    const rows = [...container.querySelectorAll('[data-shelter-source]')];
    const rf = rows.find((r) => r.dataset.shelterSource === 'aprs-rf');
    expect(rf.textContent).toContain('K0CHR');
    expect(rf.textContent).toContain('RF');
    expect(rf.textContent).toContain('OPEN'); // status read from the report text
    const townHall = rows.find((r) => r.textContent.includes('Town Hall'));
    expect(townHall.dataset.shelterSource).toBe('fema');
    expect(townHall.textContent).toContain('W0TH-1: Town Hall full, no beds');
    act(() => root.unmount());
    container.remove();
  });
});

describe('MobileEmcommCard', () => {
  it('summarises alerts, shelters and the roster, and stops polling when unmounted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        roster: [
          { call: 'W0OLD', netName: 'ARES', age: 95, stale: true },
          { call: 'K0NEW', netName: 'ARES', age: 1 },
        ],
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<MobileEmcommCard location={{ lat: 44.37, lon: -93.04 }} allUnits={{ dist: 'metric' }} />);
    });

    expect(emcommCalls.at(-1)).toMatchObject({
      enabled: true,
      includeDisasters: false,
      location: { lat: 44.37, lon: -93.04 },
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/aprs/net');

    const text = container.textContent;
    // worst alert first
    expect(text.indexOf('Severe Thunderstorm Warning')).toBeLessThan(text.indexOf('Frost Advisory'));
    // nearest shelter first, with distance
    expect(text.indexOf('Town Hall')).toBeLessThan(text.indexOf('Far School'));
    expect(text).toContain('1 km');
    // roster, most recent first
    expect(text.indexOf('K0NEW')).toBeLessThan(text.indexOf('W0OLD'));

    act(() => root.unmount());
    container.remove();
    const callsAfterUnmount = fetchSpy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterUnmount);
  });
});
