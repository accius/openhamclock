/**
 * APRS message / bulletin parser (shared by the APRS-IS feed and the
 * local-TNC path in server/routes/aprs.js).
 *
 *   SRC>DEST,PATH::ADDRESSEE:text{id
 *
 * Returns null for anything that is not a message, and for ack/rej frames.
 * EmComm net commands (`CQ NETNAME status`, `U NETNAME`) to EMCOMM or any other net address
 * come back as `netCommand` so the roster can act on them.
 */
const { parseResourceTokens, parseMessageFrame } = require('./aprsParser');

function parseAprsMessage(line) {
  try {
    // Addressee, text and id come from the shared parser, which unwraps
    // third-party frames from igates (#1253) and takes the id — `{id`, or the
    // reply-ack `{MM}` / `{MM}AA` a Kenwood TH-D75 sends (#1252) — off the
    // text after trimming the CR/space radios leave behind (#1212).
    const m = parseMessageFrame(line);
    if (!m) return null;
    // Acks/rejs are not messages (parseAprsAck handles them)
    if (m.ack || m.rej) return null;
    const { from, to, text, msgId } = m;

    const isBulletin = to.startsWith('BLN');
    const { tokens, cleanComment } = parseResourceTokens(text);

    // Detect shelter-related content
    // A shelter report needs shelter context: the word itself (or evacuee /
    // refuge), or a structured shelter token. Bare "open" / "closed" /
    // "capacity" / "beds" used to qualify, so an ordinary net message such as
    // "How many open cots are available?" became a shelter named after its
    // sender (#1219).
    const isShelterReport =
      /\bshelter|\bevacuee|\bevacuation\s+(center|centre|site)|\brefuge\b/i.test(text) ||
      tokens.some((t) => ['Beds', 'Capacity', 'Shelter', 'Evacuees'].includes(t.key));

    // Net check-in / check-out commands. Any addressee counts (#1237): a
    // group can use its own callsign (W8ROC) or tactical alias instead of
    // EMCOMM, and one server's roster serves every browser, so the address is
    // recorded on the command and each browser shows only its own addresses.
    let netCommand = null;
    if (!isBulletin && to) {
      const upper = text.toUpperCase().trim();
      const cqMatch = upper.match(/^CQ\s+(\S+)\s*(.*)/);
      const uMatch = upper.match(/^U\s+(\S+)/);
      if (cqMatch) {
        netCommand = { action: 'checkin', netName: cqMatch[1], status: cqMatch[2] || '', alias: to.toUpperCase() };
      } else if (uMatch) {
        netCommand = { action: 'checkout', netName: uMatch[1], alias: to.toUpperCase() };
      }
    }

    return {
      type: isBulletin ? 'bulletin' : 'message',
      from,
      to,
      text,
      cleanText: cleanComment,
      tokens,
      msgId,
      isShelterReport,
      netCommand,
      timestamp: Date.now(),
      raw: line,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Messages exchanged with one station (#1216): anything from or to the exact
 * callsign-SSID, plus the base callsign's other SSIDs (KE8PLM-9 and KE8PLM-7
 * are the same operator from a net control's point of view). Newest first.
 */
function messagesForStation(messages, call, limit = 200) {
  const key = String(call || '')
    .trim()
    .toUpperCase();
  if (!key) return [];
  const base = key.split('-')[0];
  const baseOf = (c) =>
    String(c || '')
      .trim()
      .toUpperCase()
      .split('-')[0];
  const hit = (c) => {
    const u = String(c || '')
      .trim()
      .toUpperCase();
    return u === key || baseOf(u) === base;
  };
  return (messages || [])
    .filter((m) => m && (hit(m.from) || hit(m.to)))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((m) => ({
      from: m.from,
      to: m.to,
      text: m.text,
      msgId: m.msgId ?? null,
      delivery: m.delivery ?? null,
      timestamp: m.timestamp,
      direction: m.direction || 'received',
      source: m.source || null,
      type: m.type || 'message',
    }));
}

/**
 * Is `msg` a retransmission of one already logged (#1230)? Senders retry an
 * un-acked message several times (aprs.fi ×6, Yaesu FTM-500 ×6), and a
 * message addressed to an alias such as EMCOMM is never acked — so without
 * this every message landed in the log, and re-ran its net command, up to six
 * times. The same packet heard over both RF and APRS-IS is caught too.
 * Same sender + addressee + message id within 30 min; messages with no id
 * fall back to identical text within 5 min.
 */
const DUP_WINDOW_ID_MS = 30 * 60 * 1000;
const DUP_WINDOW_TEXT_MS = 5 * 60 * 1000;
function isDuplicateMessage(messages, msg) {
  if (!msg || !Array.isArray(messages)) return false;
  const up = (c) =>
    String(c || '')
      .trim()
      .toUpperCase();
  const from = up(msg.from);
  const to = up(msg.to);
  const now = msg.timestamp || Date.now();
  const window = msg.msgId ? DUP_WINDOW_ID_MS : DUP_WINDOW_TEXT_MS;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (now - (m.timestamp || 0) > window) break; // log is append-only, so older entries are out of window too
    if (m.direction === 'sent' || up(m.from) !== from || up(m.to) !== to) continue;
    if (msg.msgId ? m.msgId === msg.msgId : !m.msgId && m.text === msg.text) return true;
  }
  return false;
}

/**
 * An ack or rej frame (#1247): "SRC>DEST::ADDRESSEE:ack12". A reply-ack
 * message "text{MM}AA" acks our message AA too (#1252), and an ack relayed by
 * an igate arrives inside a third-party wrapper "IGATE>...:}SRC>...::..."
 * (#1253); `from` is the station that answered.
 * @returns {null | { from, to, msgId, state: 'acked' | 'rejected' }}
 */
function parseAprsAck(line) {
  const m = parseMessageFrame(line);
  if (!m) return null;
  const msgId = m.ack || m.rej || m.replyAck;
  if (!msgId) return null;
  return { from: m.from.toUpperCase(), to: m.to.toUpperCase(), msgId, state: m.rej ? 'rejected' : 'acked' };
}

/**
 * Mark the sent message an ack/rej answers (#1247): same message id, sent to
 * the station that answered. Returns the message, or null when none matches.
 */
function applyAprsAck(messages, ack) {
  if (!ack) return null;
  const base = (c) =>
    String(c || '')
      .trim()
      .toUpperCase()
      .replace(/-0$/, '');
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.direction === 'sent' && String(m.msgId ?? '').trim() === ack.msgId && base(m.to) === base(ack.from)) {
      if (m.delivery !== 'acked') {
        m.delivery = ack.state;
        m.deliveredAt = Date.now();
      }
      return m;
    }
  }
  return null;
}

module.exports = { parseAprsMessage, messagesForStation, isDuplicateMessage, parseAprsAck, applyAprsAck };
