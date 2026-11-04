import { describe, expect, it } from 'vitest';

const plugin = require('./mqtt-publish.js');
const { bandFromHz, buildRigPayload, buildRotatorPayload, buildHaDiscovery } = plugin._internal;

describe('mqtt-publish plugin descriptor', () => {
  it('has the integration plugin shape', () => {
    expect(plugin.id).toBe('mqtt-publish');
    expect(plugin.category).toBe('integration');
    expect(plugin.configKey).toBe('mqtt');
    expect(typeof plugin.create).toBe('function');
  });

  it('stays idle without a broker URL and never throws', () => {
    const instance = plugin.create({ mqtt: { enabled: true } }, { state: {}, pluginBus: null });
    expect(() => instance.connect()).not.toThrow();
    expect(instance.getStatus().connected).toBe(false);
    expect(() => instance.disconnect()).not.toThrow();
  });
});

describe('payload builders', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  it('rig payload', () => {
    const p = buildRigPayload({ connected: true, freq: 7074000, mode: 'USB', width: 2800, ptt: true }, 3, NOW);
    expect(p).toEqual({
      connected: true,
      freq_hz: 7074000,
      freq_mhz: 7.074,
      band: '40m',
      mode: 'USB',
      width: 2800,
      ptt: true,
      aprs_received: 3,
      updated_at: '2026-10-14T12:00:00.000Z',
    });
    expect(bandFromHz(28500000)).toBe('10m');
  });
  it('rotator payload', () => {
    expect(buildRotatorPayload({ enabled: true, connected: false, azimuth: 45.26, elevation: 0 }, NOW)).toMatchObject({
      enabled: true,
      connected: false,
      az: 45.3,
      el: 0,
      target_az: null,
    });
  });
  it('HA discovery uses the prefix and the bridge availability topic', () => {
    const cfgs = buildHaDiscovery('shack');
    expect(cfgs).toHaveLength(8);
    for (const c of cfgs) {
      expect(c.topic).toMatch(/^homeassistant\/(sensor|binary_sensor)\/openhamclock_rig_bridge_/);
      expect(c.payload.availability_topic).toBe('shack/bridge/status');
    }
    expect(cfgs.find((c) => c.payload.unique_id.endsWith('_ptt')).payload.state_topic).toBe('shack/rig');
    expect(cfgs.find((c) => c.payload.unique_id.endsWith('_rotator_az')).payload.state_topic).toBe('shack/rotator');
  });
});
