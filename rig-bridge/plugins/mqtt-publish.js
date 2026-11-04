'use strict';
/**
 * mqtt-publish.js — Publish rig / rotator / APRS state to an MQTT broker
 * (Home Assistant friendly).
 *
 * Topics (prefix default "openhamclock"):
 *   <prefix>/rig            { connected, freq_hz, freq_mhz, band, mode, width, ptt, aprs_received, updated_at }
 *   <prefix>/rotator        { enabled, connected, az, el, target_az, target_el, updated_at }
 *   <prefix>/bridge/status  { state: 'online'|'offline' }   (LWT — availability for HA entities)
 *   homeassistant/<sensor|binary_sensor>/<nodeId>_<id>/config   (when haDiscovery is on)
 *
 * Rig state is pushed on change (PTT immediately, frequency/mode throttled
 * to one publish per second) and every publishInterval as a keepalive.
 * Rotator position is polled from this bridge's own /api/rotator/status
 * when the rotator plugin is enabled.
 *
 * Config section: config.mqtt
 *   enabled:         boolean (default false)
 *   url:             string  mqtt://host:1883 | mqtts://… | ws(s)://…
 *   username/password
 *   prefix:          string  (default 'openhamclock')
 *   haDiscovery:     boolean (default true)
 *   publishInterval: number  keepalive ms (default 60000)
 *
 * The `mqtt` npm module is an optional dependency and is loaded lazily, so
 * a bridge without it still starts — the plugin just logs and stays idle.
 */

const DEFAULT_PREFIX = 'openhamclock';
const NODE_ID = 'openhamclock_rig_bridge';
const RIG_THROTTLE_MS = 1000;
const ROTATOR_POLL_MS = 2000;

const BANDS = [
  ['160m', 1.8, 2.0],
  ['80m', 3.5, 4.0],
  ['60m', 5.25, 5.45],
  ['40m', 7.0, 7.3],
  ['30m', 10.1, 10.15],
  ['20m', 14.0, 14.35],
  ['17m', 18.068, 18.168],
  ['15m', 21.0, 21.45],
  ['12m', 24.89, 24.99],
  ['10m', 28.0, 29.7],
  ['6m', 50.0, 54.0],
  ['2m', 144.0, 148.0],
  ['70cm', 420.0, 450.0],
];

function bandFromHz(hz) {
  const mhz = hz / 1e6;
  for (const [b, lo, hi] of BANDS) if (mhz >= lo && mhz <= hi) return b;
  return null;
}

function buildRigPayload(state, aprsReceived = 0, now = Date.now()) {
  const freq = Number(state && state.freq) || 0;
  return {
    connected: !!(state && state.connected),
    freq_hz: freq,
    freq_mhz: freq ? Math.round(freq / 10) / 1e5 : null,
    band: freq ? bandFromHz(freq) : null,
    mode: (state && state.mode) || null,
    width: state && state.width != null ? state.width : null,
    ptt: !!(state && state.ptt),
    aprs_received: aprsReceived,
    updated_at: new Date(now).toISOString(),
  };
}

function buildRotatorPayload(status, now = Date.now()) {
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return {
    enabled: !!(status && status.enabled),
    connected: !!(status && status.connected),
    az: r1(status && status.azimuth),
    el: r1(status && status.elevation),
    target_az: status && status.targetAz != null ? status.targetAz : null,
    target_el: status && status.targetEl != null ? status.targetEl : null,
    updated_at: new Date(now).toISOString(),
  };
}

function buildHaDiscovery(prefix, nodeId = NODE_ID) {
  const device = {
    identifiers: [nodeId],
    name: 'OpenHamClock Rig Bridge',
    manufacturer: 'OpenHamClock',
    model: 'Rig Bridge',
  };
  const avail = {
    availability_topic: `${prefix}/bridge/status`,
    availability_template: '{{ value_json.state }}',
    payload_available: 'online',
    payload_not_available: 'offline',
  };
  const rig = `${prefix}/rig`;
  const rot = `${prefix}/rotator`;
  const sensor = (id, name, topic, template, extra) => ({
    topic: `homeassistant/sensor/${nodeId}_${id}/config`,
    payload: Object.assign(
      {
        name,
        unique_id: `${nodeId}_${id}`,
        object_id: `${nodeId}_${id}`,
        state_topic: topic,
        value_template: template,
        device,
      },
      avail,
      extra || {},
    ),
  });
  const binary = (id, name, template, extra) => ({
    topic: `homeassistant/binary_sensor/${nodeId}_${id}/config`,
    payload: Object.assign(
      {
        name,
        unique_id: `${nodeId}_${id}`,
        object_id: `${nodeId}_${id}`,
        state_topic: rig,
        value_template: template,
        device,
      },
      avail,
      extra || {},
    ),
  });
  return [
    sensor('frequency', 'Rig Frequency', rig, '{{ value_json.freq_mhz }}', {
      unit_of_measurement: 'MHz',
      icon: 'mdi:radio',
      state_class: 'measurement',
    }),
    sensor('mode', 'Rig Mode', rig, '{{ value_json.mode }}', { icon: 'mdi:waveform' }),
    sensor('band', 'Rig Band', rig, '{{ value_json.band }}', { icon: 'mdi:sine-wave' }),
    sensor('aprs_received', 'APRS Packets Received', rig, '{{ value_json.aprs_received }}', {
      icon: 'mdi:map-marker-radius',
      state_class: 'total_increasing',
    }),
    sensor('rotator_az', 'Rotator Azimuth', rot, '{{ value_json.az }}', {
      unit_of_measurement: '°',
      icon: 'mdi:compass-outline',
      state_class: 'measurement',
    }),
    sensor('rotator_el', 'Rotator Elevation', rot, '{{ value_json.el }}', {
      unit_of_measurement: '°',
      icon: 'mdi:angle-acute',
      state_class: 'measurement',
    }),
    binary('ptt', 'Rig PTT', '{{ "ON" if value_json.ptt else "OFF" }}', {
      device_class: 'running',
      icon: 'mdi:microphone',
    }),
    binary('connected', 'Rig Connected', '{{ "ON" if value_json.connected else "OFF" }}', {
      device_class: 'connectivity',
    }),
  ];
}

module.exports = {
  id: 'mqtt-publish',
  name: 'MQTT Publish (Home Assistant)',
  category: 'integration',
  configKey: 'mqtt',

  create(config, services) {
    const cfg = config.mqtt || {};
    const { state, pluginBus, onStateChange, removeStateChangeListener } = services || {};
    const prefix = String(cfg.prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '') || DEFAULT_PREFIX;
    const haDiscovery = cfg.haDiscovery !== false;
    const keepaliveMs = Math.max(5000, parseInt(cfg.publishInterval, 10) || 60000);
    const rotatorEnabled = !!(config.rotator && config.rotator.enabled);
    const bridgePort = config.port || 5555;

    let client = null;
    let aprsReceived = 0;
    let rigTimer = null;
    let rigLastAt = 0;
    let keepaliveTimer = null;
    let rotatorTimer = null;
    let lastRotatorJson = '';
    let stateHandler = null;
    let aprsHandler = null;

    function pub(topic, payload) {
      if (!client || !client.connected) return;
      try {
        client.publish(topic, JSON.stringify(payload), { retain: true, qos: 0 });
      } catch (e) {
        console.error(`[MQTT] publish failed: ${e.message}`);
      }
    }

    function publishRig() {
      rigLastAt = Date.now();
      pub(`${prefix}/rig`, buildRigPayload(state, aprsReceived));
    }

    function scheduleRig(immediate) {
      if (immediate) {
        if (rigTimer) {
          clearTimeout(rigTimer);
          rigTimer = null;
        }
        publishRig();
        return;
      }
      if (rigTimer) return;
      const wait = Math.max(0, rigLastAt + RIG_THROTTLE_MS - Date.now());
      rigTimer = setTimeout(() => {
        rigTimer = null;
        publishRig();
      }, wait);
    }

    async function pollRotator() {
      try {
        const res = await fetch(`http://127.0.0.1:${bridgePort}/api/rotator/status`);
        if (!res.ok) return;
        const status = await res.json();
        const payload = buildRotatorPayload(status);
        const key = JSON.stringify([
          payload.enabled,
          payload.connected,
          payload.az,
          payload.el,
          payload.target_az,
          payload.target_el,
        ]);
        if (key !== lastRotatorJson) {
          lastRotatorJson = key;
          pub(`${prefix}/rotator`, payload);
        }
      } catch (e) {
        // rotator plugin not running — silent
      }
    }

    function connect() {
      if (!cfg.url) {
        console.log('[MQTT] No broker URL configured — plugin idle');
        return;
      }
      let mqtt;
      try {
        mqtt = require('mqtt');
      } catch (e) {
        console.error(
          '[MQTT] The "mqtt" module is not installed. Run "npm install mqtt" inside rig-bridge/ to enable publishing.',
        );
        return;
      }
      console.log(`[MQTT] Connecting to ${String(cfg.url).replace(/\/\/[^@]*@/, '//***@')} (prefix "${prefix}/")`);
      client = mqtt.connect(cfg.url, {
        username: cfg.username || undefined,
        password: cfg.password || undefined,
        clientId: `ohc-rig-bridge-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 10000,
        connectTimeout: 15000,
        will: { topic: `${prefix}/bridge/status`, payload: JSON.stringify({ state: 'offline' }), retain: true, qos: 0 },
      });
      client.on('connect', () => {
        console.log('[MQTT] Connected');
        pub(`${prefix}/bridge/status`, { state: 'online' });
        if (haDiscovery) for (const d of buildHaDiscovery(prefix)) pub(d.topic, d.payload);
        publishRig();
        if (rotatorEnabled) pollRotator();
      });
      client.on('error', (e) => console.error(`[MQTT] ${e.message}`));
      client.on('close', () => {
        if (cfg.verbose) console.log('[MQTT] Connection closed');
      });

      if (typeof onStateChange === 'function') {
        stateHandler = (prop) => scheduleRig(prop === 'ptt' || prop === 'connected');
        onStateChange(stateHandler);
      }
      if (pluginBus && typeof pluginBus.on === 'function') {
        aprsHandler = () => {
          aprsReceived += 1;
          scheduleRig(false);
        };
        pluginBus.on('aprs', aprsHandler);
      }
      keepaliveTimer = setInterval(() => {
        publishRig();
        pub(`${prefix}/bridge/status`, { state: 'online' });
      }, keepaliveMs);
      if (rotatorEnabled) rotatorTimer = setInterval(pollRotator, ROTATOR_POLL_MS);
    }

    function disconnect() {
      if (rigTimer) clearTimeout(rigTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (rotatorTimer) clearInterval(rotatorTimer);
      rigTimer = keepaliveTimer = rotatorTimer = null;
      if (stateHandler && typeof removeStateChangeListener === 'function') removeStateChangeListener(stateHandler);
      if (aprsHandler && pluginBus && typeof pluginBus.off === 'function') pluginBus.off('aprs', aprsHandler);
      stateHandler = aprsHandler = null;
      if (client) {
        try {
          if (client.connected)
            client.publish(`${prefix}/bridge/status`, JSON.stringify({ state: 'offline' }), { retain: true });
          client.end(true);
        } catch (e) {}
        client = null;
      }
      console.log('[MQTT] Stopped');
    }

    function getStatus() {
      return { enabled: !!cfg.enabled, connected: !!(client && client.connected), prefix, aprsReceived };
    }

    return { connect, disconnect, getStatus };
  },

  _internal: { bandFromHz, buildRigPayload, buildRotatorPayload, buildHaDiscovery },
};
