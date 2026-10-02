import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logbookStore from '../services/logbookStore.js';
import { isBackupSettingsKey } from './backup.js';
import {
  __resetLogsyncForTests,
  buildAdifRecord,
  enqueue,
  getPendingCount,
  getQueue,
  lotwCooldownRemainingMs,
  matchLotwConfirmations,
  onQsoLogged,
  processQueue,
  qsoTimestamp,
  QUEUE_CAP,
  QUEUE_KEY,
  syncLotwConfirmations,
  syncWavelogQsos,
} from './logsync.js';
import { getLogsyncConfig, getLogsyncState, LOGSYNC_STATE_KEY, setLogsyncServiceConfig } from './logsyncConfig.js';

const qso = (over = {}) => ({
  id: over.id || 'q1',
  call: 'DL1ABC',
  qso_date: '20260815',
  time_on: '1200',
  band: '20m',
  mode: 'SSB',
  extras: {},
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  __resetLogsyncForTests();
  logbookStore.__resetLogbookForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── ADIF single-record building ────────────────────────────────────────────

describe('buildAdifRecord', () => {
  it('builds a headerless single record ending in <eor>', () => {
    const rec = buildAdifRecord(qso(), { myCall: 'K0CJH' });
    expect(rec).not.toMatch(/<eoh>/i);
    expect(rec).not.toMatch(/adif_ver/i);
    expect(rec).toContain('<call:6>DL1ABC');
    expect(rec).toContain('<band:3>20m');
    expect(rec).toContain('<STATION_CALLSIGN:5>K0CJH');
    expect(rec.trim().endsWith('<eor>')).toBe(true);
  });

  it('round-trips through parseAdif field emission (reuses buildAdif)', () => {
    const rec = buildAdifRecord(qso({ freq: 14.074, mode: 'FT8' }));
    expect(rec).toContain('<mode:3>FT8');
    expect(rec).toContain('<freq:6>14.074');
  });
});

// ── Timestamps ─────────────────────────────────────────────────────────────

describe('qsoTimestamp', () => {
  it('parses HHMM and HHMMSS times as UTC', () => {
    expect(qsoTimestamp({ qso_date: '20260815', time_on: '1200' })).toBe(Date.UTC(2026, 7, 15, 12, 0, 0));
    expect(qsoTimestamp({ qso_date: '20260815', time_on: '120030' })).toBe(Date.UTC(2026, 7, 15, 12, 0, 30));
  });

  it('returns NaN for malformed values', () => {
    expect(qsoTimestamp({ qso_date: '2026', time_on: '1200' })).toBeNaN();
    expect(qsoTimestamp({ qso_date: '20260815', time_on: '' })).toBeNaN();
    expect(qsoTimestamp({})).toBeNaN();
  });
});

// ── LoTW confirmation matching ─────────────────────────────────────────────

describe('matchLotwConfirmations', () => {
  const lotwRec = (over = {}) => ({
    call: 'DL1ABC',
    qso_date: '20260815',
    time_on: '1210',
    band: '20m',
    mode: 'SSB',
    extras: { QSL_RCVD: 'Y', QSLRDATE: '2026-08-20' },
    ...over,
  });

  it('matches call + band + mode within ±30 minutes and merges extras', () => {
    const local = qso({ extras: { MY_SOTA_REF: 'W0C/FR-001' } });
    const { updates, matched, unmatched } = matchLotwConfirmations([lotwRec()], [local]);
    expect(matched).toBe(1);
    expect(unmatched).toHaveLength(0);
    expect(updates[0].id).toBe('q1');
    expect(updates[0].extras.LOTW_QSL_RCVD).toBe('Y');
    expect(updates[0].extras.LOTW_QSLRDATE).toBe('20260820');
    expect(updates[0].extras.MY_SOTA_REF).toBe('W0C/FR-001'); // existing extras preserved
  });

  it('rejects matches outside the ±30 minute window', () => {
    const { matched, unmatched } = matchLotwConfirmations([lotwRec({ time_on: '1231' })], [qso()]);
    // 1231 vs 1200 = 31 min
    expect(matched).toBe(0);
    expect(unmatched).toHaveLength(1);
  });

  it('rejects a band or call mismatch', () => {
    expect(matchLotwConfirmations([lotwRec({ band: '40m' })], [qso()]).matched).toBe(0);
    expect(matchLotwConfirmations([lotwRec({ call: 'DL1XYZ' })], [qso()]).matched).toBe(0);
  });

  it('treats LoTW MODE=MFSK/SUBMODE=FT4 as compatible with local mode FT4', () => {
    const local = qso({ mode: 'FT4' });
    const rec = lotwRec({ mode: 'MFSK', submode: 'FT4' });
    expect(matchLotwConfirmations([rec], [local]).matched).toBe(1);
  });

  it('prefers the closest-in-time candidate and claims each QSO once', () => {
    const a = qso({ id: 'a', time_on: '1150' }); // 20 min off
    const b = qso({ id: 'b', time_on: '1205' }); // 5 min off
    const { updates } = matchLotwConfirmations([lotwRec(), lotwRec()], [a, b]);
    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b']); // second QSL falls back to 'a'
    expect(updates[0].id).toBe('b'); // closest claimed first
  });

  it('skips records that are not confirmed QSLs', () => {
    const rec = lotwRec({ extras: { QSL_RCVD: 'N' } });
    expect(matchLotwConfirmations([rec], [qso()]).matched).toBe(0);
  });
});

// ── Retry queue ────────────────────────────────────────────────────────────

describe('retry queue', () => {
  it('enqueues per service without duplicates', () => {
    enqueue('wavelog', 'q1');
    enqueue('wavelog', 'q1');
    enqueue('qrz', 'q1');
    expect(getPendingCount()).toBe(2);
    expect(getPendingCount('wavelog')).toBe(1);
    expect(getPendingCount('qrz')).toBe(1);
  });

  it('caps the queue at 100 entries, dropping the oldest', () => {
    for (let i = 0; i < QUEUE_CAP + 10; i++) enqueue('wavelog', `q${i}`);
    const queue = getQueue();
    expect(queue).toHaveLength(QUEUE_CAP);
    expect(queue[0].qsoId).toBe('q10'); // oldest 10 dropped
    expect(queue[queue.length - 1].qsoId).toBe(`q${QUEUE_CAP + 9}`);
  });

  it('onQsoLogged queues only for enabled+configured services', async () => {
    setLogsyncServiceConfig('wavelog', { enabled: true, url: 'https://log.example.com', apiKey: 'k' });
    setLogsyncServiceConfig('qrz', { enabled: true }); // no key → not ready
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const saved = await logbookStore.add(qso());
    onQsoLogged(saved);
    expect(getPendingCount('wavelog')).toBe(1);
    expect(getPendingCount('qrz')).toBe(0);
    // let the fire-and-forget background drain settle before the next test
    await new Promise((r) => setTimeout(r, 20));
  });

  it('processQueue pushes queued QSOs, removes them on success, and spaces pushes 1/sec', async () => {
    vi.useFakeTimers();
    setLogsyncServiceConfig('wavelog', { enabled: true, url: 'https://log.example.com', apiKey: 'k' });
    await logbookStore.add(qso({ id: 'q1' }));
    await logbookStore.add(qso({ id: 'q2', call: 'F4XYZ' }));
    enqueue('wavelog', 'q1');
    enqueue('wavelog', 'q2');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const p = processQueue();
    await vi.advanceTimersByTimeAsync(3000);
    const { pushed, failed } = await p;

    expect(pushed).toBe(2);
    expect(failed).toBe(0);
    expect(getPendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/logsync/wavelog');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key).toBe('k');
    expect(body.adif).toContain('<call:6>DL1ABC');
    expect(getLogsyncState().wavelogLastPushAt).toBeTruthy();
  });

  it('keeps failed pushes queued (attempts++) and stops hammering a down service', async () => {
    vi.useFakeTimers();
    setLogsyncServiceConfig('wavelog', { enabled: true, url: 'https://log.example.com', apiKey: 'k' });
    await logbookStore.add(qso({ id: 'q1' }));
    await logbookStore.add(qso({ id: 'q2', call: 'F4XYZ' }));
    enqueue('wavelog', 'q1');
    enqueue('wavelog', 'q2');

    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);

    const p = processQueue();
    await vi.advanceTimersByTimeAsync(3000);
    const { pushed, failed } = await p;

    expect(pushed).toBe(0);
    expect(failed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // service marked down after first failure
    expect(getPendingCount('wavelog')).toBe(2);
    expect(getQueue()[0].attempts).toBe(1);
  });

  it('drops queue entries whose QSO was deleted', async () => {
    setLogsyncServiceConfig('wavelog', { enabled: true, url: 'https://log.example.com', apiKey: 'k' });
    await logbookStore.init();
    enqueue('wavelog', 'ghost');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await processQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPendingCount()).toBe(0);
  });
});

// ── Wavelog pull sync ──────────────────────────────────────────────────────

describe('Wavelog pull sync', () => {
  it('imports returned ADIF and advances the QSO cursor', async () => {
    setLogsyncServiceConfig('wavelog', {
      enabled: true,
      url: 'http://wavelog.test/index.php',
      apiKey: 'secret',
      pullEnabled: true,
      pullStationIds: [1, 2, 3],
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        lastFetchedId: 42,
        exportedQsos: 1,
        adif: 'stub-adif',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const parsedQso = qso({ id: undefined, call: 'W1AW' });
    const parseAdif = vi.fn().mockReturnValue({ qsos: [parsedQso] });

    const result = await syncWavelogQsos({ parseAdif });

    expect(parseAdif).toHaveBeenCalledWith('stub-adif');
    expect(result.imported).toBe(1);
    expect(result.fetched).toBe(1);
    expect(result.lastFetchedId).toBe(42);
    expect(logbookStore.getAll()).toHaveLength(1);
    expect(logbookStore.getAll()[0].call).toBe('W1AW');

    const state = getLogsyncState();
    expect(state.wavelogLastFetchedId).toBe(42);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/logsync/wavelog/pull');
    const body = JSON.parse(opts.body);
    expect(body.stationIds).toEqual([1, 2, 3]);
    expect(body.fetchFromId).toBe(0);
  });

  it('posts grid-bearing pulled QSOs to the QSO map layer', async () => {
    setLogsyncServiceConfig('wavelog', {
      enabled: true,
      url: 'http://wavelog.test/index.php',
      apiKey: 'secret',
      pullEnabled: true,
      pullStationIds: [1],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          lastFetchedId: 42,
          exportedQsos: 1,
          adif: 'stub-adif',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    vi.stubGlobal('fetch', fetchMock);

    await syncWavelogQsos({
      parseAdif: () => ({
        qsos: [
          qso({
            id: undefined,
            call: 'W1AW',
            gridsquare: 'FN31',
            qso_date: '2026-10-02',
            time_on: '12:34:56',
            band: '20m',
            mode: 'SSB',
            freq: '14.250',
          }),
        ],
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/qso-layer');

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.qsos).toHaveLength(1);
    expect(body.qsos[0]).toMatchObject({
      call: 'W1AW',
      grid: 'FN31',
      band: '20m',
      mode: 'SSB',
      label: 'Wavelog',
    });
  });

  it('still advances the cursor when only the map-layer update fails', async () => {
    setLogsyncServiceConfig('wavelog', {
      enabled: true,
      url: 'http://wavelog.test/index.php',
      apiKey: 'secret',
      pullEnabled: true,
      pullStationIds: [1],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          lastFetchedId: 77,
          exportedQsos: 1,
          adif: 'stub-adif',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'map unavailable' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await syncWavelogQsos({
      parseAdif: () => ({
        qsos: [
          qso({
            id: undefined,
            call: 'K1ABC',
            gridsquare: 'EM73',
          }),
        ],
      }),
    });

    expect(result.imported).toBe(1);
    expect(result.lastFetchedId).toBe(77);
    expect(getLogsyncState().wavelogLastFetchedId).toBe(77);
    expect(logbookStore.getAll()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('does not advance the cursor when the strict logbook import fails', async () => {
    setLogsyncServiceConfig('wavelog', {
      enabled: true,
      url: 'http://wavelog.test/index.php',
      apiKey: 'secret',
      pullEnabled: true,
      pullStationIds: [1],
    });

    localStorage.setItem(LOGSYNC_STATE_KEY, JSON.stringify({ wavelogLastFetchedId: 10 }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          lastFetchedId: 11,
          exportedQsos: 1,
          adif: 'stub-adif',
        }),
      }),
    );

    const addMany = vi.spyOn(logbookStore, 'addMany').mockRejectedValue(new Error('disk write failed'));

    await expect(
      syncWavelogQsos({
        parseAdif: () => ({ qsos: [qso({ call: 'W1AW' })] }),
      }),
    ).rejects.toThrow('disk write failed');

    expect(addMany).toHaveBeenCalledWith(expect.any(Array), { strict: true });
    expect(getLogsyncState().wavelogLastFetchedId).toBe(10);
  });
});

// ── LoTW cooldown + sync ───────────────────────────────────────────────────

describe('LoTW sync', () => {
  it('enforces a 5-minute cooldown between syncs', async () => {
    expect(lotwCooldownRemainingMs()).toBe(0);
    localStorage.setItem(LOGSYNC_STATE_KEY, JSON.stringify({ lotwLastAttemptAt: Date.now() }));
    expect(lotwCooldownRemainingMs()).toBeGreaterThan(4 * 60 * 1000);
    await expect(syncLotwConfirmations({ parseAdif: () => ({ qsos: [] }) })).rejects.toThrow(/cooldown/i);
  });

  it('pulls the report, applies matches to the store, and records the result', async () => {
    setLogsyncServiceConfig('lotw', { enabled: true, username: 'k0cjh', password: 'pw' });
    await logbookStore.add(qso({ id: 'q1' }));

    const adifText = 'stub';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => adifText }));
    const parseAdif = vi.fn().mockReturnValue({
      qsos: [
        {
          call: 'DL1ABC',
          qso_date: '20260815',
          time_on: '1205',
          band: '20m',
          mode: 'SSB',
          extras: { QSL_RCVD: 'Y', QSLRDATE: '2026-08-20' },
        },
      ],
    });

    const result = await syncLotwConfirmations({ parseAdif });
    expect(parseAdif).toHaveBeenCalledWith(adifText);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(0);

    const stored = logbookStore.getAll().find((q) => q.id === 'q1');
    expect(stored.extras.LOTW_QSL_RCVD).toBe('Y');
    expect(stored.extras.LOTW_QSLRDATE).toBe('20260820');

    const state = getLogsyncState();
    expect(state.lotwLastResult.matched).toBe(1);
    expect(state.lotwQslSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sends credentials as a header, never in the URL', async () => {
    setLogsyncServiceConfig('lotw', { enabled: true, username: 'k0cjh', password: 'secret' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await syncLotwConfirmations({ parseAdif: () => ({ qsos: [] }) });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).not.toContain('secret');
    expect(opts.headers['X-LoTW-Auth']).toBeTruthy();
  });
});

// ── Credential exclusion from backups ──────────────────────────────────────

describe('backup exclusion', () => {
  it('never includes log-sync credentials or the retry queue in a backup', () => {
    expect(isBackupSettingsKey('ohc-logsync-auth')).toBe(false);
    expect(isBackupSettingsKey(QUEUE_KEY)).toBe(false);
  });

  it('does include the non-secret sync state so the LoTW cursor survives a restore', () => {
    expect(isBackupSettingsKey(LOGSYNC_STATE_KEY)).toBe(true);
  });

  it('stores credentials under the browser-private dash prefix', () => {
    setLogsyncServiceConfig('qrz', { enabled: true, apiKey: 'sekrit' });
    expect(localStorage.getItem('ohc-logsync-auth')).toContain('sekrit');
    expect(getLogsyncConfig().qrz.apiKey).toBe('sekrit');
  });
});
