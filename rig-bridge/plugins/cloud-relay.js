'use strict';
/**
 * cloud-relay.js — Rig Bridge Cloud Relay
 *
 * Bridges the gap between a locally-running rig-bridge and a cloud-hosted
 * OpenHamClock instance. Provides all rig-bridge features to cloud users
 * by relaying state and commands over HTTPS.
 *
 * How it works:
 *   1. LOCAL → CLOUD: Pushes rig state (freq, mode, PTT, WSJT-X decodes,
 *      APRS packets, etc.) to the cloud OHC instance periodically.
 *   2. CLOUD → LOCAL: Polls the cloud instance for pending commands (tune,
 *      PTT, WSJT-X reply, APRS message) and executes them locally.
 *
 * This means cloud-hosted OHC users get the same rig control capabilities
 * as local users — click-to-tune, PTT, WSJT-X decode replies, APRS messaging —
 * all proxied through this relay.
 *
 * Config section: config.cloudRelay
 *   enabled:        boolean  (default: false)
 *   url:            string   Cloud OHC URL (e.g. 'https://openhamclock.com')
 *   apiKey:         string   Authentication key for the relay
 *   session:        string   Browser session ID for per-user isolation
 *   pushInterval:   number   State push interval in ms (default: 2000)
 *   relayRig:       boolean  Relay rig state (default: true)
 *   relayWsjtx:     boolean  Relay WSJT-X decodes (default: true)
 *   relayAprs:      boolean  Relay APRS packets (default: true)
 *   relayFldigi:    boolean  Relay the fldigi plugin's status, receive text and
 *                            flmsg forms, and accept NBEMS commands (default: true)
 *   relayAudio:     boolean  Carry KiwiSDR audio to the Decoder panel while it
 *                            listens (µ-law, ~12 kB/s; default: false — opt-in)
 *   verbose:        boolean  Log all relay activity (default: false)
 *   commandKey:     string   64-hex key shared with the browser that pressed
 *                            Connect Cloud Relay (never sent to the server).
 *                            When set, every command must carry a valid
 *                            HMAC (lib/relay-sign.js) or it is refused.
 *   allowUnsigned:  boolean  Accept unsigned commands of every kind, as before
 *                            command signing existed (default: false — unsafe)
 *   unsignedGraceUntil: string  Without a commandKey, unsigned tuning
 *                            (setFreq / setMode) is still accepted until this
 *                            date (default '2027-01-31'); PTT and anything that
 *                            transmits never is.
 *
 * Command authentication: the hosted server only queues commands, and anyone
 * who learns a session id can queue one, so Rig Bridge decides. See
 * authorizeCommand() below.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createRelayAudio } = require('../lib/relay-audio');
const { nextLongPollDelay, heartbeatDue } = require('../lib/relay-timing');
const { createCommandVerifier, isValidKey, deriveReadToken, readTokenHash } = require('../lib/relay-sign');

// Unsigned commands a bridge that has not been re-paired still accepts during
// the grace period: they tune, they never transmit.
const LEGACY_UNSIGNED_TYPES = new Set(['setFreq', 'setMode']);
const DEFAULT_UNSIGNED_GRACE_UNTIL = '2027-01-31';

let _currentInstance = null;

const descriptor = {
  id: 'cloud-relay',
  name: 'Rig Bridge Cloud Relay',
  category: 'integration',
  configKey: 'cloudRelay',

  registerRoutes(app) {
    app.get('/api/cloud-relay/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config, services) {
    const cfg = config.cloudRelay || {};
    const serverUrl = (cfg.url || '').replace(/\/$/, '');
    const apiKey = cfg.apiKey || '';
    const session = cfg.session || '';
    const pushInterval = cfg.pushInterval || 2000; // Fallback interval for data batches

    // ── Command authentication ─────────────────────────────────────────────
    // Read live so a key pasted into the setup page applies without a restart
    const live = () => config.cloudRelay || cfg;
    const commandKey = () =>
      String(live().commandKey || '')
        .trim()
        .toLowerCase();
    const verifier = createCommandVerifier({ key: commandKey, session: () => session });
    const graceUntil = (() => {
      const t = Date.parse(cfg.unsignedGraceUntil || DEFAULT_UNSIGNED_GRACE_UNTIL);
      return Number.isFinite(t) ? t : Date.parse(DEFAULT_UNSIGNED_GRACE_UNTIL);
    })();
    // sha256 of the relay read token (lib/relay-sign deriveReadToken); '' unpaired
    let readHashCache = { key: null, hash: '' };
    function readHash() {
      const k = commandKey();
      if (readHashCache.key !== k) {
        readHashCache = { key: k, hash: isValidKey(k) ? readTokenHash(deriveReadToken(k, session)) : '' };
      }
      return readHashCache.hash;
    }
    const warnedAt = new Map(); // reason → last log time
    let refusedCommands = 0;

    // Every plugin-bus listener this instance adds, so disconnect() can remove
    // them all — otherwise each restart of the relay added another set.
    let busListeners = [];
    let running = false;
    function onBus(event, fn) {
      pluginBus.on(event, fn);
      busListeners.push([event, fn]);
    }
    function warnOnce(key, msg, everyMs = 3600000) {
      const t = Date.now();
      if (t - (warnedAt.get(key) || 0) < everyMs) return;
      warnedAt.set(key, t);
      console.warn(`[CloudRelay] ${msg}`);
    }

    /**
     * Decide whether a relayed command may run.
     *  - paired (commandKey set): only a valid, fresh, unreplayed signature.
     *  - not paired: allowUnsigned restores the old accept-everything
     *    behaviour; otherwise tuning only, and only until unsignedGraceUntil.
     * @returns {{ ok: boolean, reason?: string }}
     */
    function authorizeCommand(cmd) {
      const paired = isValidKey(commandKey());
      const r = verifier.verify(cmd);
      if (r.ok) return r;
      if (paired) return r;
      if (live().allowUnsigned === true) {
        warnOnce('allow', 'allowUnsigned is on — relay commands are accepted without proof they came from you');
        return { ok: true };
      }
      if (LEGACY_UNSIGNED_TYPES.has(cmd?.type) && Date.now() < graceUntil) {
        warnOnce(
          'grace',
          `Accepting unsigned ${cmd.type} until ${new Date(graceUntil).toISOString().slice(0, 10)} — ` +
            're-run Connect Cloud Relay in OpenHamClock and paste the new settings (they include a command key)',
        );
        return { ok: true };
      }
      return { ok: false, reason: 'unsigned-refused' };
    }
    const { state, pluginBus, onStateChange, removeStateChangeListener } = services;

    let pushTimer = null;
    let pollRetryTimer = null; // Used only for error-backoff delays between long-poll attempts
    let pollAborted = false; // Set on disconnect to stop the long-poll loop
    let immediatePushTimer = null;
    let stateChangeHandler = null;
    let lastPttState = null; // Track PTT separately to detect PTT-specific changes
    let serverReachable = false;
    let credentialsInvalid = false; // Set permanently on 401/403 — stops all retry loops
    let totalPushed = 0;
    let totalCommands = 0;
    let totalDecodes = 0;
    let consecutiveErrors = 0;
    let lastPushAt = 0; // last successful push, for the heartbeat
    let lastState = {};
    let pendingDecodes = []; // Batched decodes to push
    let pendingAprs = []; // Batched APRS packets to push
    let pendingMeshCom = []; // Batched MeshCom packets to push
    let pendingHamAlerts = []; // Batched HamAlert spots to push
    // fldigi / NBEMS: latest status, accumulated receive text, forms and
    // command results — pushed as `pluginEvents` with the same
    // { event, source, data } shape the local /stream uses.
    let pendingFldigiStatus = null;
    let pendingFldigiRx = null; // { text, reset }
    let pendingFldigiOther = []; // nbems-form / fldigi-cmd-result
    let fldigiPushTimer = null;
    function schedulePluginPush() {
      if (fldigiPushTimer) return;
      fldigiPushTimer = setTimeout(() => {
        fldigiPushTimer = null;
        pushState();
      }, 250);
    }
    // Refusals reported back to the browser, at most one per type + reason
    // every 30 s (indicators repeat every few seconds).
    const refusalReportedAt = new Map();
    const cleanRequestId = (v) =>
      String(v || '')
        .replace(/[^A-Za-z0-9-]/g, '')
        .slice(0, 40);
    function queueRelayEvent(event, data) {
      pendingFldigiOther.push({ event, source: 'cloud-relay', data });
      if (pendingFldigiOther.length > 50) pendingFldigiOther.splice(0, pendingFldigiOther.length - 50);
      schedulePluginPush();
    }
    // A refusal for a command that carried a requestId is always reported
    // (someone is waiting for it); anonymous ones are rate-limited.
    function reportRefusal(type, reason, requestId = '') {
      const key = `${type}|${reason}`;
      const t = Date.now();
      if (!requestId) {
        if (t - (refusalReportedAt.get(key) || 0) < 30000) return;
        refusalReportedAt.set(key, t);
      }
      queueRelayEvent('relay-cmd-refused', {
        type: String(type || '').slice(0, 40),
        reason,
        at: t,
        ...(requestId ? { requestId } : {}),
      });
    }
    const FLDIGI_RX_MAX = 8000;

    // Opt-in KiwiSDR audio over the relay (see lib/relay-audio.js)
    const relayAudio = cfg.relayAudio
      ? createRelayAudio({
          serverUrl,
          apiKey,
          session,
          getKiwiAudio: () => {
            if (services && services.kiwiAudio) return services.kiwiAudio; // tests
            try {
              return require('./kiwi-audio').getActive();
            } catch (e) {
              return null;
            }
          },
          parseTune: (f, m) => require('./kiwi-audio').parseTune(f, m),
          log: (m) => console.log(`[CloudRelay] ${m}`),
          // same read-token registration as every other bridge → server call
          extraHeaders: () => (readHash() ? { 'X-Relay-Read-Hash': readHash() } : {}),
        })
      : null;
    let audioRefusedLogged = false;

    function makeRequest(urlStr, method, body, callback, timeoutMs) {
      let parsed;
      try {
        parsed = new URL(urlStr);
      } catch (e) {
        if (callback) callback(new Error(`Invalid URL: ${urlStr}`));
        return;
      }

      const mod = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Relay-Session': session,
      };
      // Register the read-token hash on every authenticated request, so the
      // server protects this session's reads even right after it restarts.
      const rh = readHash();
      if (rh) headers['X-Relay-Read-Hash'] = rh;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
      };

      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (callback) callback(null, res.statusCode, data);
        });
      });
      req.on('error', (err) => {
        if (callback) callback(err);
      });
      req.setTimeout(timeoutMs || 5000, () => {
        req.destroy(new Error('Timeout'));
      });
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    }

    // Called on 401/403 — permanently stops all relay loops so the user isn't
    // spammed with auth errors. They must re-run "Connect Cloud Relay" in OHC
    // Settings to generate fresh credentials.
    function handleCredentialsInvalid(status, data) {
      if (credentialsInvalid) return;
      credentialsInvalid = true;
      try {
        const msg = JSON.parse(data)?.error || data;
        console.error(`[CloudRelay] Authentication failed (${status}): ${msg}`);
      } catch {
        console.error(
          `[CloudRelay] Authentication failed (${status}) — re-run Connect Cloud Relay in OHC Settings → Rig Bridge`,
        );
      }
      console.error(
        '[CloudRelay] Stopping relay — re-run Connect Cloud Relay in OHC Settings → Rig Bridge to get fresh credentials, then restart rig-bridge',
      );
      // Stop push timer
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      // Stop long-poll loop
      pollAborted = true;
      if (pollRetryTimer) {
        clearTimeout(pollRetryTimer);
        pollRetryTimer = null;
      }
      if (immediatePushTimer) {
        clearTimeout(immediatePushTimer);
        immediatePushTimer = null;
      }
    }

    // Push current rig state + batched decodes to cloud
    function pushState() {
      if (credentialsInvalid) return;
      const currentState = {
        freq: state.freq,
        mode: state.mode,
        ptt: state.ptt,
        connected: state.connected,
        width: state.width,
        timestamp: Date.now(),
      };

      const hasDecodes = pendingDecodes.length > 0;
      const hasAprs = pendingAprs.length > 0;
      const hasMeshCom = pendingMeshCom.length > 0;
      const hasHamAlerts = pendingHamAlerts.length > 0;
      const hasPluginEvents = !!(pendingFldigiStatus || pendingFldigiRx || pendingFldigiOther.length);
      const stateChanged =
        currentState.freq !== lastState.freq ||
        currentState.mode !== lastState.mode ||
        currentState.ptt !== lastState.ptt ||
        currentState.connected !== lastState.connected;

      // Only push if state changed or there's data to send — or a heartbeat is
      // due: the server forgets sessions on restart and after an idle TTL, and
      // an unchanged rig would otherwise never re-register.
      const hasData = hasDecodes || hasAprs || hasMeshCom || hasHamAlerts || hasPluginEvents;
      if (!stateChanged && !hasData && !heartbeatDue(Date.now(), lastPushAt)) return;
      lastState = { ...currentState };

      // Include batched data in the push
      // commandAuth tells the server to refuse unsigned commands for this session
      const payload = {
        ...currentState,
        session,
        commandAuth: isValidKey(commandKey()) ? 'hmac-sha256' : 'none',
        ...(readHash() ? { readTokenHash: readHash() } : {}),
      };
      if (hasDecodes) {
        payload.decodes = pendingDecodes.splice(0, 50);
        totalDecodes += payload.decodes.length;
      }
      if (hasAprs) {
        payload.aprsPackets = pendingAprs.splice(0, 50);
      }
      if (hasMeshCom) {
        payload.meshcomPackets = pendingMeshCom.splice(0, 50);
      }
      if (hasHamAlerts) {
        payload.hamAlerts = pendingHamAlerts.splice(0, 50);
      }
      let sentFldigi = null;
      if (hasPluginEvents) {
        sentFldigi = { status: pendingFldigiStatus, rx: pendingFldigiRx, other: pendingFldigiOther.splice(0, 20) };
        pendingFldigiStatus = null;
        pendingFldigiRx = null;
        payload.pluginEvents = [
          ...(sentFldigi.status ? [{ event: 'fldigi', source: 'fldigi', data: sentFldigi.status }] : []),
          ...(sentFldigi.rx ? [{ event: 'fldigi-rx', source: 'fldigi', data: sentFldigi.rx }] : []),
          ...sentFldigi.other,
        ];
      }

      makeRequest(`${serverUrl}/api/rig-bridge/relay/state`, 'POST', payload, (err, status, data) => {
        if (err) {
          if (serverReachable) console.error(`[CloudRelay] Push error: ${err.message}`);
          serverReachable = false;
          consecutiveErrors++;
          // Restore all batched data so it is retried on the next push cycle
          if (payload.decodes) pendingDecodes.unshift(...payload.decodes);
          if (payload.aprsPackets) pendingAprs.unshift(...payload.aprsPackets);
          if (payload.meshcomPackets) pendingMeshCom.unshift(...payload.meshcomPackets);
          if (payload.hamAlerts) pendingHamAlerts.unshift(...payload.hamAlerts);
          if (sentFldigi) {
            pendingFldigiStatus = pendingFldigiStatus || sentFldigi.status;
            if (sentFldigi.rx) {
              pendingFldigiRx = pendingFldigiRx
                ? pendingFldigiRx.reset
                  ? pendingFldigiRx
                  : {
                      text: (sentFldigi.rx.text + pendingFldigiRx.text).slice(-FLDIGI_RX_MAX),
                      reset: sentFldigi.rx.reset,
                    }
                : sentFldigi.rx;
            }
            pendingFldigiOther.unshift(...sentFldigi.other);
          }
          return;
        }
        if (status === 200) {
          serverReachable = true;
          consecutiveErrors = 0;
          totalPushed++;
          lastPushAt = Date.now();
          if (cfg.verbose) {
            const decodeInfo = payload.decodes ? ` + ${payload.decodes.length} decodes` : '';
            console.log(`[CloudRelay] Pushed state (${currentState.freq} Hz ${currentState.mode}${decodeInfo})`);
          }
        } else if (status === 401 || status === 403) {
          handleCredentialsInvalid(status, data);
        }
      });
    }

    // Long-poll loop — holds the connection open for up to LONG_POLL_WAIT ms.
    // The server resolves the request immediately when a command is queued,
    // so latency is ~network RTT rather than the push interval.
    // On timeout (no commands) it restarts immediately. On network error, or an
    // empty response the server did not hold, it waits before retrying — see
    // lib/relay-timing.js.
    const LONG_POLL_WAIT = 28000; // ms to hold open (server caps at 30 s)

    function longPollCommands() {
      if (pollAborted) return;
      const startedAt = Date.now();
      const url =
        `${serverUrl}/api/rig-bridge/relay/commands` + `?session=${encodeURIComponent(session)}&wait=${LONG_POLL_WAIT}`;

      makeRequest(
        url,
        'GET',
        null,
        (err, status, data) => {
          if (pollAborted) return;

          if (!err && (status === 401 || status === 403)) {
            // Invalid credentials — stop permanently, no retry
            handleCredentialsInvalid(status, data);
            return;
          }
          const ok = !err && status === 200;
          let commandCount = 0;
          if (ok) {
            try {
              const response = JSON.parse(data);
              const commands = response.commands || [];
              commandCount = commands.length;
              for (const cmd of commands) executeCommand(cmd);
            } catch (e) {}
          }
          const delay = nextLongPollDelay({ ok, elapsedMs: Date.now() - startedAt, commandCount });
          if (delay === 0) longPollCommands();
          else pollRetryTimer = setTimeout(longPollCommands, delay);
        },
        LONG_POLL_WAIT + 4000, // HTTP timeout = hold window + 4 s network buffer
      );
    }

    // Execute a command received from the cloud
    // Uses https when rig-bridge TLS is enabled, http otherwise.
    // All requests have an error handler to prevent unhandled-error crashes.
    function executeCommand(cmd) {
      totalCommands++;
      const verdict = authorizeCommand(cmd);
      if (!verdict.ok) {
        refusedCommands++;
        reportRefusal(cmd?.type, verdict.reason, cleanRequestId(cmd?.payload?.requestId));
        warnOnce(
          `refused-${verdict.reason}`,
          `Refused relay command ${cmd?.type} (${verdict.reason})` +
            (verdict.reason === 'unsigned-refused' || verdict.reason === 'unsigned'
              ? ' — re-run Connect Cloud Relay in OpenHamClock and paste the new settings into Rig Bridge'
              : ''),
          60000,
        );
        if (cmd?.type === 'fldigi' && pluginBus && cmd.payload?.requestId) {
          pluginBus.emit('fldigi-cmd-result', {
            requestId: String(cmd.payload.requestId)
              .replace(/[^A-Za-z0-9-]/g, '')
              .slice(0, 40),
            ok: false,
            status: 401,
            error: `Relay command refused by Rig Bridge (${verdict.reason})`,
          });
        }
        return;
      }
      if (cfg.verbose) console.log(`[CloudRelay] Command: ${cmd.type} ${JSON.stringify(cmd.payload || {})}`);

      if (relayAudio && relayAudio.handleCommand(cmd)) return;
      if (!relayAudio && /^kiwiAudio/.test(cmd.type || '')) {
        if (!audioRefusedLogged) {
          audioRefusedLogged = true;
          console.log('[CloudRelay] KiwiSDR audio was requested but "Relay KiwiSDR audio" is off — enable it to allow');
        }
        return;
      }

      const localMod = config.tls?.enabled ? https : http;
      const localOptions = (path, body) => ({
        hostname: '127.0.0.1',
        port: config.port || 5555,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': config.apiToken || '' },
        // Skip cert verification for loopback self-signed cert
        rejectUnauthorized: false,
      });

      switch (cmd.type) {
        case 'setFreq':
          if (cmd.payload?.freq) {
            const freqReq = localMod.request(localOptions('/freq'), () => {});
            freqReq.on('error', (err) => {
              if (cfg.verbose) console.error(`[CloudRelay] setFreq dispatch error: ${err.message}`);
            });
            freqReq.write(JSON.stringify({ freq: cmd.payload.freq }));
            freqReq.end();
          }
          break;
        case 'setMode':
          if (cmd.payload?.mode) {
            const modeReq = localMod.request(localOptions('/mode'), () => {});
            modeReq.on('error', (err) => {
              if (cfg.verbose) console.error(`[CloudRelay] setMode dispatch error: ${err.message}`);
            });
            modeReq.write(JSON.stringify({ mode: cmd.payload.mode }));
            modeReq.end();
          }
          break;
        case 'setPTT':
          if (cmd.payload != null) {
            const pttReq = localMod.request(localOptions('/ptt'), () => {});
            pttReq.on('error', (err) => {
              if (cfg.verbose) console.error(`[CloudRelay] setPTT dispatch error: ${err.message}`);
            });
            pttReq.write(JSON.stringify({ ptt: !!cmd.payload.ptt }));
            pttReq.end();
          }
          break;
        case 'fldigi':
          runFldigiCommand(cmd.payload || {}, localMod, localOptions);
          break;
        case 'indicators':
          // Display indicator state (satellite, countdown, alarm, lightning
          // guard relay) from a browser in cloud-relay mode → the same local
          // /api/indicators the browser would POST to directly.
          // A browser waiting to acknowledge a lightning-relay report sends a
          // requestId; the bridge's answer goes back as 'relay-cmd-result'.
          if (cmd.payload && typeof cmd.payload === 'object') {
            const requestId = cleanRequestId(cmd.payload.requestId);
            const answer = (ok, status) => {
              if (requestId) queueRelayEvent('relay-cmd-result', { requestId, type: 'indicators', ok, status });
            };
            const indReq = localMod.request(localOptions('/api/indicators'), (res) => {
              res.resume();
              answer(res.statusCode >= 200 && res.statusCode < 300, res.statusCode);
            });
            indReq.on('error', (err) => {
              if (cfg.verbose) console.error(`[CloudRelay] indicators dispatch error: ${err.message}`);
              answer(false, 502);
            });
            indReq.write(JSON.stringify(cmd.payload));
            indReq.end();
          }
          break;
        default:
          if (cfg.verbose) console.log(`[CloudRelay] Unknown command type: ${cmd.type}`);
      }
    }

    // NBEMS commands from the browser: run against the local fldigi plugin
    // routes once authorizeCommand() has accepted the command's signature
    // (they transmit, so they are never accepted unsigned unless
    // allowUnsigned is on). The signature, not a token carried through the
    // server, is the proof that the paired browser sent it. The outcome goes
    // back as a 'fldigi-cmd-result' plugin event.
    const FLDIGI_ACTIONS = new Set(['send', 'send-ics213', 'mode', 'abort']);
    function runFldigiCommand(p, localMod, localOptions) {
      const requestId = String(p.requestId || '')
        .replace(/[^A-Za-z0-9-]/g, '')
        .slice(0, 40);
      const done = (result) => {
        if (pluginBus && requestId) pluginBus.emit('fldigi-cmd-result', { requestId, ...result });
      };
      if (cfg.relayFldigi === false)
        return done({ ok: false, status: 403, error: 'fldigi relay is off in Rig Bridge' });
      if (!FLDIGI_ACTIONS.has(p.action)) return done({ ok: false, status: 400, error: 'Unknown fldigi action' });
      const body = JSON.stringify(p.body && typeof p.body === 'object' ? p.body : {});
      const opts = localOptions(`/api/fldigi/${p.action}`);
      const req = localMod.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(data);
          } catch (e) {}
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          done({ ...parsed, ok, status: res.statusCode });
        });
      });
      req.on('error', (err) => done({ ok: false, status: 502, error: err.message }));
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    }

    function connect() {
      if (!serverUrl || !apiKey || !session) {
        console.error('[CloudRelay] Cannot start: url, apiKey, and session are required');
        return;
      }

      if (running) return; // already connected — never subscribe twice
      running = true;
      pollAborted = false;

      console.log(`[CloudRelay] Starting relay to ${serverUrl}`);
      if (commandKey() && !isValidKey(commandKey())) {
        console.warn(
          '[CloudRelay] commandKey is not 64 hex characters — ignored; paste it again from Connect Cloud Relay',
        );
      } else if (!commandKey()) {
        console.warn(
          '[CloudRelay] No commandKey: PTT and transmit commands from the relay are refused, tuning is accepted until ' +
            new Date(graceUntil).toISOString().slice(0, 10) +
            ' — re-run Connect Cloud Relay in OpenHamClock and paste the new settings',
        );
      }
      console.log(`[CloudRelay] Push interval: ${pushInterval}ms, Command delivery: long-poll`);

      // Initial health check
      makeRequest(`${serverUrl}/api/health`, 'GET', null, (err, status) => {
        if (!err && status === 200) {
          serverReachable = true;
          console.log(`[CloudRelay] Server reachable (${serverUrl})`);
        } else {
          console.error(`[CloudRelay] Server not reachable: ${err ? err.message : `HTTP ${status}`}`);
        }
      });

      // Push on state changes:
      //   PTT changes → push immediately (no debounce) — operators need instant TX feedback
      //   freq/mode/connected changes → 50ms debounce to collapse rapid VFO spinning
      if (typeof onStateChange === 'function') {
        stateChangeHandler = () => {
          const pttChanged = state.ptt !== lastPttState;
          if (pttChanged) {
            lastPttState = state.ptt;
            // Cancel any pending debounced push and push right now
            if (immediatePushTimer) clearTimeout(immediatePushTimer);
            immediatePushTimer = null;
            pushState();
          } else {
            if (immediatePushTimer) clearTimeout(immediatePushTimer);
            immediatePushTimer = setTimeout(pushState, 50);
          }
        };
        onStateChange(stateChangeHandler);
        console.log('[CloudRelay] Subscribed to immediate state changes');
      }

      // Fallback interval for batched data (decodes, APRS) even if state hasn't changed
      pushTimer = setInterval(pushState, pushInterval);

      // Start long-poll command loop — replaces the old fixed-interval poll.
      // Each iteration holds the server connection open until a command arrives
      // or the 28 s window expires, so commands are delivered within ~RTT.
      longPollCommands();

      // Subscribe to plugin bus — batch decodes, APRS, and MeshCom packets for push.
      // cfg.relayWsjtx and cfg.relayAprs default to true to preserve existing behaviour.
      // cfg.relayMeshCom defaults to true.
      if (pluginBus) {
        const relayWsjtx = cfg.relayWsjtx !== false;
        const relayAprs = cfg.relayAprs !== false;
        const relayMeshCom = cfg.relayMeshCom !== false;
        const subscribed = [];

        if (relayWsjtx) {
          onBus('decode', (msg) => {
            pendingDecodes.push({
              source: msg.source,
              message: msg.message,
              snr: msg.snr,
              deltaFreq: msg.deltaFreq,
              mode: msg.mode,
              time: msg.time?.formatted,
              timestamp: msg.timestamp,
            });
            // Cap pending queue
            if (pendingDecodes.length > 200) pendingDecodes.splice(0, pendingDecodes.length - 200);
          });
          subscribed.push('WSJT-X');
        }
        if (relayAprs) {
          onBus('aprs', (packet) => {
            pendingAprs.push(packet);
            if (pendingAprs.length > 200) pendingAprs.splice(0, pendingAprs.length - 200);
          });
          subscribed.push('APRS');
        }
        if (relayMeshCom) {
          onBus('meshcom', (packet) => {
            pendingMeshCom.push(packet);
            if (pendingMeshCom.length > 200) pendingMeshCom.splice(0, pendingMeshCom.length - 200);
          });
          subscribed.push('MeshCom');
        }
        if (cfg.relayHamAlert !== false) {
          onBus('hamalert', (alert) => {
            pendingHamAlerts.push(alert);
            if (pendingHamAlerts.length > 200) pendingHamAlerts.splice(0, pendingHamAlerts.length - 200);
          });
          subscribed.push('HamAlert');
        }
        if (cfg.relayFldigi !== false) {
          const soon = () => {
            if (fldigiPushTimer) return;
            fldigiPushTimer = setTimeout(() => {
              fldigiPushTimer = null;
              pushState();
            }, 250);
          };
          onBus('fldigi', (status) => {
            pendingFldigiStatus = status;
            soon();
          });
          onBus('fldigi-rx', (rx) => {
            const text = String(rx?.text ?? '');
            if (rx?.reset || !pendingFldigiRx) {
              pendingFldigiRx = { text: text.slice(-FLDIGI_RX_MAX), reset: !!rx?.reset };
            } else {
              pendingFldigiRx = {
                text: (pendingFldigiRx.text + text).slice(-FLDIGI_RX_MAX),
                reset: pendingFldigiRx.reset,
              };
            }
            soon();
          });
          for (const event of ['nbems-form', 'fldigi-cmd-result']) {
            onBus(event, (data) => {
              const { fields, ...slim } = data || {};
              pendingFldigiOther.push({ event, source: 'fldigi', data: slim });
              if (pendingFldigiOther.length > 50) pendingFldigiOther.splice(0, pendingFldigiOther.length - 50);
              soon();
            });
          }
          subscribed.push('fldigi');
        }
        console.log(`[CloudRelay] Subscribed to plugin bus (${subscribed.join(', ')})`);
      }
    }

    function disconnect() {
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      // Signal the long-poll loop to stop; clear any pending error-backoff timer
      pollAborted = true;
      if (pollRetryTimer) {
        clearTimeout(pollRetryTimer);
        pollRetryTimer = null;
      }
      if (immediatePushTimer) {
        clearTimeout(immediatePushTimer);
        immediatePushTimer = null;
      }
      clearTimeout(fldigiPushTimer);
      fldigiPushTimer = null;
      if (stateChangeHandler && typeof removeStateChangeListener === 'function') {
        removeStateChangeListener(stateChangeHandler);
      }
      stateChangeHandler = null;
      for (const [event, fn] of busListeners) pluginBus.removeListener(event, fn);
      busListeners = [];
      running = false;
      if (relayAudio) relayAudio.stop('relay stopped');
      _currentInstance = null;
      console.log(`[CloudRelay] Stopped (pushed: ${totalPushed}, commands: ${totalCommands})`);
    }

    function getStatus() {
      return {
        enabled: !!(cfg.url && cfg.apiKey),
        running: pushTimer !== null,
        serverReachable,
        serverUrl,
        totalPushed,
        totalCommands,
        consecutiveErrors,
        pushInterval,
        commandDelivery: 'long-poll',
        audio: relayAudio ? relayAudio.status() : { enabled: false },
        commandAuth: isValidKey(commandKey())
          ? 'hmac-sha256'
          : live().allowUnsigned === true
            ? 'unsigned-allowed'
            : 'legacy',
        unsignedGraceUntil: new Date(graceUntil).toISOString().slice(0, 10),
        refusedCommands,
      };
    }

    const instance = { connect, disconnect, getStatus, _pushState: pushState, _executeCommand: executeCommand };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
