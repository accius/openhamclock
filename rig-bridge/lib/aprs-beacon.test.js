import { describe, it, expect } from 'vitest';
import { createBeaconer, cleanComment, parsePath, intervalSec, GPS_MAX_AGE_MS } from './aprs-beacon.js';
import { buildAx25Frame, parseAx25Frame } from './kiss-protocol.js';

function setup(settings = {}, { connected = true } = {}) {
  let t = 1_700_000_000_000;
  const s = { beaconEnabled: true, beaconInterval: 600, stationLat: 41.5, stationLon: -81.7, ...settings };
  const sent = [];
  const state = { connected, write: true };
  const b = createBeaconer({
    settings: () => s,
    transmit: (lat, lon, comment) => {
      if (!state.write) return null;
      const info = `!pos ${lat},${lon} ${comment}`;
      sent.push({ lat, lon, comment, info });
      return info;
    },
    isConnected: () => state.connected,
    myCall: () => 'KE8PLM-9',
    now: () => t,
  });
  return { b, s, sent, state, advance: (ms) => (t += ms) };
}

describe('aprs-beacon', () => {
  it('sends nothing while beacons are off', () => {
    const { b, sent } = setup({ beaconEnabled: false });
    expect(b.tick()).toBe(false);
    expect(sent).toHaveLength(0);
    expect(b.status().nextDue).toBeNull();
  });

  it('sends at once when on, then once per interval', () => {
    const { b, sent, advance } = setup();
    expect(b.tick()).toBe(true);
    advance(599_000);
    expect(b.tick()).toBe(false);
    advance(1_000);
    expect(b.tick()).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('never beacons faster than once a minute', () => {
    expect(intervalSec({ beaconInterval: 5 })).toBe(60);
    expect(intervalSec({ beaconInterval: 0 })).toBe(600);
    expect(intervalSec({ beaconInterval: 'x' })).toBe(600);
    expect(intervalSec({ beaconInterval: 1800 })).toBe(1800);
  });

  it('uses the override, then a fresh GPS fix, then the station location', () => {
    const { b, s, advance } = setup();
    expect(b.position()).toMatchObject({ lat: 41.5, lon: -81.7, source: 'station' });
    b.noteGps({ fix: true, lat: 41.6, lon: -81.8 });
    expect(b.position()).toMatchObject({ lat: 41.6, source: 'gps' });
    s.beaconLat = '41.7';
    s.beaconLon = '-81.9';
    expect(b.position()).toMatchObject({ lat: 41.7, lon: -81.9, source: 'override' });
    s.beaconLat = '';
    advance(GPS_MAX_AGE_MS + 1);
    expect(b.position().source).toBe('station'); // stale GPS fix ignored
  });

  it('ignores a half-filled or out-of-range override and GPS without a fix', () => {
    const { b, s } = setup({ beaconLat: '41.7', beaconLon: '' });
    expect(b.position().source).toBe('station');
    s.beaconLon = '-200';
    expect(b.position().source).toBe('station');
    b.noteGps({ fix: false, lat: 1, lon: 1 });
    expect(b.position().source).toBe('station');
  });

  it('reports why nothing went out', () => {
    const { b, state } = setup({ stationLat: null, stationLon: null });
    expect(b.send()).toMatchObject({ ok: false, error: expect.stringMatching(/No position/) });
    const other = setup();
    other.state.connected = false;
    expect(other.b.send()).toEqual({ ok: false, error: 'TNC not connected' });
    other.state.connected = true;
    other.state.write = false;
    expect(other.b.send().error).toBe('TNC write failed');
    expect(other.b.status().error).toBe('TNC write failed');
    expect(state).toBeTruthy();
  });

  it('marks the beacon heard when a digipeated copy comes back', () => {
    const { b, sent } = setup();
    b.send();
    const info = sent[0].info;
    // our own frame without a repeated digi, someone else's frame, a different info: not heard
    expect(b.noteFrame({ source: 'KE8PLM-9', info, repeatedBy: [] })).toBe(false);
    expect(b.noteFrame({ source: 'W8ABC', info, repeatedBy: ['W8DIG'] })).toBe(false);
    expect(b.noteFrame({ source: 'KE8PLM-9', info: info + 'x', repeatedBy: ['W8DIG'] })).toBe(false);
    expect(b.status().lastHeard).toBeNull();
    expect(b.noteFrame({ source: 'ke8plm-9', info, repeatedBy: ['W8DIG-1', 'W8DIG-2'] })).toBe(true);
    expect(b.status().lastHeard).toMatchObject({ via: 'W8DIG-2' });
    // a new beacon starts unheard
    b.send();
    expect(b.status().lastHeard).toBeNull();
  });

  it('uses the default comment when blank, cleaned and capped otherwise', () => {
    const { b, sent, s } = setup({ beaconComment: '' });
    b.send();
    expect(sent[0].comment).toBe('OpenHamClock');
    s.beaconComment = 'Shelter "A" <ops> | net 146.52 ~ ' + 'x'.repeat(60);
    expect(b.status().comment.length).toBeLessThanOrEqual(43);
    expect(b.status().comment).not.toMatch(/["<>|~]/);
    expect(cleanComment('héllo\n')).toBe('hllo');
  });
});

describe('parsePath', () => {
  it('reads arrays and the settings page text', () => {
    expect(parsePath(['WIDE1-1', 'WIDE2-1'])).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(parsePath('wide1-1, wide2-2')).toEqual(['WIDE1-1', 'WIDE2-2']);
    expect(parsePath('WIDE2-1')).toEqual(['WIDE2-1']);
  });
  it('blank → default, DIRECT → none, junk → default', () => {
    expect(parsePath('')).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(parsePath(undefined)).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(parsePath('DIRECT')).toEqual([]);
    expect(parsePath('WIDE1-1,TOOLONGCALL')).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(parsePath('WIDE1-16')).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(parsePath(Array(9).fill('WIDE1-1'))).toEqual(['WIDE1-1', 'WIDE2-1']);
  });
});

describe('kiss-protocol repeatedBy', () => {
  it('lists via addresses with the has-been-repeated bit', () => {
    const frame = buildAx25Frame('KE8PLM-9', 'APOHC1', ['W8DIG-1', 'WIDE2-1'], '!test');
    expect(parseAx25Frame(frame).repeatedBy).toEqual([]); // our own transmission: nothing repeated
    // A digipeater sets H (0x80) in the SSID byte of the hop it used: the first via, bytes 14–20.
    const heard = Buffer.from(frame);
    heard[20] |= 0x80;
    const p = parseAx25Frame(heard);
    expect(p.repeatedBy).toEqual(['W8DIG-1']);
    expect(p.digipeaters).toEqual(['W8DIG-1', 'WIDE2-1']); // unchanged
  });
});
