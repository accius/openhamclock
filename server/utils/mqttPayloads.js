/**
 * Outbound MQTT payload builders (pure) for the optional publisher in
 * routes/mqtt-publish.js and Home Assistant MQTT discovery configs.
 *
 * Topics (prefix defaults to "openhamclock"):
 *   <prefix>/spaceweather   SFI, SSN, Kp, A, X-ray class, Bz, solar wind, NOAA scales
 *   <prefix>/alerts/swpc    latest SWPC alert products (slim)
 *   <prefix>/band-openings  current openings + zone openings (slim)
 *   <prefix>/status         version, uptime, subsystem health
 *   homeassistant/sensor/openhamclock_<id>/config   HA discovery (retained)
 */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * NOAA R/S/G scale from N0NBH-style data when present.
 * X-ray class → R scale: M1–M4 R1, M5–X R2, X1 R3, X10 R4, X20 R5.
 */
function rScaleFromXray(xray) {
  const m = String(xray || '')
    .trim()
    .toUpperCase()
    .match(/^([ABCMX])(\d+(?:\.\d+)?)?/);
  if (!m) return null;
  const cls = m[1];
  const mag = parseFloat(m[2] || '1');
  if (cls === 'X') return mag >= 20 ? 5 : mag >= 10 ? 4 : 3;
  if (cls === 'M') return mag >= 5 ? 2 : 1;
  return 0;
}

function gScaleFromKp(kp) {
  const k = num(kp);
  if (k == null) return null;
  if (k >= 9) return 5;
  if (k >= 8) return 4;
  if (k >= 7) return 3;
  if (k >= 6) return 2;
  if (k >= 5) return 1;
  return 0;
}

/**
 * @param {object} [n0nbh]  parseN0NBHxml() output ({ solarData, geomagField, signalNoise, updated })
 * @param {object} [indices] /api/solar-indices payload ({ sfi, kp, ssn, bz })
 * @param {string|number} [now]
 */
function buildSpaceWeatherPayload(n0nbh, indices, now = Date.now()) {
  const s = n0nbh?.solarData || {};
  const sfi = indices?.sfi?.current ?? num(s.solarFlux);
  const ssn = indices?.ssn?.current ?? num(s.sunspots);
  const kp = indices?.kp?.current ?? num(s.kIndex);
  const a = num(s.aIndex);
  const bz = indices?.bz?.current ?? num(s.magneticField);
  const wind = num(s.solarWind);
  const xray = s.xray || null;
  const proton = num(s.protonFlux);
  const payload = {
    sfi,
    ssn,
    kp,
    a_index: a,
    xray_class: xray,
    bz,
    solar_wind_speed: wind,
    proton_flux: proton,
    geomag_field: n0nbh?.geomagField || null,
    signal_noise: n0nbh?.signalNoise || null,
    scales: {
      R: rScaleFromXray(xray),
      S:
        proton == null
          ? null
          : proton >= 1e5
            ? 5
            : proton >= 1e4
              ? 4
              : proton >= 1e3
                ? 3
                : proton >= 100
                  ? 2
                  : proton >= 10
                    ? 1
                    : 0,
      G: gScaleFromKp(kp),
    },
    source_updated: n0nbh?.updated || indices?.timestamp || null,
    updated_at: new Date(now).toISOString(),
  };
  return payload;
}

/** Slim the SWPC alert list (routes/swpc-alerts.js parseAlert rows). */
function buildAlertsPayload(alerts, now = Date.now()) {
  const list = (Array.isArray(alerts) ? alerts : []).slice(0, 10).map((a) => ({
    product_id: a.productId || null,
    serial: a.serial || null,
    title: a.title || null,
    scale: a.scale?.band != null ? `${a.scale.band}${a.scale.level ?? ''}` : null,
    level: a.scale?.level ?? null,
    issued: a.issueTime || null,
  }));
  const maxLevel = list.reduce((m, a) => Math.max(m, a.level ?? 0), 0);
  return { count: list.length, max_level: maxLevel, alerts: list, updated_at: new Date(now).toISOString() };
}

/** Slim the /api/band-openings payload. */
function buildBandOpeningsPayload(bo, now = Date.now()) {
  const slim = (o) => ({
    band: o.band,
    from: o.from_continent || null,
    to: o.to_zone != null ? `Z${o.to_zone}` : o.to_continent || null,
    state: o.state || null,
    factor: Number.isFinite(o.factor) ? Math.round(o.factor * 10) / 10 : null,
    spots: o.shortCount ?? null,
  });
  const openings = (bo?.openings || []).slice(0, 25).map(slim);
  const zoneOpenings = (bo?.zone_openings || []).slice(0, 25).map(slim);
  const bands = [...new Set([...openings, ...zoneOpenings].map((o) => o.band))];
  return {
    warming: !!bo?.warming,
    count: openings.length + zoneOpenings.length,
    bands,
    openings,
    zone_openings: zoneOpenings,
    generated_at: bo?.generated_at || null,
    updated_at: new Date(now).toISOString(),
  };
}

function buildStatusPayload({ version, startedAt, health, now = Date.now() } = {}) {
  const subs = {};
  if (health && typeof health === 'object') {
    for (const [k, v] of Object.entries(health))
      if (k !== 'aggregate' && v && typeof v === 'object') subs[k] = v.status;
  }
  return {
    state: 'online',
    version: version || null,
    uptime_s: Number.isFinite(startedAt) ? Math.round((now - startedAt) / 1000) : null,
    health: health?.aggregate || null,
    subsystems: subs,
    updated_at: new Date(now).toISOString(),
  };
}

/**
 * True when the payload changed (ignoring the volatile `updated_at` /
 * `uptime_s` fields) or when the last publish is older than maxAgeMs.
 */
function shouldPublish(prev, next, lastPublishedAt, now = Date.now(), maxAgeMs = 60 * 1000) {
  if (!next) return false;
  if (!prev || !Number.isFinite(lastPublishedAt)) return true;
  if (now - lastPublishedAt < maxAgeMs) return false;
  return stableJson(prev) !== stableJson(next);
}

const VOLATILE = new Set(['updated_at', 'uptime_s']);
function stableJson(obj) {
  return JSON.stringify(obj, (k, v) => (VOLATILE.has(k) ? undefined : v));
}

/**
 * Home Assistant MQTT discovery configs.
 * @returns {Array<{ topic: string, payload: object }>}
 */
function buildHaDiscovery(
  prefix = 'openhamclock',
  { includeRig = false, includeServer = true, nodeId = 'openhamclock' } = {},
) {
  const device = {
    identifiers: [nodeId],
    name: 'OpenHamClock',
    manufacturer: 'OpenHamClock',
    model: includeRig && !includeServer ? 'Rig Bridge' : 'Server',
  };
  const avail = {
    availability_topic: `${prefix}/status`,
    availability_template: '{{ value_json.state }}',
    payload_available: 'online',
    payload_not_available: 'offline',
  };
  const sensor = (id, name, topic, template, extra = {}) => ({
    topic: `homeassistant/sensor/${nodeId}_${id}/config`,
    payload: {
      name,
      unique_id: `${nodeId}_${id}`,
      object_id: `${nodeId}_${id}`,
      state_topic: topic,
      value_template: template,
      device,
      ...avail,
      ...extra,
    },
  });
  const out = [];
  if (includeServer) {
    const sw = `${prefix}/spaceweather`;
    out.push(
      sensor('sfi', 'Solar Flux Index', sw, '{{ value_json.sfi }}', {
        icon: 'mdi:white-balance-sunny',
        state_class: 'measurement',
      }),
      sensor('ssn', 'Sunspot Number', sw, '{{ value_json.ssn }}', {
        icon: 'mdi:weather-sunny',
        state_class: 'measurement',
      }),
      sensor('kp', 'Kp Index', sw, '{{ value_json.kp }}', { icon: 'mdi:magnet', state_class: 'measurement' }),
      sensor('a_index', 'A Index', sw, '{{ value_json.a_index }}', {
        icon: 'mdi:magnet-on',
        state_class: 'measurement',
      }),
      sensor('xray', 'X-ray Class', sw, '{{ value_json.xray_class }}', { icon: 'mdi:radioactive' }),
      sensor('bz', 'IMF Bz', sw, '{{ value_json.bz }}', {
        unit_of_measurement: 'nT',
        state_class: 'measurement',
        icon: 'mdi:compass',
      }),
      sensor('solar_wind', 'Solar Wind Speed', sw, '{{ value_json.solar_wind_speed }}', {
        unit_of_measurement: 'km/s',
        state_class: 'measurement',
        icon: 'mdi:weather-windy',
      }),
      sensor('scale_g', 'NOAA G Scale', sw, '{{ value_json.scales.G }}', { icon: 'mdi:earth' }),
      sensor('scale_r', 'NOAA R Scale', sw, '{{ value_json.scales.R }}', { icon: 'mdi:radio-tower' }),
      sensor('swpc_alerts', 'SWPC Alerts', `${prefix}/alerts/swpc`, '{{ value_json.count }}', {
        icon: 'mdi:alert',
        json_attributes_topic: `${prefix}/alerts/swpc`,
      }),
      sensor('band_openings', 'Band Openings', `${prefix}/band-openings`, '{{ value_json.count }}', {
        icon: 'mdi:antenna',
        json_attributes_topic: `${prefix}/band-openings`,
      }),
      sensor('status', 'Server Health', `${prefix}/status`, '{{ value_json.health }}', {
        icon: 'mdi:server',
        json_attributes_topic: `${prefix}/status`,
      }),
    );
  }
  if (includeRig) {
    const rig = `${prefix}/rig`;
    const rot = `${prefix}/rotator`;
    out.push(
      sensor('rig_frequency', 'Rig Frequency', rig, '{{ value_json.freq_mhz }}', {
        unit_of_measurement: 'MHz',
        icon: 'mdi:radio',
        state_class: 'measurement',
      }),
      sensor('rig_mode', 'Rig Mode', rig, '{{ value_json.mode }}', { icon: 'mdi:waveform' }),
      sensor('rig_band', 'Rig Band', rig, '{{ value_json.band }}', { icon: 'mdi:sine-wave' }),
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
      sensor('aprs_received', 'APRS Packets Received', rig, '{{ value_json.aprs_received }}', {
        icon: 'mdi:map-marker-radius',
        state_class: 'total_increasing',
      }),
    );
    out.push({
      topic: `homeassistant/binary_sensor/${nodeId}_rig_ptt/config`,
      payload: {
        name: 'Rig PTT',
        unique_id: `${nodeId}_rig_ptt`,
        object_id: `${nodeId}_rig_ptt`,
        state_topic: rig,
        value_template: '{{ "ON" if value_json.ptt else "OFF" }}',
        device_class: 'running',
        icon: 'mdi:microphone',
        device,
        ...avail,
      },
    });
    out.push({
      topic: `homeassistant/binary_sensor/${nodeId}_rig_connected/config`,
      payload: {
        name: 'Rig Connected',
        unique_id: `${nodeId}_rig_connected`,
        object_id: `${nodeId}_rig_connected`,
        state_topic: rig,
        value_template: '{{ "ON" if value_json.connected else "OFF" }}',
        device_class: 'connectivity',
        device,
        ...avail,
      },
    });
  }
  return out;
}

/** Band key from Hz (rig bridge). */
function bandFromHz(hz) {
  const mhz = hz / 1e6;
  const bands = [
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
  for (const [b, lo, hi] of bands) if (mhz >= lo && mhz <= hi) return b;
  return null;
}

/** Rig state payload for <prefix>/rig (rig bridge). */
function buildRigPayload(state, { aprsReceived = 0, now = Date.now() } = {}) {
  const freq = Number(state?.freq) || 0;
  return {
    connected: !!state?.connected,
    freq_hz: freq,
    freq_mhz: freq ? Math.round(freq / 10) / 1e5 : null,
    band: freq ? bandFromHz(freq) : null,
    mode: state?.mode || null,
    width: state?.width ?? null,
    ptt: !!state?.ptt,
    aprs_received: aprsReceived,
    updated_at: new Date(now).toISOString(),
  };
}

/** Rotator payload for <prefix>/rotator from GET /api/rotator/status (rig bridge). */
function buildRotatorPayload(status, now = Date.now()) {
  return {
    enabled: !!status?.enabled,
    connected: !!status?.connected,
    az: Number.isFinite(status?.azimuth) ? Math.round(status.azimuth * 10) / 10 : null,
    el: Number.isFinite(status?.elevation) ? Math.round(status.elevation * 10) / 10 : null,
    target_az: status?.targetAz ?? null,
    target_el: status?.targetEl ?? null,
    updated_at: new Date(now).toISOString(),
  };
}

module.exports = {
  buildSpaceWeatherPayload,
  buildAlertsPayload,
  buildBandOpeningsPayload,
  buildStatusPayload,
  buildHaDiscovery,
  buildRigPayload,
  buildRotatorPayload,
  shouldPublish,
  stableJson,
  rScaleFromXray,
  gScaleFromKp,
  bandFromHz,
};
