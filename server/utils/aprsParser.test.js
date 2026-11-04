import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseAprsPacket,
  parseMice,
  parseResourceTokens,
  unwrapThirdParty,
  parseMessagePayload,
  MICE_TYPES,
} from './aprsParser.js';

// Expected values cross-checked with aprslib (the reference Python parser)
// wherever it supports the format; third-party and item formats follow APRS 1.01.

describe('parseMice', () => {
  it('decodes a real Yaesu FT-5D beacon (the packet from the bug report)', () => {
    const r = parseMice('SXUX4Y', '`p+5l!![/`"6E}');
    expect(r.lat).toBeCloseTo(38.9748, 4);
    expect(r.lon).toBeCloseTo(-84.2542, 4);
    expect(r.speed).toBe(0);
    expect(r.course).toBe(105);
    expect(r.symbolTable).toBe('/');
    expect(r.symbolCode).toBe('[');
    expect(r.altitude).toBe(748); // 228 m → feet, matching the /A= convention
    expect(r.comment).toBe('`');
  });

  it('decodes the north-west case with speed and course (aprslib: 33.4273, -12.129, 20 kt, 251°)', () => {
    const r = parseMice('S32U6T', '`(_fn"Oj/');
    expect(r.lat).toBeCloseTo(33.4273, 4);
    expect(r.lon).toBeCloseTo(-12.129, 3);
    expect(r.speed).toBe(20);
    expect(r.course).toBe(251);
    expect(r.symbolTable).toBe('/');
    expect(r.symbolCode).toBe('j');
    expect(r.altitude).toBeNull();
  });

  it('applies the +100° longitude offset from destination byte 5', () => {
    expect(parseMice('S32UPT', '`(_fn"Oj/').lon).toBeCloseTo(-112.129, 3);
  });

  it('handles south and east flags', () => {
    const r = parseMice('S32064', '`(_fn"Oj/');
    expect(r.lat).toBeCloseTo(-33.344, 3);
    expect(r.lon).toBeCloseTo(12.129, 3);
  });

  it('decodes the base-91 altitude field and strips it from the comment', () => {
    const r = parseMice('S32U6T', '`(_fn"Oj/"4T}rest');
    expect(r.altitude).toBe(Math.round(61 * 3.28084));
    expect(r.comment).toBe('rest');
  });

  it('accepts all four Mic-E type bytes and an SSID on the destination', () => {
    for (const t of MICE_TYPES) expect(parseMice('SXUX4Y-1', `${t}p+5l!![/`)).not.toBeNull();
  });

  it('rejects non-Mic-E payloads and short inputs', () => {
    expect(parseMice('SXUX4Y', '!3858.49N/08415.25W[')).toBeNull();
    expect(parseMice('SXUX4Y', '`p+5')).toBeNull();
    expect(parseMice('SXU', '`p+5l!![/')).toBeNull();
    expect(parseMice('', '`p+5l!![/')).toBeNull();
  });
});

describe('parseAprsPacket', () => {
  it('parses an uncompressed position with CSE/SPD and /A= altitude', () => {
    const s = parseAprsPacket('N0CALL-9>APRS,WIDE1-1:!3858.49N/08415.25W>090/010/A=000750 test');
    expect(s.call).toBe('N0CALL');
    expect(s.ssid).toBe('N0CALL-9');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/>');
    expect(s.course).toBe(90);
    expect(s.speed).toBe(10);
    expect(s.altitude).toBe(750);
    expect(s.packetType).toBe('position');
    expect(s.positionAmbiguity).toBe(0);
  });

  it('parses a timestamped position and rejects a malformed timestamp', () => {
    const ok = parseAprsPacket('K9XYZ-9>APRS:/092345z3858.49N/08415.25W>090/010/A=000750 ts');
    expect(ok.lat).toBeCloseTo(38.9748, 4);
    expect(ok.comment).toBe('ts');
    expect(parseAprsPacket('K9XYZ-9>APRS:/99xx45z3858.49N/08415.25W>')).toBeNull();
  });

  it('accepts the 000000z "no timestamp" placeholder (the one miss in an 11-hour RF comparison)', () => {
    const s = parseAprsPacket(
      'KF9UG-10>APDW18,KD9QDL-10,WIDE1,W8BLV,WIDE2*:}KK2BUD-10>APMI04,TCPIP,KF9UG-10*:@000000z4033.01N/08433.80W- KK2BUD DIGI Celina Ohio',
    );
    expect(s).not.toBeNull();
    expect(s.ssid).toBe('KK2BUD-10');
    expect(s.lat).toBeCloseTo(40.5502, 3);
    expect(s.lon).toBeCloseTo(-84.5633, 3);
  });

  it('parses a Mic-E beacon end to end', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y,WIDE1-1,WIDE2-1:`p+5l!![/`"6E}');
    expect(s.call).toBe('N8TAG');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/[');
    expect(s.altitude).toBe(748);
    expect(s.packetType).toBe('mic-e');
  });

  it('parses compressed positions (APRS 1.01 example: 49.5N 72.75W, 88°, 36 kt)', () => {
    const s = parseAprsPacket('K9XYZ-9>APRS:=/5L!!<*e7>7P[');
    expect(s.lat).toBeCloseTo(49.5, 4);
    expect(s.lon).toBeCloseTo(-72.75, 4);
    expect(s.symbol).toBe('/>');
    expect(s.course).toBe(88);
    expect(s.speed).toBeCloseTo(36.2, 0);
    // filler cs/T bytes → no course/speed, comment preserved
    const f = parseAprsPacket('K9XYZ-9>APRS:!/5L!!<*e7>  !comment');
    expect(f.lat).toBeCloseTo(49.5, 4);
    expect(f.speed).toBeNull();
    expect(f.comment).toBe('comment');
  });

  it('parses object reports at the right offset (the old parser read the timestamp as latitude)', () => {
    const s = parseAprsPacket('N8TAG-1>APRS,TCPIP*:;OBJNAME  *092345z3858.49N/08415.25W-object comment');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.objectName).toBe('OBJNAME');
    expect(s.packetType).toBe('object');
    expect(s.comment).toBe('object comment');
    // keyed by the object's own name; the transmitting station is kept as sender
    expect(s.ssid).toBe('OBJNAME');
    expect(s.call).toBe('OBJNAME');
    expect(s.sender).toBe('N8TAG-1');
  });

  it('keeps a repeater object separate from the digipeater that sends it', () => {
    const own = parseAprsPacket('W8VFR-3>APRS:!3955.00N/08348.00W#digi');
    const obj = parseAprsPacket('W8VFR-3>APRS:;KA8OCG-2 *092345z3955.66N/08348.37W& object');
    expect(own.ssid).toBe('W8VFR-3');
    expect(obj.ssid).toBe('KA8OCG-2');
    expect(obj.call).toBe('KA8OCG');
    expect(obj.sender).toBe('W8VFR-3');
  });

  it('ignores killed objects and items', () => {
    expect(parseAprsPacket('N8TAG-1>APRS:;OBJNAME  _092345z3858.49N/08415.25W-gone')).toBeNull();
    expect(parseAprsPacket('N8TAG-1>APRS:)ITEM1_3858.49N/08415.25W-gone')).toBeNull();
  });

  it('parses item reports', () => {
    const s = parseAprsPacket('N8TAG-1>APRS:)ITEM1!3858.49N/08415.25W-item comment');
    expect(s.itemName).toBe('ITEM1');
    expect(s.ssid).toBe('ITEM1');
    expect(s.sender).toBe('N8TAG-1');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.packetType).toBe('item');
  });

  it('unwraps third-party frames re-transmitted by an igate', () => {
    const s = parseAprsPacket(
      'N8TAG-1>APRS,TCPIP*:}K1JBP-9>APMAIL,TCPIP,N8TAG-1*:!3801.56N/08430.09Wk in service mobile winlink',
    );
    expect(s.call).toBe('K1JBP');
    expect(s.ssid).toBe('K1JBP-9');
    expect(s.lat).toBeCloseTo(38.026, 3);
    expect(s.lon).toBeCloseTo(-84.5015, 3);
    expect(s.symbol).toBe('/k');
    expect(s.thirdPartyVia).toEqual(['N8TAG-1']);
    expect(s.raw.startsWith('N8TAG-1>')).toBe(true);
    // Mic-E inside a third-party wrapper still gets its latitude from the inner destination
    const m = parseAprsPacket('N8TAG-1>APRS,TCPIP*:}N8TAG-12>SXUX4Y,WIDE1-1:`p+5l!![/`"6E}');
    expect(m.ssid).toBe('N8TAG-12');
    expect(m.lat).toBeCloseTo(38.9748, 4);
  });

  it('honours position ambiguity by centring the cell (aprslib agrees)', () => {
    const one = parseAprsPacket('K9XYZ-9>APRS:!3858.4 N/08415.2 W- ambiguity');
    expect(one.lat).toBeCloseTo(38.97417, 4);
    expect(one.lon).toBeCloseTo(-84.25417, 4);
    expect(one.positionAmbiguity).toBe(1);
    const three = parseAprsPacket('K9XYZ-9>APRS:!385 .  N/0841 .  W- ambiguity');
    expect(three.lat).toBeCloseTo(38.91667, 4);
    expect(three.lon).toBeCloseTo(-84.25, 4);
    expect(three.positionAmbiguity).toBe(3);
  });

  it('keeps EmComm resource tokens working, including inside a Mic-E comment', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y:`p+5l!![/[Beds 12/20] [Water OK]');
    expect(s.tokens).toEqual([
      { key: 'Beds', current: 12, max: 20, type: 'capacity' },
      { key: 'Water', value: 'OK', type: 'status' },
    ]);
    expect(s.cleanComment).toBe('');
  });

  it('returns null for non-position packets and junk', () => {
    expect(parseAprsPacket('N8TAG-12>APRS::N0CALL   :hello{1')).toBeNull();
    expect(parseAprsPacket('N8TAG-12>APRS:>status text')).toBeNull();
    expect(parseAprsPacket('N8TAG-12>APRS:T#001,1,2,3,4,5,00000000')).toBeNull();
    expect(parseAprsPacket('no header here')).toBeNull();
    expect(parseAprsPacket('')).toBeNull();
    expect(parseAprsPacket(null)).toBeNull();
    expect(parseAprsPacket('N8TAG-12>AP:`p+5l!![/')).toBeNull(); // Mic-E with a too-short destination
    expect(parseAprsPacket('A>B:!3858.49N/08415.25W-')).toBeNull(); // callsign too short
  });
});

describe('message frames (#1252, #1253)', () => {
  it('unwrapThirdParty returns the inner sender and payload', () => {
    expect(
      unwrapThirdParty('W8EH>APU25N,W8BLV,WIDE1*,WIDE2-1:}KE8PLM-9>APFII0,TCPIP,W8EH*::KE8PLM   :ack687\r'),
    ).toEqual({ src: 'KE8PLM-9', destination: 'APFII0', payload: ':KE8PLM   :ack687', thirdPartyVia: ['W8EH'] });
    expect(unwrapThirdParty('N8TAG>APRS::W1AW     :hi')).toMatchObject({ src: 'N8TAG', thirdPartyVia: [] });
    expect(unwrapThirdParty('A>B:' + '}A>B:'.repeat(10) + 'x')).toBeNull(); // depth-limited
    expect(unwrapThirdParty('garbage')).toBeNull();
  });

  it('parseMessagePayload splits ids, reply-acks, acks and rejs off the text', () => {
    expect(parseMessagePayload(':KE8PLM   :got it{0D}682')).toEqual({
      to: 'KE8PLM',
      text: 'got it',
      msgId: '0D',
      replyAck: '682',
      ack: null,
      rej: null,
    });
    expect(parseMessagePayload(':KE8PLM   :ack687\r')).toMatchObject({ ack: '687', rej: null, msgId: null });
    expect(parseMessagePayload(':KE8PLM   :rej687 ')).toMatchObject({ ack: null, rej: '687' });
    expect(parseMessagePayload(':KE8PLM   :set {verbose} on')).toMatchObject({ text: 'set {verbose} on', msgId: null });
    expect(parseMessagePayload('!3900.11N/08411.80W-')).toBeNull();
    expect(parseMessagePayload(':TOOLONGADDRESS:hi')).toBeNull();
  });
});

describe('rig-bridge copy stays in step', () => {
  it('rig-bridge/lib/aprs-parser.js is a verbatim copy of server/utils/aprsParser.js (banner aside)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const strip = (src) =>
      src
        .replace(/^'use strict';\n/, '')
        .replace(/^(\/\/ [^\n]*\n)+/, '') // rig-bridge banner
        .trim();
    const server = strip(fs.readFileSync(path.join(root, 'server/utils/aprsParser.js'), 'utf8'));
    const bridge = strip(fs.readFileSync(path.join(root, 'rig-bridge/lib/aprs-parser.js'), 'utf8'));
    expect(bridge).toBe(server);
  });
});

describe('pathological input stays fast (CodeQL js/polynomial-redos)', () => {
  it('resource tokens: "[A" followed by 50k spaces and no closing bracket', () => {
    const t0 = Date.now();
    const r = parseResourceTokens('[A' + ' '.repeat(50000) + 'x');
    expect(Date.now() - t0).toBeLessThan(200);
    expect(r.tokens).toEqual([]);
    const ok = parseResourceTokens('go [Beds 12/20] and [Water OK] now');
    expect(ok.tokens.map((t) => t.key)).toEqual(['Beds', 'Water']);
    expect(ok.cleanComment).toBe('go  and  now');
  });

  it('long runs of spaces inside a bracket token and long newline tails parse in bounded time', () => {
    const spaces = `N8TAG-12>SXUX4Y:\`p+5l!![/[A${' '.repeat(20000)}x`;
    const newlines = `N0CALL-9>APRS:!3858.49N/08415.25W>test${'\n'.repeat(8000)}`;
    const t0 = performance.now();
    parseAprsPacket(spaces);
    const s = parseAprsPacket(newlines);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(s.comment).toBe('test');
    // tokens with ordinary spacing still parse
    expect(parseAprsPacket('N8TAG-12>SXUX4Y:\`p+5l!![/[Beds   12/20] [Water OK]').tokens).toHaveLength(2);
  });
});

describe('shelter beacons from the aprs.fi app (#1235, #1236)', () => {
  it('strips the !DAO! precision extension from the comment', () => {
    const p = parseAprsPacket(String.raw`KE8PLM-9>APFII0,WIDE1-1:@150953h3900.11N\08411.80WzOPEN [BEDS 12/20]!w\z!`);
    expect(p.comment).toBe('OPEN [BEDS 12/20]');
    expect(p.cleanComment).toBe('OPEN');
  });

  it('strips the human-readable !W12! form but leaves ordinary text alone', () => {
    expect(parseAprsPacket('N0CALL>APRS:!3900.11N/08411.80W-Hello!W12!').comment).toBe('Hello');
    expect(parseAprsPacket('N0CALL>APRS:!3900.11N/08411.80W-Hi!Wow!').comment).toBe('Hi!Wow!');
  });

  it('normalizes resource keys typed in any case, keeps unknown keys as sent', () => {
    const { tokens } = parseResourceTokens('OPEN [WATER 100] [BEDS 12/20] [beds 1/2] [MRE 40]');
    expect(tokens.map((t) => t.key)).toEqual(['Water', 'Beds', 'Beds', 'MRE']);
  });
});

describe('spaceless and mixed-case resource tokens (#1254)', () => {
  it('reads a known key run straight into its value, in any case', () => {
    const { tokens, cleanComment } = parseResourceTokens('OPEN [BEDS180/200] [water170/190] [Food 50]');
    expect(tokens).toEqual([
      { key: 'Beds', current: 180, max: 200, type: 'capacity' },
      { key: 'Water', current: 170, max: 190, type: 'capacity' },
      { key: 'Food', value: 50, type: 'quantity' },
    ]);
    expect(cleanComment).toBe('OPEN');
  });

  it('matches the spaced form token for token', () => {
    const spaced = parseResourceTokens('[Beds 180/200] [Water OK] [Fuel -20] [Med !] [Staff 12]').tokens;
    const tight = parseResourceTokens('[beds180/200][WATEROK][Fuel-20][MED!][staff12]').tokens;
    expect(tight).toEqual(spaced);
    expect(tight.map((t) => t.type)).toEqual(['capacity', 'status', 'need', 'critical', 'quantity']);
  });

  it('tolerates spaces inside the brackets and around the slash', () => {
    const { tokens } = parseResourceTokens('[ Beds 180 / 200 ] [  gen OK ]');
    expect(tokens).toEqual([
      { key: 'Beds', current: 180, max: 200, type: 'capacity' },
      { key: 'Gen', value: 'OK', type: 'status' },
    ]);
  });

  it('prefers the longest key ("Evacuees" over "Evac")', () => {
    expect(parseResourceTokens('[EVACUEES12] [evac3]').tokens.map((t) => t.key)).toEqual(['Evacuees', 'Evac']);
  });

  it('leaves unknown or untyped spaceless text alone', () => {
    const r = parseResourceTokens('[MRE40] [Generators] [Bedsfull] [Beds] note');
    expect(r.tokens).toEqual([]);
    expect(r.cleanComment).toBe('[MRE40] [Generators] [Bedsfull] [Beds] note');
  });

  it('still parses in a full packet', () => {
    const p = parseAprsPacket(String.raw`KE8PLM-3>APFII0,WIDE1-1:@165208h3900.11N\08411.80WzOPEN [BEDS4/20][WATER50]`);
    expect(p.tokens).toEqual([
      { key: 'Beds', current: 4, max: 20, type: 'capacity' },
      { key: 'Water', value: 50, type: 'quantity' },
    ]);
    expect(p.cleanComment).toBe('OPEN');
  });

  it('"[" plus long space runs stays fast', () => {
    const t0 = Date.now();
    parseResourceTokens('[' + ' '.repeat(50000) + 'Beds');
    parseResourceTokens('[ '.repeat(25000));
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('position extensions leave the comment once read (#1235)', () => {
  it('altitude and DAO come out of an aprs.fi shelter beacon; adjacent tags still parse', () => {
    const p = parseAprsPacket(
      String.raw`KE8PLM-3>APFII0,WIDE1-1:@165208h3900.11N\08411.80Wz/A=000921OPEN [BEDS 4/20][WATER 50]!w[z!`,
    );
    expect(p.altitude).toBe(921);
    expect(p.comment).toBe('OPEN [BEDS 4/20][WATER 50]');
    expect(p.cleanComment).toBe('OPEN');
    expect(p.tokens.map((t) => t.key)).toEqual(['Beds', 'Water']);
  });

  it('course/speed prefix is read and removed', () => {
    const p = parseAprsPacket('N0CALL>APRS:!3900.11N/08411.80W>090/045/A=001234 mobile');
    expect([p.course, p.speed, p.altitude, p.comment]).toEqual([90, 45, 1234, 'mobile']);
  });
});
