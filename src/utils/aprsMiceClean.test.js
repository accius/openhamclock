import { describe, it, expect } from 'vitest';
import { identifyMice, cleanRfStation } from './aprsMiceClean.js';
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
