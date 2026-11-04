import { describe, it, expect } from 'vitest';
import { identifyMice, cleanRfStation, stripCommentTelemetry } from './aprsMiceClean.js';
const { identifyMice: serverIdentifyMice } = require('../../server/utils/aprsDeviceId.js');

// Comments from KE8PLM's RF station list (#1245)
const SAMPLES = ['`_%', ']146.640MHz=', '`_1', '`winlink APMAIL_4', ']146.640MHz T123 -060', 'Clermont County, OH'];

describe('Mic-E type bytes in the browser (#1245)', () => {
  it('strips them the same way the server does', () => {
    for (const c of SAMPLES) expect(identifyMice(c), c).toEqual(serverIdentifyMice(c));
  });

  it('turns the reported comments into plain text', () => {
    expect(SAMPLES.map((c) => identifyMice(c).comment)).toEqual([
      '',
      '146.640MHz',
      '',
      'winlink APMAIL',
      '146.640MHz T123 -060',
      'Clermont County, OH',
    ]);
    expect(identifyMice('`_%').device).toMatchObject({ vendor: 'Yaesu' });
  });

  it('cleans an RF Mic-E station and leaves other packets alone', () => {
    const rf = cleanRfStation({ packetType: 'mic-e', comment: ']146.640MHz=', cleanComment: ']146.640MHz=' });
    expect(rf).toMatchObject({ comment: '146.640MHz', cleanComment: '146.640MHz' });
    expect(rf.device).toBeTruthy();
    const pos = { packetType: 'position', comment: '`_%' };
    expect(cleanRfStation(pos)).toBe(pos);
    expect(cleanRfStation(null)).toBeNull();
  });
});

describe('base-91 telemetry from older Rig Bridges (#1245)', () => {
  it('matches the server parser', () => {
    const { parseCommentTelemetry } = require('../../server/utils/aprsParser.js');
    for (const c of ['|!)&2"`|', 'Solar digi |ss11223344556{| 13.8V', 'Net |Mon| 8pm', '|abc|', ''])
      expect(stripCommentTelemetry(c), c).toBe(parseCommentTelemetry(c).comment);
  });

  it('cleans it from any RF packet type, and after the Mic-E bytes', () => {
    expect(cleanRfStation({ packetType: 'position', comment: '|!)&2"`|', cleanComment: '|!)&2"`|' })).toMatchObject({
      comment: '',
      cleanComment: '',
    });
    expect(cleanRfStation({ packetType: 'mic-e', comment: '`|!)&2"`|_%' })).toMatchObject({ comment: '' });
    const plain = { packetType: 'position', comment: 'Clermont County, OH' };
    expect(cleanRfStation(plain)).toBe(plain);
  });
});
