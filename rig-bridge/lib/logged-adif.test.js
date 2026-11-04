// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseLoggedAdifPacket, describeAdif } from './logged-adif.js';

// Captured from RUMlogNG 6.4.1 with "Contact N1MM & ADIF" enabled (calls
// replaced). On every new QSO it sends a <contactinfo> and this packet.
const ADIF_PACKET = `<?xml version="1.0" encoding="UTF-8"?>
<QsoLoggedInfoAdif>
    <AppVersion>RUMlogNG 6.4.1</AppVersion>
    <ADIF>&lt;call:5&gt;AA1AA &lt;qso_date:8&gt;20261016 &lt;time_on:6&gt;003615 &lt;band:3&gt;20m &lt;freq:9&gt;14.075159 &lt;mode:3&gt;FT8 &lt;rst_sent:3&gt;-06 &lt;rst_rcvd:3&gt;+04 &lt;gridsquare:6&gt;EN27NK &lt;comment:25&gt;FT8  Sent: -06  Rcvd: +04 &lt;eor&gt;</ADIF>
</QsoLoggedInfoAdif>`;

const CONTACT_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<contactinfo>
    <timestamp>2026-10-16 00:36:15</timestamp>
    <mycall>N0CALL</mycall>
    <band>14</band>
    <mode>FT8</mode>
    <call>AA1AA</call>
</contactinfo>`;

// Editing a QSO sends a delete + replace pair, never an ADIF packet.
const CONTACT_REPLACE = CONTACT_INFO.replace(/contactinfo/g, 'contactreplace');
const CONTACT_DELETE = `<?xml version="1.0" encoding="UTF-8"?>
<contactdelete>
    <timestamp>2026-10-16 00:10:15</timestamp>
    <call>AA1AA</call>
    <contactreplace>YES</contactreplace>
</contactdelete>`;

describe('parseLoggedAdifPacket', () => {
  it('extracts and unescapes the ADIF record from a QsoLoggedInfoAdif packet', () => {
    const adif = parseLoggedAdifPacket(ADIF_PACKET);
    expect(adif).toBe(
      '<call:5>AA1AA <qso_date:8>20261016 <time_on:6>003615 <band:3>20m <freq:9>14.075159 <mode:3>FT8 ' +
        '<rst_sent:3>-06 <rst_rcvd:3>+04 <gridsquare:6>EN27NK <comment:25>FT8  Sent: -06  Rcvd: +04 <eor>',
    );
  });

  it('accepts a Buffer', () => {
    expect(parseLoggedAdifPacket(Buffer.from(ADIF_PACKET))).toMatch(/^<call:5>AA1AA /);
  });

  it('ignores N1MM contact info, replace and delete packets', () => {
    expect(parseLoggedAdifPacket(CONTACT_INFO)).toBeNull();
    expect(parseLoggedAdifPacket(CONTACT_REPLACE)).toBeNull();
    expect(parseLoggedAdifPacket(CONTACT_DELETE)).toBeNull();
  });

  it('unescapes every XML entity once, not twice', () => {
    const pkt =
      '<QsoLoggedInfoAdif><ADIF>&lt;call:5&gt;AA1AA &lt;comment:13&gt;R&amp;D &quot;hi&quot; &amp;lt;x&gt; &#39;y&#x27; &lt;eor&gt;</ADIF></QsoLoggedInfoAdif>';
    expect(parseLoggedAdifPacket(pkt)).toBe('<call:5>AA1AA <comment:13>R&D "hi" &lt;x> \'y\' <eor>');
  });

  it('rejects packets without a usable ADIF record', () => {
    expect(parseLoggedAdifPacket('<QsoLoggedInfoAdif><ADIF></ADIF></QsoLoggedInfoAdif>')).toBeNull();
    expect(parseLoggedAdifPacket('<QsoLoggedInfoAdif><ADIF>&lt;call:5&gt;AA1AA</ADIF></QsoLoggedInfoAdif>')).toBeNull();
    expect(parseLoggedAdifPacket('not xml at all')).toBeNull();
    expect(parseLoggedAdifPacket('')).toBeNull();
  });
});

describe('describeAdif', () => {
  it('summarises a record for logs', () => {
    expect(describeAdif(parseLoggedAdifPacket(ADIF_PACKET))).toBe('AA1AA 20261016 003615 20m FT8');
  });

  it('copes with missing fields', () => {
    expect(describeAdif('<call:5>AA1AA <eor>')).toBe('AA1AA');
  });
});
