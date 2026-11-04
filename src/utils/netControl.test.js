/**
 * Tests for netControl — check-in parsing (flags/suffixes), roster
 * mutators (dedupe, recheck, check-out, undo), traffic queue, report
 * builders, duration formatting, script templates and storage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCheckin,
  createNet,
  checkIn,
  checkOut,
  toggleFlag,
  updateStation,
  removeStation,
  undoLast,
  trafficQueue,
  passTraffic,
  nextTraffic,
  closeNet,
  buildReport,
  reportToText,
  reportToCsv,
  historyToCsv,
  reportToPrintHtml,
  toRosterEntries,
  formatElapsed,
  formatDuration,
  netDurationMs,
  fillTemplate,
  scriptContext,
  stationFromLogbook,
  stationFromLookup,
  loadRunningNet,
  saveRunningNet,
  clearRunningNet,
  loadHistory,
  pushHistory,
  loadScript,
  loadScriptTemplates,
  saveScriptTemplates,
  getTemplate,
  addTemplate,
  duplicateTemplate,
  renameTemplate,
  updateTemplate,
  deleteTemplate,
  builtinDefault,
  BUILTIN_TEMPLATES,
  NET_CONTROL_SCRIPT_KEY,
  NET_CONTROL_SCRIPTS_KEY,
  NET_CONTROL_KEY,
  peekUndo,
  withdrawalSummary,
  attachEvent,
  readRunningNetRecord,
  commitRunningNet,
  pickNewer,
  livePeerCount,
  changedCalls,
  changedNetFields,
  rebaseCheck,
  PEER_TTL_MS,
  serializeNetState,
  applyRemoteNetState,
  parseNetFrequency,
  parseOffset,
  formatOffset,
  bandPlanRegion,
  standardOffset,
  localParts,
  fmtLocalDateTime,
  rememberStation,
  loadStationCache,
  saveStationCache,
  saveRosterSnapshot,
  getNetControlRoster,
  mergeRosters,
  NET_CONTROL_ROSTER_EVENT,
  flagsToText,
  DEFAULT_PREAMBLE,
  DEFAULT_CLOSING,
  MAX_HISTORY,
  MAX_UNDO,
  STATION_CACHE_MAX,
  DUPLICATE_WINDOW_MS,
  NET_CONTROL_ROSTER_KEY,
} from './netControl.js';

const T0 = Date.UTC(2026, 9, 15, 19, 0, 0); // 2026-10-15 19:00:00Z
const min = (n) => n * 60 * 1000;

const startNet = () => createNet({ name: 'ARES Tuesday Net', frequency: '146.940 - 100.0', ncs: 'k0cjh', now: T0 });

describe('parseCheckin', () => {
  it('uppercases a bare callsign with no flags', () => {
    expect(parseCheckin('k0cjh')).toEqual({ call: 'K0CJH', flags: [], note: '' });
  });
  it('reads a flag token after the call', () => {
    expect(parseCheckin('K0CJH T')).toEqual({ call: 'K0CJH', flags: ['traffic'], note: '' });
    expect(parseCheckin('K0CJH tm').flags).toEqual(['traffic', 'mobile']);
  });
  it('orders flags canonically and dedupes', () => {
    expect(parseCheckin('K0CJH MT T').flags).toEqual(['traffic', 'mobile']);
    expect(parseCheckin('K0CJH /SMTR').flags).toEqual(['traffic', 'relay', 'mobile', 'short']);
    expect(parseCheckin('K0CJH +i').flags).toEqual(['inout']);
  });
  it('reads slash-suffix flags and strips them from the call', () => {
    expect(parseCheckin('K0CJH/M')).toEqual({ call: 'K0CJH', flags: ['mobile'], note: '' });
    expect(parseCheckin('k0cjh/t s')).toEqual({ call: 'K0CJH', flags: ['traffic', 'short'], note: '' });
  });
  it('keeps real portable suffixes on the call', () => {
    expect(parseCheckin('K0CJH/P').call).toBe('K0CJH/P');
    expect(parseCheckin('K0CJH/QRP').call).toBe('K0CJH/QRP');
    expect(parseCheckin('W1AW/7').call).toBe('W1AW/7');
  });
  it('strips an SSID', () => {
    expect(parseCheckin('KE8PLM-9').call).toBe('KE8PLM');
  });
  it('treats tokens with non-flag letters as a note, and everything after it', () => {
    expect(parseCheckin('K0CJH Chris')).toEqual({ call: 'K0CJH', flags: [], note: 'Chris' });
    expect(parseCheckin('K0CJH T Chris in Denver')).toEqual({
      call: 'K0CJH',
      flags: ['traffic'],
      note: 'Chris in Denver',
    });
    // a name spelled only with flag letters is a note, and so is everything after it
    expect(parseCheckin('K0CJH Tim S')).toEqual({ call: 'K0CJH', flags: [], note: 'Tim S' });
    expect(parseCheckin('K0CJH T Mitt')).toEqual({ call: 'K0CJH', flags: ['traffic'], note: 'Mitt' });
  });
  it('rejects things that are not callsigns', () => {
    expect(parseCheckin('')).toBeNull();
    expect(parseCheckin('   ')).toBeNull();
    expect(parseCheckin('hello')).toBeNull();
    expect(parseCheckin('12345')).toBeNull();
    expect(parseCheckin('K0')).toBeNull();
  });
});

describe('createNet', () => {
  it('builds a running net with defaults', () => {
    const net = startNet();
    expect(net.name).toBe('ARES Tuesday Net');
    expect(net.ncs).toBe('K0CJH');
    expect(net.frequency).toBe('146.940 - 100.0');
    expect(net.startTime).toBe(T0);
    expect(net.endTime).toBeNull();
    expect(net.stations).toEqual([]);
    expect(net.id).toMatch(/^net-/);
  });
  it('requires a name', () => {
    expect(createNet({ name: '  ' })).toBeNull();
  });
});

describe('checkIn', () => {
  it('adds a new station at the top', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 + min(1) }));
    const r = checkIn(net, { call: 'KE8PLM', flags: ['traffic'], name: 'Michael', now: T0 + min(2) });
    expect(r.result).toBe('new');
    expect(r.net.stations.map((s) => s.call)).toEqual(['KE8PLM', 'W1AW']);
    expect(r.station).toMatchObject({
      call: 'KE8PLM',
      name: 'Michael',
      flags: ['traffic'],
      checkinTime: T0 + min(2),
      checkoutTime: null,
      recheckCount: 0,
      trafficPassed: null,
    });
  });
  it('ignores a duplicate Enter within the window', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const r = checkIn(net, { call: 'w1aw', now: T0 + DUPLICATE_WINDOW_MS - 1 });
    expect(r.result).toBe('duplicate');
    expect(r.net).toBe(net);
    expect(r.net.stations).toHaveLength(1);
  });
  it('rechecks a station: moves it to the top, bumps the count, merges flags', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    ({ net } = checkIn(net, { call: 'K0CJH', now: T0 + min(1) }));
    const r = checkIn(net, { call: 'W1AW', flags: ['traffic'], now: T0 + min(5) });
    expect(r.result).toBe('recheck');
    expect(r.net.stations.map((s) => s.call)).toEqual(['W1AW', 'K0CJH']);
    expect(r.station.recheckCount).toBe(1);
    expect(r.station.flags).toEqual(['traffic']);
    expect(r.station.checkinTime).toBe(T0); // original time kept
    expect(r.station.lastActivity).toBe(T0 + min(5));
    expect(r.net.stations).toHaveLength(2);
  });
  it('returns a checked-out station to the net', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    net = checkOut(net, 'W1AW', T0 + min(2));
    expect(net.stations[0].checkoutTime).toBe(T0 + min(2));
    const r = checkIn(net, { call: 'W1AW', now: T0 + min(3) });
    expect(r.result).toBe('return');
    expect(r.station.checkoutTime).toBeNull();
  });
  it('does not overwrite a known name with a blank one', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', name: 'Hiram', now: T0 }));
    const r = checkIn(net, { call: 'W1AW', name: '', now: T0 + min(5) });
    expect(r.station.name).toBe('Hiram');
  });
});

describe('checkOut / toggleFlag / updateStation / removeStation / undoLast', () => {
  it('checkOut is a no-op for unknown or already-out stations', () => {
    let net = startNet();
    expect(checkOut(net, 'NOBODY')).toBe(net);
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const out = checkOut(net, 'W1AW', T0 + min(1));
    expect(checkOut(out, 'W1AW', T0 + min(2))).toBe(out);
  });
  it('toggleFlag adds and removes', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    net = toggleFlag(net, 'W1AW', 'mobile');
    expect(net.stations[0].flags).toEqual(['mobile']);
    net = toggleFlag(net, 'W1AW', 'traffic');
    expect(net.stations[0].flags).toEqual(['traffic', 'mobile']);
    net = toggleFlag(net, 'W1AW', 'mobile');
    expect(net.stations[0].flags).toEqual(['traffic']);
    expect(toggleFlag(net, 'W1AW', 'bogus')).toBe(net);
  });
  it('updateStation patches name/location without an undo entry', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const undoLen = net.undo.length;
    net = updateStation(net, 'W1AW', { name: 'Hiram', location: 'Newington, CT', bogus: 'x' });
    expect(net.stations[0]).toMatchObject({ name: 'Hiram', location: 'Newington, CT' });
    expect(net.stations[0].bogus).toBeUndefined();
    expect(net.undo).toHaveLength(undoLen);
  });
  it('removeStation drops the line; undoLast brings it back', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    ({ net } = checkIn(net, { call: 'K0CJH', now: T0 + min(1) }));
    net = removeStation(net, 'W1AW');
    expect(net.stations.map((s) => s.call)).toEqual(['K0CJH']);
    net = undoLast(net);
    expect(net.stations.map((s) => s.call)).toEqual(['K0CJH', 'W1AW']);
    net = undoLast(net);
    expect(net.stations.map((s) => s.call)).toEqual(['W1AW']);
    net = undoLast(net);
    expect(net.stations).toEqual([]);
    expect(undoLast(net)).toBe(net); // nothing left to undo
  });
  it('caps the undo stack', () => {
    let net = startNet();
    for (let i = 0; i < MAX_UNDO + 10; i++) {
      ({ net } = checkIn(net, { call: `K${i}ABC`, now: T0 + min(i) }));
    }
    expect(net.undo).toHaveLength(MAX_UNDO);
  });
});

describe('traffic queue', () => {
  it('lists traffic stations oldest-first and pops them as passed', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', flags: ['traffic'], now: T0 }));
    ({ net } = checkIn(net, { call: 'K0CJH', now: T0 + min(1) }));
    ({ net } = checkIn(net, { call: 'KE8PLM', flags: ['traffic', 'mobile'], now: T0 + min(2) }));
    expect(trafficQueue(net).map((s) => s.call)).toEqual(['W1AW', 'KE8PLM']);
    net = passTraffic(net, 'W1AW', T0 + min(3));
    expect(trafficQueue(net).map((s) => s.call)).toEqual(['KE8PLM']);
    expect(net.stations.find((s) => s.call === 'W1AW').trafficPassed).toBe(T0 + min(3));
    // passing a non-traffic or already-passed station is a no-op
    expect(passTraffic(net, 'K0CJH')).toBe(net);
    expect(passTraffic(net, 'W1AW')).toBe(net);
  });
  it('nextTraffic calls the head of the queue and passing clears it', () => {
    let net = startNet();
    expect(nextTraffic(net)).toBe(net); // empty queue, nothing calling
    ({ net } = checkIn(net, { call: 'W1AW', flags: ['traffic'], now: T0 }));
    ({ net } = checkIn(net, { call: 'KE8PLM', flags: ['traffic'], now: T0 + min(1) }));
    net = nextTraffic(net);
    expect(net.calling).toBe('W1AW');
    expect(nextTraffic(net)).toBe(net);
    net = passTraffic(net, 'W1AW', T0 + min(2));
    expect(net.calling).toBeNull();
    net = nextTraffic(net);
    expect(net.calling).toBe('KE8PLM');
    // passing a different station leaves the current call alone
    ({ net } = checkIn(net, { call: 'K0CJH', flags: ['traffic'], now: T0 + min(3) }));
    net = passTraffic(net, 'K0CJH', T0 + min(4));
    expect(net.calling).toBe('KE8PLM');
  });
  it('drops checked-out stations from the queue', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', flags: ['traffic'], now: T0 }));
    net = checkOut(net, 'W1AW', T0 + min(1));
    expect(trafficQueue(net)).toEqual([]);
  });
});

describe('closeNet / duration', () => {
  it('sets endTime once and clears undo', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const closed = closeNet(net, T0 + min(45));
    expect(closed.endTime).toBe(T0 + min(45));
    expect(closed.undo).toEqual([]);
    expect(closeNet(closed, T0 + min(60))).toBe(closed);
    expect(netDurationMs(closed)).toBe(min(45));
    expect(netDurationMs(net, T0 + min(10))).toBe(min(10));
  });
  it('formats elapsed and duration', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(min(12) + 34 * 1000)).toBe('00:12:34');
    expect(formatElapsed(min(125))).toBe('02:05:00');
    expect(formatDuration(30 * 1000)).toBe('<1m');
    expect(formatDuration(min(12))).toBe('12m');
    expect(formatDuration(min(65))).toBe('1h 05m');
  });
});

describe('buildReport', () => {
  const fullNet = () => {
    let net = startNet();
    ({ net } = checkIn(net, {
      call: 'W1AW',
      flags: ['traffic'],
      name: 'Hiram',
      location: 'Newington, CT',
      now: T0 + min(1),
    }));
    ({ net } = checkIn(net, { call: 'K0CJH', flags: ['mobile'], now: T0 + min(2) }));
    ({ net } = checkIn(net, { call: 'KE8PLM', flags: ['traffic'], note: 'ARES EC', now: T0 + min(3) }));
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 + min(10) })); // recheck
    net = passTraffic(net, 'W1AW', T0 + min(12));
    net = checkOut(net, 'K0CJH', T0 + min(15));
    return closeNet(net, T0 + min(40));
  };

  it('summarises counts and lists stations in check-in order', () => {
    const r = buildReport(fullNet());
    expect(r).toMatchObject({
      name: 'ARES Tuesday Net',
      ncs: 'K0CJH',
      frequency: '146.940 - 100.0',
      startTime: T0,
      endTime: T0 + min(40),
      durationMs: min(40),
      totalCheckins: 4,
      uniqueStations: 3,
      trafficCount: 2,
      trafficPassed: 1,
    });
    expect(r.stations.map((s) => s.call)).toEqual(['W1AW', 'K0CJH', 'KE8PLM']);
    expect(r.stations[0]).toMatchObject({ recheckCount: 1, trafficPassed: T0 + min(12), name: 'Hiram' });
    expect(r.stations[1].checkoutTime).toBe(T0 + min(15));
  });

  it('renders text, CSV and print HTML', () => {
    const r = buildReport(fullNet());
    const text = reportToText(r);
    expect(text).toContain('NET REPORT — ARES Tuesday Net');
    expect(text).toContain('Net control: K0CJH');
    expect(text).toContain('Check-ins: 4   Unique stations: 3   Traffic: 2 listed, 1 passed');
    expect(text).toContain('19:01 W1AW        TFC          Hiram, Newington, CT (recheck x1)');
    expect(text).toContain('19:02 K0CJH       MOB          (out 19:15)\n');
    expect(text).toContain('(ARES EC)');

    const csv = reportToCsv(r);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Net,NCS,Frequency,/);
    expect(lines[1]).toContain('"Newington, CT"');
    expect(lines[1]).toContain('2026-10-15T19:01:00.000Z');
    expect(lines[2]).toContain('2026-10-15T19:15:00.000Z');

    const html = reportToPrintHtml(r);
    expect(html).toContain('<title>Net Report — ARES Tuesday Net</title>');
    expect(html).toContain('<td class="mono">W1AW</td>');
    expect(html).toContain('recheck x1; traffic passed');
  });

  it('escapes HTML in the print view', () => {
    let net = createNet({ name: '<script>alert(1)</script>', now: T0 });
    ({ net } = checkIn(net, { call: 'W1AW', name: '<b>Hiram</b>', now: T0 }));
    const html = reportToPrintHtml(buildReport(closeNet(net, T0 + min(1))));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;b&gt;Hiram&lt;/b&gt;');
  });

  it('historyToCsv rolls up several nets', () => {
    const a = fullNet();
    let b = createNet({ name: 'Second Net', ncs: 'W1AW', now: T0 + min(60) });
    ({ net: b } = checkIn(b, { call: 'N0CALL', now: T0 + min(61) }));
    b = closeNet(b, T0 + min(70));
    const lines = historyToCsv([b, a]).trim().split('\r\n');
    expect(lines).toHaveLength(1 + 1 + 3);
    expect(lines[1]).toMatch(/^Second Net,W1AW,/);
    expect(lines[2]).toMatch(/^ARES Tuesday Net,K0CJH,/);
  });
});

describe('toRosterEntries', () => {
  it('matches the EmComm roster entry shape', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', flags: ['traffic'], name: 'Hiram', location: 'CT', now: T0 + min(1) }));
    ({ net } = checkIn(net, { call: 'K0CJH', now: T0 + min(2) }));
    net = checkOut(net, 'K0CJH', T0 + min(5));
    const roster = toRosterEntries(net);
    expect(roster.map((r) => r.call)).toEqual(['W1AW', 'K0CJH']);
    expect(roster[0]).toEqual({
      call: 'W1AW',
      netName: 'ARES Tuesday Net',
      status: 'Voice net: TFC · Hiram · CT',
      checkinTime: T0 + min(1),
      lastHeard: T0 + min(1),
      lat: null,
      lon: null,
      tokens: [],
      source: 'net-control',
    });
    expect(roster[1].status).toBe('Voice net: out 19:05');
    expect(roster[1].lastHeard).toBe(T0 + min(5));
  });
});

describe('script templates', () => {
  it('fills placeholders and leaves unknown/empty ones alone', () => {
    const out = fillTemplate('{ncs} opens {net} on {freq} at {time} with {count}; {nope}', {
      ncs: 'K0CJH',
      net: 'ARES Net',
      freq: '',
      time: '19:00',
      count: '7',
    });
    expect(out).toBe('K0CJH opens ARES Net on {freq} at 19:00 with 7; {nope}');
  });
  it('scriptContext derives values from the net', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const ctx = scriptContext(net, T0);
    expect(ctx).toMatchObject({ net: 'ARES Tuesday Net', ncs: 'K0CJH', freq: '146.940 - 100.0', count: '1' });
    expect(ctx.time).toContain('19:00 UTC');
    expect(ctx.date).toBeTruthy();
  });
  it('the default preamble and closing use the placeholders', () => {
    expect(DEFAULT_PREAMBLE).toContain('{ncs}');
    expect(DEFAULT_PREAMBLE).toContain('{net}');
    expect(DEFAULT_CLOSING).toContain('{count}');
  });
});

describe('station fills', () => {
  it('stationFromLogbook picks the newest QSO with a name', () => {
    const qsos = [
      { call: 'W1AW', qso_date: '20250101', time_on: '120000', name: 'Old Name', extras: { QTH: 'Hartford' } },
      { call: 'W1AW', qso_date: '20260301', time_on: '090000', name: 'Hiram', extras: { STATE: 'CT' } },
      { call: 'W1AW', qso_date: '20260401', time_on: '090000', name: '', extras: {} },
      { call: 'K0CJH', qso_date: '20260401', time_on: '090000', name: 'Chris' },
    ];
    expect(stationFromLogbook(qsos, 'w1aw')).toEqual({ name: 'Hiram', location: 'CT' });
    expect(stationFromLogbook(qsos, 'N0CALL')).toBeNull();
    expect(stationFromLogbook(null, 'W1AW')).toBeNull();
  });
  it('stationFromLookup composes name and location from a callbook result', () => {
    expect(
      stationFromLookup({ fname: 'Hiram', name: 'Maxim', county: 'Hartford', state: 'CT', country: 'United States' }),
    ).toEqual({ name: 'Hiram Maxim', location: 'Hartford, CT' });
    expect(stationFromLookup({ name: 'Koen', country: 'Belgium' })).toEqual({ name: 'Koen', location: 'Belgium' });
    expect(stationFromLookup({ country: 'Unknown', source: 'qrz' })).toBeNull();
    expect(stationFromLookup({ country: 'United States', source: 'prefix' })).toBeNull();
    expect(stationFromLookup({ country: 'United States', source: 'hamqth-dxcc', estimated: true })).toBeNull();
    expect(stationFromLookup({ country: 'United States', source: 'qrz' })).toBeNull();
    expect(stationFromLookup(null)).toBeNull();
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the running net and clears it', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    saveRunningNet(net);
    expect(loadRunningNet()).toEqual(net);
    clearRunningNet();
    expect(loadRunningNet()).toBeNull();
  });
  it('tolerates corrupt storage', () => {
    localStorage.setItem('openhamclock_netControl', '{not json');
    expect(loadRunningNet()).toBeNull();
    localStorage.setItem('openhamclock_netControlHistory', '"nope"');
    expect(loadHistory()).toEqual([]);
    localStorage.setItem('openhamclock_netControlStations', '[]');
    expect(loadStationCache()).toEqual({});
  });
  it('pushHistory prepends, dedupes by id, drops undo and caps', () => {
    let list = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      let net = createNet({ name: `Net ${i}`, now: T0 + min(i) });
      ({ net } = checkIn(net, { call: 'W1AW', now: T0 + min(i) }));
      list = pushHistory(list, closeNet(net, T0 + min(i) + 1000));
    }
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].name).toBe(`Net ${MAX_HISTORY + 4}`);
    expect(list[0].undo).toBeUndefined();
    const again = pushHistory(list, list[3]);
    expect(again).toHaveLength(MAX_HISTORY);
    expect(again[0].id).toBe(list[3].id);
  });
  it('script defaults to the first built-in template', () => {
    expect(loadScript()).toEqual({ preamble: DEFAULT_PREAMBLE, closing: DEFAULT_CLOSING });
  });
  it('station cache remembers, merges and evicts oldest', () => {
    let cache = rememberStation({}, 'w1aw', { name: 'Hiram' }, 1);
    cache = rememberStation(cache, 'W1AW', { location: 'CT' }, 2);
    expect(cache.W1AW).toEqual({ name: 'Hiram', location: 'CT', ts: 2 });
    expect(rememberStation(cache, 'K0CJH', {}, 3)).toBe(cache);
    for (let i = 0; i < STATION_CACHE_MAX; i++) cache = rememberStation(cache, `K${i}AB`, { name: 'x' }, 10 + i);
    expect(Object.keys(cache)).toHaveLength(STATION_CACHE_MAX);
    expect(cache.W1AW).toBeUndefined(); // oldest evicted
    saveStationCache(cache);
    expect(Object.keys(loadStationCache())).toHaveLength(STATION_CACHE_MAX);
  });
  it('saveRosterSnapshot writes roster-shaped entries', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    let fired = 0;
    const onEvt = () => fired++;
    window.addEventListener(NET_CONTROL_ROSTER_EVENT, onEvt);
    saveRosterSnapshot(net, { active: true });
    window.removeEventListener(NET_CONTROL_ROSTER_EVENT, onEvt);
    expect(fired).toBe(1);
    const snap = JSON.parse(localStorage.getItem(NET_CONTROL_ROSTER_KEY));
    expect(snap.net).toBe('ARES Tuesday Net');
    expect(snap.active).toBe(true);
    expect(snap.roster[0]).toMatchObject({ call: 'W1AW', netName: 'ARES Tuesday Net', source: 'net-control' });
    expect(getNetControlRoster()).toEqual(snap);
  });
  it('mergeRosters adds active voice-net stations the APRS roster lacks', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    ({ net } = checkIn(net, { call: 'KE8PLM', now: T0 + min(1) }));
    const aprs = [{ call: 'KE8PLM-7', netName: 'APRSNET', status: 'Checked in', age: 0, stale: false }];
    saveRosterSnapshot(net, { active: true });
    const merged = mergeRosters(aprs, getNetControlRoster(), T0 + min(3));
    expect(merged.map((r) => r.call)).toEqual(['KE8PLM-7', 'W1AW']);
    expect(merged[1]).toMatchObject({ age: 3, stale: false, source: 'net-control' });
    saveRosterSnapshot(closeNet(net, T0 + min(5)), { active: false });
    expect(mergeRosters(aprs, getNetControlRoster())).toBe(aprs);
    expect(mergeRosters(null, null)).toEqual([]);
  });
  it('flagsToText', () => {
    expect(flagsToText(['mobile', 'traffic', 'bogus'])).toBe('TFC MOB');
    expect(flagsToText([])).toBe('');
  });
});

describe('undo bookkeeping', () => {
  it('records the action and attached event ids on the undo entry and the station', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', flags: ['traffic'], now: T0 }));
    net = attachEvent(net, 'ev-1', 'W1AW');
    expect(peekUndo(net)).toMatchObject({ action: { kind: 'new', call: 'W1AW' }, eventIds: ['ev-1'] });
    expect(net.stations[0].logIds).toEqual(['ev-1']);
    net = passTraffic(net, 'W1AW', T0 + min(1));
    expect(peekUndo(net).action).toEqual({ kind: 'traffic', call: 'W1AW' });
    net = checkOut(net, 'W1AW', T0 + min(2));
    expect(peekUndo(net).action.kind).toBe('checkout');
    net = toggleFlag(net, 'W1AW', 'mobile');
    expect(peekUndo(net).action.kind).toBe('flag');
    net = removeStation(net, 'W1AW');
    expect(peekUndo(net).action.kind).toBe('remove');
    expect(attachEvent(null, 'x')).toBeNull();
  });
  it('attaches to the action for that call even when another action was stacked on top', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    ({ net } = checkIn(net, { call: 'K0CJH', now: T0 + 1 })); // e.g. from another tab
    net = attachEvent(net, 'ev-w', 'W1AW');
    expect(net.undo.map((u) => u.eventIds)).toEqual([['ev-w'], []]);
  });
  it('withdrawalSummary names what Undo reversed', () => {
    expect(withdrawalSummary({ kind: 'new' }, 'ARES')).toBe('Check-in withdrawn (ARES)');
    expect(withdrawalSummary({ kind: 'return' })).toBe('Re-check-in withdrawn');
    expect(withdrawalSummary({ kind: 'checkout' })).toBe('Check-out withdrawn');
    expect(withdrawalSummary({ kind: 'traffic' })).toBe('Traffic pass withdrawn');
    expect(withdrawalSummary({ kind: 'remove' })).toBe('Removal undone, entries reinstated');
    expect(withdrawalSummary(null)).toBe('Entry withdrawn');
  });
  it('reads the bare-array undo entries saved by the first release', () => {
    let net = startNet();
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const legacy = { ...net, undo: [[]] };
    expect(peekUndo(legacy)).toEqual({ stations: [], action: null, eventIds: [] });
    expect(undoLast(legacy).stations).toEqual([]);
    expect(peekUndo(startNet())).toBeNull();
  });
});

describe('script templates', () => {
  beforeEach(() => localStorage.clear());
  it('seeds the built-ins on first load', () => {
    const { templates, lastId } = loadScriptTemplates();
    expect(templates.map((t) => t.name)).toEqual(['ARES weekly net', 'SKYWARN activation', 'Tactical net']);
    expect(lastId).toBe('tpl-ares');
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.preamble).toContain('{ncs}');
      expect(t.closing).toContain('{net}');
    }
  });
  it('migrates a customised single script from the first release', () => {
    localStorage.setItem(NET_CONTROL_SCRIPT_KEY, JSON.stringify({ preamble: 'Mine', closing: DEFAULT_CLOSING }));
    const { templates, lastId } = loadScriptTemplates();
    expect(templates[0]).toMatchObject({ name: 'My net script', preamble: 'Mine' });
    expect(lastId).toBe(templates[0].id);
    expect(templates).toHaveLength(4);
  });
  it('does not migrate an unchanged default script', () => {
    localStorage.setItem(
      NET_CONTROL_SCRIPT_KEY,
      JSON.stringify({ preamble: DEFAULT_PREAMBLE, closing: DEFAULT_CLOSING }),
    );
    expect(loadScriptTemplates().templates).toHaveLength(3);
  });
  it('create / duplicate / rename / update / delete', () => {
    let { templates } = loadScriptTemplates();
    let id;
    ({ templates, id } = addTemplate(templates, { name: 'Hospital net' }));
    expect(getTemplate(templates, id).name).toBe('Hospital net');
    ({ templates, id } = addTemplate(templates, { name: 'Hospital net' }));
    expect(getTemplate(templates, id).name).toBe('Hospital net (2)');
    const dup = duplicateTemplate(templates, 'tpl-skywarn');
    templates = dup.templates;
    const copy = getTemplate(templates, dup.id);
    expect(copy).toMatchObject({ name: 'SKYWARN activation (copy)', preamble: BUILTIN_TEMPLATES[1].preamble });
    expect(copy.builtin).toBeUndefined();
    templates = renameTemplate(templates, dup.id, '  Spotter net ');
    expect(getTemplate(templates, dup.id).name).toBe('Spotter net');
    expect(renameTemplate(templates, dup.id, '   ')).toBe(templates);
    templates = renameTemplate(templates, dup.id, 'Tactical net'); // clash → numbered
    expect(getTemplate(templates, dup.id).name).toBe('Tactical net (2)');
    templates = updateTemplate(templates, 'tpl-ares', { preamble: 'Edited' });
    expect(getTemplate(templates, 'tpl-ares').preamble).toBe('Edited');
    expect(builtinDefault(getTemplate(templates, 'tpl-ares')).preamble).toBe(DEFAULT_PREAMBLE);
    expect(builtinDefault(copy)).toBeNull();
    templates = deleteTemplate(templates, 'tpl-ares');
    expect(templates.find((t) => t.id === 'tpl-ares')).toBeUndefined();
    expect(getTemplate(templates, 'tpl-ares').id).toBe(templates[0].id); // falls back to the first
    const one = [templates[0]];
    expect(deleteTemplate(one, one[0].id)).toBe(one); // last one stays
  });
  it('persists and restores the list and last-used id', () => {
    const state = loadScriptTemplates();
    const { templates, id } = addTemplate(state.templates, { name: 'Mine', preamble: 'P', closing: 'C' });
    saveScriptTemplates({ templates, lastId: id });
    expect(JSON.parse(localStorage.getItem(NET_CONTROL_SCRIPTS_KEY)).lastId).toBe(id);
    const again = loadScriptTemplates();
    expect(again.lastId).toBe(id);
    expect(loadScript()).toEqual({ preamble: 'P', closing: 'C' });
  });
});

describe('tabs in step (revision counter)', () => {
  beforeEach(() => localStorage.clear());
  it('commits with increasing revs and refuses to overwrite a newer state', () => {
    const a = commitRunningNet(null, startNet(), T0);
    expect(a).toMatchObject({ conflict: false });
    expect(a.net.rev).toBe(1);
    // Tab A and tab B both hold rev 1
    let tabA = a.net;
    const tabB = a.net;
    ({ net: tabA } = commitRunningNet(tabA, checkIn(tabA, { call: 'W1AW', now: T0 }).net, T0));
    expect(tabA.rev).toBe(2);
    // B's change is based on rev 1 → refused, B gets A's newer net
    const res = commitRunningNet(tabB, checkIn(tabB, { call: 'K0CJH', now: T0 }).net, T0);
    expect(res.conflict).toBe(true);
    expect(res.net.stations.map((s) => s.call)).toEqual(['W1AW']);
    expect(readRunningNetRecord().stations.map((s) => s.call)).toEqual(['W1AW']);
  });
  it('closing leaves a tombstone that closes the net in other tabs and blocks stale writes', () => {
    const { net } = commitRunningNet(null, startNet(), T0);
    const stale = net;
    expect(commitRunningNet(net, null, T0).net).toBeNull();
    expect(readRunningNetRecord()).toMatchObject({ closedId: net.id, rev: 2 });
    expect(loadRunningNet()).toBeNull();
    expect(pickNewer(stale, readRunningNetRecord())).toEqual({ net: null, changed: true });
    const res = commitRunningNet(stale, checkIn(stale, { call: 'W1AW', now: T0 }).net, T0);
    expect(res).toEqual({ net: null, conflict: true });
    // a new net may start over the tombstone
    const fresh = commitRunningNet(null, createNet({ name: 'Next', now: T0 }), T0);
    expect(fresh.conflict).toBe(false);
    expect(fresh.net.rev).toBe(3);
  });
  it('starting a net while another tab already runs one adopts that net', () => {
    const { net } = commitRunningNet(null, startNet(), T0);
    const res = commitRunningNet(null, createNet({ name: 'Other', now: T0 }), T0);
    expect(res.conflict).toBe(true);
    expect(res.net.id).toBe(net.id);
  });
  it('pickNewer applies only higher revisions', () => {
    const local = { ...startNet(), rev: 5 };
    expect(pickNewer(local, { ...local, rev: 4 }).changed).toBe(false);
    expect(pickNewer(local, { ...local, rev: 6, name: 'X' })).toMatchObject({ changed: true, net: { name: 'X' } });
    expect(pickNewer(local, null)).toEqual({ net: local, changed: false });
    expect(pickNewer(local, { closedId: 'someone-else', rev: 9 }).changed).toBe(false);
    expect(pickNewer(null, { ...local, rev: 1 }).changed).toBe(true);
  });
  it('livePeerCount drops panels not heard from within the TTL', () => {
    expect(livePeerCount({ a: T0, b: T0 - PEER_TTL_MS - 1 }, T0 + 1000)).toBe(1);
    expect(livePeerCount(null)).toBe(0);
  });
  it('the running net is written under NET_CONTROL_KEY', () => {
    commitRunningNet(null, startNet(), T0);
    expect(JSON.parse(localStorage.getItem(NET_CONTROL_KEY)).rev).toBe(1);
  });
});

describe('shared-incident adapters', () => {
  it('serializes without the undo stack and applies by revision', () => {
    let net = { ...startNet(), rev: 3 };
    ({ net } = checkIn(net, { call: 'W1AW', now: T0 }));
    const doc = serializeNetState(net, T0);
    expect(doc).toMatchObject({ v: 1, kind: 'net-control', rev: 3, closedId: null });
    expect(doc.net.undo).toBeUndefined();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    // same rev → no change; newer remote → applied with empty undo
    expect(applyRemoteNetState(net, doc).changed).toBe(false);
    const newer = { ...doc, rev: 4, net: { ...doc.net, name: 'Renamed' } };
    const applied = applyRemoteNetState(net, newer);
    expect(applied.changed).toBe(true);
    expect(applied.net).toMatchObject({ name: 'Renamed', rev: 4, undo: [] });
    // a closed net elsewhere
    const closed = serializeNetState({ closedId: net.id, rev: 9 }, T0);
    expect(closed.net).toBeNull();
    expect(applyRemoteNetState(net, closed)).toEqual({ net: null, changed: true });
    // no net / foreign or future documents are ignored
    expect(serializeNetState(null, T0)).toMatchObject({ net: null, closedId: null, rev: 0 });
    expect(applyRemoteNetState(net, { ...newer, v: 2 }).changed).toBe(false);
    expect(applyRemoteNetState(net, null).changed).toBe(false);
  });
});

describe('report times (UTC + local)', () => {
  const tz = 'America/Chicago'; // CDT = UTC−5 in October
  const net = () => {
    let n = startNet();
    ({ net: n } = checkIn(n, { call: 'W1AW', now: T0 + min(1) }));
    n = checkOut(n, 'W1AW', T0 + min(30));
    return closeNet(n, T0 + min(40));
  };
  it('localParts converts to the given zone and survives a bad zone', () => {
    expect(localParts(T0, tz)).toEqual({ date: '2026-10-15', time: '14:00', zone: 'CDT' });
    expect(fmtLocalDateTime(T0, tz)).toBe('2026-10-15 14:00 CDT');
    expect(localParts(T0, 'Not/AZone')).toBeTruthy();
    expect(localParts(null, tz)).toBeNull();
  });
  it('text and print add local times only when asked', () => {
    const r = buildReport(net());
    expect(reportToText(r, { timeZone: tz })).not.toContain('CDT');
    const both = reportToText(r, { times: 'both', timeZone: tz });
    expect(both).toContain('Opened: 2026-10-15 19:00Z (2026-10-15 14:00 CDT)');
    expect(both).toContain('19:01 14:01 W1AW');
    expect(both).toContain('out 19:30/14:30');
    const html = reportToPrintHtml(r, { times: 'both', timeZone: tz });
    expect(html).toContain('<th>In (CDT)</th>');
    expect(html).toContain('Opened (local)');
    expect(reportToPrintHtml(r, { timeZone: tz })).not.toContain('(local)');
  });
  it('CSV always carries both columns and the zone', () => {
    const lines = reportToCsv(buildReport(net()), { timeZone: tz }).trim().split('\r\n');
    expect(lines[0]).toContain('Check-In (UTC),Check-In (local)');
    expect(lines[0].endsWith('Time Zone')).toBe(true);
    expect(lines[1]).toContain('2026-10-15T19:01:00.000Z,2026-10-15 14:01');
    expect(lines[1]).toContain('2026-10-15T19:30:00.000Z,2026-10-15 14:30');
    expect(lines[1].endsWith('America/Chicago')).toBe(true);
  });
  it('scriptContext uses the configured zone', () => {
    expect(scriptContext(startNet(), T0, tz).time).toMatch(/0?2:00\s?PM local \(19:00 UTC\)|14:00 local \(19:00 UTC\)/);
  });
});

describe('parseNetFrequency', () => {
  const R2 = { region: 'R2' };
  it('reads repeater descriptions', () => {
    expect(parseNetFrequency('146.940 − PL 100.0', R2)).toEqual({
      mhz: 146.94,
      txMhz: 146.34,
      offsetMhz: -0.6,
      offsetSource: 'standard',
      offsetCheck: false,
      tone: '100.0',
      mode: '',
    });
    expect(parseNetFrequency('442.150 +5 T 123.0 FM')).toMatchObject({
      txMhz: 447.15,
      offsetSource: 'explicit',
      tone: '123.0',
      mode: 'FM',
    });
    expect(parseNetFrequency('147.105 MHz + 600 kHz 88.5 Hz')).toMatchObject({ txMhz: 147.705, tone: '88.5' });
    expect(parseNetFrequency('146.520 MHz FM')).toMatchObject({ txMhz: 146.52, offsetMhz: 0, offsetSource: 'simplex' });
    expect(parseNetFrequency('3.873 LSB')).toMatchObject({ mhz: 3.873, txMhz: 3.873, mode: 'LSB' });
    expect(parseNetFrequency('Main repeater')).toBeNull();
    expect(parseNetFrequency('')).toBeNull();
  });
  it("uses the region's standard offsets, flagging ones that vary locally", () => {
    expect(parseNetFrequency('224.940 -', R2)).toMatchObject({ txMhz: 223.34, offsetCheck: false });
    expect(parseNetFrequency('439.000 -', { region: 'R1' })).toMatchObject({ txMhz: 431.4, offsetCheck: true });
    expect(parseNetFrequency('145.700 -', { region: 'R1' })).toMatchObject({ txMhz: 145.1, offsetCheck: false });
    expect(parseNetFrequency('29.660 -', { region: 'R3' })).toMatchObject({ txMhz: 29.56 });
  });
  it('6 m in the Americas follows the ARRL band plan segments (all −500 kHz)', () => {
    // 51.62–51.98 outputs: the plan lists no exceptions
    expect(parseNetFrequency('51.620 -', R2)).toMatchObject({ txMhz: 51.12, offsetMhz: -0.5, offsetCheck: false });
    expect(parseNetFrequency('51.980 -', R2)).toMatchObject({ txMhz: 51.48, offsetCheck: false });
    // 52.5–52.98 and 53.5–53.98 outputs: "except as noted" → check locally
    expect(parseNetFrequency('52.700 -', R2)).toMatchObject({ txMhz: 52.2, offsetCheck: true }); // the plan's test pair
    expect(parseNetFrequency('52.500 -', R2)).toMatchObject({ txMhz: 52.0, offsetCheck: true });
    expect(parseNetFrequency('53.980 -', R2)).toMatchObject({ txMhz: 53.48, offsetCheck: true });
    expect(parseNetFrequency('53.500 -', R2)).toMatchObject({ txMhz: 53.0, offsetCheck: true });
    // outside an output segment (inputs, simplex, gaps): no standard
    for (const f of ['51.100 -', '51.990 -', '52.400 -', '53.150 -', '53.490 -', '50.500 -']) {
      expect(parseNetFrequency(f, R2), f).toMatchObject({ txMhz: null, offsetSource: 'unknown' });
    }
  });
  it('reports an unknown offset instead of guessing', () => {
    for (const [text, opts] of [
      ['50.840 -', { region: 'R3' }], // no 6 m standard in R3
      ['146.940 -', {}], // no region known
      ['1293.000 -', R2], // 23 cm: no single standard
    ]) {
      expect(parseNetFrequency(text, opts)).toMatchObject({ txMhz: null, offsetMhz: null, offsetSource: 'unknown' });
    }
  });
  it('an override fills or replaces the offset; its sign may come from the text', () => {
    // a locally coordinated 1 MHz pair outside the plan's segments
    expect(parseNetFrequency('53.150 -', { ...R2, offset: '1' })).toMatchObject({
      txMhz: 52.15,
      offsetSource: 'override',
    });
    // the override also replaces a standard offset
    expect(parseNetFrequency('53.700 -', { ...R2, offset: '1' })).toMatchObject({ txMhz: 52.7 });
    expect(parseNetFrequency('50.840 -', { region: 'R3', offset: '+0.5' })).toMatchObject({ txMhz: 51.34 });
    expect(parseNetFrequency('442.150 +5', { offset: '−5' })).toMatchObject({ txMhz: 437.15 });
    expect(parseNetFrequency('146.520', { offset: '0' })).toMatchObject({ txMhz: 146.52, offsetSource: 'override' });
    expect(parseNetFrequency('146.940', { offset: 'abc' })).toMatchObject({ offsetSource: 'simplex' }); // unreadable override ignored
  });
  it('parseOffset, formatOffset and bandPlanRegion', () => {
    expect(parseOffset('−600 kHz')).toEqual({ sign: '-', mhz: 0.6 });
    expect(parseOffset('+5')).toEqual({ sign: '+', mhz: 5 });
    expect(parseOffset('500')).toEqual({ sign: null, mhz: 0.5 });
    expect(parseOffset('x')).toBeNull();
    expect(formatOffset(-0.6)).toBe('−600 kHz');
    expect(formatOffset(5)).toBe('+5 MHz');
    expect(formatOffset(null)).toBe('');
    expect(bandPlanRegion({ lat: 44.4, lon: -93.2 })).toBe('R2');
    expect(bandPlanRegion({ lat: 51.5, lon: -0.1 })).toBe('R1');
    expect(bandPlanRegion({ lat: 55.7, lon: 37.6 })).toBe('R1');
    expect(bandPlanRegion({ lat: 55, lon: 82.9 })).toBe('R1'); // Novosibirsk
    expect(bandPlanRegion({ lat: 35.7, lon: 139.7 })).toBe('R3');
    expect(bandPlanRegion({ lat: -33.9, lon: 151.2 })).toBe('R3');
    expect(bandPlanRegion(null)).toBeNull();
    expect(standardOffset(146.94, 'R9')).toBeNull();
  });
});

describe('createNet frequency fields', () => {
  it('stores scheduled frequency, mode and script', () => {
    const net = createNet({
      name: 'N',
      freqMhz: 146.94,
      mode: 'fm',
      scriptId: 'tpl-skywarn',
      region: 'R2',
      offset: ' -0.6 ',
      now: T0,
    });
    expect(net).toMatchObject({
      freqMhz: 146.94,
      mode: 'FM',
      scriptId: 'tpl-skywarn',
      rev: 0,
      region: 'R2',
      offset: '-0.6',
    });
    expect(createNet({ name: 'N', freqMhz: 'x' }).freqMhz).toBeNull();
    saveRosterSnapshot(net, { active: true });
    expect(getNetControlRoster()).toMatchObject({ freqMhz: 146.94, mode: 'FM', region: 'R2', offset: '-0.6' });
  });
});

describe('re-applying a refused change (rebaseCheck)', () => {
  const base = () => {
    let n = { ...startNet(), rev: 4 };
    ({ net: n } = checkIn(n, { call: 'W1AW', now: T0 }));
    ({ net: n } = checkIn(n, { call: 'K0CJH', now: T0 + 1000 }));
    return n;
  };
  it('different calls checked in on each side → re-apply', () => {
    const b = base();
    const theirs = checkIn(b, { call: 'KE8PLM', now: T0 + min(1) }).net;
    const mine = checkIn(b, { call: 'N0XYZ', now: T0 + min(1) }).net;
    expect(rebaseCheck(b, mine, theirs)).toEqual({ ok: true, calls: [], fields: [] });
    // re-applying my operation to their net keeps both check-ins
    const merged = checkIn(theirs, { call: 'N0XYZ', now: T0 + min(1) }).net;
    expect(merged.stations.map((s) => s.call).sort()).toEqual(['K0CJH', 'KE8PLM', 'N0XYZ', 'W1AW']);
  });
  it('flag toggles on different lines → re-apply; on the same line → ask', () => {
    const b = base();
    const theirs = toggleFlag(b, 'W1AW', 'mobile');
    expect(rebaseCheck(b, toggleFlag(b, 'K0CJH', 'traffic'), theirs).ok).toBe(true);
    expect(rebaseCheck(b, toggleFlag(b, 'W1AW', 'traffic'), theirs)).toEqual({
      ok: false,
      calls: ['W1AW'],
      fields: [],
    });
  });
  it('the same call checked in on both sides → ask', () => {
    const b = base();
    const theirs = checkIn(b, { call: 'KE8PLM', now: T0 + min(1) }).net;
    const mine = checkIn(b, { call: 'KE8PLM', now: T0 + min(1) + 5 }).net;
    expect(rebaseCheck(b, mine, theirs)).toMatchObject({ ok: false, calls: ['KE8PLM'] });
  });
  it('net fields: both set the same value → fine; different values → ask', () => {
    let b = base();
    b = toggleFlag(b, 'W1AW', 'traffic');
    b = toggleFlag(b, 'K0CJH', 'traffic');
    expect(rebaseCheck(b, nextTraffic(b), nextTraffic(b)).ok).toBe(true);
    expect(rebaseCheck(b, { ...b, scriptId: 'a' }, { ...b, scriptId: 'b' })).toMatchObject({
      ok: false,
      fields: ['scriptId'],
    });
    expect(changedNetFields(b, { ...b, frequency: 'x' })).toEqual(['frequency']);
  });
  it('a closed or different net elsewhere → ask', () => {
    const b = base();
    const mine = checkIn(b, { call: 'N0XYZ', now: T0 }).net;
    expect(rebaseCheck(b, mine, null).ok).toBe(false);
    expect(rebaseCheck(b, mine, { ...b, id: 'other' }).ok).toBe(false);
  });
  it('changedCalls sees added, removed and edited lines', () => {
    const b = base();
    expect([...changedCalls(b, removeStation(b, 'W1AW'))]).toEqual(['W1AW']);
    expect([...changedCalls(b, updateStation(b, 'K0CJH', { name: 'Chris' }))]).toEqual(['K0CJH']);
    expect(changedCalls(b, { ...b }).size).toBe(0);
  });
});
