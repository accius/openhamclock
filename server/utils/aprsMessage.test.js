import { describe, it, expect } from 'vitest';
import { parseAprsMessage, messagesForStation, isDuplicateMessage, parseAprsAck, applyAprsAck } from './aprsMessage.js';

const line = (body) => `N8TAG-7>APY5D1,WIDE1-1:${body}`;

describe('parseAprsMessage', () => {
  it('parses an addressed message with a message id', () => {
    const m = parseAprsMessage(line(':KE8PLM-9 :see you at the EOC{42'));
    expect(m).toMatchObject({
      type: 'message',
      from: 'N8TAG-7',
      to: 'KE8PLM-9',
      text: 'see you at the EOC',
      msgId: '42',
    });
  });

  it('strips the id when the radio leaves a CR, LF, NUL or space after it (#1212)', () => {
    for (const tail of ['\r', '\n', '\r\n', ' ', '\0', '  \r']) {
      const m = parseAprsMessage(line(`:EMCOMM   :CQ TESTNET AVAILABLE{02${tail}`));
      expect(m.text, JSON.stringify(tail)).toBe('CQ TESTNET AVAILABLE');
      expect(m.msgId, JSON.stringify(tail)).toBe('02');
      expect(m.netCommand, JSON.stringify(tail)).toEqual({
        action: 'checkin',
        netName: 'TESTNET',
        status: 'AVAILABLE',
        alias: 'EMCOMM',
      });
    }
  });

  it('stays fast on a 50k run of trailing NULs (CodeQL js/polynomial-redos)', () => {
    const t0 = Date.now();
    const m = parseAprsMessage(line(':EMCOMM   :CQ TESTNET{02' + '\0'.repeat(50000)));
    expect(Date.now() - t0).toBeLessThan(200);
    expect(m.text).toBe('CQ TESTNET');
    expect(m.msgId).toBe('02');
  });

  it('understands the APRS 1.2 reply-ack id forms', () => {
    expect(parseAprsMessage(line(':W1AW     :hello{02}'))).toMatchObject({ text: 'hello', msgId: '02' });
    expect(parseAprsMessage(line(':W1AW     :hello{02}AB'))).toMatchObject({ text: 'hello', msgId: '02' });
  });

  it('keeps a brace that is part of the text', () => {
    expect(parseAprsMessage(line(':W1AW     :set {verbose} on'))).toMatchObject({
      text: 'set {verbose} on',
      msgId: null,
    });
  });

  it('parses net check-in and check-out commands to EMCOMM', () => {
    expect(parseAprsMessage(line(':EMCOMM   :CQ TESTNET at the EOC')).netCommand).toEqual({
      action: 'checkin',
      netName: 'TESTNET',
      status: 'AT THE EOC',
      alias: 'EMCOMM',
    });
    expect(parseAprsMessage(line(':EMCOMM   :cq testnet')).netCommand).toEqual({
      action: 'checkin',
      netName: 'TESTNET',
      status: '',
      alias: 'EMCOMM',
    });
    expect(parseAprsMessage(line(':EMCOMM   :U TESTNET')).netCommand).toEqual({
      action: 'checkout',
      netName: 'TESTNET',
      alias: 'EMCOMM',
    });
  });

  it('records the address of a check-in sent to any net address (#1237)', () => {
    expect(parseAprsMessage(line(':W8ROC    :CQ HAMCO at Station 1')).netCommand).toEqual({
      action: 'checkin',
      netName: 'HAMCO',
      status: 'AT STATION 1',
      alias: 'W8ROC',
    });
    expect(parseAprsMessage(line(':W8ROC-10 :U HAMCO')).netCommand).toMatchObject({
      action: 'checkout',
      alias: 'W8ROC-10',
    });
    // Ordinary text and bulletins are not net commands
    expect(parseAprsMessage(line(':W1AW     :see you on the net')).netCommand).toBeNull();
    expect(parseAprsMessage(line(':BLN1     :CQ NET tonight')).netCommand).toBeNull();
  });

  it('flags bulletins and skips acks, rejs and non-messages', () => {
    expect(parseAprsMessage(line(':BLN1     :Net tonight 1900')).type).toBe('bulletin');
    expect(parseAprsMessage(line(':W1AW     :ack42'))).toBeNull();
    expect(parseAprsMessage(line(':W1AW     :rej42'))).toBeNull();
    expect(parseAprsMessage(line('!4130.00N/08142.00W>'))).toBeNull();
    expect(parseAprsMessage('garbage')).toBeNull();
  });

  it('flags shelter reports only with shelter context (#1219)', () => {
    expect(parseAprsMessage(line(':KE8PLM-9 :How many open Cots are available?')).isShelterReport).toBe(false);
    expect(parseAprsMessage(line(':EMCOMM   :Net is closed for tonight')).isShelterReport).toBe(false);
    expect(parseAprsMessage(line(':EMCOMM   :Shelter open at the high school, 40 beds')).isShelterReport).toBe(true);
    expect(parseAprsMessage(line(':EMCOMM   :Evacuees arriving at the fairgrounds')).isShelterReport).toBe(true);
    expect(parseAprsMessage(line(':EMCOMM   :[Beds 12/20] cots on the floor')).isShelterReport).toBe(true);
  });

  it('extracts resource tokens from the text', () => {
    const m = parseAprsMessage(line(':EMCOMM   :[Beds 12/20] shelter open'));
    expect(m.tokens.map((t) => t.key)).toContain('Beds');
    expect(m.isShelterReport).toBe(true);
  });
});

describe('messagesForStation', () => {
  const msgs = [
    { from: 'KE8PLM-9', to: 'EMCOMM', text: 'CQ TESTNET', timestamp: 100 },
    { from: 'K0CJH', to: 'KE8PLM-9', text: 'Acknowledged', timestamp: 300, direction: 'sent' },
    { from: 'KE8PLM-7', to: 'K0CJH', text: 'from the HT', timestamp: 200 },
    { from: 'W1AW', to: 'BLN1', text: 'unrelated', timestamp: 400 },
  ];
  it("returns both directions for the exact SSID and the operator's other SSIDs, newest first", () => {
    const h = messagesForStation(msgs, 'ke8plm-9');
    expect(h.map((m) => [m.text, m.direction])).toEqual([
      ['Acknowledged', 'sent'],
      ['from the HT', 'received'],
      ['CQ TESTNET', 'received'],
    ]);
  });
  it('is empty for an unknown or blank call and respects the limit', () => {
    expect(messagesForStation(msgs, 'N0XYZ')).toEqual([]);
    expect(messagesForStation(msgs, '')).toEqual([]);
    expect(messagesForStation(msgs, 'KE8PLM', 1)).toHaveLength(1);
  });
});

describe('isDuplicateMessage (#1230)', () => {
  const t0 = 1_700_000_000_000;
  const base = { from: 'KE8PLM-9', to: 'EMCOMM', text: 'CQ OHNET', msgId: '12', timestamp: t0 };

  it('catches a retransmission with the same sender, addressee and id', () => {
    expect(isDuplicateMessage([base], { ...base, timestamp: t0 + 60_000 })).toBe(true);
    expect(isDuplicateMessage([base], { ...base, from: 'ke8plm-9', timestamp: t0 + 60_000 })).toBe(true);
  });

  it('keeps a new id, another sender, or an old id outside the window', () => {
    expect(isDuplicateMessage([base], { ...base, msgId: '13', timestamp: t0 + 60_000 })).toBe(false);
    expect(isDuplicateMessage([base], { ...base, from: 'W8ROC', timestamp: t0 + 60_000 })).toBe(false);
    expect(isDuplicateMessage([base], { ...base, timestamp: t0 + 31 * 60_000 })).toBe(false);
  });

  it('falls back to identical text for id-less messages, within 5 min', () => {
    const noId = { ...base, msgId: null };
    expect(isDuplicateMessage([noId], { ...noId, timestamp: t0 + 60_000 })).toBe(true);
    expect(isDuplicateMessage([noId], { ...noId, text: 'U OHNET', timestamp: t0 + 60_000 })).toBe(false);
    expect(isDuplicateMessage([noId], { ...noId, timestamp: t0 + 6 * 60_000 })).toBe(false);
  });

  it('ignores our own sent messages', () => {
    expect(isDuplicateMessage([{ ...base, direction: 'sent' }], { ...base, timestamp: t0 + 1 })).toBe(false);
  });
});

describe('acks mark sent messages delivered (#1247)', () => {
  it('parses ack and rej frames, nothing else', () => {
    expect(parseAprsAck('KE8PLM-9>APY400,WIDE1-1::K0CJH-9  :ack12')).toEqual({
      from: 'KE8PLM-9',
      to: 'K0CJH-9',
      msgId: '12',
      state: 'acked',
    });
    expect(parseAprsAck('KE8PLM-9>APY400::K0CJH-9  :rej7\r')).toMatchObject({ msgId: '7', state: 'rejected' });
    expect(parseAprsAck('KE8PLM-9>APY400::K0CJH-9  :hello{12')).toBeNull();
    expect(parseAprsAck('KE8PLM-9>APY400:!3900.11N/08411.80W-')).toBeNull();
  });

  it('matches the id and the station it was sent to', () => {
    const sent = { direction: 'sent', to: 'KE8PLM-9', msgId: '12', delivery: 'pending', text: 'x' };
    const other = { direction: 'sent', to: 'N8TAG', msgId: '12', delivery: 'pending', text: 'y' };
    const msgs = [sent, other];
    expect(applyAprsAck(msgs, parseAprsAck('KE8PLM-9>APY400::K0CJH-9  :ack12'))).toBe(sent);
    expect(sent.delivery).toBe('acked');
    expect(other.delivery).toBe('pending');
    expect(applyAprsAck(msgs, parseAprsAck('W1AW>APY400::K0CJH-9  :ack99'))).toBeNull();
    // A later rej never downgrades a delivered message
    applyAprsAck(msgs, parseAprsAck('KE8PLM-9>APY400::K0CJH-9  :rej12'));
    expect(sent.delivery).toBe('acked');
    expect(messagesForStation(msgs, 'KE8PLM-9')[0]).toMatchObject({ msgId: '12', delivery: 'acked' });
  });
});

// Frames as heard by KE8PLM's DireWolf (#1252, #1253)
const TH_D75 = 'KE8PLM-9>APK005,W8BLV,WIDE1*,WIDE2-1:';
const IGATED_ACK = 'W8EH>APU25N,W8BLV,WIDE1*,WIDE2-1:}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :ack687\r';

describe('reply-ack ids are not part of the text (#1252)', () => {
  it('takes "{MM}AA" off the text; the id is MM', () => {
    expect(parseAprsMessage(TH_D75 + ':KE8PLM   :got it{0D}682')).toMatchObject({ text: 'got it', msgId: '0D' });
    expect(parseAprsMessage(TH_D75 + ':KE8PLM   :hi{0D}')).toMatchObject({ text: 'hi', msgId: '0D' });
    expect(parseAprsMessage(TH_D75 + ':KE8PLM   :hi{0D}682\r')).toMatchObject({ text: 'hi', msgId: '0D' });
    expect(parseAprsMessage(TH_D75 + ':KE8PLM   :hi{687')).toMatchObject({ text: 'hi', msgId: '687' });
  });

  it('net check-in status and check-out are clean', () => {
    const cq = parseAprsMessage(TH_D75 + ':EMCOMM   :CQ TESTNET INSERVICE{0C}681');
    expect(cq.text).toBe('CQ TESTNET INSERVICE');
    expect(cq.netCommand).toMatchObject({ action: 'checkin', netName: 'TESTNET', status: 'INSERVICE' });
    const u = parseAprsMessage(TH_D75 + ':EMCOMM   :U Testnet{0E}682');
    expect(u.text).toBe('U Testnet');
    expect(u.netCommand).toMatchObject({ action: 'checkout', netName: 'TESTNET' });
  });

  it('the trailing AA acks our message AA to that station', () => {
    const sent = { direction: 'sent', to: 'KE8PLM-9', msgId: '682', delivery: 'pending', text: 'x' };
    const ack = parseAprsAck(TH_D75 + ':KE8PLM   :got it{0D}682');
    expect(ack).toEqual({ from: 'KE8PLM-9', to: 'KE8PLM', msgId: '682', state: 'acked' });
    expect(applyAprsAck([sent], ack)).toBe(sent);
    expect(sent.delivery).toBe('acked');
    // "{MM}" alone acks nothing
    expect(parseAprsAck(TH_D75 + ':KE8PLM   :hi{0D}')).toBeNull();
  });
});

describe('acks relayed by an igate in a third-party wrapper (#1253)', () => {
  it('unwraps the frame and trims the CR after the id', () => {
    expect(parseAprsAck(IGATED_ACK)).toEqual({ from: 'KE8PLM-9', to: 'KE8PLM', msgId: '687', state: 'acked' });
    expect(parseAprsMessage(IGATED_ACK)).toBeNull();
  });

  it('marks the sent message delivered', () => {
    const sent = {
      direction: 'sent',
      to: 'KE8PLM-9',
      msgId: '687',
      delivery: 'pending',
      text: 'Test Message for Ack5',
    };
    expect(applyAprsAck([sent], parseAprsAck(IGATED_ACK))).toBe(sent);
    expect(sent.delivery).toBe('acked');
  });

  it('rejects and messages are unwrapped the same way', () => {
    expect(parseAprsAck('W8EH>APU25N:}KE8PLM-9>APFII0,TCPIP,W8EH*::ke8plm   :rej687\r')).toMatchObject({
      from: 'KE8PLM-9',
      to: 'KE8PLM',
      msgId: '687',
      state: 'rejected',
    });
    expect(parseAprsMessage('W8EH>APU25N:}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :hello{12\r')).toMatchObject({
      from: 'KE8PLM-9',
      to: 'KE8PLM',
      text: 'hello',
      msgId: '12',
    });
  });
});
