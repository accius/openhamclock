import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeAlias,
  parseAliasList,
  getAliases,
  setAliases,
  ALIASES_KEY,
  addresseeMatches,
  filterRosterByAliases,
  rosterKey,
  messageIsRelevant,
  groupRoster,
  rosterForAddress,
} from './netAliases.js';

beforeEach(() => localStorage.clear());

describe('alias validation (#1237)', () => {
  it('accepts callsigns with SSID and tactical aliases, upper-cased', () => {
    expect(normalizeAlias(' w8roc ')).toBe('W8ROC');
    expect(normalizeAlias('W8ROC-10')).toBe('W8ROC-10');
    expect(normalizeAlias('emcomm')).toBe('EMCOMM');
    expect(normalizeAlias('OHARES123')).toBe('OHARES123');
  });
  it('rejects what cannot be an APRS addressee', () => {
    for (const bad of ['', 'TOOLONGALIAS', 'W8 ROC', '12345', 'BLN1', 'W8ROC-123', 'a/b']) {
      expect(normalizeAlias(bad), bad).toBeNull();
    }
  });
  it('parses a typed list, dropping duplicates and reporting invalid entries', () => {
    expect(parseAliasList('W8ROC, emcomm w8roc; bad!')).toEqual({ aliases: ['W8ROC', 'EMCOMM'], invalid: ['bad!'] });
  });
});

describe('stored aliases', () => {
  it('default to EMCOMM and round-trip', () => {
    expect(getAliases()).toEqual(['EMCOMM']);
    expect(setAliases(['w8roc', 'EMCOMM'])).toEqual(['W8ROC', 'EMCOMM']);
    expect(getAliases()).toEqual(['W8ROC', 'EMCOMM']);
  });
  it('an empty list or plain EMCOMM clears the stored key', () => {
    setAliases(['W8ROC']);
    expect(setAliases([])).toEqual(['EMCOMM']);
    expect(localStorage.getItem(ALIASES_KEY)).toBeNull();
    setAliases(['EMCOMM']);
    expect(localStorage.getItem(ALIASES_KEY)).toBeNull();
  });
  it('survives junk in storage', () => {
    localStorage.setItem(ALIASES_KEY, '{nope');
    expect(getAliases()).toEqual(['EMCOMM']);
    localStorage.setItem(ALIASES_KEY, JSON.stringify(['!!', 'w8roc']));
    expect(getAliases()).toEqual(['W8ROC']);
  });
});

describe('roster filtering', () => {
  const roster = [
    { call: 'KE8PLM-9', alias: 'EMCOMM', netName: 'OHNET' },
    { call: 'KE8PLM-9', alias: 'W8ROC', netName: 'HAMCO' },
    { call: 'N8TAG-7', alias: 'EMCOMM-1', netName: 'OHNET' },
    { call: 'K1ABC', alias: 'OTHERGRP', netName: 'X' },
    { call: 'W1AW', netName: 'ARES' }, // old server / manual: no alias
    { call: 'N0VOX', source: 'net-control', netName: 'VOICE' },
  ];

  it('EMCOMM keeps its old prefix meaning; other aliases match exactly', () => {
    expect(addresseeMatches('EMCOMM-1', 'EMCOMM')).toBe(true);
    expect(addresseeMatches('W8ROC-1', 'W8ROC')).toBe(false);
  });

  it('shows only check-ins to this station’s addresses', () => {
    const calls = (list) => list.map((op) => `${op.alias}|${op.call}`);
    expect(calls(filterRosterByAliases(roster, ['EMCOMM']))).toEqual([
      'EMCOMM|KE8PLM-9',
      'EMCOMM|N8TAG-7',
      'EMCOMM|W1AW',
      'EMCOMM|N0VOX',
    ]);
    expect(calls(filterRosterByAliases(roster, ['W8ROC']))).toEqual(['W8ROC|KE8PLM-9', 'W8ROC|N0VOX']);
  });

  it('keys entries by address and call', () => {
    expect(rosterKey({ call: 'ke8plm-9', alias: 'W8ROC' })).toBe('W8ROC|KE8PLM-9');
    expect(rosterKey({ call: 'W1AW' })).toBe('EMCOMM|W1AW');
  });
});

describe('message relevance (#1237)', () => {
  const aliases = ['W8ROC'];
  it('keeps traffic to my addresses, to or from me, and bulletins', () => {
    expect(messageIsRelevant({ from: 'N8TAG', to: 'W8ROC', type: 'message' }, aliases, 'K0CJH')).toBe(true);
    expect(messageIsRelevant({ from: 'N8TAG', to: 'K0CJH-7', type: 'message' }, aliases, 'K0CJH')).toBe(true);
    expect(messageIsRelevant({ from: 'K0CJH-9', to: 'N8TAG', type: 'message' }, aliases, 'K0CJH')).toBe(true);
    expect(messageIsRelevant({ from: 'N8TAG', to: 'BLN1', type: 'bulletin' }, aliases, 'K0CJH')).toBe(true);
  });
  it('drops traffic between two other stations and to other groups', () => {
    expect(messageIsRelevant({ from: 'N8TAG', to: 'W1AW', type: 'message' }, aliases, 'K0CJH')).toBe(false);
    expect(messageIsRelevant({ from: 'N8TAG', to: 'EMCOMM', type: 'message' }, aliases, 'K0CJH')).toBe(false);
    expect(messageIsRelevant({ from: 'N8TAG', to: 'N0CALL', type: 'message' }, aliases, 'N0CALL')).toBe(false);
  });
});

describe('roster grouping (#1240)', () => {
  const roster = [
    { call: 'A', alias: 'EMCOMM', netName: 'ohnet' },
    { call: 'B', alias: 'W8ROC', netName: 'HAMCO' },
    { call: 'C', alias: 'EMCOMM', netName: '' },
    { call: 'D', alias: 'W8ROC', netName: 'OHNET' },
  ];
  const shape = (groups) => groups.map((g) => [g.label, g.entries.map((e) => e.call).join('')]);

  it('no grouping is one group', () => {
    expect(shape(groupRoster(roster, 'none'))).toEqual([['', 'ABCD']]);
  });
  it('by address follows the alias list order', () => {
    expect(shape(groupRoster(roster, 'alias', ['W8ROC', 'EMCOMM']))).toEqual([
      ['W8ROC', 'BD'],
      ['EMCOMM', 'AC'],
    ]);
  });
  it('by net name is case-insensitive and puts entries without a name last', () => {
    expect(shape(groupRoster(roster, 'net'))).toEqual([
      ['HAMCO', 'B'],
      ['OHNET', 'AD'],
      ['No net name', 'C'],
    ]);
  });
  it('voice-net entries get their own group, last, and stay visible for any address', () => {
    const withVoice = [...roster, { call: 'V', source: 'net-control', netName: 'OHNET' }];
    expect(shape(groupRoster(withVoice, 'alias', ['EMCOMM', 'W8ROC']))).toEqual([
      ['EMCOMM', 'AC'],
      ['W8ROC', 'BD'],
      ['Voice net', 'V'],
    ]);
    expect(rosterForAddress(withVoice, 'W8ROC').map((e) => e.call)).toEqual(['B', 'D', 'V']);
    expect(rosterForAddress(withVoice, 'all')).toHaveLength(5);
  });
});
