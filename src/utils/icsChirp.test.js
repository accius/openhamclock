/**
 * Tests for icsChirp — CHIRP generic CSV export/import of the ICS 205 plan:
 * duplex/offset, tone modes, mode, and a round trip.
 */
import { describe, it, expect } from 'vitest';
import {
  CHIRP_COLUMNS,
  chirpRecord,
  ics205ToChirpCsv,
  chirpCsvToIcs205Rows,
  parseCsv,
  parseCtcss,
  parseDcs,
} from './icsChirp.js';
import { newIcs205Row, ics205RowFromRepeater, newSimplexRow } from './icsForms.js';

const rec = (row, loc = 1) => Object.fromEntries(CHIRP_COLUMNS.map((c, i) => [c, chirpRecord(row, loc)[i]]));

describe('CHIRP export mapping', () => {
  it('writes the standard CHIRP header', () => {
    expect(ics205ToChirpCsv([]).split('\r\n')[0]).toBe(
      'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Comment,URCALL,RPT1CALL,RPT2CALL',
    );
  });

  it('simplex: no duplex, zero offset, no tone', () => {
    const r = rec(newSimplexRow({ name: 'SIMPLEX', mhz: 146.52 }));
    expect(r).toMatchObject({
      Name: 'SIMPLEX',
      Frequency: '146.520000',
      Duplex: '',
      Offset: '0.000000',
      Tone: '',
      rToneFreq: '88.5',
      cToneFreq: '88.5',
      DtcsCode: '023',
      DtcsPolarity: 'NN',
      Mode: 'FM',
      TStep: '5.00',
    });
  });

  it('negative and positive repeater offsets with a TX tone', () => {
    const minus = rec(ics205RowFromRepeater({ callsign: 'W0XYZ', mhz: 146.94, offsetMhz: -0.6, tone: '100.0' }));
    expect(minus).toMatchObject({
      Frequency: '146.940000',
      Duplex: '-',
      Offset: '0.600000',
      Tone: 'Tone',
      rToneFreq: '100.0',
    });
    const plus = rec(ics205RowFromRepeater({ callsign: 'K1ABC', mhz: 444.5, offsetMhz: 5, tone: '131.8 Hz' }));
    expect(plus).toMatchObject({ Duplex: '+', Offset: '5.000000', Tone: 'Tone', rToneFreq: '131.8' });
  });

  it('same tone both ways is TSQL, different tones are Cross', () => {
    expect(rec(newIcs205Row({ rxFreq: '147.21', txFreq: '147.81', txTone: '123.0', rxTone: '123.0' }))).toMatchObject({
      Duplex: '+',
      Offset: '0.600000',
      Tone: 'TSQL',
      cToneFreq: '123.0',
    });
    expect(rec(newIcs205Row({ rxFreq: '147.21', txFreq: '147.21', txTone: '100.0', rxTone: '123.0' }))).toMatchObject({
      Tone: 'Cross',
      rToneFreq: '100.0',
      cToneFreq: '123.0',
    });
  });

  it('DCS codes map to DTCS with polarity', () => {
    expect(rec(newIcs205Row({ rxFreq: '446.0', txFreq: '446.0', txTone: 'D023N', rxTone: 'D023I' }))).toMatchObject({
      Tone: 'DTCS',
      DtcsCode: '023',
      DtcsPolarity: 'NR',
    });
  });

  it('cross-band TX is a split with the TX frequency in Offset; no TX is receive-only', () => {
    expect(rec(newIcs205Row({ rxFreq: '145.8', txFreq: '437.8' }))).toMatchObject({
      Duplex: 'split',
      Offset: '437.800000',
    });
    expect(rec(newIcs205Row({ rxFreq: '162.55', txFreq: '' }))).toMatchObject({ Duplex: 'off', Offset: '0.000000' });
  });

  it('modes: narrowband NFM, digital names, comment from function/assignment/remarks', () => {
    expect(rec(newIcs205Row({ rxFreq: '155.16', txFreq: '155.16', rxNW: 'N' })).Mode).toBe('NFM');
    expect(rec(newIcs205Row({ rxFreq: '145.67', mode: 'D', modeName: 'D-STAR' })).Mode).toBe('DV');
    expect(rec(newIcs205Row({ rxFreq: '441.0', mode: 'D', modeName: 'DMR' })).Mode).toBe('DMR');
    expect(rec(newIcs205Row({ rxFreq: '441.0', mode: 'D', modeName: 'YSF' })).Mode).toBe('DN');
    expect(rec(newIcs205Row({ rxFreq: '441.0', mode: 'D' })).Mode).toBe('DIG');
    expect(rec(newIcs205Row({ rxFreq: '146.52', function: 'Net', assignment: 'All', remarks: 'Tue' })).Comment).toBe(
      'Net · All · Tue',
    );
  });

  it('skips rows without an RX frequency; distinct channel numbers become Location', () => {
    const csv = ics205ToChirpCsv([
      newSimplexRow({ name: 'A', mhz: 146.52 }),
      newIcs205Row({ name: 'blank' }),
      { ...newSimplexRow({ name: 'C', mhz: 146.55 }), ch: '9' },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines.length).toBe(3);
    expect(lines[1].startsWith('1,A,146.520000')).toBe(true);
    expect(lines[2].startsWith('9,C,146.550000')).toBe(true);
  });
});

describe('CHIRP import', () => {
  it('parses quoted CSV fields, tones and DCS codes', () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "q"'],
      ['1', '2', '3'],
    ]);
    expect(parseCtcss('88.5')).toBe('88.5');
    expect(parseCtcss('x')).toBe('');
    expect(parseDcs('D754I')).toEqual({ code: '754', polarity: 'R' });
    expect(parseDcs('100.0')).toBeNull();
  });

  it('builds 205 rows from a CHIRP export (offsets, tones, split, receive-only)', () => {
    const csv = [
      CHIRP_COLUMNS.join(','),
      '0,W0XYZ,146.940000,-,0.600000,Tone,100.0,88.5,023,NN,FM,5.00,,Denver,,,',
      '1,TSQL,147.210000,+,0.600000,TSQL,88.5,123.0,023,NN,NFM,5.00,,,,,',
      '2,DCS,446.000000,,0.000000,DTCS,88.5,88.5,754,NR,FM,5.00,,,,,',
      '3,XBAND,145.800000,split,437.800000,,88.5,88.5,023,NN,FM,5.00,,,,,',
      '4,WX,162.550000,off,0.000000,,88.5,88.5,023,NN,FM,5.00,,,,,',
      '5,DSTAR,145.670000,,0.000000,,88.5,88.5,023,NN,DV,5.00,,,,,',
      '6,,0,,,,,,,,,,,,,,',
    ].join('\r\n');
    const rows = chirpCsvToIcs205Rows(csv);
    expect(rows.length).toBe(6);
    expect(rows[0]).toMatchObject({
      ch: '0',
      name: 'W0XYZ',
      function: 'Repeater',
      rxFreq: '146.940',
      txFreq: '146.340',
      txTone: '100.0',
      rxTone: '',
      remarks: 'Denver',
      mode: 'A',
      rxNW: 'W',
      source: 'chirp',
    });
    expect(rows[1]).toMatchObject({ txFreq: '147.810', txTone: '123.0', rxTone: '123.0', rxNW: 'N', txNW: 'N' });
    expect(rows[2]).toMatchObject({ function: 'Simplex', txTone: 'D754N', rxTone: 'D754I' });
    expect(rows[3]).toMatchObject({ rxFreq: '145.800', txFreq: '437.800' });
    expect(rows[4]).toMatchObject({ function: 'Receive only', txFreq: '' });
    expect(rows[5]).toMatchObject({ mode: 'D', modeName: 'DV' });
  });

  it('round-trips an exported plan', () => {
    const plan = [
      ics205RowFromRepeater({ callsign: 'W0XYZ', mhz: 146.94, offsetMhz: -0.6, tone: '100.0', mode: 'FM' }),
      newIcs205Row({
        name: 'TSQ',
        rxFreq: '147.21',
        txFreq: '147.81',
        txTone: '123.0',
        rxTone: '123.0',
        rxNW: 'N',
        txNW: 'N',
      }),
      newSimplexRow({ name: 'S', mhz: 146.52 }),
    ];
    const back = chirpCsvToIcs205Rows(ics205ToChirpCsv(plan));
    const pick = (r) => [r.name, Number(r.rxFreq), Number(r.txFreq), r.txTone, r.rxTone, r.rxNW];
    expect(back.map(pick)).toEqual(plan.map(pick));
  });

  it('rejects a file that is not CHIRP CSV', () => {
    expect(() => chirpCsvToIcs205Rows('foo,bar\n1,2')).toThrow(/CHIRP/);
    expect(chirpCsvToIcs205Rows('')).toEqual([]);
  });
});
