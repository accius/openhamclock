import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseActiveNets, parseCheckins, parseFrequency, parseNetDate, decodeEntities } from './netlogger.js';

const fixture = (name) => readFileSync(resolve(process.cwd(), 'server/utils/__fixtures__/netlogger', name), 'utf8');

describe('netlogger — parseActiveNets', () => {
  const result = parseActiveNets(fixture('active-nets.xml'));

  it('lists every net across all servers with its server name', () => {
    expect(result.apiVersion).toBe('1.3.1');
    expect(result.servers).toEqual(['NETLOGGER', 'NETLOGGER2']);
    expect(result.nets).toHaveLength(4);
    expect(result.nets.map((n) => n.server)).toEqual(['NETLOGGER', 'NETLOGGER', 'NETLOGGER', 'NETLOGGER2']);
  });

  it('normalises frequency to MHz and keeps the raw text', () => {
    const [simplex, tune, web, county] = result.nets;
    expect(simplex).toMatchObject({ name: 'ALL IN SIMPLEX', freq: 146.52, freqRaw: '146520', mode: 'FM', band: '2m' });
    expect(tune.freq).toBe(7.272);
    expect(web.freq).toBeNull();
    expect(web.freqRaw).toBe('www.example.org');
    expect(county.freq).toBe(14.336);
  });

  it('decodes entities, parses dates, and tolerates missing counts', () => {
    const tune = result.nets[1];
    expect(tune.name).toBe('Test & Tune Net');
    expect(tune.altName).toBe('T&T');
    expect(tune.ncs).toBe('K1ABC');
    expect(tune.started).toBe('2026-10-14T23:10:34.000Z');
    expect(tune.checkins).toBe(12);
    const county = result.nets[3];
    expect(county.started).toBeNull();
    expect(county.checkins).toBe(0);
  });

  it('returns an empty list for garbage', () => {
    expect(parseActiveNets('').nets).toEqual([]);
    expect(parseActiveNets('<html>403</html>').nets).toEqual([]);
    expect(parseActiveNets(null).nets).toEqual([]);
  });
});

describe('netlogger — parseCheckins (XML)', () => {
  const result = parseCheckins(fixture('checkins.xml'));

  it('reads the list header and every check-in', () => {
    expect(result.server).toBe('NETLOGGER');
    expect(result.net).toBe('ALL IN SIMPLEX');
    expect(result.count).toBe(3);
    expect(result.checkins).toHaveLength(3);
  });

  it('projects public fields only — no street, ZIP or member id', () => {
    const first = result.checkins[0];
    expect(first).toEqual({
      serial: 1,
      call: 'N0CALL',
      name: 'Patricia',
      state: 'SC',
      city: 'Lancaster',
      county: 'Lancaster',
      country: 'United States',
      grid: 'EM94ov',
      status: '(nc)',
      remarks: null,
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/Example St|00000|MemberID|1234/);
  });

  it('upper-cases calls, prefers the preferred name, normalises grids', () => {
    const second = result.checkins[1];
    expect(second.call).toBe('K1ABC');
    expect(second.name).toBe('Todd');
    expect(second.grid).toBe('EM94pw');
    expect(second.remarks).toBe('mobile & QRP');
    const third = result.checkins[2];
    expect(third.grid).toBeNull();
    expect(third.name).toBeNull();
    expect(third.status).toBe('(c/o)');
  });
});

describe('netlogger — parseCheckins (legacy |~ text)', () => {
  it('splits records on |~ and fields on |', () => {
    const legacy =
      'N0CALL|Boulder|CO|Chris|QRP|direct|2026-10-14 23:00:00|Boulder|DN70kp|1 Main St|80301|(nc)|42|United States|291|Christopher|~' +
      'k1abc|Boston|MA|Todd||||Suffolk|FN42||||United States||' +
      '|~';
    const r = parseCheckins(legacy);
    expect(r.count).toBe(2);
    expect(r.checkins[0]).toMatchObject({
      serial: 1,
      call: 'N0CALL',
      name: 'Christopher',
      grid: 'DN70kp',
      status: '(nc)',
    });
    expect(r.checkins[1]).toMatchObject({ serial: 2, call: 'K1ABC', name: 'Todd', grid: 'FN42', state: 'MA' });
    expect(JSON.stringify(r)).not.toMatch(/Main St|80301/);
  });

  it('returns empty for blank input', () => {
    expect(parseCheckins('')).toEqual({ server: null, net: null, count: 0, checkins: [] });
    expect(parseCheckins(undefined).checkins).toEqual([]);
  });
});

describe('netlogger — helpers', () => {
  it('parseFrequency handles kHz, MHz, units and junk', () => {
    expect(parseFrequency('146520')).toBe(146.52);
    expect(parseFrequency('7.272')).toBe(7.272);
    expect(parseFrequency('14,336')).toBe(14.336);
    expect(parseFrequency('3.985 MHz')).toBe(3.985);
    expect(parseFrequency('7185 kHz')).toBe(7.185);
    expect(parseFrequency('Echolink')).toBeNull();
    expect(parseFrequency('')).toBeNull();
    expect(parseFrequency('0')).toBeNull();
  });

  it('parseNetDate and decodeEntities', () => {
    expect(parseNetDate('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05.000Z');
    expect(parseNetDate('nope')).toBeNull();
    expect(decodeEntities('A &amp; B &lt;3 &#39;x&#39; &#x41;')).toBe("A & B <3 'x' A");
  });
});
