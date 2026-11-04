/**
 * fldigi plugin — driven against an in-memory fake of fldigi's XML-RPC
 * interface (no socket), a fake flmsg watcher, and a captured server POST.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import EventEmitter from 'events';
import http from 'http';
import plugin from './fldigi.js';
import fmt from '../lib/flmsg-format.js';
import xr from '../lib/xmlrpc-client.js';

const { unwrapFlmsg, parseFlmsg, fieldsToFriendly } = fmt;

/** A tiny fldigi: just the XML-RPC methods the plugin uses. */
function fakeFldigi() {
  const f = {
    up: true,
    freq: 7070000,
    modem: 'BPSK31',
    carrier: 1500,
    trx: 'rx',
    rx: '',
    tx: '',
    names: ['BPSK31', 'MT63-2KL', 'OLIVIA-8-500', 'CW'],
    calls: [],
    noTextApi: false,
    async call(method, params = []) {
      f.calls.push(method);
      if (!f.up) throw new Error('connect ECONNREFUSED 127.0.0.1:7362');
      const fault = () => Object.assign(new Error('fault'), { faultCode: 1, faultString: 'no such method' });
      switch (method) {
        case 'fldigi.version':
          return '4.2.05';
        case 'modem.get_names':
          return f.names;
        case 'main.get_frequency':
          return f.freq;
        case 'modem.get_name':
          return f.modem;
        case 'modem.get_carrier':
          return f.carrier;
        case 'main.get_trx_status':
          return f.trx;
        case 'text.get_rx_length':
          if (f.noTextApi) throw fault();
          return Buffer.byteLength(f.rx);
        case 'text.get_rx':
          return Buffer.from(f.rx).subarray(params[0], params[0] + params[1]);
        case 'rx.get_data': {
          const out = Buffer.from(f.rx);
          f.rx = '';
          return out;
        }
        case 'modem.set_by_name': {
          const old = f.modem;
          f.modem = params[0];
          return old;
        }
        case 'text.add_tx':
          f.tx += params[0];
          return null;
        case 'main.tx':
          f.trx = 'tx';
          return null;
        case 'main.rx':
        case 'main.abort':
          f.trx = 'rx';
          return null;
        case 'text.clear_tx':
          f.tx = '';
          return null;
        default:
          throw fault();
      }
    },
  };
  return f;
}

function make(cfg = {}, { watcher, prefs } = {}) {
  const fl = fakeFldigi();
  const bus = new EventEmitter();
  const events = [];
  for (const ev of ['fldigi', 'fldigi-rx', 'nbems-form']) bus.on(ev, (d) => events.push({ ev, d }));
  const posted = [];
  let watcherOpts = null;
  const config = { fldigi: { enabled: true, flmsgEnabled: !!watcher, ...cfg } };
  const inst = plugin.create(config, {
    pluginBus: bus,
    flmsgPrefs: () => prefs || { dtformat: null, mycall: '' },
    locale: 'en-US',
    createClient: () => ({ call: (m, p) => fl.call(m, p) }),
    createWatcher: (opts) => {
      watcherOpts = opts;
      return watcher || { start() {}, stop() {}, getStatus: () => ({ running: true, dirs: [] }) };
    },
    postReports: (r) => posted.push(...r),
  });
  return { fl, inst, events, posted, config, watcherOpts: () => watcherOpts };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fldigi plugin — status and RX', () => {
  it('polls frequency, mode, carrier and TRX state and emits a status event', async () => {
    const { inst, events } = make();
    await inst.pollOnce();
    const s = inst.getStatus();
    expect(s).toMatchObject({
      connected: true,
      freq: 7070000,
      mode: 'BPSK31',
      carrier: 1500,
      trx: 'rx',
      version: '4.2.05',
    });
    expect(s.modes).toContain('MT63-2KL');
    expect(events.find((e) => e.ev === 'fldigi').d).toMatchObject({ connected: true, mode: 'BPSK31' });
  });

  it('seeds the receive tail on first contact, then streams only new text', async () => {
    const { fl, inst, events } = make({ rxBufferChars: 500 });
    fl.rx = 'x'.repeat(600) + 'CQ CQ de KE8PLM';
    await inst.pollOnce();
    const first = events.filter((e) => e.ev === 'fldigi-rx');
    expect(first).toHaveLength(1);
    expect(first[0].d.reset).toBe(true);
    expect(first[0].d.text.endsWith('CQ CQ de KE8PLM')).toBe(true);
    expect(first[0].d.text.length).toBe(500);

    fl.rx += '\r\nKE8PLM de N8TAG\x07 K\n';
    await inst.pollOnce();
    const rx = events.filter((e) => e.ev === 'fldigi-rx');
    expect(rx[1].d).toEqual({ text: '\nKE8PLM de N8TAG K\n' });
    expect(inst.getRxText().endsWith('KE8PLM de N8TAG K\n')).toBe(true);
  });

  it('re-seeds when the operator clears the receive pane', async () => {
    const { fl, inst, events } = make();
    fl.rx = 'old traffic';
    await inst.pollOnce();
    fl.rx = 'new';
    await inst.pollOnce();
    const last = events.filter((e) => e.ev === 'fldigi-rx').pop();
    expect(last.d).toEqual({ text: 'new', reset: true });
  });

  it('falls back to rx.get_data when the text.* calls are missing', async () => {
    const { fl, inst } = make();
    fl.noTextApi = true;
    await inst.pollOnce(); // discovers the fault, switches method
    fl.rx = 'hello';
    await inst.pollOnce();
    expect(inst.getStatus().rxMethod).toBe('stream');
    expect(inst.getRxText()).toBe('hello');
    expect(fl.rx).toBe(''); // consumed
  });

  it('marks fldigi disconnected on failure and recovers on the next answer', async () => {
    const { fl, inst } = make();
    await inst.pollOnce();
    fl.up = false;
    await inst.pollOnce();
    expect(inst.getStatus()).toMatchObject({ connected: false, lastError: expect.stringMatching(/ECONNREFUSED/) });
    fl.up = true;
    await inst.pollOnce();
    expect(inst.getStatus().connected).toBe(true);
  });

  it('backs off while fldigi is down and keeps polling once it is up', async () => {
    vi.useFakeTimers();
    const { fl, inst } = make({ pollInterval: 1000 });
    fl.up = false;
    inst.connect();
    await vi.advanceTimersByTimeAsync(0);
    const n0 = fl.calls.length;
    await vi.advanceTimersByTimeAsync(1999);
    expect(fl.calls.length).toBe(n0); // first retry waits 2 s
    fl.up = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(inst.getStatus().connected).toBe(true);
    const n1 = fl.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fl.calls.length).toBeGreaterThan(n1);
    inst.disconnect();
  });

  it('replays status and the RX tail for browsers that connect later', async () => {
    const { fl, inst } = make();
    fl.rx = 'QST';
    await inst.pollOnce();
    const snap = inst.getSseSnapshot();
    expect(snap.map((e) => e.event)).toEqual(['fldigi', 'fldigi-rx']);
    expect(snap[1].data).toEqual({ text: 'QST', reset: true });
  });

  it('refuses a non-http URL without throwing', () => {
    const inst = plugin.create({ fldigi: { url: 'file:///etc/passwd' } }, {});
    expect(inst.getStatus().lastError).toMatch(/http/);
  });
});

describe('fldigi plugin — TX', () => {
  it('queues text, keys TX with ^r appended, and counts it sent once fldigi is back on RX', async () => {
    const { fl, inst } = make();
    await inst.pollOnce();
    const r = await inst.sendText('CQ NBEMS ^r test');
    expect(r.id).toBe(1);
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    expect(fl.tx).toBe('CQ NBEMS  r test\n^r'); // user ^ neutralised, our ^r appended
    await inst.pollOnce(); // sees TX
    expect(inst.getStatus().txActive).toBe(true);
    fl.trx = 'rx'; // fldigi reached ^r
    await inst.pollOnce();
    expect(inst.getStatus()).toMatchObject({ txActive: false, txSent: 1 });
  });

  it('sends queued messages one at a time', async () => {
    const { fl, inst } = make();
    await inst.pollOnce();
    await inst.sendText('one');
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    await inst.sendText('two');
    expect(inst.getStatus().txQueued).toBe(1);
    await inst.pollOnce();
    expect(fl.tx).toBe('one\n^r');
    fl.trx = 'rx';
    await inst.pollOnce(); // completes "one" and starts "two"
    expect(fl.tx).toBe('one\n^rtwo\n^r');
    expect(fl.trx).toBe('tx');
  });

  it('rejects sends while disconnected or empty', async () => {
    const { inst } = make();
    await expect(inst.sendText('x')).rejects.toMatchObject({ status: 503 });
    await inst.pollOnce();
    await expect(inst.sendText('   ')).rejects.toMatchObject({ status: 400 });
    await expect(inst.sendText(42)).rejects.toMatchObject({ status: 400 });
  });

  it('applies the send-box options at send time: new line, DE call, extra line end (#1251)', async () => {
    const { fl, inst } = make({ callsign: 'ke8plm', txPrependCr: true, txPrependDe: true, txAppendCr: true });
    await inst.pollOnce();
    await inst.sendText('  QSL 3 msgs  ');
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    expect(fl.tx).toBe('\nDE KE8PLM QSL 3 msgs\n\n^r');
  });

  it('leaves ICS-213 transfers alone whatever the send-box options say', async () => {
    const { fl, inst } = make({ callsign: 'KE8PLM', txPrependCr: true, txPrependDe: true, txAppendCr: true });
    await inst.pollOnce();
    await inst.sendIcs213({ subject: 'Test', message: 'hi' });
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    expect(fl.tx.startsWith('... start\n')).toBe(true);
    expect(fl.tx.endsWith('... end\n^r')).toBe(true);
  });

  it('aborts a transmission that outlives maxTxSeconds', async () => {
    vi.useFakeTimers();
    const { fl, inst } = make({ maxTxSeconds: 10 });
    await inst.pollOnce();
    await inst.sendText('long');
    await vi.advanceTimersByTimeAsync(0);
    expect(fl.trx).toBe('tx');
    vi.setSystemTime(Date.now() + 11000);
    await inst.pollOnce();
    expect(fl.calls).toContain('main.abort');
    expect(fl.trx).toBe('rx');
    expect(inst.getStatus().lastTxError).toMatch(/exceeded/);
  });

  it('abort clears the queue and returns fldigi to RX', async () => {
    const { fl, inst } = make();
    await inst.pollOnce();
    await inst.sendText('one');
    await inst.sendText('two');
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    const r = await inst.abort();
    expect(r.aborted).toBe(true);
    expect(fl.trx).toBe('rx');
    expect(fl.tx).toBe('');
    expect(inst.getStatus().txQueued).toBe(0);
  });

  it('sends an ICS-213 as a checksummed flmsg WRAP transfer', async () => {
    const { fl, inst } = make({ callsign: 'ke8plm' });
    await inst.pollOnce();
    const r = await inst.sendIcs213({
      to: 'EOC',
      from: 'Shelter 3',
      subject: 'Cots',
      message: 'Need 40 cots\nby 1800',
      bogus: 'ignored',
    });
    expect(r.filename).toMatch(/^KE8PLM-\d{8}-\d{6}\.213$/);
    expect(r.folded).toBe(false);
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    expect(fl.tx.startsWith('... start\n[WRAP:beg][WRAP:lf][WRAP:fn KE8PLM-')).toBe(true);
    const u = unwrapFlmsg(fl.tx);
    expect(u).toMatchObject({ filename: r.filename, checksumOk: true });
    const doc = parseFlmsg(u.content);
    expect(doc.form).toBe('ics213');
    expect(doc.header.hdr_fm).toMatch(/^\nKE8PLM \d{14}$/);
    expect(fieldsToFriendly('ics213', doc.fields)).toMatchObject({
      to: 'EOC',
      from: 'Shelter 3',
      subject: 'Cots',
      message: 'Need 40 cots\nby 1800',
    });
    expect(fl.tx.endsWith('[WRAP:end]\n... end\n^r')).toBe(true);
  });

  it('folds an ICS-213 to plain ASCII so any flmsg verifies its checksum', async () => {
    const { fl, inst } = make({ callsign: 'KE8PLM' });
    await inst.pollOnce();
    const r = await inst.sendIcs213({ subject: 'Café – Wasser', message: 'für 20 Personen' });
    expect(r.folded).toBe(true);
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    const fields = parseFlmsg(unwrapFlmsg(fl.tx).content).fields;
    expect(fields).toMatchObject({ sb: 'Cafe - Wasser', mg: 'fur 20 Personen' });
    expect(/[^\x00-\x7f]/.test(fl.tx)).toBe(false);
  });

  it('takes the station callsign from flmsg when the plugin has none', async () => {
    const { fl, inst } = make({}, { prefs: { dtformat: 2, mycall: 'W1AW' } });
    await inst.pollOnce();
    const r = await inst.sendIcs213({ subject: 'x' });
    expect(r.filename).toMatch(/^W1AW-/);
    await vi.waitFor(() => expect(fl.trx).toBe('tx'));
    expect(inst.getStatus().stationCall).toBe('W1AW');
  });

  it('validates ICS-213 input', async () => {
    const { inst } = make();
    await inst.pollOnce();
    await expect(inst.sendIcs213({ to: 'EOC' })).rejects.toMatchObject({ status: 400 });
    await expect(inst.sendIcs213({ subject: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
  });
});

describe('fldigi plugin — mode', () => {
  it('sets a mode by name, matching fldigi’s list case-insensitively', async () => {
    const { fl, inst } = make();
    await inst.pollOnce();
    await expect(inst.setMode('mt63-2kl')).resolves.toEqual({ mode: 'MT63-2KL' });
    expect(fl.modem).toBe('MT63-2KL');
  });

  it('rejects unknown or malformed mode names', async () => {
    const { inst } = make();
    await inst.pollOnce();
    await expect(inst.setMode('PSK9000')).rejects.toMatchObject({ status: 400 });
    await expect(inst.setMode('<script>')).rejects.toMatchObject({ status: 400 });
  });
});

describe('fldigi plugin — flmsg forms', () => {
  it('starts the watcher with the configured folders and forwards forms to the server', async () => {
    vi.useFakeTimers();
    const watcher = { start: vi.fn(), stop: vi.fn(), getStatus: () => ({ running: true, dirs: [] }) };
    const { inst, posted, events, watcherOpts } = make(
      { flmsgDirs: '/a/ICS/messages; /b/WRAP/recv', flmsgPollInterval: 5, flmsgMaxAgeHours: 1 },
      { watcher },
    );
    inst.connect();
    expect(watcher.start).toHaveBeenCalled();
    expect(watcherOpts()).toMatchObject({ dirs: ['/a/ICS/messages', '/b/WRAP/recv'], pollMs: 5000, maxAgeMs: 3600000 });

    const record = {
      id: 'abc',
      callsign: 'KE8PLM',
      formType: 'ICS-213 (NBEMS)',
      form: 'ics213',
      lat: 39,
      lon: -94,
      timestamp: 1,
      text: 'Cots',
      extra: {},
      fields: { to: 'EOC' },
      senders: ['KE8PLM'],
      wrapped: true,
      origin: 'received',
    };
    watcherOpts().onForm(record, '/a/ICS/messages/x.213');
    expect(events.find((e) => e.ev === 'nbems-form').d).toBe(record);
    await vi.advanceTimersByTimeAsync(600);
    expect(posted).toEqual([
      {
        id: 'abc',
        callsign: 'KE8PLM',
        formType: 'ICS-213 (NBEMS)',
        lat: 39,
        lon: -94,
        timestamp: 1,
        text: 'Cots',
        extra: {},
        receivedVia: 'nbems-flmsg',
      },
    ]);
    expect(inst.getForms()[0]).toMatchObject({ id: 'abc', file: '/a/ICS/messages/x.213' });
    inst.disconnect();
    expect(watcher.stop).toHaveBeenCalled();
  });

  it('keeps drafts and sent forms out of Field Reports unless flmsgIncludeLocal is on', async () => {
    vi.useFakeTimers();
    const watcher = { start() {}, stop() {}, getStatus: () => ({}) };
    const draft = { id: 'd', callsign: '', formType: 'ICS-213 (NBEMS)', extra: {}, origin: 'local' };
    const a = make({}, { watcher });
    a.inst.connect();
    a.watcherOpts().onForm(draft, 'f');
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.posted).toEqual([]);
    expect(a.events.some((e) => e.ev === 'nbems-form')).toBe(false);
    expect(a.inst.getForms()[0]).toMatchObject({ id: 'd', origin: 'local' });
    a.inst.disconnect();

    const b = make({ flmsgIncludeLocal: true }, { watcher });
    b.inst.connect();
    b.watcherOpts().onForm(draft, 'f');
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.posted[0]).toMatchObject({ id: 'd', receivedVia: 'nbems-flmsg-local', extra: { origin: 'local' } });
    b.inst.disconnect();
  });

  it('forwards forms of unknown origin, tagged, and reports the missing callsign in status', async () => {
    vi.useFakeTimers();
    const watcher = { start() {}, stop() {}, getStatus: () => ({}) };
    const { inst, posted, events, watcherOpts } = make({}, { watcher }); // no callsign anywhere
    inst.connect();
    watcherOpts().onForm(
      { id: 'u', callsign: 'N8TAG', formType: 'ICS-213 (NBEMS)', extra: {}, origin: 'unknown' },
      'f',
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted[0]).toMatchObject({ id: 'u', receivedVia: 'nbems-flmsg', extra: { origin: 'unknown' } });
    expect(events.some((e) => e.ev === 'nbems-form')).toBe(true);
    await inst.pollOnce();
    expect(events.filter((e) => e.ev === 'fldigi').pop().d.stationCall).toBe('');
    inst.disconnect();
  });

  it('gives the watcher the station call and date order (flmsg prefs, then locale)', () => {
    const watcher = { start() {}, stop() {}, getStatus: () => ({}) };
    const a = make({}, { watcher, prefs: { dtformat: 2, mycall: 'W1AW' } });
    a.inst.connect();
    expect(a.watcherOpts().stationCall()).toBe('W1AW');
    expect(a.watcherOpts().dateOrder()).toMatchObject({ slash: 'dmy', source: 'flmsg' });
    a.inst.disconnect();
    const b = make({ callsign: 'ke8plm', flmsgDateFormat: 'mdy' }, { watcher, prefs: { dtformat: 2, mycall: 'W1AW' } });
    b.inst.connect();
    expect(b.watcherOpts().stationCall()).toBe('KE8PLM');
    expect(b.watcherOpts().dateOrder()).toMatchObject({ slash: 'mdy', source: 'setting' });
    b.inst.disconnect();
    const c = make({}, { watcher });
    c.inst.connect();
    expect(c.watcherOpts().dateOrder()).toMatchObject({ slash: 'mdy', source: 'locale' }); // en-US
    c.inst.disconnect();
  });

  it('does not post when serverForward is off', async () => {
    vi.useFakeTimers();
    const watcher = { start() {}, stop() {}, getStatus: () => ({}) };
    const { inst, posted, watcherOpts } = make({ serverForward: false }, { watcher });
    inst.connect();
    watcherOpts().onForm({ id: 'x', extra: {} }, 'f');
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted).toEqual([]);
    inst.disconnect();
  });

  it('formatFldigiTx adds each option on its own and skips DE without a callsign', () => {
    const { formatFldigiTx } = plugin._internals;
    expect(formatFldigiTx('hi')).toBe('hi');
    expect(formatFldigiTx('hi', { prependCr: true })).toBe('\nhi');
    expect(formatFldigiTx('hi', { prependDe: true, callsign: 'KE8PLM' })).toBe('DE KE8PLM hi');
    expect(formatFldigiTx('hi', { appendCr: true })).toBe('hi\n');
    expect(formatFldigiTx('hi', { prependCr: true, prependDe: true, appendCr: true, callsign: 'N8TAG' })).toBe(
      '\nDE N8TAG hi\n',
    );
    expect(formatFldigiTx('hi', { prependCr: true, prependDe: true, callsign: ' ' })).toBe('\nhi');
  });

  it('exposes internals for splitting folder lists', () => {
    const { splitDirs } = plugin._internals;
    expect(splitDirs(' a ;b\nc ')).toEqual(['a', 'b', 'c']);
    expect(splitDirs(['x', ''])).toEqual(['x']);
    expect(splitDirs(undefined)).toEqual([]);
  });
});

describe('fldigi plugin — over a real XML-RPC socket', () => {
  it('talks to an HTTP XML-RPC server with the built-in client', async () => {
    const fl = fakeFldigi();
    fl.rx = 'CQ CQ de N8TAG';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const method = body.match(/<methodName>([^<]+)<\/methodName>/)[1];
        const params = [];
        let pos = 0;
        let p;
        while ((p = xr.findTag(body, 'param', pos))) {
          params.push(xr.decodeValueInner(xr.findTag(p.inner, 'value').inner));
          pos = p.end;
        }
        let xml;
        try {
          const v = await fl.call(method, params);
          xml = `<?xml version="1.0"?><methodResponse><params><param>${xr.encodeValue(v)}</param></params></methodResponse>`;
        } catch (e) {
          xml = `<?xml version="1.0"?><methodResponse><fault>${xr.encodeValue({ faultCode: 1, faultString: e.message })}</fault></methodResponse>`;
        }
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(xml);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
      const inst = plugin.create({ fldigi: { enabled: true, url: `http://127.0.0.1:${port}` } }, {});
      await inst.pollOnce();
      expect(inst.getStatus()).toMatchObject({ connected: true, freq: 7070000, mode: 'BPSK31', trx: 'rx' });
      expect(inst.getRxText()).toBe('CQ CQ de N8TAG');
      await inst.setMode('cw');
      expect(fl.modem).toBe('CW');
      await inst.sendText('QRL?');
      await vi.waitFor(() => expect(fl.trx).toBe('tx'));
      expect(fl.tx).toBe('QRL?\n^r');
    } finally {
      server.close();
    }
  });
});
