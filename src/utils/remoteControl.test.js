import { describe, it, expect, beforeEach } from 'vitest';
import {
  getControlId,
  getControlSecret,
  rotateControlId,
  isRemoteEnabled,
  buildRemoteUrl,
  displayQuery,
  readMapSettings,
  panelsFromLayoutJson,
  buildStateReport,
  stateFingerprint,
  resolveDxTarget,
  CONTROL_ID_KEY,
  CONTROL_ID_RE,
  CONTROL_SECRET_KEY,
  CONTROL_SECRET_RE,
  CONTROL_ID_CHANGED_EVENT,
} from './remoteControl.js';

describe('controlSecret', () => {
  beforeEach(() => {
    localStorage.removeItem(CONTROL_ID_KEY);
    localStorage.removeItem(CONTROL_SECRET_KEY);
  });

  it('creates a 32-char url-safe secret and keeps it stable', () => {
    const s = getControlSecret();
    expect(s).toMatch(CONTROL_SECRET_RE);
    expect(s.length).toBe(32);
    expect(getControlSecret()).toBe(s);
    expect(localStorage.getItem(CONTROL_SECRET_KEY)).toBe(s);
  });

  it('replaces a short or unsafe stored secret', () => {
    localStorage.setItem(CONTROL_SECRET_KEY, 'too short');
    expect(getControlSecret()).toMatch(CONTROL_SECRET_RE);
  });

  it('secrets differ between generations', () => {
    const a = getControlSecret();
    localStorage.removeItem(CONTROL_SECRET_KEY);
    expect(getControlSecret()).not.toBe(a);
  });

  it('rotateControlId replaces id AND secret and announces it', () => {
    const id = getControlId();
    const secret = getControlSecret();
    let seen = null;
    const onChange = (e) => (seen = e.detail.controlId);
    window.addEventListener(CONTROL_ID_CHANGED_EVENT, onChange);
    const next = rotateControlId();
    window.removeEventListener(CONTROL_ID_CHANGED_EVENT, onChange);
    expect(next).not.toBe(id);
    expect(getControlSecret()).not.toBe(secret);
    expect(getControlSecret()).toMatch(CONTROL_SECRET_RE);
    expect(seen).toBe(next);
  });

  it('displayQuery carries target and secret, url-encoded', () => {
    expect(displayQuery('ohc-abc', 'S3cr-t_x')).toBe('target=ohc-abc&secret=S3cr-t_x');
    expect(displayQuery('ohc-abc', '')).toBe('target=ohc-abc');
    expect(displayQuery('a b', 'c&d')).toBe('target=a%20b&secret=c%26d');
  });
});

describe('controlId', () => {
  beforeEach(() => localStorage.removeItem(CONTROL_ID_KEY));

  it('creates a valid id and keeps it stable', () => {
    const a = getControlId();
    expect(a).toMatch(CONTROL_ID_RE);
    expect(a.startsWith('ohc-')).toBe(true);
    expect(getControlId()).toBe(a);
    expect(localStorage.getItem(CONTROL_ID_KEY)).toBe(a);
  });

  it('replaces an invalid stored id', () => {
    localStorage.setItem(CONTROL_ID_KEY, 'bad id!');
    expect(getControlId()).toMatch(CONTROL_ID_RE);
  });

  it('rotateControlId yields a different id', () => {
    const a = getControlId();
    const b = rotateControlId();
    expect(b).not.toBe(a);
    expect(getControlId()).toBe(b);
  });
});

describe('isRemoteEnabled', () => {
  it('defaults on for local installs and off on hosted', () => {
    expect(isRemoteEnabled({}, true)).toBe(true);
    expect(isRemoteEnabled({}, false)).toBe(false);
    expect(isRemoteEnabled({ remoteControl: { enabled: null } }, true)).toBe(true);
  });
  it('explicit setting wins', () => {
    expect(isRemoteEnabled({ remoteControl: { enabled: false } }, true)).toBe(false);
    expect(isRemoteEnabled({ remoteControl: { enabled: true } }, false)).toBe(true);
  });
});

describe('buildRemoteUrl', () => {
  it('builds the phone URL with optional key', () => {
    expect(buildRemoteUrl('http://pi.local:3001/', 'ohc-abc')).toBe('http://pi.local:3001/remote?target=ohc-abc');
    expect(buildRemoteUrl('https://x.y', 'ohc-abc', 'k&1')).toBe('https://x.y/remote?target=ohc-abc&key=k%261');
  });
});

describe('readMapSettings', () => {
  it('reads projection + style, with defaults', () => {
    localStorage.removeItem('openhamclock_mapSettings');
    expect(readMapSettings()).toEqual({ projection: 'mercator', basemap: 'dark' });
    localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ mapProjection: 'globe3d', mapStyle: 'topo' }));
    expect(readMapSettings()).toEqual({ projection: 'globe3d', basemap: 'topo' });
    localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ isAzimuthal: true }));
    expect(readMapSettings().projection).toBe('azimuthal');
  });
});

describe('panelsFromLayoutJson', () => {
  it('collects tab component ids from a flexlayout model', () => {
    const json = {
      layout: {
        type: 'row',
        children: [
          { type: 'tabset', children: [{ type: 'tab', component: 'world-map' }] },
          {
            type: 'row',
            children: [
              {
                type: 'tabset',
                children: [
                  { type: 'tab', component: 'dx-cluster' },
                  { type: 'tab', component: 'world-map' },
                ],
              },
            ],
          },
        ],
      },
      borders: [{ type: 'border', children: [{ type: 'tab', component: 'logbook' }] }],
    };
    expect(panelsFromLayoutJson(json)).toEqual(['world-map', 'dx-cluster', 'logbook']);
    expect(panelsFromLayoutJson(null)).toEqual([]);
  });
});

describe('buildStateReport / stateFingerprint', () => {
  const base = {
    config: {
      callsign: 'K0CJH',
      locator: 'DN70',
      location: { lat: 40, lon: -105 },
      layout: 'dockable',
      theme: 'dark',
      callsignTitles: 'A;B',
      version: '26.10.1',
    },
    dxLocation: { lat: 35.6, lon: 139.6 },
    dxCallsign: 'JA1ABC',
    layers: [{ id: 'grayline', name: 'Gray line', enabled: true }],
    panels: ['world-map'],
    satellites: ['ISS (ZARYA)'],
    mapSettings: { projection: 'globe3d', basemap: 'dark' },
    flags: { demoMode: true, kioskLocked: false, timeOffsetMs: 5000 },
    rigRelaySession: 'sess1',
  };

  it('packs the expected shape', () => {
    const s = buildStateReport(base);
    expect(s).toMatchObject({
      callsign: 'K0CJH',
      de: { lat: 40, lon: -105, grid: 'DN70' },
      dx: { lat: 35.6, lon: 139.6, grid: null },
      dxCallsign: 'JA1ABC',
      layout: 'dockable',
      theme: 'dark',
      projection: 'globe3d',
      basemap: 'dark',
      timeOffsetMs: 5000,
      title: 'A;B',
      kioskLocked: false,
      demoMode: true,
      rigRelaySession: 'sess1',
      version: '26.10.1',
      panels: ['world-map'],
      satellites: ['ISS (ZARYA)'],
      layers: [{ id: 'grayline', name: 'Gray line', enabled: true }],
    });
  });

  it('tolerates empty input', () => {
    const s = buildStateReport();
    expect(s.callsign).toBe(null);
    expect(s.dx).toBe(null);
    expect(s.layers).toEqual([]);
    expect(s.timeOffsetMs).toBe(0);
  });

  it('fingerprint changes only when a reported field changes', () => {
    const a = stateFingerprint(buildStateReport(base));
    const same = stateFingerprint(buildStateReport({ ...base, config: { ...base.config } }));
    expect(same).toBe(a);
    const layerOff = stateFingerprint(
      buildStateReport({ ...base, layers: [{ id: 'grayline', name: 'Gray line', enabled: false }] }),
    );
    expect(layerOff).not.toBe(a);
    const dxMoved = stateFingerprint(buildStateReport({ ...base, dxLocation: { lat: 1, lon: 2 } }));
    expect(dxMoved).not.toBe(a);
    expect(stateFingerprint(null)).toBe('');
  });
});

describe('resolveDxTarget', () => {
  it('uses explicit coordinates without lookup', async () => {
    const r = await resolveDxTarget({ lat: 1, lon: 2, call: 'W1AW', grid: 'FN31' }, () => {
      throw new Error('should not be called');
    });
    expect(r).toEqual({ lat: 1, lon: 2, callsign: 'W1AW', grid: 'FN31' });
  });
  it('looks up a callsign', async () => {
    const r = await resolveDxTarget({ lat: null, lon: null, call: 'W1AW' }, async () => ({
      lat: 41.7,
      lon: -72.7,
      grid: 'FN31',
    }));
    expect(r).toEqual({ lat: 41.7, lon: -72.7, callsign: 'W1AW', grid: 'FN31' });
  });
  it('returns null when the lookup fails', async () => {
    expect(await resolveDxTarget({ lat: null, lon: null, call: 'W1AW' }, async () => null)).toBe(null);
    expect(await resolveDxTarget({ lat: null, lon: null, call: null }, async () => null)).toBe(null);
  });
});
