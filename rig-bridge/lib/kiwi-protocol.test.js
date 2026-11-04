// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  decodeSmeter,
  encodeSmeter,
  parseFrame,
  encodeSndFrame,
  encodeMsgFrame,
  parseMsgParams,
  cmd,
  setupCommands,
  audioSocketUrl,
  classifyMsg,
} from './kiwi-protocol.js';

describe('kiwi-protocol S-meter decode', () => {
  it('maps the raw 16-bit field to dBm as kiwiclient does (value/10 − 127)', () => {
    expect(decodeSmeter(0)).toBe(-127);
    expect(decodeSmeter(1270)).toBe(0);
    expect(decodeSmeter(270)).toBeCloseTo(-100);
    expect(decodeSmeter(NaN)).toBeNull();
  });

  it('encode/decode round-trips to 0.1 dB', () => {
    for (const dbm of [-127, -115.3, -73, -30.1, 0]) {
      expect(decodeSmeter(encodeSmeter(dbm))).toBeCloseTo(dbm, 1);
    }
  });
});

describe('kiwi-protocol frame parsing', () => {
  it('parses an SND frame: tag, flags, LE sequence, BE smeter, audio payload', () => {
    const audio = Buffer.from([1, 2, 3, 4, 5, 6]);
    const buf = encodeSndFrame({ flags: 0x08, seq: 0x01020304, rssiDbm: -95.5, audio });
    expect(buf.subarray(0, 3).toString()).toBe('SND');
    expect(buf.readUInt32LE(4)).toBe(0x01020304);
    const f = parseFrame(buf);
    expect(f.type).toBe('SND');
    expect(f.flags).toBe(0x08);
    expect(f.seq).toBe(0x01020304);
    expect(f.rssiDbm).toBeCloseTo(-95.5, 1);
    expect(Buffer.from(f.audio)).toEqual(audio);
  });

  it('accepts ArrayBuffer / Uint8Array input (browser-style ws payloads)', () => {
    const buf = encodeSndFrame({ seq: 7, rssiDbm: -80 });
    const u8 = new Uint8Array(buf);
    expect(parseFrame(u8).seq).toBe(7);
    expect(parseFrame(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)).seq).toBe(7);
  });

  it('parses MSG frames into URL-decoded key/value params', () => {
    const f = parseFrame(encodeMsgFrame({ audio_rate: 12000, sample_rate: '12001.123', ident_user: 'Open Ham' }));
    expect(f.type).toBe('MSG');
    expect(f.params.audio_rate).toBe('12000');
    expect(f.params.sample_rate).toBe('12001.123');
    expect(f.params.ident_user).toBe('Open Ham');
    expect(parseMsgParams('badp=1 extra')).toEqual({ badp: '1', extra: true });
  });

  it('returns null for runt frames and a generic record for other tags', () => {
    expect(parseFrame(Buffer.from('SN'))).toBeNull();
    expect(parseFrame(Buffer.from('W/Fabc')).type).toBe('W/F');
    expect(parseFrame(12345)).toBeNull();
  });

  it('tolerates a truncated SND header without throwing', () => {
    const f = parseFrame(Buffer.from('SND\x00\x01'));
    expect(f.type).toBe('SND');
    expect(f.rssiDbm).toBeNull();
  });
});

describe('kiwi-protocol command builders', () => {
  it('builds the kiwiclient auth / tune / agc / keepalive lines', () => {
    expect(cmd.auth('secret')).toBe('SET auth t=kiwi p=secret');
    expect(cmd.auth('')).toBe('SET auth t=kiwi p=');
    expect(cmd.tune({ freqKHz: 14100 })).toBe('SET mod=cw low_cut=300 high_cut=700 freq=14100.000');
    expect(cmd.tune({ freqKHz: 18110, mode: 'USB', lowCut: 100, highCut: 2800 })).toBe(
      'SET mod=usb low_cut=100 high_cut=2800 freq=18110.000',
    );
    expect(cmd.agc()).toBe('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    expect(cmd.compression(false)).toBe('SET compression=0');
    expect(cmd.squelch()).toBe('SET squelch=0 max=0');
    expect(cmd.genattn()).toBe('SET genattn=0');
    expect(cmd.identUser('OpenHamClock')).toBe('SET ident_user=OpenHamClock');
    expect(cmd.keepalive()).toBe('SET keepalive');
    expect(cmd.arOk(12000)).toBe('SET AR OK in=12000 out=44100');
  });

  it('refuses to put whitespace/newlines into a SET line', () => {
    expect(cmd.auth('a b\nc')).toBe('SET auth t=kiwi p=a_b_c');
    expect(cmd.identUser('x y')).toBe('SET ident_user=x_y');
    expect(() => cmd.tune({ freqKHz: 'nope' })).toThrow();
  });

  it('setup sequence tunes CW 300–700 Hz and ends with the ident', () => {
    const seq = setupCommands({ freqKHz: 21150 });
    expect(seq[0]).toBe('SET squelch=0 max=0');
    expect(seq).toContain('SET mod=cw low_cut=300 high_cut=700 freq=21150.000');
    expect(seq).toContain('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    expect(seq).toContain('SET compression=0');
    expect(seq[seq.length - 1]).toBe('SET ident_user=OpenHamClock');
  });

  it('builds the audio socket URL kiwiclient uses', () => {
    expect(audioSocketUrl('kiwi.example.org', 8073, { timestamp: 1700000000 })).toBe(
      'ws://kiwi.example.org:8073/kiwi/1700000000/SND',
    );
    expect(audioSocketUrl('::1', 8073, { timestamp: 1 })).toBe('ws://[::1]:8073/kiwi/1/SND');
    expect(audioSocketUrl('h', 8073, { secure: true, timestamp: 1 })).toMatch(/^wss:/);
    expect(() => audioSocketUrl('', 8073)).toThrow();
  });
});

describe('kiwi-protocol MSG classification', () => {
  it('recognizes the handshake and rejection messages', () => {
    expect(classifyMsg({ badp: '0' })).toBeNull();
    expect(classifyMsg({ badp: '1' })).toMatchObject({ event: 'badp', reason: 'bad password' });
    expect(classifyMsg({ badp: '2' })).toMatchObject({ event: 'badp', reason: 'user limit reached' });
    expect(classifyMsg({ too_busy: '4' })).toMatchObject({ event: 'too_busy' });
    expect(classifyMsg({ down: '1' })).toMatchObject({ event: 'down' });
    expect(classifyMsg({ redirect: 'http://x' })).toMatchObject({ event: 'redirect', url: 'http://x' });
    expect(classifyMsg({ audio_rate: '12000' })).toEqual({ event: 'audio_rate', rate: 12000 });
    expect(classifyMsg({ sample_rate: '12001.5' })).toEqual({ event: 'sample_rate', rate: 12001.5 });
    expect(classifyMsg({ version_maj: '1' })).toBeNull();
    expect(classifyMsg(null)).toBeNull();
  });
});
