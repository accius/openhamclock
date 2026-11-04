import { describe, it, expect } from 'vitest';
import { firstVisitPlan } from './firstVisit.js';

// What useTheme writes on first load, before App's check runs
const THEME_ONLY = JSON.stringify({ theme: 'dark', customTheme: { '--bg-primary': '#0a0e14' } });
const SAVED = JSON.stringify({ callsign: 'K0CJH', layout: 'modern', theme: 'retro', customTheme: {} });

describe('firstVisitPlan', () => {
  it('a theme-only config is still a first visit (the Staging regression)', () => {
    const plan = firstVisitPlan({ savedConfigRaw: THEME_ONLY, width: 1440, height: 900 });
    expect(plan.firstVisit).toBe(true);
    expect(plan.openSettings).toBe(true);
    expect(plan.layout).toBeNull(); // desktop keeps the default layout
  });

  it('a real saved setup is never treated as a first visit', () => {
    for (const w of [390, 1440]) {
      const plan = firstVisitPlan({ savedConfigRaw: SAVED, callsign: 'N0CALL', width: w, height: 844, isTouch: true });
      expect(plan).toEqual({
        firstVisit: false,
        openSettings: false,
        layout: null,
        suggestMobile: false,
        markSuggested: false,
      });
    }
  });

  it('touch devices get their layout picked, as before — phones now get Mobile', () => {
    const phone = firstVisitPlan({ width: 390, height: 844, isTouch: true });
    expect(phone).toMatchObject({ openSettings: true, layout: 'mobile', suggestMobile: false, markSuggested: true });
    const sideways = firstVisitPlan({ width: 844, height: 390, isTouch: true });
    expect(sideways.layout).toBe('mobile');
    expect(firstVisitPlan({ width: 744, height: 1133, isTouch: true }).layout).toBe('compact');
    expect(firstVisitPlan({ width: 1024, height: 1366, isTouch: true }).layout).toBe('tablet');
    expect(firstVisitPlan({ width: 1440, height: 900, isTouch: true }).layout).toBeNull();
  });

  it('a first-time phone visitor gets exactly one prompt', () => {
    // Unconfigured station: Settings only (no offer stacked on top)
    const a = firstVisitPlan({ width: 390, height: 844, isTouch: true });
    expect([a.openSettings, a.suggestMobile].filter(Boolean)).toHaveLength(1);
    // Station configured on the server: the Mobile offer only
    const b = firstVisitPlan({ callsign: 'K0CJH', width: 390, height: 844, isTouch: true });
    expect(b).toMatchObject({ openSettings: false, suggestMobile: true, layout: null });
    // ...and only once
    expect(firstVisitPlan({ callsign: 'K0CJH', width: 390, height: 844, alreadySuggested: true }).suggestMobile).toBe(
      false,
    );
  });

  it('the first-visit layout save keeps the theme the theme module stored', async () => {
    const { loadConfig } = await import('./config.js');
    localStorage.setItem('openhamclock_config', JSON.stringify({ theme: 'retro', customTheme: { '--x': '1' } }));
    const cfg = loadConfig();
    expect(cfg.theme).toBe('retro');
    expect(cfg.customTheme).toEqual({ '--x': '1' });
    // App then saves { ...config, layout: plan.layout }: theme and customTheme ride along
    expect({ ...cfg, layout: 'mobile' }).toMatchObject({ theme: 'retro', customTheme: { '--x': '1' } });
    localStorage.clear();
  });

  it('configured station on a desktop: nothing at all', () => {
    expect(firstVisitPlan({ callsign: 'K0CJH', width: 1440, height: 900 })).toMatchObject({
      firstVisit: true,
      openSettings: false,
      suggestMobile: false,
      layout: null,
    });
  });
});
