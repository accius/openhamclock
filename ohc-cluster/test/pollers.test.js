const { test } = require('node:test');
const assert = require('node:assert');

const {
  JsonPoller,
  parsePotaSpots,
  parseSotaSpots,
  parseDxSummitSpots,
  parseDxSpiderSpots,
  parseWwffSpots,
  parsePnpSpots,
  latLonToGrid6,
} = require('../lib/pollers.js');
const { SpotStore } = require('../lib/store.js');

// Fixtures mirror real API responses captured 2026-07-09
const POTA_ROW = {
  spotId: 53252827,
  activator: 'KD8IE',
  frequency: '14278.0',
  mode: 'SSB',
  reference: 'US-1942',
  spotTime: '2026-07-09T23:12:58',
  spotter: 'KE8AFJ',
  comments: '5/8 VA',
  invalid: null,
  grid6: 'EN91em',
};

const SOTA_ROW = {
  id: 345544,
  timeStamp: '2026-07-09T23:13:29',
  comments: 'Matariki',
  callsign: 'ZL1BYZ',
  associationCode: 'ZL1',
  summitCode: 'AK-027',
  activatorCallsign: 'ZL1BYZ',
  frequency: '28.062',
  mode: 'CW',
};

const DXSUMMIT_ROW = {
  info: 'FT8 GG66sj -> GG54',
  de_call: 'PY2DN',
  frequency: 144174.0,
  time: '2026-07-09T23:14:42',
  dx_call: 'PY5CC',
  id: 67424269,
};

const SPIDER_ROW = {
  spotter: 'PU2LQX',
  freq: '21.074',
  call: 'KA1MXL',
  comment: 'FT8, TNX QSO, 73s',
  time: '23:14z',
  mode: 'FT8',
};

test('parsePotaSpots: maps kHz, mode, grid, and skips RBN reposts', () => {
  const rows = parsePotaSpots([
    POTA_ROW,
    { ...POTA_ROW, spotId: 1, spotter: 'DR4W-#' }, // RBN repost — skip
    { ...POTA_ROW, spotId: 2, invalid: true }, // withdrawn — skip
  ]);
  assert.equal(rows.length, 1);
  const { key, spot } = rows[0];
  assert.equal(key, 'pota|53252827');
  assert.equal(spot.call, 'KD8IE');
  assert.equal(spot.freqKhz, 14278);
  assert.equal(spot.mode, 'SSB');
  assert.equal(spot.dxGrid, 'EN91em');
  assert.equal(spot.comment, 'POTA US-1942 5/8 VA');
  assert.equal(spot.timestamp, Date.parse('2026-07-09T23:12:58Z'));
  assert.equal(spot.isSkimmer, false);
});

test('parseSotaSpots: converts MHz to kHz and builds the summit reference', () => {
  const rows = parseSotaSpots([SOTA_ROW]);
  assert.equal(rows.length, 1);
  const { key, spot } = rows[0];
  assert.equal(key, 'sota|345544');
  assert.equal(spot.freqKhz, 28062);
  assert.equal(spot.mode, 'CW');
  assert.equal(spot.comment, 'SOTA ZL1/AK-027 Matariki');
  assert.equal(spot.source, 'SOTA');
});

test('parseDxSummitSpots: maps fields, leaves mode null for inference', () => {
  const rows = parseDxSummitSpots([DXSUMMIT_ROW, { ...DXSUMMIT_ROW, id: 2, dx_call: '' }]);
  assert.equal(rows.length, 1);
  const { spot } = rows[0];
  assert.equal(spot.spotter, 'PY2DN');
  assert.equal(spot.call, 'PY5CC');
  assert.equal(spot.freqKhz, 144174);
  assert.equal(spot.mode, null);
  assert.equal(spot.comment, 'FT8 GG66sj -> GG54');
});

test('parseDxSpiderSpots: MHz to kHz, composite key covers the missing date', () => {
  const rows = parseDxSpiderSpots([SPIDER_ROW]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'spider|PU2LQX|KA1MXL|21074|23:14z');
  assert.equal(rows[0].spot.freqKhz, 21074);
  assert.equal(rows[0].spot.mode, 'FT8');
});

// Fixtures mirror real API responses captured 2026-07-10
const WWFF_ROW = {
  id: 118726,
  activator: 'KO4FX',
  frequency_khz: 14240,
  mode: 'SSB',
  reference: 'KFF-7436',
  remarks: '',
  spotter: 'KO4FX',
  latitude: 36.1538,
  longitude: -86.6212,
  spot_time: 1783647417,
};

const PNP_ROW = {
  actTime: '2026-07-10 03:52:18',
  actID: '2773693',
  actSiteID: 'VKFF-1331',
  actCallsign: 'VK2USH',
  actMode: 'SSB',
  actFreq: '14.310',
  actClass: 'WWFF',
  actComments: '',
  actSpoter: 'VK2USH',
};

test('parseWwffSpots: kHz passthrough, park coords become a grid square', () => {
  const rows = parseWwffSpots([WWFF_ROW]);
  assert.equal(rows.length, 1);
  const { key, spot } = rows[0];
  assert.equal(key, 'wwff|118726');
  assert.equal(spot.call, 'KO4FX');
  assert.equal(spot.freqKhz, 14240);
  assert.equal(spot.mode, 'SSB');
  assert.equal(spot.comment, 'WWFF KFF-7436');
  assert.equal(spot.dxGrid, 'EM66qd'); // Percy Priest, Tennessee
  assert.equal(spot.timestamp, 1783647417000); // epoch seconds -> ms
  assert.equal(spot.source, 'WWFF');
});

test('parsePnpSpots: MHz to kHz, program tag in comment, API spotter typo handled', () => {
  const rows = parsePnpSpots([PNP_ROW, { ...PNP_ROW, actID: '2', actCallsign: '' }]);
  assert.equal(rows.length, 1);
  const { key, spot } = rows[0];
  assert.equal(key, 'pnp|2773693');
  assert.equal(spot.call, 'VK2USH');
  assert.equal(spot.spotter, 'VK2USH');
  assert.equal(spot.freqKhz, 14310);
  assert.equal(spot.mode, 'SSB');
  assert.equal(spot.comment, 'WWFF VKFF-1331');
  assert.equal(spot.timestamp, Date.parse('2026-07-10T03:52:18Z'));
});

test('latLonToGrid6: known references and invalid input', () => {
  assert.equal(latLonToGrid6(36.1538, -86.6212), 'EM66qd');
  assert.equal(latLonToGrid6(51.4779, -0.0015), 'IO91xl'); // Greenwich, just west of the meridian
  assert.equal(latLonToGrid6(999, 0), null);
  assert.equal(latLonToGrid6(NaN, 10), null);
});

test('JsonPoller.ingest: seen-set drops repeats across polls', () => {
  const store = new SpotStore();
  const poller = new JsonPoller({
    name: 'test',
    url: 'http://unused',
    parse: (x) => x,
    store,
    log: () => {},
  });

  const rows = parsePotaSpots([POTA_ROW]);
  assert.equal(poller.ingest(rows), 1);
  assert.equal(poller.ingest(rows), 0); // same poll payload again — all seen
  assert.equal(store.stats().activeSpots, 1);
});

test('JsonPoller.ingest: distinct spots from the same source all land', () => {
  const store = new SpotStore();
  const poller = new JsonPoller({
    name: 'test',
    url: 'http://unused',
    parse: (x) => x,
    store,
    log: () => {},
  });
  const rows = parsePotaSpots([
    POTA_ROW,
    { ...POTA_ROW, spotId: 99, activator: 'W1AW', frequency: '7200.0', spotter: 'K1ABC' },
  ]);
  assert.equal(poller.ingest(rows), 2);
});
