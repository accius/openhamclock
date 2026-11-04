'use strict';
/**
 * APRS message acknowledgements (#1244, #1247).
 *
 * Outgoing (#1247): a message to a callsign is sent with a message id and
 * re-sent on a doubling interval (30 s, 60 s, 120 s …) until the addressee
 * acks (or rejects) it or `maxTries` transmissions have gone out — what
 * Yaesu radios and aprs.fi do. Messages to an alias, a group or a bulletin
 * (EMCOMM, BLN1, W8ROC-net aliases) can never be acked, so they go out once
 * without an id, as before.
 *
 * Incoming (#1244): a message addressed to this station's exact
 * callsign-SSID that carries an id is acked, every copy (the sender keeps
 * retrying until one of our acks gets through).
 *
 * Settings are read on every call, so the Rig Bridge settings page applies
 * them without a restart. Timers and the clock are injectable for tests.
 */

const { unwrapThirdParty, parseMessagePayload } = require('./aprs-parser');

const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 8 * 60 * 1000;
const KEEP_DONE_MS = 60 * 60 * 1000; // finished messages stay listed for an hour
const MAX_TRACKED = 100;

// A callsign (optionally with SSID): 1–2 chars, a digit, 1–4 letters.
const CALLSIGN_RE = /^[A-Z0-9]{1,2}[0-9][A-Z]{1,4}(-[0-9]{1,2})?$/;

const norm = (c) =>
  String(c || '')
    .trim()
    .toUpperCase()
    .replace(/-0$/, '');

/**
 * Parse the info field of an APRS message frame (":ADDRESSEE:text{id").
 * Shared with the server parser (lib/aprs-parser.js): trailing CR trimmed,
 * reply-ack "{MM}AA" split off the text.
 * @returns {null | { to, text, msgId, replyAck, ack, rej }} ack/rej/replyAck hold the acked id
 */
function parseMessageInfo(info) {
  const m = parseMessagePayload(info);
  return m ? { ...m, to: m.to.toUpperCase() } : null;
}

/**
 * @param {object} deps
 * @param {(to, text, msgId|null) => boolean} deps.transmit  send one message frame
 * @param {(to, msgId) => boolean} deps.transmitAck
 * @param {() => string} deps.myCall      this station's callsign-SSID, live
 * @param {() => object} deps.settings    live aprs config: autoAck, messageRetry, messageMaxTries
 * @param {(status) => void} [deps.emit]  outgoing message state changes
 */
function createMessenger({
  transmit,
  transmitAck,
  myCall,
  settings,
  emit = () => {},
  now = Date.now,
  timers = { setTimeout, clearTimeout },
}) {
  const outgoing = new Map(); // msgId → record
  let nextId = 1 + Math.floor(Math.random() * 900); // distinct ids across restarts

  const cfg = () => {
    const s = settings() || {};
    const tries = parseInt(s.messageMaxTries, 10);
    return {
      autoAck: s.autoAck !== false,
      retry: s.messageRetry !== false,
      maxTries: Number.isFinite(tries) ? Math.min(10, Math.max(1, tries)) : 6,
    };
  };

  const view = (r) => ({
    msgId: r.msgId,
    to: r.to,
    text: r.text,
    state: r.state,
    tries: r.tries,
    maxTries: r.maxTries,
    sentAt: r.sentAt,
    updatedAt: r.updatedAt,
  });
  const publish = (r) => {
    r.updatedAt = now();
    try {
      emit(view(r));
    } catch (e) {}
  };

  function prune() {
    const cutoff = now() - KEEP_DONE_MS;
    for (const [id, r] of outgoing) {
      if (r.state !== 'pending' && r.updatedAt < cutoff) outgoing.delete(id);
    }
    while (outgoing.size > MAX_TRACKED) {
      const [oldestId, oldest] = outgoing.entries().next().value;
      if (oldest.timer) timers.clearTimeout(oldest.timer);
      outgoing.delete(oldestId);
    }
  }

  function newId() {
    // Never reuse an id that is still pending
    for (let i = 0; i < 1000; i++) {
      const id = String(nextId);
      nextId = nextId >= 99999 ? 1 : nextId + 1;
      if (!outgoing.has(id)) return id;
    }
    return String(nextId);
  }

  function scheduleRetry(r) {
    const delay = Math.min(RETRY_BASE_MS * 2 ** (r.tries - 1), RETRY_MAX_MS);
    r.timer = timers.setTimeout(() => {
      r.timer = null;
      if (r.state !== 'pending') return;
      if (r.tries >= r.maxTries) {
        r.state = 'expired'; // every try went out, no ack came back
        publish(r);
        return;
      }
      r.tries++;
      transmit(r.to, r.text, r.msgId);
      publish(r);
      scheduleRetry(r);
    }, delay);
  }

  /**
   * Send a message. Returns { ok, msgId, ackRequested }.
   * ok is false when the first transmission could not be made (TNC down).
   */
  function send(to, text) {
    const addressee = norm(to);
    const { retry, maxTries } = cfg();
    const wantAck = retry && CALLSIGN_RE.test(addressee);
    if (!wantAck) {
      return { ok: transmit(addressee, text, null), msgId: null, ackRequested: false };
    }
    const msgId = newId();
    if (!transmit(addressee, text, msgId)) return { ok: false, msgId: null, ackRequested: false };
    const r = { msgId, to: addressee, text, state: 'pending', tries: 1, maxTries, sentAt: now(), timer: null };
    outgoing.set(msgId, r);
    prune();
    publish(r);
    if (maxTries > 1) scheduleRetry(r);
    else {
      // One try only: still wait one interval for a late ack before giving up
      r.timer = timers.setTimeout(() => {
        r.timer = null;
        if (r.state === 'pending') {
          r.state = 'expired';
          publish(r);
        }
      }, RETRY_BASE_MS);
    }
    return { ok: true, msgId, ackRequested: true };
  }

  // Our message `id` to `from` was acked or rejected. True when it was pending.
  function settle(id, from, state) {
    const r = outgoing.get(id);
    if (!r || r.to !== from || r.state !== 'pending') return false;
    if (r.timer) timers.clearTimeout(r.timer);
    r.timer = null;
    r.state = state;
    publish(r);
    return true;
  }

  /** Handle a received frame. Returns what it did, for logging/tests. */
  function handleIncoming(source, info) {
    // An igate relays internet traffic over RF as "}SRC>DEST,PATH:payload";
    // the inner station is the sender — an aprs.fi ack arrives this way (#1253)
    const inner =
      typeof info === 'string' && info.charAt(0) === '}' ? unwrapThirdParty(`${source}>APRS:${info}`) : null;
    const m = parseMessageInfo(inner ? inner.payload : info);
    if (!m) return null;
    const from = norm(inner ? inner.src : source);
    const me = norm(myCall());
    if (!me || norm(m.to) !== me || from === me) return null;

    const doneId = m.ack || m.rej;
    if (doneId) {
      const state = m.ack ? 'acked' : 'rejected';
      if (settle(doneId, from, state)) return { type: state, msgId: doneId };
      return { type: 'ack-unmatched', msgId: doneId };
    }

    // Reply-ack "text{MM}AA": the message also acks our message AA (#1252)
    const replyAcked = m.replyAck && settle(m.replyAck, from, 'acked') ? m.replyAck : null;
    const extra = replyAcked ? { replyAcked } : {};

    if (m.msgId && cfg().autoAck) {
      transmitAck(from, m.msgId);
      return { type: 'acked-incoming', msgId: m.msgId, from, ...extra };
    }
    return { type: 'message', msgId: m.msgId, ...extra };
  }

  function list() {
    prune();
    return [...outgoing.values()].map(view).reverse();
  }

  function stop() {
    for (const r of outgoing.values()) if (r.timer) timers.clearTimeout(r.timer);
    outgoing.clear();
  }

  return { send, handleIncoming, list, stop };
}

module.exports = { createMessenger, parseMessageInfo, CALLSIGN_RE, RETRY_BASE_MS };
