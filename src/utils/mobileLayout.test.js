import { describe, it, expect } from 'vitest';
import {
  MOBILE_CARD_KEY,
  MOBILE_SUGGEST_KEY,
  buildMobileCards,
  readLastCardIndex,
  writeLastCard,
  cardIndexFromScroll,
  scrollLeftForCard,
  isPhoneViewport,
  shouldSuggestMobileLayout,
  readSuggestionDone,
  hasSavedLayout,
  MOBILE_CARD_PREFS_KEY,
  readCardPrefs,
  writeCardPrefs,
  toggleCardPref,
  isCardEnabled,
  summarizeEmcomm,
  markSuggestionDone,
  isStandaloneDisplay,
  isLandscape,
  portraitMapHeight,
} from './mobileLayout.js';

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

describe('buildMobileCards', () => {
  it('offers the core cards in order and hides APRS until the layer is on', () => {
    const ids = buildMobileCards().map((c) => c.id);
    expect(ids).toEqual([
      'dx-cluster',
      'activations',
      'propagation',
      'solar',
      'satellites',
      'logbook',
      'weather',
      'psk',
    ]);
    expect(buildMobileCards({ showAPRS: true }).map((c) => c.id)).toContain('aprs');
  });

  it('respects config.panels visibility', () => {
    const panels = { dxCluster: { visible: false }, solar: { visible: true }, pota: { visible: false } };
    const ids = buildMobileCards({ panels }).map((c) => c.id);
    expect(ids).not.toContain('dx-cluster');
    expect(ids).not.toContain('activations');
    expect(ids).toContain('solar');
  });

  it('returns id, icon and whether the panel draws its own header', () => {
    for (const c of buildMobileCards()) expect(Object.keys(c).sort()).toEqual(['icon', 'id', 'ownHeader']);
    const byId = Object.fromEntries(buildMobileCards().map((c) => [c.id, c.ownHeader]));
    expect(byId['dx-cluster']).toBe(true);
    expect(byId.weather).toBe(false); // plain weather block — the card supplies the title
  });
});

describe('last-card persistence', () => {
  const cards = buildMobileCards();

  it('defaults to the first card', () => {
    expect(readLastCardIndex(memStorage(), cards)).toBe(0);
    expect(readLastCardIndex(null, cards)).toBe(0);
    expect(readLastCardIndex(undefined, undefined)).toBe(0);
  });

  it('round-trips a remembered card and ignores ids no longer offered', () => {
    const s = memStorage();
    writeLastCard(s, 'solar');
    expect(s.getItem(MOBILE_CARD_KEY)).toBe('solar');
    expect(readLastCardIndex(s, cards)).toBe(3);
    writeLastCard(s, 'aprs'); // only present when the APRS layer is on
    expect(readLastCardIndex(s, cards)).toBe(0);
    writeLastCard(s, null);
    expect(s.getItem(MOBILE_CARD_KEY)).toBeNull();
  });

  it('survives a throwing storage', () => {
    const bad = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
    };
    expect(() => writeLastCard(bad, 'solar')).not.toThrow();
    expect(readLastCardIndex(bad, cards)).toBe(0);
  });
});

describe('scroll <-> card index', () => {
  it('rounds to the nearest card and clamps', () => {
    expect(cardIndexFromScroll(0, 300, 12, 5)).toBe(0);
    expect(cardIndexFromScroll(312, 300, 12, 5)).toBe(1);
    expect(cardIndexFromScroll(140, 300, 12, 5)).toBe(0);
    expect(cardIndexFromScroll(170, 300, 12, 5)).toBe(1);
    expect(cardIndexFromScroll(99999, 300, 12, 5)).toBe(4);
    expect(cardIndexFromScroll(-50, 300, 12, 5)).toBe(0);
  });

  it('is safe with degenerate sizes', () => {
    expect(cardIndexFromScroll(100, 0, 0, 3)).toBe(0);
    expect(cardIndexFromScroll(100, 300, 0, 0)).toBe(0);
  });

  it('scrollLeftForCard inverts cardIndexFromScroll', () => {
    for (let i = 0; i < 6; i++) {
      expect(cardIndexFromScroll(scrollLeftForCard(i, 328, 12), 328, 12, 6)).toBe(i);
    }
    expect(scrollLeftForCard(-3, 328, 12)).toBe(0);
  });
});

describe('viewport classification', () => {
  it('isPhoneViewport', () => {
    expect(isPhoneViewport(390, 844)).toBe(true);
    expect(isPhoneViewport(360, 640)).toBe(true);
    expect(isPhoneViewport(844, 390)).toBe(true); // phone held sideways
    expect(isPhoneViewport(768, 1024)).toBe(false); // tablet portrait
    expect(isPhoneViewport(1024, 768)).toBe(false);
    expect(isPhoneViewport(1920, 1080)).toBe(false);
    expect(isPhoneViewport(0, 0)).toBe(false);
  });

  it('isLandscape', () => {
    expect(isLandscape(844, 390)).toBe(true);
    expect(isLandscape(390, 844)).toBe(false);
    expect(isLandscape(0, 0)).toBe(false);
  });

  it('portraitMapHeight clamps to a usable band', () => {
    expect(portraitMapHeight(844)).toBe(338);
    expect(portraitMapHeight(400)).toBe(200);
    expect(portraitMapHeight(2000)).toBe(420);
    expect(portraitMapHeight(0)).toBe(260);
  });
});

describe('shouldSuggestMobileLayout', () => {
  const phone = { width: 390, height: 844 };

  it('offers once, on a phone, on first visit, when Mobile is not already chosen', () => {
    expect(shouldSuggestMobileLayout({ ...phone, layout: 'modern', firstVisit: true })).toBe(true);
    expect(shouldSuggestMobileLayout({ ...phone, layout: 'compact', firstVisit: true })).toBe(true);
  });

  it('stays quiet otherwise', () => {
    expect(shouldSuggestMobileLayout({ ...phone, layout: 'modern', firstVisit: false })).toBe(false);
    expect(shouldSuggestMobileLayout({ ...phone, layout: 'mobile', firstVisit: true })).toBe(false);
    expect(shouldSuggestMobileLayout({ ...phone, layout: 'modern', firstVisit: true, alreadySuggested: true })).toBe(
      false,
    );
    expect(shouldSuggestMobileLayout({ width: 1440, height: 900, layout: 'modern', firstVisit: true })).toBe(false);
    expect(shouldSuggestMobileLayout()).toBe(false);
  });

  it('hasSavedLayout ignores the theme-only config written on first load', () => {
    expect(hasSavedLayout(null)).toBe(false);
    expect(hasSavedLayout('')).toBe(false);
    expect(hasSavedLayout('not json')).toBe(false);
    expect(hasSavedLayout(JSON.stringify({ theme: 'dark', customTheme: {} }))).toBe(false);
    expect(hasSavedLayout(JSON.stringify({ theme: 'dark', layout: 'modern' }))).toBe(true);
  });

  it('remembers the offer', () => {
    const s = memStorage();
    expect(readSuggestionDone(s)).toBe(false);
    markSuggestionDone(s);
    expect(s.getItem(MOBILE_SUGGEST_KEY)).toBe('1');
    expect(readSuggestionDone(s)).toBe(true);
    expect(readSuggestionDone(null)).toBe(false);
  });
});

describe('card picker prefs', () => {
  it('EmComm is opt-in: off by default, on when arriving from the EmComm layout', () => {
    expect(buildMobileCards().map((c) => c.id)).not.toContain('emcomm');
    const fresh = readCardPrefs(memStorage(), 'modern');
    expect(isCardEnabled(fresh, 'emcomm')).toBe(false);
    const fromEmcomm = readCardPrefs(memStorage(), 'emcomm');
    expect(isCardEnabled(fromEmcomm, 'emcomm')).toBe(true);
    expect(buildMobileCards({ prefs: fromEmcomm }).map((c) => c.id)[0]).toBe('emcomm');
  });

  it('round-trips saved choices, which then win over the previous layout', () => {
    const s = memStorage();
    let p = readCardPrefs(s, 'modern');
    p = toggleCardPref(p, 'emcomm');
    p = toggleCardPref(p, 'solar');
    writeCardPrefs(s, p);
    expect(JSON.parse(s.getItem(MOBILE_CARD_PREFS_KEY)).enabled).toEqual({ emcomm: true, solar: false });
    const back = readCardPrefs(s, 'classic');
    expect(isCardEnabled(back, 'emcomm')).toBe(true);
    expect(isCardEnabled(back, 'solar')).toBe(false);
    const ids = buildMobileCards({ prefs: back }).map((c) => c.id);
    expect(ids).toContain('emcomm');
    expect(ids).not.toContain('solar');
  });

  it('never lets the last card be switched off', () => {
    let p = { enabled: {} };
    for (const c of buildMobileCards()) p = toggleCardPref(p, c.id);
    expect(buildMobileCards({ prefs: p })).toHaveLength(1);
  });

  it('ignores corrupt stored prefs', () => {
    const s = memStorage();
    s.setItem(MOBILE_CARD_PREFS_KEY, '{nope');
    expect(readCardPrefs(s, null).isDefault).toBe(true);
  });
});

describe('summarizeEmcomm', () => {
  it('orders alerts by severity, shelters by distance from DE, roster by recency', () => {
    const sum = summarizeEmcomm({
      alerts: [
        { id: 1, severity: 'Minor' },
        { id: 2, severity: 'Extreme' },
        { id: 3, severity: 'Moderate' },
      ],
      shelters: [
        { id: 'far', lat: 45, lon: -93, status: 'OPEN' },
        { id: 'near', lat: 44.4, lon: -93.05, status: 'FULL' },
        { id: 'nopos', status: 'OPEN' },
      ],
      roster: [
        { call: 'A', age: 30 },
        { call: 'B', age: 2, stale: false },
        { call: 'C', age: 90, stale: true },
      ],
      de: { lat: 44.37, lon: -93.04 },
    });
    expect(sum.alerts.map((a) => a.id)).toEqual([2, 3, 1]);
    expect(sum.worstSeverity).toBe('Extreme');
    expect(sum.shelters.map((s) => s.id)).toEqual(['near', 'far', 'nopos']);
    expect(sum.shelters[0].distanceKm).toBeGreaterThan(0);
    expect(sum.shelters[0].distanceKm).toBeLessThan(5);
    expect(sum.shelters[2].distanceKm).toBeNull();
    expect(sum.openShelters).toBe(2);
    expect(sum.roster.map((o) => o.call)).toEqual(['B', 'A', 'C']);
    expect(sum.activeOps).toBe(2);
  });

  it('handles empty input and an unknown DE', () => {
    const sum = summarizeEmcomm({ shelters: [{ id: 'x', lat: 1, lon: 1 }] });
    expect(sum.alerts).toEqual([]);
    expect(sum.worstSeverity).toBeNull();
    expect(sum.shelters[0].distanceKm).toBeNull();
    expect(summarizeEmcomm().shelterCount).toBe(0);
  });
});

describe('isStandaloneDisplay', () => {
  it('detects iOS standalone and display-mode media queries', () => {
    expect(isStandaloneDisplay(null)).toBe(false);
    expect(isStandaloneDisplay({ navigator: { standalone: true } })).toBe(true);
    const win = { navigator: {}, matchMedia: (q) => ({ matches: q.includes('standalone') }) };
    expect(isStandaloneDisplay(win)).toBe(true);
    expect(isStandaloneDisplay({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandaloneDisplay({ navigator: {} })).toBe(false);
  });
});
