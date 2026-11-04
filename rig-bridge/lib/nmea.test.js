import { describe, it, expect } from 'vitest';
import {
  computeChecksum,
  splitSentence,
  parseCoordinate,
  parseUtcTime,
  parseSentence,
  LineSplitter,
  NmeaFix,
} from './nmea.js';
import { latLonToGrid } from './maidenhead.js';
import { applyTpv, applySky, parseGpsdLine } from './gpsd.js';
import { latLonToMaidenhead } from '../../src/utils/geo.js';

// Classic textbook sentences (Munich, 23 Mar 1994 12:35:19 UTC)
const RMC = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
const GGA = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
const GSA = '$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39';

describe('nmea checksum + framing', () => {
  it('computes the XOR checksum', () => {
    expect(computeChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W')).toBe(0x6a);
  });
  it('rejects a bad checksum and accepts a missing one', () => {
    expect(splitSentence(RMC.replace('*6A', '*6B'))).toBeNull();
    expect(splitSentence(RMC.replace('*6A', ''))).not.toBeNull();
  });
  it('rejects junk', () => {
    expect(splitSentence('')).toBeNull();
    expect(splitSentence('hello')).toBeNull();
    expect(splitSentence('$X,1,2')).toBeNull();
    expect(parseSentence(null)).toBeNull();
  });
  it('accepts any two-letter talker (GN, GL, GA, BD)', () => {
    const gn = RMC.replace('$GPRMC', '$GNRMC').replace('*6A', '');
    expect(parseSentence(gn).talker).toBe('GN');
  });
});

describe('coordinate and time parsing', () => {
  it('converts ddmm.mmmm with hemisphere', () => {
    expect(parseCoordinate('4807.038', 'N')).toBeCloseTo(48.1173, 4);
    expect(parseCoordinate('01131.000', 'E')).toBeCloseTo(11.516667, 5);
    expect(parseCoordinate('4807.038', 'S')).toBeCloseTo(-48.1173, 4);
    expect(parseCoordinate('', 'N')).toBeNull();
  });
  it('builds a UTC Date from hhmmss + ddmmyy', () => {
    const d = parseUtcTime('123519', '230394');
    expect(d.toISOString()).toBe('1994-03-23T12:35:19.000Z');
    expect(parseUtcTime('123519.50', '010126').toISOString()).toBe('2026-01-01T12:35:19.500Z');
    expect(parseUtcTime('', '230394')).toBeNull();
    expect(parseUtcTime('253519', '230394')).toBeNull();
  });
});

describe('sentence parsing', () => {
  it('parses RMC', () => {
    const s = parseSentence(RMC);
    expect(s.type).toBe('RMC');
    expect(s.valid).toBe(true);
    expect(s.lat).toBeCloseTo(48.1173, 4);
    expect(s.lon).toBeCloseTo(11.516667, 5);
    expect(s.speedKn).toBeCloseTo(22.4);
    expect(s.speedKmh).toBeCloseTo(41.4848, 3);
    expect(s.course).toBeCloseTo(84.4);
    expect(s.time.toISOString()).toBe('1994-03-23T12:35:19.000Z');
  });
  it('parses GGA', () => {
    const s = parseSentence(GGA);
    expect(s.type).toBe('GGA');
    expect(s.quality).toBe(1);
    expect(s.valid).toBe(true);
    expect(s.sats).toBe(8);
    expect(s.hdop).toBeCloseTo(0.9);
    expect(s.alt).toBeCloseTo(545.4);
  });
  it('parses GSA fix mode', () => {
    const s = parseSentence(GSA);
    expect(s.type).toBe('GSA');
    expect(s.fixMode).toBe(3);
    expect(s.hdop).toBeCloseTo(1.3);
  });
  it('marks a void RMC as no fix', () => {
    const s = parseSentence('$GPRMC,123519,V,,,,,,,230394,,,N');
    expect(s.valid).toBe(false);
    expect(s.lat).toBeNull();
  });
  it('ignores other sentence types', () => {
    expect(parseSentence('$GPGSV,3,1,11,03,03,111,00,04,15,270,00,06,01,010,00,13,06,292,00*74')).toBeNull();
  });
});

describe('LineSplitter', () => {
  it('reassembles lines split across chunks', () => {
    const ls = new LineSplitter();
    expect(ls.push('$GPRMC,1')).toEqual([]);
    expect(ls.push('23\r\n$GPGGA,4\n$GP')).toEqual(['$GPRMC,123', '$GPGGA,4']);
    expect(ls.push(Buffer.from('X\n'))).toEqual(['$GPX']);
  });
});

describe('NmeaFix merge', () => {
  it('merges RMC + GGA + GSA into one fix with a 6-char grid', () => {
    const fx = new NmeaFix();
    fx.update(RMC, 1000);
    const f = fx.update(GGA, 2000);
    fx.update(GSA, 3000);
    expect(f.fix).toBe(true);
    expect(f.lat).toBeCloseTo(48.1173, 4);
    expect(f.alt).toBeCloseTo(545.4);
    expect(f.speed).toBeCloseTo(41.4848, 3);
    expect(f.course).toBeCloseTo(84.4);
    expect(f.sats).toBe(8);
    expect(f.time).toBe('1994-03-23T12:35:19.000Z');
    expect(f.grid6).toBe(latLonToMaidenhead({ lat: f.lat, lon: f.lon }, 6));
    expect(fx.fix.mode).toBe(3);
  });
  it('drops the fix on a void RMC but keeps the last position', () => {
    const fx = new NmeaFix();
    fx.update(RMC);
    const f = fx.update('$GPRMC,123520,V,,,,,,,230394,,,N');
    expect(f.fix).toBe(false);
    expect(f.lat).toBeCloseTo(48.1173, 4);
    expect(f.grid6).toBeNull();
  });
  it('returns null for lines that are not fixes', () => {
    expect(new NmeaFix().update('garbage')).toBeNull();
  });
});

describe('maidenhead (bridge copy matches the browser helper)', () => {
  const points = [
    [40.015, -105.2705],
    [48.1173, 11.516667],
    [-33.8688, 151.2093],
    [0, 0],
    [89.9, 179.9],
    [-89.9, -179.9],
  ];
  for (const [lat, lon] of points) {
    it(`${lat},${lon}`, () => {
      expect(latLonToGrid(lat, lon, 6)).toBe(latLonToMaidenhead({ lat, lon }, 6));
      expect(latLonToGrid(lat, lon, 4)).toBe(latLonToMaidenhead({ lat, lon }, 4));
    });
  }
  it('rejects garbage', () => {
    expect(latLonToGrid(NaN, 0)).toBeNull();
    expect(latLonToGrid(91, 0)).toBeNull();
  });
});

describe('gpsd TPV / SKY mapping', () => {
  it('maps a 3D TPV to the shared fix shape', () => {
    const fix = {};
    applyTpv(
      fix,
      {
        class: 'TPV',
        mode: 3,
        time: '2026-10-14T10:00:00.000Z',
        lat: 40.015,
        lon: -105.2705,
        altMSL: 1630,
        speed: 10,
        track: 90,
      },
      5,
    );
    expect(fix.fix).toBe(true);
    expect(fix.alt).toBe(1630);
    expect(fix.speed).toBeCloseTo(36);
    expect(fix.course).toBe(90);
    expect(fix.grid6).toBe('DN70ia');
    expect(fix.time).toBe('2026-10-14T10:00:00.000Z');
    expect(fix.updatedAt).toBe(5);
  });
  it('mode 1 means no fix', () => {
    const fix = {};
    applyTpv(fix, { class: 'TPV', mode: 1 });
    expect(fix.fix).toBe(false);
    expect(fix.grid6).toBeNull();
  });
  it('SKY sets used-satellite count', () => {
    const fix = {};
    applySky(fix, { class: 'SKY', hdop: 1.1, satellites: [{ used: true }, { used: false }, { used: true }] });
    expect(fix.sats).toBe(2);
    expect(fix.hdop).toBe(1.1);
    applySky(fix, { class: 'SKY', uSat: 7 });
    expect(fix.sats).toBe(7);
    expect(applyTpv(fix, { class: 'SKY' })).toBeNull();
  });
  it('parses JSON lines and ignores noise', () => {
    expect(parseGpsdLine('{"class":"VERSION"}').class).toBe('VERSION');
    expect(parseGpsdLine('not json')).toBeNull();
    expect(parseGpsdLine('{broken')).toBeNull();
  });
});
