/**
 * Tests for icsForms — ICS 309/214/213/205 data model, row builders, APRS
 * splitting, CSV and print HTML.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ICS_DRAFTS_KEY,
  ICS309_DEFAULT_TYPES,
  ICS309_ROWS_PER_PAGE,
  APRS_MSG_MAX,
  utcDate,
  utcTime,
  utcDateTime,
  toInputDateTime,
  fromInputDateTime,
  inputToPrintDateTime,
  defaultDrafts,
  mergeDrafts,
  migrateIcs309Types,
  DRAFTS_VERSION,
  loadDrafts,
  saveDrafts,
  eventsInRange,
  headerRange,
  ics309RowsFromEvents,
  ics309Csv,
  ics214RowsFromEvents,
  mergeIcs214Rows,
  newIcs214Row,
  ics213AprsText,
  splitForAprs,
  ics205ModeCode,
  formatPlanFreq,
  ics205RowFromRepeater,
  ics205RowFromNet,
  ics205RowFromVoiceNet,
  newSimplexRow,
  numberChannels,
  buildIcs309Html,
  buildIcs214Html,
  buildIcs213Html,
  buildIcs205Html,
  buildIcsHtml,
  ics309Rows,
  newIcs309Row,
  editIcs309Row,
  removeIcs309Row,
  defaultTr,
  newSendState,
  applySendResult,
  firstUnsentPart,
  sendStateMatches,
  zonesOf,
  groupRowsByZone,
} from './icsForms.js';

const T0 = Date.UTC(2026, 9, 14, 18, 0, 0); // 2026-10-14 1800Z

// A fixture event log as the EmComm layout records it
const LOG = [
  { id: 'e1', ts: T0 + 60_000, type: 'net_checkin', callsign: 'KE8PLM', summary: 'Checked into ARES', details: '' },
  {
    id: 'e2',
    ts: T0 + 5 * 60_000,
    type: 'aprs_msg_sent',
    callsign: 'K0CJH',
    summary: 'Message to KE8PLM-9',
    details: 'Report to EOC at 1900',
  },
  {
    id: 'e3',
    ts: T0 + 6 * 60_000,
    type: 'aprs_msg_rx',
    callsign: 'KE8PLM-9',
    summary: 'Message to K0CJH',
    details: 'Roger, en route',
  },
  {
    id: 'e4',
    ts: T0 + 7 * 60_000,
    type: 'aprs_msg_rx',
    callsign: 'W1AW',
    summary: 'Bulletin to BLN1',
    details: 'Shelter at school open',
  },
  {
    id: 'e5',
    ts: T0 + 8 * 60_000,
    type: 'nws_alert',
    callsign: '',
    summary: 'Severe: Flood Warning',
    details: 'River at flood stage',
  },
  { id: 'e6', ts: T0 + 9 * 60_000, type: 'station_heard', callsign: 'N0EOC', summary: 'EOC station heard via RF' },
  {
    id: 'e7',
    ts: T0 + 10 * 60_000,
    type: 'shelter_report',
    callsign: 'KD0ABC',
    summary: 'Shelter report received',
    details: '[Beds 30/100]',
  },
  { id: 'e8', ts: T0 + 11 * 60_000, type: 'net_checkout', callsign: 'KE8PLM', summary: 'Checked out of net' },
  {
    id: 'e9',
    ts: T0 + 12 * 60_000,
    type: 'ics213_sent',
    callsign: 'K0CJH',
    summary: 'ICS 213 to N0EOC: Water needed',
    details: 'Water needed: 200 gal at shelter 3',
  },
  { id: 'e0', ts: T0 - 3600_000, type: 'net_checkin', callsign: 'OLD1', summary: 'Checked into ARES' },
];

beforeEach(() => {
  localStorage.clear();
});

describe('UTC time helpers', () => {
  it('formats dates and 24-hour times in UTC', () => {
    expect(utcDate(T0)).toBe('2026-10-14');
    expect(utcTime(T0 + 5 * 60_000)).toBe('1805');
    expect(utcDateTime(T0)).toBe('2026-10-14 1800');
    expect(utcDate(NaN)).toBe('');
  });

  it('round-trips datetime-local values as UTC', () => {
    expect(toInputDateTime(T0)).toBe('2026-10-14T18:00');
    expect(fromInputDateTime('2026-10-14T18:00')).toBe(T0);
    expect(fromInputDateTime('2026-10-14T18:00:30')).toBe(T0 + 30_000);
    expect(fromInputDateTime('garbage')).toBeNull();
    expect(fromInputDateTime('')).toBeNull();
    expect(inputToPrintDateTime('2026-10-14T18:00')).toBe('2026-10-14 1800');
    expect(inputToPrintDateTime('free text')).toBe('free text');
  });
});

describe('drafts', () => {
  it('defaults the operational period to today 0000Z → now', () => {
    const d = defaultDrafts(T0 + 90_000);
    expect(d.header.periodFrom).toBe('2026-10-14T00:00');
    expect(d.header.periodTo).toBe('2026-10-14T18:01');
    expect(d.ics309.types).toEqual(ICS309_DEFAULT_TYPES);
    expect(d.ics214.rows).toEqual([]);
    expect(d.ics205.rows).toEqual([]);
  });

  it('merges a stored draft over defaults and repairs bad shapes', () => {
    const merged = mergeDrafts({ header: { incidentName: 'Flood 26' }, ics214: { rows: 'nope' }, junk: 1 }, T0);
    expect(merged.header.incidentName).toBe('Flood 26');
    expect(merged.header.periodFrom).toBe('2026-10-14T00:00');
    expect(merged.ics214.rows).toEqual([]);
    expect(merged.junk).toBeUndefined();
    expect(mergeDrafts(null, T0)).toEqual(defaultDrafts(T0));
  });

  it('persists to localStorage and survives corruption', () => {
    const d = defaultDrafts(T0);
    d.header.incidentName = 'Test Incident';
    saveDrafts(d);
    expect(JSON.parse(localStorage.getItem(ICS_DRAFTS_KEY)).header.incidentName).toBe('Test Incident');
    expect(loadDrafts(T0).header.incidentName).toBe('Test Incident');
    localStorage.setItem(ICS_DRAFTS_KEY, '{not json');
    expect(loadDrafts(T0).header.incidentName).toBe('');
  });
});

describe('eventsInRange / headerRange', () => {
  it('filters inclusively and sorts oldest first', () => {
    const shuffled = [...LOG].reverse();
    const r = eventsInRange(shuffled, { from: T0, to: T0 + 6 * 60_000 });
    expect(r.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(eventsInRange(LOG, {}).length).toBe(LOG.length);
  });

  it('treats the end minute as inclusive', () => {
    const range = headerRange({ periodFrom: '2026-10-14T18:00', periodTo: '2026-10-14T18:05' });
    expect(range.from).toBe(T0);
    expect(range.to).toBe(T0 + 5 * 60_000 + 59_999);
    expect(headerRange({ periodFrom: '', periodTo: '' })).toEqual({ from: null, to: null });
  });
});

describe('ICS 309 rows from the event log', () => {
  const rows = ics309RowsFromEvents(LOG, { from: T0, to: T0 + 3600_000, operatorCall: 'k0cjh' });
  const byId = Object.fromEntries(rows.map((r) => [r.eventId, r]));

  it('includes all event types when no filter is given, in time order, range-limited', () => {
    expect(rows.map((r) => r.eventId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']);
    expect(rows[0].id).toBe('ev-e1');
    expect(rows[0].time).toBe('1801');
    expect(rows[0].date).toBe('2026-10-14');
  });

  it('check-ins come FROM the station TO the operator', () => {
    expect(byId.e1).toMatchObject({ from: 'KE8PLM', to: 'K0CJH', message: 'Checked into ARES' });
    expect(byId.e8).toMatchObject({ from: 'KE8PLM', to: 'K0CJH' });
  });

  it('sent APRS messages go FROM us TO the addressee, message is the text', () => {
    expect(byId.e2).toMatchObject({ from: 'K0CJH', to: 'KE8PLM-9', message: 'Report to EOC at 1900' });
  });

  it('received APRS messages and bulletins keep their addressee', () => {
    expect(byId.e3).toMatchObject({ from: 'KE8PLM-9', to: 'K0CJH', message: 'Roger, en route' });
    expect(byId.e4).toMatchObject({ from: 'W1AW', to: 'BLN1', message: 'Bulletin: Shelter at school open' });
  });

  it('NWS alerts come from NWS; reports carry their details', () => {
    expect(byId.e5.from).toBe('NWS');
    expect(byId.e5.message).toContain('Flood Warning');
    expect(byId.e5.message).toContain('River at flood stage');
    expect(byId.e7.message).toBe('Shelter report received — [Beds 30/100]');
  });

  it('ICS 213 sends are addressed to the 213 recipient', () => {
    expect(byId.e9).toMatchObject({ from: 'K0CJH', to: 'N0EOC' });
    expect(byId.e9.message).toBe('ICS 213 — Water needed: 200 gal at shelter 3');
  });

  it('numbers message traffic: FROM Msg # for traffic we sent, TO Msg # for traffic received', () => {
    // Legacy events (no msgNo) get numbers derived in time order across the
    // whole log: e0 (before the period) = 1, e1 = 2, e2 = 3, e3 = 4,
    // e4 (received bulletin) = 5, e8 = 6, e9 = 7
    expect(byId.e1).toMatchObject({ fromMsg: '', toMsg: '2' });
    expect(byId.e2).toMatchObject({ fromMsg: '3', toMsg: '' });
    expect(byId.e3).toMatchObject({ fromMsg: '', toMsg: '4' });
    expect(byId.e4).toMatchObject({ fromMsg: '', toMsg: '5' });
    expect(byId.e8).toMatchObject({ toMsg: '6' });
    expect(byId.e9).toMatchObject({ fromMsg: '7', toMsg: '' });
    // Alerts, reports and first-heard stations are not message traffic
    for (const id of ['e5', 'e6', 'e7']) expect(byId[id]).toMatchObject({ fromMsg: '', toMsg: '' });
  });

  it('uses the stored msgNo when the event has one', () => {
    const log = [
      { id: 'a', ts: T0, type: 'aprs_msg_sent', callsign: 'K0CJH', summary: 'Message to N0EOC', msgNo: 41 },
      { id: 'b', ts: T0 + 1000, type: 'aprs_msg_rx', callsign: 'N0EOC', summary: 'Message to K0CJH', msgNo: 42 },
    ];
    const r = ics309RowsFromEvents(log, { operatorCall: 'K0CJH' });
    expect(r.map((x) => [x.fromMsg, x.toMsg])).toEqual([
      ['41', ''],
      ['', '42'],
    ]);
  });

  it('renumbers the period from the operator’s starting number', () => {
    const r = ics309RowsFromEvents(LOG, { from: T0, operatorCall: 'K0CJH', startNumber: 100 });
    const nums = r.map((x) => x.fromMsg || x.toMsg).filter(Boolean);
    expect(nums).toEqual(['100', '101', '102', '103', '104', '105']);
    // Blank / invalid start keeps the running numbers
    const keep = ics309RowsFromEvents(LOG, { from: T0, operatorCall: 'K0CJH', startNumber: '' });
    expect(keep[0].toMsg).toBe('2');
  });

  it('filters by event type (defaults leave out alerts and first-heard stations)', () => {
    const filtered = ics309RowsFromEvents(LOG, { from: T0, operatorCall: 'K0CJH', types: ICS309_DEFAULT_TYPES });
    expect(filtered.map((r) => r.type)).not.toContain('nws_alert');
    expect(filtered.map((r) => r.type)).not.toContain('station_heard');
    expect(filtered.length).toBe(7);
    expect(ics309RowsFromEvents(LOG, { types: [] })).toEqual([]);
  });
});

describe('ICS 309 CSV', () => {
  it('writes the identification blocks then the standard columns, RFC 4180 escaped', () => {
    const d = defaultDrafts(T0);
    d.header.incidentName = 'River Flood, 2026';
    d.header.periodFrom = '2026-10-14T18:00';
    d.header.periodTo = '2026-10-14T19:00';
    d.ics309.netName = 'ARES Tactical';
    d.ics309.operatorName = 'Chris';
    d.ics309.operatorCall = 'K0CJH';
    const rows = ics309RowsFromEvents(LOG, { ...headerRange(d.header), operatorCall: 'K0CJH' });
    const csv = ics309Csv(d, rows, { now: T0 });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Form,ICS 309 Communications Log');
    expect(lines[1]).toBe('1. Incident Name and Activation Number,"River Flood, 2026"');
    expect(lines[2]).toBe('2. Operational Period (UTC),2026-10-14 1800 – 2026-10-14 1900');
    expect(lines[3]).toBe('3. Radio Net Name (for NCS) or Position/Tactical Call,ARES Tactical');
    expect(lines[4]).toBe('"4. Radio Operator (Name, Call Sign)",Chris K0CJH');
    expect(csv).toContain(
      'Date (UTC),Time (24:00),From Call Sign/ID,From Msg #,To Call Sign/ID,To Msg #,Message\r\n2026-10-14,1801,KE8PLM,,K0CJH,2,Checked into ARES',
    );
    expect(csv).toContain('2026-10-14,1806,KE8PLM-9,,K0CJH,4,"Roger, en route"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('ICS 214 rows', () => {
  it('imports event-log rows as editable datetime/text rows', () => {
    const rows = ics214RowsFromEvents(LOG, { from: T0, to: T0 + 2 * 60_000 });
    expect(rows).toEqual([
      { id: 'ev-e1', dateTime: '2026-10-14T18:01', text: 'Net Check-In. KE8PLM: Checked into ARES', source: 'event' },
    ]);
  });

  it('re-import keeps operator edits and manual rows, adds only new events, sorted by time', () => {
    const first = ics214RowsFromEvents(LOG, { from: T0, to: T0 + 2 * 60_000 });
    first[0].text = 'Edited by operator';
    const manual = { ...newIcs214Row(T0 + 3 * 60_000), text: 'Deployed to EOC' };
    const merged = mergeIcs214Rows([...first, manual], ics214RowsFromEvents(LOG, { from: T0, to: T0 + 6 * 60_000 }));
    expect(merged.map((r) => r.text)).toEqual([
      'Edited by operator',
      'Deployed to EOC',
      expect.stringContaining('Message to KE8PLM-9'),
      expect.stringContaining('Roger, en route'),
    ]);
    expect(merged[1].source).toBe('manual');
  });
});

describe('ICS 213 → APRS', () => {
  it('builds "Subject: message" with collapsed whitespace', () => {
    expect(ics213AprsText({ subject: 'Water', message: 'Need   200\n gal' })).toBe('Water: Need 200 gal');
    expect(ics213AprsText({ subject: '', message: 'Hello' })).toBe('Hello');
    expect(ics213AprsText({ subject: 'Only subject', message: '' })).toBe('Only subject');
    expect(ics213AprsText({})).toBe('');
  });

  it('sends short text as a single unnumbered message', () => {
    expect(splitForAprs('Short message')).toEqual(['Short message']);
    expect(splitForAprs('x'.repeat(APRS_MSG_MAX))).toEqual(['x'.repeat(APRS_MSG_MAX)]);
    expect(splitForAprs('   ')).toEqual([]);
  });

  it('splits long text into numbered parts of at most 67 chars on word boundaries', () => {
    const text =
      'Shelter 3 at Lincoln Elementary needs 200 gallons of potable water, 50 cots and two generators before 2200 local tonight. Contact the shelter manager on the ARES tactical net.';
    const parts = splitForAprs(text);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(67);
      expect(p.startsWith(`${i + 1}/${parts.length} `)).toBe(true);
    });
    // Nothing lost or duplicated: stripping prefixes reconstructs the text
    const rebuilt = parts.map((p) => p.replace(/^\d+\/\d+ /, '')).join(' ');
    expect(rebuilt).toBe(text);
    // Word boundaries — no part ends mid-word except where forced
    for (const p of parts.slice(0, -1)) expect(text).toContain(`${p.replace(/^\d+\/\d+ /, '')} `);
  });

  it('hard-cuts a single word longer than a part', () => {
    const parts = splitForAprs('A'.repeat(150));
    expect(parts.length).toBe(3);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(67));
    expect(parts.map((p) => p.replace(/^\d+\/\d+ /, '')).join('')).toBe('A'.repeat(150));
  });

  it('keeps every part within the limit when the count reaches two digits', () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const parts = splitForAprs(words);
    expect(parts.length).toBeGreaterThanOrEqual(10);
    parts.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(67);
      expect(p.startsWith(`${i + 1}/${parts.length} `)).toBe(true);
    });
  });

  it('honours a custom limit', () => {
    const parts = splitForAprs('one two three four five six', 12);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(12));
  });
});

describe('ICS 205 rows', () => {
  it('maps mode strings to the A/D/M code', () => {
    expect(ics205ModeCode('FM')).toBe('A');
    expect(ics205ModeCode('')).toBe('A');
    expect(ics205ModeCode('DMR')).toBe('D');
    expect(ics205ModeCode('D-STAR')).toBe('D');
    expect(ics205ModeCode('YSF')).toBe('D');
    expect(ics205ModeCode('FM/DMR')).toBe('M');
    expect(ics205ModeCode('Mixed')).toBe('M');
  });

  it('formats plan frequencies', () => {
    expect(formatPlanFreq(146.94)).toBe('146.940');
    expect(formatPlanFreq(442.1125)).toBe('442.1125');
    expect(formatPlanFreq(0)).toBe('');
    expect(formatPlanFreq('abc')).toBe('');
  });

  it('builds a repeater row: RX = output, TX = output + offset, tone on TX', () => {
    const row = ics205RowFromRepeater({
      callsign: 'w0xyz',
      mhz: 146.94,
      offsetMhz: -0.6,
      tone: '100.0',
      mode: 'FM',
      city: 'Denver',
      group: 'DRC',
    });
    expect(row).toMatchObject({
      function: 'Repeater',
      name: 'W0XYZ',
      rxFreq: '146.940',
      txFreq: '146.340',
      rxTone: '',
      txTone: '100.0',
      mode: 'A',
      remarks: 'Denver · DRC',
      source: 'repeater',
    });
    expect(row.id).toBeTruthy();
    const plus = ics205RowFromRepeater({ callsign: 'K1ABC', mhz: 444.5, offsetMhz: 5, mode: 'DMR' });
    expect(plus.txFreq).toBe('449.500');
    expect(plus.mode).toBe('D');
  });

  it('builds a net row with schedule in the remarks', () => {
    const row = ics205RowFromNet({
      name: 'County ARES',
      freq_mhz: 147.21,
      mode: 'FM',
      day: 2,
      time_utc: '0100',
      notes: 'Weekly',
    });
    expect(row).toMatchObject({
      function: 'Net',
      name: 'County ARES',
      rxFreq: '147.210',
      txFreq: '147.210',
      mode: 'A',
      remarks: 'Tue 0100Z · FM · Weekly',
    });
    expect(ics205RowFromNet({ name: 'Daily', day: 'daily', time_utc: '1200' }).remarks).toBe('Daily 1200Z');
  });

  it('builds simplex rows with RX = TX and numbers blank channels', () => {
    const s = newSimplexRow({ name: 'NATIONAL SIMPLEX', mhz: 146.52 });
    expect(s).toMatchObject({ function: 'Simplex', rxFreq: '146.520', txFreq: '146.520', txTone: '', mode: 'A' });
    const numbered = numberChannels([s, { ...s, ch: '7' }, s]);
    expect(numbered.map((r) => r.ch)).toEqual(['1', '7', '3']);
  });
});

describe('print HTML', () => {
  const drafts = (() => {
    const d = defaultDrafts(T0);
    d.header.incidentName = '<Flood> & "Fire"';
    d.header.preparedBy = 'Chris';
    d.header.preparedCall = 'K0CJH';
    d.header.periodFrom = '2026-10-14T18:00';
    d.header.periodTo = '2026-10-14T19:00';
    return d;
  })();

  it('ICS 309 carries the numbered blocks, escapes values, and pages long logs', () => {
    const rows = ics309RowsFromEvents(LOG, { from: T0, operatorCall: 'K0CJH' });
    const html = buildIcs309Html(drafts, rows, { now: T0 });
    for (const label of [
      '1. Incident Name and Activation Number',
      '2. Operational Period',
      '3. Radio Net Name (for NCS) or Position/Tactical Call',
      '4. Radio Operator (Name, Call Sign)',
      '5. COMMUNICATIONS LOG',
      '6. Prepared By (Name, Call Sign)',
      '7. Date &amp; Time Prepared',
      'Page 1 of 1',
    ])
      expect(html).toContain(label);
    expect(html).toContain('&lt;Flood&gt; &amp; &quot;Fire&quot;');
    expect(html).not.toContain('<Flood>');
    const many = Array.from({ length: ICS309_ROWS_PER_PAGE + 1 }, (_, i) => ({ ...rows[0], id: `r${i}` }));
    const paged = buildIcs309Html(drafts, many, { now: T0 });
    expect(paged.match(/<section/g).length).toBe(2);
    expect(paged).toContain('Page 2 of 2');
  });

  it('ICS 214 prints blocks 1–8 with resources and activity rows', () => {
    const d = structuredClone(drafts);
    d.ics214.name = 'Chris';
    d.ics214.resources = [{ id: 'a', name: 'Mike', position: 'Radio Op', agency: 'ARES' }];
    d.ics214.rows = [{ id: 'x', dateTime: '2026-10-14T18:30', text: 'Set up station', source: 'manual' }];
    const html = buildIcs214Html(d, { now: T0 });
    for (const label of [
      'ACTIVITY LOG',
      '1. Incident Name',
      '3. Name',
      '4. ICS Position',
      '5. Home Agency (and Unit)',
      '6. Resources Assigned',
      '7. Activity Log',
      'Notable Activities',
      '8. Prepared by',
    ])
      expect(html).toContain(label);
    expect(html).toContain('2026-10-14 1830');
    expect(html).toContain('Set up station');
    expect(html).toContain('Mike');
  });

  it('ICS 213 prints blocks 1–10', () => {
    const d = structuredClone(drafts);
    Object.assign(d.ics213, {
      to: 'EOC Manager',
      toCall: 'N0EOC',
      from: 'Shelter 3',
      subject: 'Water',
      dateTime: '2026-10-14T18:45',
      message: 'Line one\nLine two',
    });
    const html = buildIcs213Html(d);
    for (const label of [
      'GENERAL MESSAGE',
      '2. To (Name and Position)',
      '3. From (Name and Position)',
      '4. Subject',
      '5. Date',
      '6. Time',
      '7. Message',
      '8. Approved by',
      '9. Reply',
      '10. Replied by',
    ])
      expect(html).toContain(label);
    expect(html).toContain('EOC Manager (N0EOC)');
    expect(html).toContain('1845');
    expect(html).toContain('Line one\nLine two');
  });

  it('ICS 205 prints the channel table in landscape with numbered channels', () => {
    const d = structuredClone(drafts);
    d.ics205.rows = [newSimplexRow({ name: 'SIMPLEX 1', mhz: 146.52 })];
    d.ics205.specialInstructions = 'Monitor 146.520';
    const html = buildIcs205Html(d, { now: T0 });
    expect(html).toContain('landscape');
    for (const label of [
      'INCIDENT RADIO COMMUNICATIONS PLAN',
      '4. Basic Radio Channel Use',
      'Zone Grp.',
      'Ch #',
      'Channel Name/Trunked Radio System Talkgroup',
      'RX Freq N or W',
      'TX Tone/NAC',
      'Mode (A, D, or M)',
      '5. Special Instructions',
      '6. Prepared by (Communications Unit Leader)',
    ])
      expect(html).toContain(label);
    expect(html).toContain('146.520 W');
    expect(html).toContain('<td>1</td>');
  });

  it('buildIcsHtml dispatches by form id and applies the 309 header range and type filter', () => {
    const html = buildIcsHtml('309', drafts, { events: LOG, now: T0 });
    expect(html).toContain('KE8PLM');
    expect(html).not.toContain('OLD1'); // before the operational period
    expect(html).not.toContain('Flood Warning'); // nws_alert not in default types
    expect(buildIcsHtml('213', drafts)).toContain('GENERAL MESSAGE');
    expect(buildIcsHtml('999', drafts)).toBe('');
  });
});

describe('Net Control integration', () => {
  const ev = (id, mins, type, extra = {}) => ({
    id,
    ts: T0 + mins * 60_000,
    type,
    callsign: 'W1AW',
    summary: type,
    details: '',
    ...extra,
  });
  it('drops withdrawn net entries and the withdrawal records from the 309 and 214', () => {
    const log = [
      ev('a', 1, 'net_checkin'),
      ev('b', 2, 'net_checkin', { callsign: 'K0CJH' }),
      ev('w1', 3, 'net_withdrawn', { ref: 'b' }),
      ev('c', 4, 'net_traffic'),
    ];
    const rows = ics309RowsFromEvents(log, { operatorCall: 'K0CJH', types: ICS309_DEFAULT_TYPES });
    expect(rows.map((r) => r.eventId)).toEqual(['a', 'c']);
    expect(ics214RowsFromEvents(log).map((r) => r.id)).toEqual(['ev-a', 'ev-c']);
    // undoing the withdrawal (a withdrawal of the withdrawal) reinstates the check-in
    const reinstated = [...log, ev('w2', 5, 'net_withdrawn', { ref: 'w1' })];
    expect(ics309RowsFromEvents(reinstated, { types: ICS309_DEFAULT_TYPES }).map((r) => r.eventId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('a withdrawn message keeps its number: the 309 skips it without shifting later numbers', () => {
    const log = [
      ev('a', 1, 'net_checkin', { msgNo: 1 }),
      ev('b', 2, 'net_checkin', { callsign: 'K0CJH', msgNo: 2 }),
      ev('w1', 3, 'net_withdrawn', { ref: 'b' }),
      ev('c', 4, 'net_checkin', { callsign: 'KE8PLM', msgNo: 3 }),
    ];
    const rows = ics309RowsFromEvents(log, { types: ICS309_DEFAULT_TYPES });
    expect(rows.map((r) => [r.eventId, r.toMsg])).toEqual([
      ['a', '1'],
      ['c', '3'],
    ]);
    // the editable-row builder sees the same active log
    const d = defaultDrafts(T0);
    d.header.periodFrom = '';
    d.header.periodTo = '';
    expect(ics309Rows(d, log).map((r) => r.eventId)).toEqual(['a', 'c']);
    // an explicit start number renumbers only the rows on the form
    expect(ics309RowsFromEvents(log, { startNumber: 10 }).map((r) => r.toMsg)).toEqual(['10', '11']);
  });
  it('net traffic is on the 309 by default, from the station to the operator', () => {
    expect(ICS309_DEFAULT_TYPES).toContain('net_traffic');
    const [row] = ics309RowsFromEvents([ev('t', 1, 'net_traffic', { summary: 'Traffic passed on ARES' })], {
      operatorCall: 'k0cjh',
    });
    expect(row).toMatchObject({ from: 'W1AW', to: 'K0CJH', message: 'Traffic passed on ARES' });
  });
  it('ics205RowFromVoiceNet reads the running net frequency, offset and tone', () => {
    const row = ics205RowFromVoiceNet({
      net: 'County ARES Net',
      ncs: 'K0CJH',
      frequency: '146.940 − PL 100.0',
      region: 'R2',
    });
    expect(row).toMatchObject({
      function: 'Net',
      name: 'County ARES Net',
      rxFreq: '146.940',
      txFreq: '146.340',
      txTone: '100.0',
      mode: 'A',
      remarks: 'NCS K0CJH · 146.940 − PL 100.0',
      source: 'net-control',
      // Same row shape as the other 205 sources: zone (filled by the panel's
      // zone picker), separate RX/TX N/W, mode name
      zone: '',
      rxNW: 'W',
      txNW: 'W',
      modeName: '',
    });
    const scheduled = ics205RowFromVoiceNet({
      net: 'DMR net',
      freqMhz: 441.0,
      mode: 'DMR',
      frequency: '441.000 MHz DMR',
    });
    expect(scheduled).toMatchObject({ rxFreq: '441.000', txFreq: '441.000', mode: 'D', modeName: 'DMR' });
    expect(ics205RowFromVoiceNet({ net: 'X', frequency: 'the usual' })).toMatchObject({ rxFreq: '', txFreq: '' });
    // 6 m in the Americas: the ARRL plan's −500 kHz in a segment with local exceptions, noted for checking
    expect(ics205RowFromVoiceNet({ net: '6m', frequency: '53.700 −', region: 'R2' })).toMatchObject({
      rxFreq: '53.700',
      txFreq: '53.200',
      remarks: 'TX offset −500 kHz assumed — check locally · 53.700 −',
    });
    // ...and in the segment without exceptions, no note
    expect(ics205RowFromVoiceNet({ net: '6m', frequency: '51.760 −', region: 'R2' })).toMatchObject({
      txFreq: '51.260',
      remarks: '51.760 −',
    });
    // direction without a known size: TX left for the operator, flagged and noted — never silently blank
    const unknown = ics205RowFromVoiceNet({ net: '6m', frequency: '50.840 −', region: 'R3' });
    expect(unknown).toMatchObject({ rxFreq: '50.840', txFreq: '', txUnknown: true });
    expect(unknown.remarks).toMatch(/^TX offset\? — fill in TX/);
    // the operator's override wins
    expect(ics205RowFromVoiceNet({ net: '6m', frequency: '53.150 −', region: 'R2', offset: '1' })).toMatchObject({
      txFreq: '52.150',
      remarks: '53.150 −',
    });
  });
});

describe('ICS 309 editable rows', () => {
  const drafts = () => {
    const d = defaultDrafts(T0);
    d.header.periodFrom = '2026-10-14T18:00';
    d.header.periodTo = '2026-10-14T19:00';
    d.ics309.operatorCall = 'K0CJH';
    return d;
  };

  it('starts as the event rows for the period', () => {
    const rows = ics309Rows(drafts(), LOG);
    expect(rows.map((r) => r.eventId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e7', 'e8', 'e9']); // default types
  });

  it('keeps edits per row while the log keeps updating', () => {
    const d = drafts();
    const [first] = ics309Rows(d, LOG);
    d.ics309 = editIcs309Row(d.ics309, first, { message: 'Checked in, 2 operators', toMsg: '17' });
    let rows = ics309Rows(d, LOG);
    expect(rows[0]).toMatchObject({ message: 'Checked in, 2 operators', toMsg: '17', edited: true, from: 'KE8PLM' });
    // A new event arrives — the edit survives and the new row appears
    const more = [...LOG, { id: 'n1', ts: T0 + 20 * 60_000, type: 'net_checkin', callsign: 'W1NEW', summary: 'In' }];
    rows = ics309Rows(d, more);
    expect(rows[0].message).toBe('Checked in, 2 operators');
    expect(rows[rows.length - 1].from).toBe('W1NEW');
  });

  it('edits the time and re-sorts', () => {
    const d = drafts();
    const rows0 = ics309Rows(d, LOG);
    d.ics309 = editIcs309Row(d.ics309, rows0[0], { dateTime: '2026-10-14T18:30' });
    const rows = ics309Rows(d, LOG);
    expect(rows[rows.length - 1]).toMatchObject({ eventId: 'e1', time: '1830' });
  });

  it('adds, edits and removes manual rows; hides event rows', () => {
    let d = drafts();
    const manual = newIcs309Row(T0 + 2 * 60_000, { from: 'N0EOC', to: 'K0CJH', toMsg: '9', message: 'Phone relay' });
    d.ics309 = { ...d.ics309, manual: [manual] };
    let rows = ics309Rows(d, LOG);
    expect(rows[1]).toMatchObject({ source: 'manual', time: '1802', message: 'Phone relay' });
    d.ics309 = editIcs309Row(d.ics309, rows[1], { message: 'Phone relay from EOC' });
    expect(d.ics309.manual[0].message).toBe('Phone relay from EOC');
    d.ics309 = removeIcs309Row(d.ics309, rows[0]); // hide e1
    rows = ics309Rows(d, LOG);
    expect(rows.map((r) => r.eventId || r.source)).not.toContain('e1');
    d.ics309 = removeIcs309Row(d.ics309, rows[0]); // the manual row
    expect(d.ics309.manual).toEqual([]);
  });

  it('applies the starting number before the operator’s edits', () => {
    const d = drafts();
    d.ics309.startNumber = '50';
    const rows = ics309Rows(d, LOG);
    expect(rows[0].toMsg).toBe('50');
    expect(rows[1].fromMsg).toBe('51');
  });

  it('prints edited rows and manual rows', () => {
    const d = drafts();
    d.ics309.manual = [newIcs309Row(T0 + 2 * 60_000, { from: 'N0EOC', message: 'Phone relay' })];
    const html = buildIcsHtml('309', d, { events: LOG, now: T0 });
    expect(html).toContain('Phone relay');
    expect(html).toContain('<td class="mono">2</td>'); // TO Msg # of the first check-in
  });
});

describe('print labels', () => {
  it('defaultTr interpolates the English text', () => {
    expect(defaultTr('x', { defaultValue: 'Page {{page}} of {{total}}', page: 2, total: 3 })).toBe('Page 2 of 3');
    expect(defaultTr('x', {})).toBe('');
  });

  it('every printed label key exists in en.json with the same English text', async () => {
    const en = (await import('../lang/en.json')).default;
    const used = new Map();
    const tr = (key, opts) => {
      used.set(key, opts.defaultValue);
      return defaultTr(key, opts);
    };
    const d = defaultDrafts(T0);
    for (const id of ['309', '214', '213', '205']) buildIcsHtml(id, d, { events: LOG, now: T0, tr });
    ics309Csv(d, [], { now: T0, tr });
    expect(used.size).toBeGreaterThan(50);
    for (const [key, def] of used) expect(en[key], key).toBe(def);
  });

  it('routes every label through the translate function with icsForms.print.* keys', () => {
    const seen = new Set();
    const tr = (key, opts) => {
      seen.add(key);
      return `«${defaultTr(key, opts)}»`;
    };
    const d = defaultDrafts(T0);
    d.ics205.rows = [newSimplexRow({ name: 'S1', mhz: 146.52 })];
    for (const id of ['309', '214', '213', '205']) {
      const html = buildIcsHtml(id, d, { events: LOG, now: T0, tr });
      // No label left untranslated: every bold label/section/header is wrapped
      const labels = [...html.matchAll(/<div class="ics-label">([^<]*)<\/div>/g)].map((m) => m[1]);
      for (const l of labels) if (l && l !== '8.' && !/^\d+\. «/.test(l)) expect(l).toMatch(/^«.*»$/);
      const ths = [...html.matchAll(/<th[^>]*>([^<]*)/g)].map((m) => m[1].trim()).filter(Boolean);
      for (const h of ths) expect(h).toMatch(/^«/);
    }
    expect([...seen].every((k) => k.startsWith('icsForms.print.'))).toBe(true);
    expect(seen.has('icsForms.print.309.b1')).toBe(true);
    expect(seen.has('icsForms.print.205.channelName')).toBe(true);
    expect(seen.has('icsForms.print.pageOf')).toBe(true);
    const csv = ics309Csv(d, [], { now: T0, tr });
    expect(csv.startsWith('«Form»,«ICS 309 Communications Log»')).toBe(true);
  });
});

describe('ICS 213 per-part send state', () => {
  const parts = ['1/3 a', '2/3 b', '3/3 c'];

  it('tracks a partial failure and resumes from the first unsent part', () => {
    let st = newSendState('n0eoc', parts, T0);
    expect(st.to).toBe('N0EOC');
    expect(firstUnsentPart(st)).toBe(0);
    st = applySendResult(st, 0, { sent: 1, total: 3, error: 'TNC not connected' });
    expect(st.parts.map((p) => p.state)).toEqual(['sent', 'failed', 'pending']);
    expect(st.parts[1].error).toBe('TNC not connected');
    expect(firstUnsentPart(st)).toBe(1);
    st = applySendResult(st, 1, { sent: 2, total: 2 });
    expect(st.parts.map((p) => p.state)).toEqual(['sent', 'sent', 'sent']);
    expect(st.parts[1].error).toBeUndefined();
    expect(firstUnsentPart(st)).toBe(-1);
  });

  it('matches only the same addressee and identical parts', () => {
    const st = newSendState('N0EOC', parts);
    expect(sendStateMatches(st, 'n0eoc', parts)).toBe(true);
    expect(sendStateMatches(st, 'W1AW', parts)).toBe(false);
    expect(sendStateMatches(st, 'N0EOC', ['1/3 a', '2/3 b', '3/3 X'])).toBe(false);
    expect(sendStateMatches(null, 'N0EOC', parts)).toBe(false);
  });
});

describe('ICS 205 zones', () => {
  it('lists zones in order and groups rows stably, blank zone last', () => {
    const rows = [
      { id: 1, zone: 'B' },
      { id: 2, zone: '' },
      { id: 3, zone: 'A' },
      { id: 4, zone: 'B' },
      { id: 5, zone: 'A' },
    ];
    expect(zonesOf(rows)).toEqual(['B', 'A']);
    expect(groupRowsByZone(rows).map((r) => r.id)).toEqual([1, 4, 3, 5, 2]);
  });

  it('prints RX and TX bandwidth independently', () => {
    const d = defaultDrafts(T0);
    d.ics205.rows = [{ ...newSimplexRow({ mhz: 146.52 }), rxNW: 'N', txNW: 'W' }];
    const html = buildIcs205Html(d, { now: T0 });
    expect(html).toContain('146.520 N</td>');
    expect(html).toContain('146.520 W</td>');
  });
});

describe('draft migration', () => {
  const withoutTraffic = ICS309_DEFAULT_TYPES.filter((t) => t !== 'net_traffic');
  it('ticks net_traffic once in drafts saved before versioning', () => {
    const migrated = mergeDrafts({ ics309: { types: withoutTraffic } }, T0);
    expect(migrated.version).toBe(DRAFTS_VERSION);
    expect(migrated.ics309.types).toContain('net_traffic');
    // ...and an operator's other choices are left alone
    expect(mergeDrafts({ ics309: { types: ['aprs_msg_sent'] } }, T0).ics309.types).toEqual([
      'aprs_msg_sent',
      'net_traffic',
      'net_removed',
    ]);
  });
  it('does not re-tick it once the draft is current (the operator unticked it on purpose)', () => {
    const current = mergeDrafts({ version: DRAFTS_VERSION, ics309: { types: withoutTraffic } }, T0);
    expect(current.ics309.types).not.toContain('net_traffic');
  });
  it('survives a save/load round trip without migrating twice', () => {
    const once = mergeDrafts({ ics309: { types: ['aprs_msg_rx'] } }, T0);
    once.ics309.types = once.ics309.types.filter((t) => t !== 'net_traffic' && t !== 'net_removed');
    saveDrafts(once);
    expect(loadDrafts(T0).ics309.types).toEqual(['aprs_msg_rx']);
  });
  it('migrateIcs309Types is pure and tolerates bad input', () => {
    const src = ['net_checkin'];
    expect(migrateIcs309Types(src, 1)).toEqual(['net_checkin', 'net_traffic', 'net_removed']);
    expect(src).toEqual(['net_checkin']);
    expect(migrateIcs309Types(['net_traffic'], 1)).toEqual(['net_traffic', 'net_removed']);
    // v2 drafts only gain the roster-removal type (#1238)
    expect(migrateIcs309Types(['aprs_msg_rx'], 2)).toEqual(['aprs_msg_rx', 'net_removed']);
    expect(migrateIcs309Types(['aprs_msg_rx'], 3)).toEqual(['aprs_msg_rx']);
    expect(migrateIcs309Types(null, 1)).toBeNull();
    expect(defaultDrafts(T0).version).toBe(DRAFTS_VERSION);
  });
});
