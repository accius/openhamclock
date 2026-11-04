'use strict';
/**
 * fldigi.js — NBEMS plugin: fldigi (XML-RPC) + flmsg form folders
 *
 * fldigi side — talks to fldigi's built-in XML-RPC server (default
 * http://127.0.0.1:7362) with a dependency-free client (lib/xmlrpc-client):
 *   • status poll: main.get_frequency, modem.get_name, modem.get_carrier,
 *     main.get_trx_status
 *   • RX text: text.get_rx_length + text.get_rx(start, n) — a non-destructive
 *     read of fldigi's receive pane with our own cursor, so other programs
 *     reading fldigi are not starved. Falls back to rx.get_data on builds
 *     without the text.* calls.
 *   • send text: text.add_tx(text + "^r") + main.tx — fldigi transmits the
 *     text and the ^r tag returns it to receive when the buffer drains. A
 *     queue keys one message at a time; a watchdog (maxTxSeconds) aborts a
 *     transmission that never ends.
 *   • mode change: modem.set_by_name, checked against modem.get_names.
 *   • reconnect: when a call fails the plugin marks fldigi disconnected and
 *     retries with backoff (2 s → 30 s) until it answers again.
 *
 * flmsg side — watches the NBEMS folders (default ~/NBEMS.files/WRAP/recv,
 * where fldigi saves every transfer it decodes, and ~/NBEMS.files/ICS/messages,
 * where flmsg saves forms). Forms are parsed with lib/flmsg-format (including
 * flmsg's LZMA-compressed transfers) and classified by lib/flmsg-watcher:
 * received traffic is POSTed to the OpenHamClock server's
 * /api/emcomm/field-reports and appears in the EmComm Field Reports panel
 * (and on the map when the text carries a position); the station's own
 * drafts and sent forms are kept out unless flmsgIncludeLocal is on.
 * "Send ICS-213" writes the form exactly as flmsg does (plain ASCII), wraps it
 * with flmsg's checksum and transmits it through fldigi.
 *
 * Cloud relay: plugins/cloud-relay.js carries the browser events below and
 * the send / mode / abort / send-ics213 commands for hosted servers.
 *
 * Browser events (pluginBus → rig-bridge.js → SSE /stream):
 *   'fldigi'       status object (connected, freq, mode, trx, tx queue, ...)
 *   'fldigi-rx'    { text, reset? } — new receive text (reset = full tail)
 *   'nbems-form'   a form record just read from the flmsg folders
 *
 * Config section: config.fldigi
 *   enabled            boolean  (default false)
 *   url                string   fldigi XML-RPC URL (default 'http://127.0.0.1:7362')
 *   pollInterval       number   ms between status polls (default 1000, min 250)
 *   rxBufferChars      number   receive text kept for late joiners (default 4000)
 *   maxTxSeconds       number   transmit watchdog (default 600)
 *   callsign           string   station call for flmsg headers on sent forms
 *   txPrependCr        boolean  send-box text starts on a new line (default false)
 *   txPrependDe        boolean  …then "DE <callsign> " (default false; skipped without a call)
 *   txAppendCr         boolean  an extra line end after the text (default false)
 *   flmsgEnabled       boolean  watch the flmsg folders (default true)
 *   flmsgDirs          string[]|string  folders to watch ('' / [] = NBEMS defaults;
 *                               a string may list several separated by ';' or newlines)
 *   flmsgPollInterval  number   seconds between folder scans (default 15)
 *   flmsgMaxAgeHours   number   on start-up, ignore forms older than this (default 72)
 *   flmsgIncludeLocal  boolean  also forward drafts / sent forms from ICS/messages (default false)
 *   flmsgDateFormat    string   'auto' | 'mdy' | 'dmy' | 'ymd' | 'ydm' — how ambiguous form
 *                               dates are read; auto = flmsg's own setting, else system locale
 *   serverForward      boolean  POST forms to the OpenHamClock server (default true)
 *   ohcUrl             string   OpenHamClock server URL (default 'http://localhost:3000')
 *   verbose            boolean
 *
 * API:
 *   GET  /api/fldigi/status         connection + watcher state
 *   GET  /api/fldigi/rx             { text } — receive tail
 *   GET  /api/fldigi/forms          recent flmsg forms (newest first)
 *   POST /api/fldigi/send           { text }            (token-protected)
 *   POST /api/fldigi/mode           { mode }            (token-protected)
 *   POST /api/fldigi/abort          stop TX, clear queue (token-protected)
 *   POST /api/fldigi/send-ics213    ICS-213 fields      (token-protected)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { StringDecoder } = require('string_decoder');
const { createXmlRpcClient } = require('../lib/xmlrpc-client');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildIcs213, wrapFlmsg, asciiFold, resolveDateOrder, parseFlmsgPrefs } = require('../lib/flmsg-format');
const { createFlmsgWatcher, defaultFlmsgDirs } = require('../lib/flmsg-watcher');

let _currentInstance = null;

const MAX_SEND_CHARS = 20000;
const RX_CHUNK_MAX = 8192;
const FORMS_RING_MAX = 50;
const MODE_RE = /^[A-Za-z0-9][A-Za-z0-9 _/.-]{0,31}$/;

/** fldigi returns text as base64 bytes (or a plain string on some builds). */
function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v == null) return Buffer.alloc(0);
  return Buffer.from(String(v), 'utf8');
}

/** Receive text → display text: unify line ends, drop control characters. */
function cleanRx(s) {
  return s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** Outgoing text: fldigi treats ^ as a TX command prefix (^r, ^R …) — neutralise it. */
function cleanTx(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/\^/g, ' ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/**
 * Send-box text as it goes to fldigi (#1251): optional new line and
 * "DE <call> " in front, and an extra line end after. Applied at send time
 * only — never to ICS-213 transfers, whose framing flmsg expects exactly.
 * Line ends are '\n', like the rest of the cleaned outgoing text.
 */
function formatFldigiTx(text, { prependCr = false, prependDe = false, appendCr = false, callsign = '' } = {}) {
  const call = String(callsign || '').trim();
  return `${prependCr ? '\n' : ''}${prependDe && call ? `DE ${call} ` : ''}${text}${appendCr ? '\n' : ''}`;
}

function splitDirs(v) {
  if (Array.isArray(v)) return v.map((d) => String(d).trim()).filter(Boolean);
  if (typeof v === 'string')
    return v
      .split(/[;\n]/)
      .map((d) => d.trim())
      .filter(Boolean);
  return [];
}

const ICS213_FIELDS = {
  incident: 200,
  to: 200,
  toPosition: 200,
  from: 200,
  fromPosition: 200,
  subject: 200,
  date: 20,
  time: 20,
  message: 4000,
  approvedBy: 200,
  approvedPosition: 200,
};

const descriptor = {
  id: 'fldigi',
  name: 'fldigi + flmsg (NBEMS)',
  category: 'integration',
  configKey: 'fldigi',

  registerRoutes(app) {
    app.get('/api/fldigi/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
    app.get('/api/fldigi/rx', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, text: '' });
      res.json({ enabled: true, text: _currentInstance.getRxText() });
    });
    app.get('/api/fldigi/forms', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, forms: [] });
      res.json({ enabled: true, forms: _currentInstance.getForms() });
    });
  },

  /** Anything that keys the transmitter or changes fldigi sits behind the API token. */
  registerAuthRoutes(app, requireAuth) {
    const guard = (fn) => async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'fldigi plugin not running' });
      try {
        res.json({ success: true, ...(await fn(req.body || {})) });
      } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
      }
    };
    app.post(
      '/api/fldigi/send',
      requireAuth,
      guard((b) => _currentInstance.sendText(b.text)),
    );
    app.post(
      '/api/fldigi/mode',
      requireAuth,
      guard((b) => _currentInstance.setMode(b.mode)),
    );
    app.post(
      '/api/fldigi/abort',
      requireAuth,
      guard(() => _currentInstance.abort()),
    );
    app.post(
      '/api/fldigi/send-ics213',
      requireAuth,
      guard((b) => _currentInstance.sendIcs213(b)),
    );
  },

  /**
   * @param {object} config
   * @param {object} services  { pluginBus, createClient?, createWatcher?, postReports? }
   *   createClient / createWatcher / postReports are injection points for tests.
   */
  create(config, services = {}) {
    const cfg = () => config.fldigi || {};
    const bus = services.pluginBus;
    const tag = '[fldigi]';
    const log = (...a) => console.log(tag, ...a);
    const vlog = (...a) => cfg().verbose && console.log(tag, ...a);

    const url = String(cfg().url || 'http://127.0.0.1:7362');
    const pollMs = Math.max(250, Number(cfg().pollInterval) || 1000);
    const rxMax = Math.max(500, Number(cfg().rxBufferChars) || 4000);
    const maxTxMs = Math.max(10, Number(cfg().maxTxSeconds) || 600) * 1000;

    let client = null;
    let clientError = null;
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('fldigi.url must be http:// or https://');
      client = (services.createClient || createXmlRpcClient)(url, { timeout: 3000, label: 'fldigi XML-RPC' });
    } catch (e) {
      clientError = e.message;
    }
    const call = (method, params) => client.call(method, params);

    // ── State ──────────────────────────────────────────────────────────────
    let running = false;
    let timer = null;
    let polling = false;
    let connected = false;
    let version = null;
    let modemNames = null;
    let freq = null;
    let mode = null;
    let carrier = null;
    let trx = null;
    let lastError = clientError;
    let lastContact = null;
    let backoffMs = 2000;
    let lastEmitted = '';

    let rxCursor = null;
    let rxMethod = 'buffer'; // 'buffer' (text.get_rx) | 'stream' (rx.get_data)
    let rxText = '';
    const rxDecoder = new StringDecoder('utf8');

    const txQueue = [];
    let txActive = null;
    let txSent = 0;
    let txSeq = 0;
    let lastTxError = null;

    const forms = [];
    let watcher = null;
    let formsPosted = 0;
    let postErrors = 0;

    // ── Bus helpers ────────────────────────────────────────────────────────
    function statusPayload() {
      return {
        connected,
        // '' = no callsign in the plugin or in flmsg: the panel warns
        stationCall: stationCall(),
        version,
        freq,
        mode,
        carrier,
        trx,
        txActive: !!txActive,
        txQueued: txQueue.length,
        txSent,
        lastTxError,
        lastError: connected ? null : lastError,
      };
    }

    function emitStatus(force) {
      const s = statusPayload();
      const key = JSON.stringify(s);
      if (!force && key === lastEmitted) return;
      lastEmitted = key;
      if (bus) bus.emit('fldigi', s);
    }

    function appendRx(chunk) {
      const clean = cleanRx(chunk);
      if (!clean) return;
      rxText = (rxText + clean).slice(-rxMax);
      if (bus) bus.emit('fldigi-rx', { text: clean });
    }

    // ── Connection handling ────────────────────────────────────────────────
    function markConnected() {
      lastContact = Date.now();
      backoffMs = 2000;
      if (!connected) {
        connected = true;
        lastError = null;
        log(`Connected to fldigi at ${url}${version ? ` (v${version})` : ''}`);
      }
    }

    function markDisconnected(err) {
      lastError = err?.message || String(err);
      if (connected) {
        connected = false;
        log(`Lost fldigi (${lastError}) — retrying`);
      }
      // Re-sync the receive cursor and modem list after a reconnect: fldigi
      // may have restarted with an empty receive pane.
      rxCursor = null;
      modemNames = null;
      version = null;
      trx = null;
    }

    async function onFirstContact() {
      try {
        version = String(await call('fldigi.version'));
      } catch (e) {
        version = null;
      }
      try {
        const names = await call('modem.get_names');
        if (Array.isArray(names)) modemNames = names.map(String);
      } catch (e) {
        modemNames = null;
      }
    }

    async function pollRx() {
      if (rxMethod === 'stream') {
        const data = await call('rx.get_data');
        const s = rxDecoder.write(toBuffer(data));
        if (s) appendRx(s);
        return;
      }
      let len;
      try {
        len = Number(await call('text.get_rx_length'));
      } catch (e) {
        if (e.faultString || e.faultCode != null) {
          rxMethod = 'stream'; // older fldigi without text.* — use the consuming stream
          vlog('text.get_rx_length unavailable — using rx.get_data');
          return;
        }
        throw e;
      }
      if (!Number.isFinite(len) || len < 0) return;
      if (rxCursor == null || len < rxCursor) {
        // First contact, or the operator cleared fldigi's receive pane:
        // seed with the tail so late joiners see recent traffic.
        const start = Math.max(0, len - rxMax);
        const raw = len > start ? await call('text.get_rx', [start, len - start]) : Buffer.alloc(0);
        rxCursor = len;
        rxText = cleanRx(toBuffer(raw).toString('utf8')).slice(-rxMax);
        if (bus) bus.emit('fldigi-rx', { text: rxText, reset: true });
        return;
      }
      if (len > rxCursor) {
        const n = Math.min(len - rxCursor, RX_CHUNK_MAX);
        const raw = await call('text.get_rx', [rxCursor, n]);
        rxCursor += n;
        const s = rxDecoder.write(toBuffer(raw));
        if (s) appendRx(s);
      }
    }

    let txBusy = false;
    async function serviceTx() {
      if (txBusy) return;
      txBusy = true;
      try {
        await serviceTxInner();
      } finally {
        txBusy = false;
      }
    }

    async function serviceTxInner() {
      if (txActive) {
        if (trx === 'tx' || trx === 'tune') txActive.sawTx = true;
        const elapsed = Date.now() - txActive.startedAt;
        if (trx === 'rx' && (txActive.sawTx || elapsed > 5000)) {
          txSent++;
          vlog(`TX complete: ${txActive.label}`);
          txActive = null;
        } else if (elapsed > maxTxMs) {
          lastTxError = `Transmission exceeded ${Math.round(maxTxMs / 1000)} s — aborted`;
          log(lastTxError);
          txActive = null;
          await call('main.abort').catch(() => {});
          await call('main.rx').catch(() => {});
        }
      }
      if (!txActive && txQueue.length && connected && trx === 'rx') {
        const item = txQueue.shift();
        txActive = { ...item, startedAt: Date.now(), sawTx: false };
        try {
          // text.add_tx puts the text in fldigi's TX pane (FTextTX::add_text);
          // get_tx_char() reads it through the control-code path, where "^r"
          // clears the pane and returns GET_TX_CHAR_ETX, i.e. back to receive
          // once everything before it has gone out (fldigi
          // src/dialogs/fl_digi.cxx get_tx_char(), case 'r'). flmsg's own
          // autosend uses text.add_tx_queu instead, whose characters bypass
          // that path and end on queue exhaustion — "^r" would go out literally
          // there, so we deliberately use text.add_tx.
          // Every transmission ends with a line end before ^r; send-box
          // options may add one more (formatFldigiTx).
          await call('text.add_tx', [`${item.text}\n^r`]);
          await call('main.tx');
          lastTxError = null;
          log(`Transmitting ${item.label} (${item.text.length} chars)`);
        } catch (e) {
          lastTxError = `Could not start TX: ${e.message}`;
          log(lastTxError);
          txActive = null;
        }
      }
    }

    /** One status/RX/TX cycle. Exposed for tests. */
    async function pollOnce() {
      if (!client || polling) return;
      polling = true;
      try {
        const f = await call('main.get_frequency');
        if (!connected) await onFirstContact();
        freq = Number.isFinite(Number(f)) ? Math.round(Number(f)) : null;
        mode = String(await call('modem.get_name'));
        try {
          carrier = Number(await call('modem.get_carrier'));
        } catch (e) {
          carrier = null;
        }
        trx = String(await call('main.get_trx_status')).toLowerCase();
        markConnected();
        await pollRx();
        await serviceTx();
      } catch (e) {
        markDisconnected(e);
      } finally {
        polling = false;
      }
      emitStatus();
    }

    function schedule() {
      if (!running) return;
      timer = setTimeout(
        async () => {
          await pollOnce();
          if (!connected) backoffMs = Math.min(backoffMs * 2, 30000);
          schedule();
        },
        connected ? pollMs : backoffMs,
      );
    }

    // ── Commands ───────────────────────────────────────────────────────────
    function badRequest(msg) {
      const e = new Error(msg);
      e.status = 400;
      return e;
    }
    function unavailable(msg) {
      const e = new Error(msg);
      e.status = 503;
      return e;
    }

    function enqueue(text, label, format) {
      if (!client) throw unavailable(clientError || 'fldigi client not configured');
      if (!connected) throw unavailable('fldigi is not connected');
      const clean = cleanTx(text).trim();
      if (!clean) throw badRequest('Nothing to send');
      if (clean.length > MAX_SEND_CHARS) throw badRequest(`Text exceeds ${MAX_SEND_CHARS} characters`);
      const id = ++txSeq;
      txQueue.push({ id, text: format ? format(clean) : clean, label, queuedAt: Date.now() });
      emitStatus();
      // Start right away when fldigi is idle rather than waiting for the next poll
      if (!txActive && trx === 'rx') serviceTx().then(() => emitStatus());
      return { id, queued: txQueue.length + (txActive ? 1 : 0) };
    }

    async function sendText(text) {
      if (typeof text !== 'string') throw badRequest('Missing text');
      return enqueue(text, 'text', (clean) =>
        formatFldigiTx(clean, {
          prependCr: cfg().txPrependCr === true,
          prependDe: cfg().txPrependDe === true,
          appendCr: cfg().txAppendCr === true,
          callsign: stationCall(),
        }),
      );
    }

    async function sendIcs213(input = {}) {
      const form = {};
      let folded = false;
      for (const [k, max] of Object.entries(ICS213_FIELDS)) {
        if (input[k] == null) continue;
        const clean = cleanTx(input[k]).trim();
        // Plain ASCII only: flmsg's checksum of other characters depends on
        // the receiving computer (see lib/flmsg-format flmsgCrc16).
        const v = asciiFold(clean);
        if (v !== clean) folded = true;
        if (v.length > max) throw badRequest(`${k} exceeds ${max} characters`);
        if (v) form[k] = v;
      }
      if (!form.message && !form.subject) throw badRequest('An ICS-213 needs a subject or a message');
      const station = stationCall().replace(/[^A-Z0-9/-]/g, '');
      const now = Date.now();
      const content = buildIcs213(form, { call: station, when: now });
      const iso = new Date(now).toISOString();
      const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
      const filename = `${station.replace(/\//g, '_') || 'OHC'}-${stamp}.213`;
      const wrapped = wrapFlmsg(content, filename);
      // Same framing flmsg uses when it hands a transfer to fldigi
      // (src/utils/wrap.cxx xfr_via_socket()).
      const r = enqueue(`... start\n${wrapped}\n... end`, `ICS-213 ${filename}`);
      return { ...r, filename, bytes: Buffer.byteLength(wrapped), folded };
    }

    async function setMode(name) {
      if (!client) throw unavailable(clientError || 'fldigi client not configured');
      if (!connected) throw unavailable('fldigi is not connected');
      const want = String(name || '').trim();
      if (!MODE_RE.test(want)) throw badRequest('Invalid mode name');
      let target = want;
      if (modemNames && modemNames.length) {
        const hit = modemNames.find((m) => m.toUpperCase() === want.toUpperCase());
        if (!hit) throw badRequest(`fldigi has no mode "${want}"`);
        target = hit;
      }
      await call('modem.set_by_name', [target]);
      mode = String(await call('modem.get_name').catch(() => target));
      emitStatus();
      log(`Mode → ${mode}`);
      return { mode };
    }

    async function abort() {
      txQueue.length = 0;
      const had = !!txActive;
      txActive = null;
      if (client && connected) {
        await call('main.abort').catch(() => {});
        await call('text.clear_tx').catch(() => {});
        await call('main.rx').catch(() => {});
      }
      emitStatus(true);
      return { aborted: had };
    }

    // ── flmsg forms → OpenHamClock server ──────────────────────────────────
    const forwardEnabled = () => cfg().serverForward !== false;
    const ohcBase = () => String(cfg().ohcUrl || 'http://localhost:3000').replace(/\/$/, '');

    function defaultPost(reports) {
      let target;
      try {
        target = new URL(`${ohcBase()}/api/emcomm/field-reports`);
      } catch (e) {
        lastError = `Invalid ohcUrl: ${e.message}`;
        return;
      }
      const body = JSON.stringify({ reports });
      const mod = target.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 300) formsPosted += reports.length;
          else {
            postErrors++;
            log(`Field-report POST failed: HTTP ${res.statusCode}`);
          }
        },
      );
      req.on('error', (err) => {
        postErrors++;
        vlog(`Field-report POST error: ${err.message}`);
      });
      req.setTimeout(5000, () => req.destroy());
      req.write(body);
      req.end();
    }
    const postReports = services.postReports || defaultPost;

    const pending = [];
    let postTimer = null;
    function queueForPost(record) {
      if (!forwardEnabled()) return;
      const { fields, form, senders, wrapped, origin, ...report } = record;
      pending.push({
        ...report,
        extra: { ...report.extra, ...(origin === 'local' || origin === 'unknown' ? { origin } : {}) },
        receivedVia: origin === 'local' ? 'nbems-flmsg-local' : 'nbems-flmsg',
      });
      if (!postTimer) {
        postTimer = setTimeout(() => {
          postTimer = null;
          while (pending.length) postReports(pending.splice(0, 100));
        }, 500);
      }
    }

    // Drafts and sent forms (origin 'local') stay out of Field Reports unless
    // flmsgIncludeLocal is on; they are still listed by GET /api/fldigi/forms.
    const includeLocal = () => cfg().flmsgIncludeLocal === true;

    function onForm(record, file) {
      forms.unshift({ ...record, file });
      if (forms.length > FORMS_RING_MAX) forms.length = FORMS_RING_MAX;
      const show = record.origin !== 'local' || includeLocal();
      vlog(
        `flmsg ${record.origin || 'form'}: ${record.formType} from ${record.callsign || 'unknown'}${show ? '' : ' (not forwarded)'}`,
      );
      if (record.origin === 'unknown') {
        log(
          `flmsg form of unknown origin (no station callsign set): ${record.formType} sent by ${record.callsign || 'unknown'} — forwarded, tagged "origin unknown"`,
        );
      } else if (record.origin !== 'local') {
        log(
          `flmsg form received: ${record.formType} from ${record.callsign || 'unknown'}${record.text ? ` — ${record.text.slice(0, 60)}` : ''}`,
        );
      }
      if (!show) return;
      if (bus) bus.emit('nbems-form', record);
      queueForPost(record);
    }

    // ── flmsg's own preferences (NBEMS.files/w1hkj.com/flmsg.prefs) ────────
    // FLTK writes Fl_Preferences(FLMSG_dir, "w1hkj.com", "flmsg") there
    // (src/utils/status.cxx saveLastState()); we read dtformat and mycall.
    let prefsCache = { at: 0, value: { dtformat: null, mycall: '' }, file: null };
    function flmsgPrefs() {
      if (services.flmsgPrefs) return services.flmsgPrefs();
      if (Date.now() - prefsCache.at < 60000) return prefsCache.value;
      const dirs = splitDirs(cfg().flmsgDirs);
      const candidates = [
        ...(dirs.length ? dirs : defaultFlmsgDirs()).map((d) =>
          path.resolve(d, '..', '..', 'w1hkj.com', 'flmsg.prefs'),
        ),
        path.join(os.homedir(), 'NBEMS.files', 'w1hkj.com', 'flmsg.prefs'),
      ];
      prefsCache = { at: Date.now(), value: { dtformat: null, mycall: '' }, file: null };
      for (const file of candidates) {
        try {
          prefsCache.value = parseFlmsgPrefs(fs.readFileSync(file, 'utf8'));
          prefsCache.file = file;
          break;
        } catch (e) {
          // not there — try the next
        }
      }
      return prefsCache.value;
    }

    /** This station's callsign: plugin setting, else flmsg's own. */
    function stationCall() {
      return String(cfg().callsign || flmsgPrefs().mycall || '')
        .trim()
        .toUpperCase();
    }

    /** How ambiguous form dates are read (setting → flmsg's dtformat → system locale). */
    function dateOrder() {
      return resolveDateOrder({
        setting: cfg().flmsgDateFormat || 'auto',
        flmsgDtformat: flmsgPrefs().dtformat,
        locale: services.locale,
      });
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────
    function connect() {
      running = true;
      _currentInstance = instance;
      if (client) {
        log(`Polling fldigi XML-RPC at ${url} every ${pollMs} ms`);
        pollOnce().then(schedule);
      } else {
        log(`fldigi polling disabled: ${clientError}`);
      }
      if (cfg().flmsgEnabled !== false) {
        const dirs = splitDirs(cfg().flmsgDirs);
        watcher = (services.createWatcher || createFlmsgWatcher)({
          dirs,
          pollMs: Math.max(2, Number(cfg().flmsgPollInterval) || 15) * 1000,
          maxAgeMs: Math.max(0, Number(cfg().flmsgMaxAgeHours ?? 72)) * 3600 * 1000,
          onForm,
          onError: (m) => log(`flmsg: ${m}`),
          stationCall,
          dateOrder,
        });
        watcher.start();
        const st = watcher.getStatus();
        log(
          `Watching flmsg folders: ${(st.dirs || []).map((d) => `${d.path}${d.exists ? '' : ' (missing)'}`).join(', ')}`,
        );
      }
    }

    function disconnect() {
      running = false;
      clearTimeout(timer);
      timer = null;
      if (watcher) {
        watcher.stop();
        watcher = null;
      }
      clearTimeout(postTimer);
      postTimer = null;
      if (_currentInstance === instance) _currentInstance = null;
      log('Stopped');
    }

    function getStatus() {
      return {
        enabled: !!cfg().enabled,
        running,
        url,
        pollIntervalMs: pollMs,
        rxMethod,
        lastContact,
        modes: modemNames || [],
        ...statusPayload(),
        lastError: connected ? null : lastError,
        flmsg: watcher
          ? {
              ...watcher.getStatus(),
              includeLocal: includeLocal(),
              dateOrder: dateOrder(),
              prefsFile: prefsCache.file,
            }
          : { running: false },
        serverForward: forwardEnabled(),
        ohcUrl: forwardEnabled() ? ohcBase() : undefined,
        formsPosted,
        postErrors,
      };
    }

    function getSseSnapshot() {
      return [
        { type: 'plugin', event: 'fldigi', source: 'fldigi', data: statusPayload() },
        { type: 'plugin', event: 'fldigi-rx', source: 'fldigi', data: { text: rxText, reset: true } },
      ];
    }

    const instance = {
      connect,
      disconnect,
      getStatus,
      getSseSnapshot,
      getRxText: () => rxText,
      getForms: () => forms.slice(),
      sendText,
      sendIcs213,
      setMode,
      abort,
      pollOnce,
    };
    return instance;
  },
};

module.exports = descriptor;
module.exports._internals = { cleanRx, cleanTx, splitDirs, formatFldigiTx };
