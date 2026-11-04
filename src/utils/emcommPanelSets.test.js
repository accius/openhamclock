import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMCOMM_PANELS,
  BUILTIN_SETS,
  PANEL_SETS_KEY,
  readPanelSets,
  writePanelSets,
  allSets,
  activeSetName,
  togglePanel,
} from './emcommPanelSets.js';

beforeEach(() => localStorage.clear());

describe('EmComm panel sets (#1241)', () => {
  it('defaults to every panel shown', () => {
    expect(readPanelSets()).toEqual({ hidden: [], sets: {} });
    expect(activeSetName(readPanelSets())).toBe('All');
  });

  it('built-in sets only name real panels and keep the net-control essentials', () => {
    for (const hidden of Object.values(BUILTIN_SETS)) {
      for (const p of hidden) expect(EMCOMM_PANELS).toContain(p);
    }
    const shown = EMCOMM_PANELS.filter((p) => !BUILTIN_SETS['Net control'].includes(p));
    expect(shown).toEqual(['Incident', 'EmComm Stations', 'Net Control', 'Net Roster', 'Event Log', 'ICS Forms']);
  });

  it('round-trips through storage, dropping unknown panels and blank names', () => {
    writePanelSets({ hidden: ['NWS Alerts', 'Nope'], sets: { Mine: ['Event Log', 'Nope'], '  ': ['Incident'] } });
    expect(readPanelSets()).toEqual({ hidden: ['NWS Alerts'], sets: { Mine: ['Event Log'] } });
  });

  it('clears the key when nothing is customised', () => {
    writePanelSets({ hidden: ['NWS Alerts'], sets: {} });
    writePanelSets({ hidden: [], sets: {} });
    expect(localStorage.getItem(PANEL_SETS_KEY)).toBeNull();
  });

  it('names the matching set, or none for a custom mix', () => {
    expect(activeSetName({ hidden: BUILTIN_SETS['Net control'], sets: {} })).toBe('Net control');
    expect(activeSetName({ hidden: ['NWS Alerts'], sets: {} })).toBe('');
    expect(activeSetName({ hidden: ['NWS Alerts'], sets: { Quiet: ['NWS Alerts'] } })).toBe('Quiet');
    expect(Object.keys(allSets({ sets: { Quiet: [] } }))).toEqual([
      'All',
      'Net control',
      'Shelters & resources',
      'Quiet',
    ]);
  });

  it('toggles a panel but never hides the last one', () => {
    let s = { hidden: [], sets: {} };
    s = togglePanel(s, 'Event Log');
    expect(s.hidden).toEqual(['Event Log']);
    s = togglePanel(s, 'Event Log');
    expect(s.hidden).toEqual([]);
    const allButOne = { hidden: EMCOMM_PANELS.slice(1), sets: {} };
    expect(togglePanel(allButOne, EMCOMM_PANELS[0])).toBe(allButOne);
  });
});
