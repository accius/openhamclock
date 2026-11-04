import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import i18n from '../lang/i18n.js';
import { CallsignPopupProvider } from './CallsignPopupManager.jsx';
import OpportunityPanel from './OpportunityPanel.jsx';

const rows = [
  {
    key: 'P5DX|20m',
    call: 'P5DX',
    band: '20m',
    freq: 14.025,
    mode: 'CW',
    spotters: 7,
    ageMs: 90_000,
    lat: 39,
    lon: 125.7,
    grid: 'PM39',
    needs: ['dxcc', 'zone'],
    weight: 17,
    entity: 'North Korea',
    zone: 25,
    reliability: 72,
    reliabilitySource: 'p533',
    openingScore: 0.3,
    score: 40.1,
  },
  {
    key: 'W1AW|40m',
    call: 'W1AW',
    band: '40m',
    freq: 7.03,
    mode: null,
    spotters: 1,
    ageMs: 600_000,
    lat: null,
    lon: null,
    needs: [],
    weight: 1,
    reliability: null,
    reliabilitySource: 'openings',
    openingScore: 0.7,
    score: 0.4,
  },
];

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root;
  act(() => {
    root = createRoot(container);
    root.render(<CallsignPopupProvider deLocation={{ lat: 42, lon: -71 }}>{ui}</CallsignPopupProvider>);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('OpportunityPanel', () => {
  it('renders ranked rows with need badges, reliability and the fallback estimate', () => {
    const { container, unmount } = render(
      <OpportunityPanel
        opportunities={{ rows, hasLog: true, engine: 'p533', candidateCount: 12 }}
        onSpotClick={() => {}}
      />,
    );
    const text = container.textContent;
    expect(text).toContain('P5DX');
    expect(text).toContain('NEW DXCC');
    expect(text).toContain('NEW ZONE');
    expect(text).toContain('72%');
    expect(text).toContain('North Korea');
    expect(text).toContain('~70%'); // band-opening fallback for W1AW
    expect(text).toContain('12 candidates');
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(2);
    unmount();
  });

  it('calls the shared spot handler with a tune/DX-ready spot on click and keyboard', () => {
    const onSpotClick = vi.fn();
    const { container, unmount } = render(
      <OpportunityPanel
        opportunities={{ rows, hasLog: true, engine: 'p533', candidateCount: 2 }}
        onSpotClick={onSpotClick}
      />,
    );
    const row = container.querySelector('[role="row"]');
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSpotClick).toHaveBeenCalledTimes(1);
    expect(onSpotClick.mock.calls[0][0]).toMatchObject({
      call: 'P5DX',
      freq: 14.025,
      lat: 39,
      lon: 125.7,
      dxGrid: 'PM39',
    });
    act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSpotClick).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('explains the empty / no-logbook states', () => {
    const { container, unmount } = render(
      <OpportunityPanel opportunities={{ rows: [], hasLog: false, engine: 'unavailable', candidateCount: 0 }} />,
    );
    expect(container.textContent).toContain('No logbook yet');
    expect(container.textContent).toContain('Nothing spotted');
    expect(container.textContent).toContain('P.533 engine unavailable');
    unmount();
  });
});
