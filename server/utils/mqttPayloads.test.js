import { describe, expect, it } from 'vitest';

const {
  buildSpaceWeatherPayload,
  buildAlertsPayload,
  buildBandOpeningsPayload,
  buildStatusPayload,
  buildHaDiscovery,
  buildRigPayload,
  buildRotatorPayload,
  shouldPublish,
  rScaleFromXray,
  gScaleFromKp,
  bandFromHz,
} = require('./mqttPayloads.js');

const NOW = Date.parse('2026-10-14T12:00:00Z');

describe('scales', () => {
  it('maps X-ray class to NOAA R scale', () => {
    expect(rScaleFromXray('B5.2')).toBe(0);
    expect(rScaleFromXray('M1.3')).toBe(1);
    expect(rScaleFromXray('M7.0')).toBe(2);
    expect(rScaleFromXray('X1.5')).toBe(3);
    expect(rScaleFromXray('X12')).toBe(4);
    expect(rScaleFromXray('X25')).toBe(5);
    expect(rScaleFromXray('')).toBeNull();
  });
  it('maps Kp to NOAA G scale', () => {
    expect(gScaleFromKp(3)).toBe(0);
    expect(gScaleFromKp('5')).toBe(1);
    expect(gScaleFromKp(7)).toBe(3);
    expect(gScaleFromKp(null)).toBeNull();
  });
  it('bandFromHz', () => {
    expect(bandFromHz(14074000)).toBe('20m');
    expect(bandFromHz(146520000)).toBe('2m');
    expect(bandFromHz(1)).toBeNull();
  });
});

describe('buildSpaceWeatherPayload', () => {
  const n0nbh = {
    updated: '14 Oct 2026 1130 GMT',
    solarData: {
      solarFlux: '150',
      aIndex: '12',
      kIndex: '3',
      xray: 'C2.1',
      sunspots: '95',
      protonFlux: '0.4',
      solarWind: '420.5',
      magneticField: '-3.2',
    },
    geomagField: 'QUIET',
    signalNoise: 'S1-S2',
  };
  it('prefers /api/solar-indices numbers and falls back to N0NBH', () => {
    const p = buildSpaceWeatherPayload(
      n0nbh,
      { sfi: { current: 152 }, kp: { current: 4 }, ssn: { current: null }, bz: { current: -2.5 } },
      NOW,
    );
    expect(p).toMatchObject({
      sfi: 152,
      ssn: 95,
      kp: 4,
      a_index: 12,
      xray_class: 'C2.1',
      bz: -2.5,
      solar_wind_speed: 420.5,
    });
    expect(p.scales).toEqual({ R: 0, S: 0, G: 0 });
    expect(p.geomag_field).toBe('QUIET');
    expect(p.updated_at).toBe('2026-10-14T12:00:00.000Z');
  });
  it('tolerates missing sources', () => {
    const p = buildSpaceWeatherPayload(null, null, NOW);
    expect(p.sfi).toBeNull();
    expect(p.scales).toEqual({ R: null, S: null, G: null });
  });
});

describe('alerts / band openings / status', () => {
  it('slims SWPC alerts and reports the max level', () => {
    const p = buildAlertsPayload(
      [
        {
          productId: 'K05W',
          serial: '1',
          title: 'Watch',
          scale: { band: 'G', level: 1 },
          issueTime: '2026-10-14T10:00:00Z',
        },
        {
          productId: 'K07A',
          serial: '2',
          title: 'Alert',
          scale: { band: 'G', level: 3 },
          issueTime: '2026-10-14T11:00:00Z',
        },
      ],
      NOW,
    );
    expect(p.count).toBe(2);
    expect(p.max_level).toBe(3);
    expect(p.alerts[1].scale).toBe('G3');
    expect(buildAlertsPayload(null).count).toBe(0);
  });
  it('slims band openings', () => {
    const p = buildBandOpeningsPayload(
      {
        generated_at: 'x',
        warming: false,
        openings: [
          { band: '20m', from_continent: 'EU', to_continent: 'NA', state: 'active', factor: 4.26, shortCount: 12 },
        ],
        zone_openings: [
          { band: '15m', from_continent: 'AS', to_zone: 5, state: 'opening', factor: Infinity, shortCount: 6 },
        ],
      },
      NOW,
    );
    expect(p.count).toBe(2);
    expect(p.bands).toEqual(['20m', '15m']);
    expect(p.openings[0]).toEqual({ band: '20m', from: 'EU', to: 'NA', state: 'active', factor: 4.3, spots: 12 });
    expect(p.zone_openings[0].to).toBe('Z5');
    expect(p.zone_openings[0].factor).toBeNull();
  });
  it('builds status with subsystem map and uptime', () => {
    const p = buildStatusPayload({
      version: '26.10.1',
      startedAt: NOW - 90_000,
      health: { aggregate: 'ok', rbn: { status: 'up' }, satellites: { status: 'down' } },
      now: NOW,
    });
    expect(p).toMatchObject({
      state: 'online',
      version: '26.10.1',
      uptime_s: 90,
      health: 'ok',
      subsystems: { rbn: 'up', satellites: 'down' },
    });
  });
});

describe('shouldPublish', () => {
  const a = { sfi: 150, updated_at: '1' };
  it('publishes first time, then only on change and at most once per minute', () => {
    expect(shouldPublish(null, a, null, NOW)).toBe(true);
    expect(shouldPublish(a, { sfi: 151, updated_at: '2' }, NOW, NOW + 10_000)).toBe(false); // too soon
    expect(shouldPublish(a, { sfi: 150, updated_at: '2' }, NOW, NOW + 61_000)).toBe(false); // unchanged
    expect(shouldPublish(a, { sfi: 151, updated_at: '2' }, NOW, NOW + 61_000)).toBe(true);
    expect(shouldPublish(a, null, NOW, NOW + 61_000)).toBe(false);
  });
});

describe('Home Assistant discovery', () => {
  it('emits retained-style configs under homeassistant/ with the prefix in state topics', () => {
    const cfgs = buildHaDiscovery('shack');
    expect(cfgs.length).toBeGreaterThanOrEqual(10);
    const sfi = cfgs.find((c) => c.topic === 'homeassistant/sensor/openhamclock_sfi/config');
    expect(sfi.payload.state_topic).toBe('shack/spaceweather');
    expect(sfi.payload.unique_id).toBe('openhamclock_sfi');
    expect(sfi.payload.availability_topic).toBe('shack/status');
    expect(cfgs.every((c) => c.topic.startsWith('homeassistant/'))).toBe(true);
    const ids = cfgs.map((c) => c.payload.unique_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('adds rig/rotator/PTT entities for the rig bridge and can omit server ones', () => {
    const cfgs = buildHaDiscovery('openhamclock', { includeRig: true, includeServer: false, nodeId: 'ohc_rig' });
    expect(cfgs.some((c) => c.topic === 'homeassistant/binary_sensor/ohc_rig_rig_ptt/config')).toBe(true);
    expect(cfgs.some((c) => c.payload.unique_id === 'ohc_rig_rotator_az')).toBe(true);
    expect(cfgs.some((c) => c.payload.unique_id === 'ohc_rig_sfi')).toBe(false);
  });
});

describe('rig bridge payloads', () => {
  it('rig payload derives MHz and band', () => {
    const p = buildRigPayload(
      { connected: true, freq: 14074000, mode: 'USB', width: 2800, ptt: false },
      { aprsReceived: 7, now: NOW },
    );
    expect(p).toMatchObject({
      connected: true,
      freq_hz: 14074000,
      freq_mhz: 14.074,
      band: '20m',
      mode: 'USB',
      ptt: false,
      aprs_received: 7,
    });
    expect(buildRigPayload(null).freq_mhz).toBeNull();
  });
  it('rotator payload rounds az/el', () => {
    expect(
      buildRotatorPayload({ enabled: true, connected: true, azimuth: 123.456, elevation: 10.04, targetAz: 130 }, NOW),
    ).toMatchObject({
      az: 123.5,
      el: 10,
      target_az: 130,
      target_el: null,
    });
  });
});
