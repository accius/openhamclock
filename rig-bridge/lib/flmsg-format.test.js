/**
 * flmsg-format — checked against files produced by flmsg's own code
 * (fixtures/flmsg, made by make-fixtures.cxx from flmsg's sources): field
 * layout, header stamps, WRAP checksum span, Ccrc16 on both char signednesses,
 * LZMA-compressed transfers, and dates in every flmsg date format.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import fmt from './flmsg-format.js';

const {
  lineout,
  parseFlmsg,
  serializeFlmsg,
  buildIcs213,
  fieldsToFriendly,
  asciiFold,
  crc16,
  wrapFlmsg,
  unwrapFlmsg,
  decompressFlmsg,
  findLocation,
  stampToTime,
  parseHeaderEntries,
  parseFormDateTime,
  resolveDateOrder,
  parseFlmsgPrefs,
  formToFieldReport,
} = fmt;

const dir = path.join(__dirname, 'fixtures', 'flmsg');
const raw = (name) => fs.readFileSync(path.join(dir, name));
const text = (name) => raw(name).toString('utf8');

const hasLzma = (() => {
  try {
    createRequire(import.meta.url)('lzma/src/lzma_worker.js');
    return true;
  } catch {
    return false;
  }
})();

describe('lineout', () => {
  it('writes tag, byte length, one space, value, newline — nothing for empty values', () => {
    expect(lineout('to', 'EOC')).toBe(':to:3 EOC\n');
    expect(lineout('mg', 'a\nb')).toBe(':mg:3 a\nb\n');
    expect(lineout('mg', 'café')).toBe(':mg:5 café\n'); // bytes, not characters
    expect(lineout('to', '')).toBe('');
    expect(lineout('to', null)).toBe('');
  });
});

describe('parseFlmsg on an flmsg-written ICS-213', () => {
  const doc = parseFlmsg(text('ics213.213'));

  it('reads version, form, the newline-led header and a multi-line message', () => {
    expect(doc.version).toBe('4.0.23');
    expect(doc.form).toBe('ics213');
    expect(doc.header.hdr_fm).toBe('\nN8TAG 20261510143200');
    expect(doc.fields.to).toBe('Logistics Section Chief');
    expect(doc.fields.mg.split('\n')).toHaveLength(3);
    expect(doc.fields.p3).toBe('Shelter Manager');
  });

  it('keeps a value containing a line that looks like a field', () => {
    const t = `<flmsg>4.0.23\n<ics213>\n${lineout('mg', 'one\n:to:3 not a field\nend')}${lineout('to', 'EOC')}`;
    expect(parseFlmsg(t).fields).toEqual({ mg: 'one\n:to:3 not a field\nend', to: 'EOC' });
  });

  it('tolerates wrong lengths, CRLF and a BOM', () => {
    const t = '\uFEFF<flmsg>4.0.23\r\n<ics213>\r\n:to:99 EOC\r\n:sb:2 Cots required\r\n:mg:4 hello\r\nworld\r\n';
    expect(parseFlmsg(t).fields).toEqual({ to: 'EOC', sb: 'Cots required', mg: 'hello\nworld' });
  });

  it('returns an empty document for non-flmsg input', () => {
    expect(parseFlmsg('hello').form).toBeNull();
    expect(parseFlmsg(undefined).form).toBeNull();
  });
});

describe('serialiser matches flmsg byte for byte', () => {
  it('re-serialising the parsed fixture reproduces it', () => {
    const original = text('ics213.213');
    const d = parseFlmsg(original);
    const again =
      `<flmsg>${d.version}\n` +
      lineout('hdr_fm', d.header.hdr_fm) +
      lineout('hdr_ed', d.header.hdr_ed) +
      `<${d.form}>\n` +
      Object.entries(d.fields)
        .map(([k, v]) => lineout(k, v))
        .join('');
    expect(again).toBe(original);
  });

  it('buildIcs213 writes the same file flmsg does for the same fields', () => {
    const d = parseFlmsg(text('ics213.213'));
    const friendly = fieldsToFriendly('ics213', d.fields);
    // Header stamp YYYYDDMMhhmmss, UTC: 2026-10-15 14:32:00 → 20261510143200
    const built = buildIcs213(friendly, { call: 'n8tag', when: Date.UTC(2026, 9, 15, 14, 32, 0) });
    expect(built).toBe(text('ics213.213'));
  });

  it('fills date and time (UTC) and omits empty fields; no callsign → no header lines', () => {
    const t = buildIcs213({ to: 'EOC', message: 'hi', subject: '' }, { when: Date.UTC(2026, 0, 2, 3, 4) });
    expect(t).toBe('<flmsg>4.0.23\n<ics213>\n:to:3 EOC\n:d1:10 2026-01-02\n:t1:5 0304Z\n:mg:2 hi\n');
  });

  it('serializeFlmsg writes other forms', () => {
    expect(serializeFlmsg({ form: 'plaintext', fields: { tt: 'T', mg: 'B' }, call: 'W1AW', when: 0 })).toBe(
      '<flmsg>4.0.23\n:hdr_fm:20 \nW1AW 19700101000000\n:hdr_ed:20 \nW1AW 19700101000000\n<plaintext>\n:tt:1 T\n:mg:1 B\n',
    );
  });
});

describe('header stamps', () => {
  it('reads YYYYDDMMhhmmss, every sender, newest last', () => {
    expect(new Date(stampToTime('20261510143200')).toISOString()).toBe('2026-10-15T14:32:00.000Z');
    expect(parseHeaderEntries('\nW1AW 20260101000000\nN8TAG 20261510143200')).toEqual([
      { call: 'W1AW', time: Date.UTC(2026, 0, 1) },
      { call: 'N8TAG', time: Date.UTC(2026, 9, 15, 14, 32) },
    ]);
  });

  it('falls back to YYYYMMDD when the day/month order cannot be a date', () => {
    expect(new Date(stampToTime('20261015143200')).toISOString()).toBe('2026-10-15T14:32:00.000Z');
  });
});

describe('WRAP and Ccrc16', () => {
  it('CRC-16 check value; signed-char and unsigned-char results from flmsg builds', () => {
    expect(crc16('123456789')).toBe('4B37');
    // Values printed by make-fixtures.cxx (signed char) and its -funsigned-char build
    expect(crc16('café', true)).toBe('FF25');
    expect(crc16('café', false)).toBe('658F');
    expect(crc16('[WRAP:fn x.213]Straße 12\n', true)).toBe('542A');
    expect(crc16('[WRAP:fn x.213]Straße 12\n', false)).toBe('6B0E');
    expect(crc16('€50 été', true)).toBe('FF07');
    expect(crc16('€50 été', false)).toBe('EB10');
  });

  it('wrapFlmsg reproduces flmsg’s transfer exactly (checksum over [WRAP:fn] + text)', () => {
    expect(wrapFlmsg(text('ics213.213'), 'N8TAG-20261015-143200.213')).toBe(text('ics213.wrap'));
  });

  it('unwraps flmsg transfers, and both non-ASCII checksum variants verify', () => {
    const u = unwrapFlmsg(raw('ics213.wrap'));
    expect(u).toMatchObject({ filename: 'N8TAG-20261015-143200.213', checksum: 'C8A8', checksumOk: true });
    expect(u.content).toBe(text('ics213.213'));
    for (const f of ['ics213-nonascii-signed.wrap', 'ics213-nonascii-unsigned.wrap']) {
      const n = unwrapFlmsg(raw(f));
      expect(n.checksumOk, f).toBe(true);
      expect(parseFlmsg(n.content).fields.mg).toBe('Wasser für 20 Personen');
    }
  });

  it('accepts a transfer whose line ends became CRLF on the air, and flags corruption', () => {
    const crlf = text('ics213.wrap').replace(/\n/g, '\r\n');
    expect(unwrapFlmsg(crlf)).toMatchObject({ checksumOk: true, content: text('ics213.213') });
    expect(unwrapFlmsg(text('ics213.wrap').replace('40 cots', '41 cots')).checksumOk).toBe(false);
  });

  it('rejects path tricks in the filename, and returns null without an envelope', () => {
    const bad = wrapFlmsg('<flmsg>4.0.23\n<ics213>\n', 'x').replace('[WRAP:fn x]', '[WRAP:fn ../x]');
    expect(unwrapFlmsg(bad).filename).toBeNull();
    expect(unwrapFlmsg('<flmsg>4.0.23')).toBeNull();
  });

  it('folds outgoing text to ASCII', () => {
    expect(asciiFold('Café Städtler – “OK” 20°…')).toBe('Cafe Stadtler - "OK" 20 deg...');
    expect(asciiFold('Straße 東')).toBe('Strasse ?');
  });
});

describe('compressed transfers', () => {
  it.runIf(hasLzma)('decodes flmsg’s LZMA + base64 transfer to the same form', () => {
    const u = unwrapFlmsg(raw('ics213-lzma.wrap'));
    expect(u).toMatchObject({ checksumOk: true, compressed: true, error: null });
    expect(u.content).toBe(text('ics213.213'));
    const plain = formToFieldReport(raw('ics213.213'));
    const packed = formToFieldReport(raw('ics213-lzma.wrap'));
    expect(packed.id).toBe(plain.id);
    expect(packed.extra).toMatchObject({ checksum: 'OK', compressed: 'yes' });
  });

  it('reports corrupt or unsupported armour instead of a form', () => {
    expect(decompressFlmsg('[b64:start]AUxaTUEAAAA[b64:end]').error).toBe('corrupt');
    expect(decompressFlmsg('[b128:start]\n12\nxx\n[b128:end]').error).toBe('unsupported-encoding');
    expect(decompressFlmsg('no armour').compressed).toBe(false);
    expect(formToFieldReport(wrapFlmsg('[b64:start]AUxaTUEAAAA[b64:end]', 'c.213'))).toEqual({
      error: 'corrupt',
      filename: 'c.213',
    });
  });

  it('base64 without the LZMA marker is substituted as plain text', () => {
    const b = Buffer.from(':mg:2 hi\n').toString('base64');
    expect(decompressFlmsg(`<ics213>\n[b64:start]${b}[b64:end]`).text).toBe('<ics213>\n:mg:2 hi\n');
  });
});

describe('dates', () => {
  const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

  it('reads every flmsg date format (szDate 0–4) and radiogram dates', () => {
    expect(parseFormDateTime('2026-10-15', '1432Z')).toBe(Date.UTC(2026, 9, 15, 14, 32));
    expect(parseFormDateTime('10/15/26', '14:32Z')).toBe(Date.UTC(2026, 9, 15, 14, 32));
    expect(parseFormDateTime('15/10/26', '1432 UTC')).toBe(Date.UTC(2026, 9, 15, 14, 32));
    expect(parseFormDateTime('2026-15-10', '14:32 UTC')).toBe(Date.UTC(2026, 9, 15, 14, 32));
    expect(parseFormDateTime('20261510', '143200')).toBe(at(2026, 10, 15, 14, 32));
    expect(parseFormDateTime('OCT 15', '1200Z', { year: 2026 })).toBe(Date.UTC(2026, 9, 15, 12));
    expect(parseFormDateTime('2026-10-15', '1432L')).toBe(at(2026, 10, 15, 14, 32));
    expect(parseFormDateTime('', '1432')).toBeNull();
    expect(parseFormDateTime('2026-13-40', '')).toBeNull();
  });

  it('uses the configured order only when the date is ambiguous', () => {
    expect(parseFormDateTime('03/04/26', '', { slash: 'mdy' })).toBe(at(2026, 3, 4));
    expect(parseFormDateTime('03/04/26', '', { slash: 'dmy' })).toBe(at(2026, 4, 3));
    expect(parseFormDateTime('25/04/26', '', { slash: 'mdy' })).toBe(at(2026, 4, 25));
    expect(parseFormDateTime('2026-03-04', '', { dash: 'ydm' })).toBe(at(2026, 4, 3));
    expect(parseFormDateTime('2026-03-04', '', { dash: 'ymd' })).toBe(at(2026, 3, 4));
  });

  it('resolves the order: setting, then flmsg’s dtformat, then the locale', () => {
    expect(resolveDateOrder({ setting: 'dmy' })).toEqual({ slash: 'dmy', dash: 'ymd', source: 'setting' });
    expect(resolveDateOrder({ setting: 'auto', flmsgDtformat: 2, locale: 'en-US' })).toMatchObject({
      slash: 'dmy',
      source: 'flmsg',
    });
    expect(resolveDateOrder({ setting: 'auto', flmsgDtformat: 3, locale: 'en-US' })).toMatchObject({
      dash: 'ydm',
      slash: 'mdy',
    });
    expect(resolveDateOrder({ locale: 'en-US' })).toEqual({ slash: 'mdy', dash: 'ymd', source: 'locale' });
    expect(resolveDateOrder({ locale: 'en-GB' })).toEqual({ slash: 'dmy', dash: 'ymd', source: 'locale' });
    expect(resolveDateOrder({ locale: 'de-DE' }).slash).toBe('dmy');
  });

  it('reads dtformat and mycall from flmsg.prefs', () => {
    const prefs =
      '; FLTK preferences file format 1.0\n; vendor: w1hkj.com\n; application: flmsg\n\n[.]\n\nutc:2\ndtformat:2\nmycall:ke8plm\n';
    expect(parseFlmsgPrefs(prefs)).toEqual({ dtformat: 2, mycall: 'KE8PLM' });
    expect(parseFlmsgPrefs('')).toEqual({ dtformat: null, mycall: '' });
  });
});

describe('helpers', () => {
  it('findLocation recognises lat/lon, grids and decimal pairs', () => {
    expect(findLocation('LAT 39.0997 LON -94.5786')).toMatchObject({ lat: 39.0997, lon: -94.5786 });
    expect(findLocation('Lat: 39.1N, Long: 94.6W')).toMatchObject({ lat: 39.1, lon: -94.6 });
    expect(findLocation('position GRID EM29qb').source).toBe('grid');
    expect(findLocation('at 39.0997, -94.5786 now')).toMatchObject({ lat: 39.0997, lon: -94.5786 });
    expect(findLocation('need 40 cots by 1800')).toBeNull();
  });
});

describe('formToFieldReport', () => {
  it('turns the flmsg ICS-213 into a located field report', () => {
    const r = formToFieldReport(raw('ics213.213'), { file: '/x/NBEMS.files/ICS/messages/ics213.213' });
    expect(r).toMatchObject({
      callsign: 'N8TAG',
      formType: 'ICS-213 (NBEMS)',
      form: 'ics213',
      senders: ['N8TAG'],
      wrapped: false,
      timestamp: new Date(2026, 9, 15, 14, 32).getTime(), // "1432L" is local time
    });
    expect(r.text).toMatch(/^Cots required — Need 40 cots/);
    expect(r.lat).toBeCloseTo(39.06, 1);
    expect(r.extra).toMatchObject({ incident: 'Spring Flood 2026', from: 'Shelter 3 Manager', file: 'ics213.213' });
  });

  it('gives the plain file and its transfer the same id', () => {
    expect(formToFieldReport(raw('ics213.wrap')).id).toBe(formToFieldReport(raw('ics213.213')).id);
  });

  it('reads a radiogram, dating "OCT 15" by the header year', () => {
    const r = formToFieldReport(raw('welfare.m2s'));
    expect(r).toMatchObject({ callsign: 'N8TAG', formType: 'Radiogram (NBEMS)', lat: null });
    expect(r.timestamp).toBe(Date.UTC(2026, 9, 15, 12));
    expect(r.extra).toMatchObject({ number: '42', precedence: 'PRIORITY', check: '12', placeOfOrigin: 'Columbus OH' });
  });

  it('reads a HICS-213 by its numbered tags', () => {
    const t = serializeFlmsg({ form: 'hics213', fields: { 1: 'Ops', 2: 'Logistics', 8: 'Generator down' } });
    expect(formToFieldReport(t)).toMatchObject({ formType: 'HICS-213 (NBEMS)', text: 'Generator down' });
  });

  it('uses the date order it is given', () => {
    const t = serializeFlmsg({ form: 'ics213', fields: { d1: '03/04/26', t1: '1200Z', mg: 'x' } });
    expect(formToFieldReport(t, { dateOrder: { slash: 'dmy' } }).timestamp).toBe(Date.UTC(2026, 3, 3, 12));
    expect(formToFieldReport(t, { dateOrder: { slash: 'mdy' } }).timestamp).toBe(Date.UTC(2026, 2, 4, 12));
  });

  it('a never-sent draft has no senders', () => {
    const draft = serializeFlmsg({ form: 'ics213', fields: { mg: 'draft' } });
    expect(formToFieldReport(draft).senders).toEqual([]);
  });

  it('returns null for non-forms', () => {
    expect(formToFieldReport('just text')).toBeNull();
  });
});
