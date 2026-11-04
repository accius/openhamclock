import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMessenger, parseMessageInfo, RETRY_BASE_MS } from './aprs-messaging.js';

const info = (to, text) => `:${to.padEnd(9, ' ')}:${text}`;

function setup(settings = {}) {
  let t = 1_700_000_000_000;
  const timers = [];
  const fake = {
    setTimeout: (fn, ms) => {
      const h = { fn, at: t + ms, done: false };
      timers.push(h);
      return h;
    },
    clearTimeout: (h) => h && (h.done = true),
  };
  // Run every timer due by now + ms in time order, including ones scheduled
  // while advancing (each retry schedules the next).
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((h) => !h.done && h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      due.done = true;
      due.fn();
    }
    t = end;
  };
  const transmit = vi.fn(() => true);
  const transmitAck = vi.fn(() => true);
  const emit = vi.fn();
  const live = { autoAck: true, messageRetry: true, messageMaxTries: 6, ...settings };
  const m = createMessenger({
    transmit,
    transmitAck,
    myCall: () => 'K0CJH-9',
    settings: () => live,
    emit,
    now: () => t,
    timers: fake,
  });
  return { m, transmit, transmitAck, emit, advance, live };
}

describe('parseMessageInfo', () => {
  it('reads addressee, text and id, acks and rejs', () => {
    expect(parseMessageInfo(info('K0CJH-9', 'hello{12'))).toEqual({
      to: 'K0CJH-9',
      text: 'hello',
      msgId: '12',
      replyAck: null,
      ack: null,
      rej: null,
    });
    expect(parseMessageInfo(info('K0CJH-9', 'hi{MM}AA'))).toMatchObject({ text: 'hi', msgId: 'MM', replyAck: 'AA' });
    expect(parseMessageInfo(info('K0CJH-9', 'got it{0D}682'))).toMatchObject({
      text: 'got it',
      msgId: '0D',
      replyAck: '682',
    });
    expect(parseMessageInfo(info('K0CJH-9', 'hi{0D}'))).toMatchObject({ text: 'hi', msgId: '0D', replyAck: null });
    expect(parseMessageInfo(info('K0CJH-9', 'ack12\r'))).toMatchObject({ ack: '12', rej: null });
    expect(parseMessageInfo(info('K0CJH-9', 'rej7'))).toMatchObject({ ack: null, rej: '7' });
    expect(parseMessageInfo('!3900.11N/08411.80W-')).toBeNull();
  });
});

describe('outgoing: resend until acked (#1247)', () => {
  let s;
  beforeEach(() => (s = setup()));

  it('sends to a callsign with an id and retries on a doubling interval', () => {
    const r = s.m.send('ke8plm-9', 'test');
    expect(r).toMatchObject({ ok: true, ackRequested: true });
    expect(s.transmit).toHaveBeenLastCalledWith('KE8PLM-9', 'test', r.msgId);
    s.advance(RETRY_BASE_MS);
    expect(s.transmit).toHaveBeenCalledTimes(2);
    s.advance(RETRY_BASE_MS); // 60 s interval not over yet
    expect(s.transmit).toHaveBeenCalledTimes(2);
    s.advance(RETRY_BASE_MS);
    expect(s.transmit).toHaveBeenCalledTimes(3);
  });

  it('stops on the ack and reports it delivered', () => {
    const { msgId } = s.m.send('KE8PLM-9', 'test');
    expect(s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', `ack${msgId}`))).toEqual({ type: 'acked', msgId });
    s.advance(10 * 60 * 1000);
    expect(s.transmit).toHaveBeenCalledTimes(1);
    expect(s.m.list()[0]).toMatchObject({ msgId, state: 'acked', tries: 1 });
    expect(s.emit).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'acked' }));
  });

  it('ignores an ack from the wrong station or for an unknown id', () => {
    const { msgId } = s.m.send('KE8PLM-9', 'test');
    expect(s.m.handleIncoming('N8TAG', info('K0CJH-9', `ack${msgId}`)).type).toBe('ack-unmatched');
    expect(s.m.list()[0].state).toBe('pending');
  });

  it('gives up after maxTries transmissions', () => {
    s.live.messageMaxTries = 3;
    s.m.send('KE8PLM-9', 'test');
    s.advance(30 * 60 * 1000);
    expect(s.transmit).toHaveBeenCalledTimes(3);
    expect(s.m.list()[0]).toMatchObject({ state: 'expired', tries: 3 });
  });

  it('a rej stops the retries too', () => {
    const { msgId } = s.m.send('KE8PLM-9', 'test');
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', `rej${msgId}`));
    expect(s.m.list()[0].state).toBe('rejected');
  });

  it('sends once without an id to aliases and bulletins, or with retries off', () => {
    expect(s.m.send('EMCOMM', 'CQ OHNET')).toMatchObject({ ok: true, msgId: null, ackRequested: false });
    expect(s.m.send('BLN1', 'net at 7')).toMatchObject({ msgId: null });
    s.live.messageRetry = false;
    expect(s.m.send('KE8PLM-9', 'x')).toMatchObject({ msgId: null, ackRequested: false });
    s.advance(30 * 60 * 1000);
    expect(s.transmit).toHaveBeenCalledTimes(3);
  });

  it('reports a TNC that is down', () => {
    s.transmit.mockReturnValueOnce(false);
    expect(s.m.send('KE8PLM-9', 'x')).toMatchObject({ ok: false });
    expect(s.m.list()).toEqual([]);
  });
});

describe('incoming: auto-acknowledge (#1244)', () => {
  it('acks every copy of a message to our exact callsign', () => {
    const s = setup();
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', 'hello{42'));
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', 'hello{42'));
    expect(s.transmitAck).toHaveBeenCalledTimes(2);
    expect(s.transmitAck).toHaveBeenCalledWith('KE8PLM-9', '42');
  });

  it('does not ack messages to another SSID, an alias, without an id, or our own', () => {
    const s = setup();
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-7', 'hi{1'));
    s.m.handleIncoming('KE8PLM-9', info('EMCOMM', 'CQ NET{2'));
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', 'no id'));
    s.m.handleIncoming('K0CJH-9', info('K0CJH-9', 'echo{3'));
    expect(s.transmitAck).not.toHaveBeenCalled();
  });

  it('can be switched off live', () => {
    const s = setup();
    s.live.autoAck = false;
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', 'hello{42'));
    expect(s.transmitAck).not.toHaveBeenCalled();
    s.live.autoAck = true;
    s.m.handleIncoming('KE8PLM-9', info('K0CJH-9', 'hello{42'));
    expect(s.transmitAck).toHaveBeenCalledTimes(1);
  });

  it('SSID 0 matches the bare callsign', () => {
    const s = setup();
    const m = createMessenger({
      transmit: () => true,
      transmitAck: s.transmitAck,
      myCall: () => 'W8ROC',
      settings: () => ({}),
    });
    m.handleIncoming('KE8PLM-9', info('W8ROC', 'hi{5'));
    m.handleIncoming('KE8PLM-9', info('W8ROC-0', 'hi{6'));
    expect(s.transmitAck).toHaveBeenCalledTimes(2);
  });
});

// KE8PLM's frames (#1252, #1253); our station is KE8PLM here
describe('acks from a Kenwood reply-ack and from an igate (#1252, #1253)', () => {
  const setupAs = (call) => {
    const transmit = vi.fn(() => true);
    const transmitAck = vi.fn(() => true);
    const timers = { setTimeout: () => ({}), clearTimeout: () => {} };
    const m = createMessenger({ transmit, transmitAck, myCall: () => call, settings: () => ({}), timers });
    return { m, transmit, transmitAck };
  };

  it('an ack inside a third-party frame, CR after the id, stops the retries', () => {
    const s = setupAs('KE8PLM');
    const { msgId } = s.m.send('KE8PLM-9', 'Test Message for Ack5');
    // W8EH>APU25N,W8BLV,WIDE1*,WIDE2-1:}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :ack687<CR>
    const inner = `}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :ack${msgId}\r`;
    expect(s.m.handleIncoming('W8EH', inner)).toEqual({ type: 'acked', msgId });
    expect(s.m.list()[0].state).toBe('acked');
  });

  it('a rej inside a third-party frame stops them too', () => {
    const s = setupAs('KE8PLM');
    const { msgId } = s.m.send('KE8PLM-9', 'x');
    s.m.handleIncoming('W8EH', `}KE8PLM-9>APFII0,TCPIP,W8EH*::ke8plm   :rej${msgId}\r`);
    expect(s.m.list()[0].state).toBe('rejected');
  });

  it('a message inside a third-party frame is acked to the inner sender', () => {
    const s = setupAs('KE8PLM');
    s.m.handleIncoming('W8EH', '}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :hello{12\r');
    expect(s.transmitAck).toHaveBeenCalledWith('KE8PLM-9', '12');
  });

  it('"text{MM}AA" acks our message AA and is acked with MM', () => {
    const s = setupAs('KE8PLM');
    const { msgId } = s.m.send('KE8PLM-9', 'are you there');
    expect(s.m.handleIncoming('KE8PLM-9', info('KE8PLM', `got it{0D}${msgId}`))).toEqual({
      type: 'acked-incoming',
      msgId: '0D',
      from: 'KE8PLM-9',
      replyAcked: msgId,
    });
    expect(s.transmitAck).toHaveBeenCalledWith('KE8PLM-9', '0D');
    expect(s.m.list()[0].state).toBe('acked');
  });

  it('a reply-ack from another station does not settle our message', () => {
    const s = setupAs('KE8PLM');
    const { msgId } = s.m.send('KE8PLM-9', 'x');
    s.m.handleIncoming('N8TAG', info('KE8PLM', `hi{0D}${msgId}`));
    expect(s.m.list()[0].state).toBe('pending');
  });
});
