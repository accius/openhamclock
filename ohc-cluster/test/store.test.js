const { test } = require('node:test');
const assert = require('node:assert');

const { SpotStore } = require('../lib/store.js');

const skimmerSpot = (over = {}) => ({
  spotter: 'KM3T-#',
  call: 'W1AW',
  freqKhz: 14025.1,
  mode: 'CW',
  snr: 20,
  comment: 'CW 20 dB 22 WPM CQ',
  timestamp: Date.now(),
  source: 'RBN',
  isSkimmer: true,
  ...over,
});

const humanSpot = (over = {}) => ({
  spotter: 'K0CJH',
  call: 'TX5U',
  freqKhz: 18070,
  comment: 'up 2',
  timestamp: Date.now(),
  source: 'OHC',
  isSkimmer: false,
  ...over,
});

test('skimmer spots collapse by call+band+mode', () => {
  const store = new SpotStore();
  store.add(skimmerSpot({ spotter: 'KM3T-#', snr: 20 }));
  store.add(skimmerSpot({ spotter: 'W3OA-#', snr: 31, comment: 'CW 31 dB 22 WPM CQ' }));
  store.add(skimmerSpot({ spotter: 'DL8LAS-#', snr: 12 }));

  const spots = store.query({ limit: 10 });
  assert.equal(spots.length, 1);
  assert.equal(spots[0].skimmerCount, 3);
  assert.equal(spots[0].snr, 31); // best report wins
  assert.equal(spots[0].comment, 'CW 31 dB 22 WPM CQ');
});

test('same call on different bands stays separate', () => {
  const store = new SpotStore();
  store.add(skimmerSpot({ freqKhz: 14025 }));
  store.add(skimmerSpot({ freqKhz: 7025 }));
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('human spots dedupe by spotter+call+freq window', () => {
  const store = new SpotStore();
  const ts = Date.now();
  assert.ok(store.add(humanSpot({ timestamp: ts })));
  assert.equal(store.add(humanSpot({ timestamp: ts + 1000 })), null); // dupe
  assert.ok(store.add(humanSpot({ spotter: 'W1AW', timestamp: ts }))); // different spotter is fine
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('listeners fire for new spots, not skimmer refreshes', () => {
  const store = new SpotStore();
  let fired = 0;
  store.onSpot(() => fired++);
  store.add(skimmerSpot({ spotter: 'A1AA-#' }));
  store.add(skimmerSpot({ spotter: 'B2BB-#' })); // collapse, no re-fire
  store.add(humanSpot());
  assert.equal(fired, 2);
});

test('query filters by humanOnly, band, mode', () => {
  const store = new SpotStore();
  store.add(skimmerSpot());
  store.add(humanSpot());
  assert.equal(store.query({ humanOnly: true }).length, 1);
  assert.equal(store.query({ humanOnly: true })[0].call, 'TX5U');
  assert.equal(store.query({ band: '20m' }).length, 1);
  assert.equal(store.query({ mode: 'CW' }).length, 1);
});

test('cleanup drops expired spots and their skimmer index entries', () => {
  const store = new SpotStore({ retentionMs: 1000 });
  store.add(skimmerSpot({ timestamp: Date.now() - 5000 }));
  store.add(humanSpot());
  assert.equal(store.cleanup(), 1);
  assert.equal(store.query({ limit: 10 }).length, 1);
  // The skimmer key must be gone so the same station can be spotted fresh
  store.add(skimmerSpot());
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('store caps total spots and evicts oldest', () => {
  const store = new SpotStore({ maxSpots: 5 });
  for (let i = 0; i < 10; i++) {
    store.add(humanSpot({ call: `W${i}AW`, spotter: `K${i}AB`, freqKhz: 14000 + i }));
  }
  assert.equal(store.query({ limit: 100 }).length, 5);
});

test('default query reserves a slice for human spots under FT8 flood', () => {
  const store = new SpotStore();
  const ts = Date.now();
  // Humans arrive first, then a flood of newer FT8 aggregates
  for (let i = 0; i < 5; i++) {
    store.add(humanSpot({ call: `HU${i}MAN`, spotter: `K${i}HS`, freqKhz: 14200 + i, timestamp: ts - 60000 }));
  }
  for (let i = 0; i < 60; i++) {
    store.add(skimmerSpot({ call: `K${i}FT`, freqKhz: 14074, mode: 'FT8', timestamp: ts }));
  }

  const spots = store.query({ limit: 20 });
  assert.equal(spots.length, 20);
  const humans = spots.filter((s) => s.skimmerCount === 0);
  assert.equal(humans.length, 5); // all humans fit inside the ceil(20 * 0.25) reserve
});

test('default query caps FT8/FT4 share when other modes are active', () => {
  const store = new SpotStore();
  const ts = Date.now();
  for (let i = 0; i < 40; i++) {
    store.add(skimmerSpot({ call: `K${i}FT`, freqKhz: 14074, mode: 'FT8', timestamp: ts }));
    store.add(skimmerSpot({ call: `C${i}W`, freqKhz: 14025, mode: 'CW', timestamp: ts - 1 }));
  }

  const spots = store.query({ limit: 20 });
  assert.equal(spots.length, 20);
  const ft8 = spots.filter((s) => s.mode === 'FT8' || s.mode === 'FT4');
  assert.ok(ft8.length <= 10, `FT8/FT4 took ${ft8.length} of 20`); // ceil(20 * 0.5)
  assert.ok(spots.filter((s) => s.mode === 'CW').length >= 10);
});

test('default query backfills with FT8 when nothing else is on the air', () => {
  const store = new SpotStore();
  for (let i = 0; i < 30; i++) {
    store.add(skimmerSpot({ call: `K${i}FT`, freqKhz: 14074, mode: 'FT8' }));
  }
  assert.equal(store.query({ limit: 20 }).length, 20);
});

test('explicit mode query is an exact slice, not balanced', () => {
  const store = new SpotStore();
  for (let i = 0; i < 15; i++) {
    store.add(skimmerSpot({ call: `K${i}FT`, freqKhz: 14074, mode: 'FT8' }));
  }
  store.add(skimmerSpot({ call: 'C1W', freqKhz: 14025, mode: 'CW' }));
  const spots = store.query({ limit: 10, mode: 'FT8' });
  assert.equal(spots.length, 10);
  assert.ok(spots.every((s) => s.mode === 'FT8'));
});

test('a refreshed skimmer aggregate ranks by activity, not insertion order', () => {
  const store = new SpotStore();
  const ts = Date.now();
  store.add(skimmerSpot({ call: 'OL1DCW', freqKhz: 14025, mode: 'CW', timestamp: ts - 60000 }));
  for (let i = 0; i < 50; i++) {
    store.add(skimmerSpot({ call: `K${i}FT`, freqKhz: 14074, mode: 'FT8', timestamp: ts - 30000 }));
  }
  // The CW station is still being heard — refresh updates it in place
  store.add(skimmerSpot({ call: 'OL1DCW', spotter: 'W3OA-#', freqKhz: 14025, mode: 'CW', timestamp: ts }));

  const spots = store.query({ limit: 10 });
  assert.equal(spots[0].call, 'OL1DCW'); // freshest activity leads despite oldest insertion
});

test('rejects spots with missing or invalid fields', () => {
  const store = new SpotStore();
  assert.equal(store.add({ spotter: '', call: 'W1AW', freqKhz: 14000 }), null);
  assert.equal(store.add({ spotter: 'K0CJH', call: 'W1AW', freqKhz: -5 }), null);
  assert.equal(store.add({ spotter: 'K0CJH', call: '', freqKhz: 14000 }), null);
});

test('busted-call filter drops implausible spotted calls and counts them', () => {
  const store = new SpotStore();
  assert.equal(store.add(humanSpot({ call: 'NATZR' })), null); // dropped digit
  assert.equal(store.add(skimmerSpot({ call: 'TM113TDFBK' })), null); // CW BK bust
  assert.equal(store.add(humanSpot({ call: 'CQ', spotter: 'W1AW' })), null);
  assert.ok(store.add(humanSpot({ call: 'YR50NADIA', spotter: 'K2ABC' }))); // special event survives
  const stats = store.stats();
  assert.equal(stats.busted, 3);
  assert.equal(stats.activeSpots, 1);
});
