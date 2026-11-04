import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { listZipEntries, extractKml } from './kmz.js';

const fx = (name) => fs.readFileSync(path.join(__dirname, '__fixtures__', name));

describe('kmz', () => {
  it('lists entries of a deflated NHC track KMZ', () => {
    const entries = listZipEntries(fx('nhc-track.kmz'));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('ep212026_006adv_TRACK.kml');
    expect(entries[0].method).toBe(8);
    expect(entries[0].size).toBeGreaterThan(10000);
  });

  it('inflates the KML document (method 8)', () => {
    const kml = extractKml(fx('nhc-track.kmz'));
    expect(kml.startsWith('<?xml')).toBe(true);
    expect(kml).toContain('<name>Forecast Track</name>');
  });

  it('reads stored entries (method 0)', () => {
    const kml = extractKml(fx('nhc-cone-stored.kmz'));
    expect(kml).toContain('Forecast Track Uncertainty');
  });

  it('passes raw KML through untouched', () => {
    const raw = Buffer.from('<?xml version="1.0"?><kml></kml>');
    expect(extractKml(raw)).toBe(raw.toString());
  });

  it('rejects garbage that pretends to be a zip', () => {
    expect(() => extractKml(Buffer.from('PK\x03\x04 not really a zip at all, just bytes'))).toThrow();
  });
});
