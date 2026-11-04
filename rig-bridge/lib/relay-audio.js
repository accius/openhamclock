'use strict';
/**
 * relay-audio.js — carries KiwiSDR audio over the Cloud Relay (opt-in).
 *
 *   browser ──GET /api/rig-bridge/relay/audio──► OHC server ──queues "kiwiAudioStart"──►
 *   rig-bridge (cloud-relay long-poll) → kiwi-audio session (µ-law) →
 *   POST /api/rig-bridge/relay/audio/upload (one long chunked request) → server → browser
 *
 * Commands handled (from the relay command queue — cloud-relay.js has already
 * verified their end-to-end signature; kiwiAudioStart is never accepted
 * unsigned, it starts a receiver):
 *   kiwiAudioStart { freqKHz, mode }   open a Kiwi session and start uploading
 *   kiwiAudioTune  { freqKHz, mode }   retune it
 *   kiwiAudioStop                      end it
 *
 * The server ends the upload (responds) when the last browser listener goes
 * away; that response — or any upload error — ends the Kiwi session, so the
 * receiver slot is only held while someone listens. µ-law halves the
 * bandwidth: ~12 kB/s for a 12 kHz Kiwi.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Node's HTTP server cuts any request that takes longer than requestTimeout
// (300 s by default) to arrive, so the upload is rolled over to a fresh
// request every SEGMENT_MS; the server swaps it in without the listener
// noticing.
const SEGMENT_MS = 240 * 1000;

/**
 * @param {{ serverUrl: string, apiKey: string, session: string,
 *           getKiwiAudio: () => ({ openSession: Function } | null),
 *           parseTune: (freq, mode) => object, log?: (msg: string) => void,
 *           extraHeaders?: () => object }} opts   extraHeaders: e.g. X-Relay-Read-Hash, as the
 *           cloud relay's other requests send
 */
function createRelayAudio({
  serverUrl,
  apiKey,
  session,
  getKiwiAudio,
  parseTune,
  log = () => {},
  segmentMs = SEGMENT_MS,
  extraHeaders = () => ({}),
}) {
  let active = null; // { handle, req, startedAt, bytes }
  let lastError = null;

  function stop(reason) {
    const a = active;
    active = null;
    if (!a) return;
    try {
      a.handle.stop(reason);
    } catch (e) {}
    if (a.segTimer) clearInterval(a.segTimer);
    if (a.req) {
      try {
        a.req.destroy();
      } catch (e) {}
    }
  }

  function start(payload = {}) {
    const kiwi = getKiwiAudio();
    if (!kiwi) {
      lastError = 'KiwiSDR Audio plugin is not enabled';
      log(`relay audio: ${lastError}`);
      return false;
    }
    const t = parseTune(payload.freqKHz, payload.mode);
    if (t.error) {
      lastError = t.error;
      return false;
    }
    stop('replaced');
    let url;
    try {
      url = new URL(`${serverUrl.replace(/\/$/, '')}/api/rig-bridge/relay/audio/upload`);
    } catch (e) {
      lastError = `Invalid relay URL: ${serverUrl}`;
      return false;
    }
    url.searchParams.set('session', session);
    const mod = url.protocol === 'https:' ? https : http;
    const a = { handle: null, req: null, startedAt: Date.now(), bytes: 0, segTimer: null, segments: 0 };
    active = a;

    function openUpload(meta) {
      const req = mod.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${apiKey}`,
          'X-Relay-Session': session,
          ...extraHeaders(),
          'X-Sample-Rate': String(meta.sampleRate),
          'X-Audio-Format': meta.codec,
          ...(meta.cwPitchHz ? { 'X-CW-Pitch': String(meta.cwPitchHz) } : {}),
        },
      });
      const prev = a.req;
      a.req = req;
      a.segments++;
      // The server answers the current upload only when the last listener has
      // gone (or to refuse); answers to retired segments are expected.
      req.on('response', (res) => {
        res.resume();
        if (active === a && a.req === req) {
          log(`relay audio: server ended the upload (${res.statusCode})`);
          stop('relay listeners left');
        }
      });
      req.on('error', (err) => {
        if (active === a && a.req === req) {
          lastError = err.message;
          stop(`upload error: ${err.message}`);
        }
      });
      if (typeof req.flushHeaders === 'function') req.flushHeaders();
      if (prev) {
        // Overlap the segments briefly so the server has the new one before
        // the old one finishes (it waits a few seconds for a successor anyway).
        const t = setTimeout(() => {
          try {
            prev.end();
          } catch (e) {}
        }, 1000);
        if (t.unref) t.unref();
      }
      return req;
    }

    const sink = {
      start(meta) {
        if (active !== a) return;
        openUpload(meta);
        a.segTimer = setInterval(() => {
          if (active === a) openUpload(meta);
        }, segmentMs);
        if (a.segTimer.unref) a.segTimer.unref();
        log(`relay audio: uploading ${t.freqKHz} kHz ${t.mode} (${meta.codec} @ ${meta.sampleRate} Hz)`);
      },
      write(buf, onDrain) {
        if (active !== a || !a.req) return true;
        a.bytes += buf.length;
        const ok = a.req.write(buf);
        if (!ok) a.req.once('drain', onDrain);
        return ok;
      },
      fail(status, error) {
        lastError = error;
        log(`relay audio: ${error}`);
        if (active === a) active = null;
      },
      end() {
        if (a.segTimer) clearInterval(a.segTimer);
        if (a.req) {
          try {
            a.req.end();
          } catch (e) {}
        }
        if (active === a) active = null;
      },
    };
    a.handle = kiwi.openSession({ tuning: t, codec: 'ulaw', sink });
    return true;
  }

  function handleCommand(cmd) {
    switch (cmd && cmd.type) {
      case 'kiwiAudioStart':
        start(cmd.payload);
        return true;
      case 'kiwiAudioTune': {
        if (!active) return true;
        const t = parseTune(cmd.payload?.freqKHz, cmd.payload?.mode);
        if (!t.error) active.handle.tune(t);
        return true;
      }
      case 'kiwiAudioStop':
        stop('stopped by listener');
        return true;
      default:
        return false;
    }
  }

  function status() {
    return {
      active: !!active,
      segments: active ? active.segments : 0,
      startedAt: active ? active.startedAt : null,
      bytes: active ? active.bytes : 0,
      lastError,
    };
  }

  return { handleCommand, stop, status };
}

module.exports = { createRelayAudio };
