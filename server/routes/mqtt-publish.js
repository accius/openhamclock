/**
 * Outbound MQTT publisher (optional) — space weather, SWPC alerts, band
 * openings and server status as retained JSON topics, plus Home Assistant
 * MQTT discovery. Dormant unless MQTT_PUBLISH_URL is set.
 *
 * Env:
 *   MQTT_PUBLISH_URL            mqtt://host:1883 | mqtts://… | ws(s)://…   (required to enable)
 *   MQTT_PUBLISH_USER / _PASS   broker credentials (optional)
 *   MQTT_PUBLISH_PREFIX         topic prefix (default "openhamclock")
 *   MQTT_PUBLISH_HA_DISCOVERY   "true" → publish homeassistant/sensor/openhamclock_<id>/config (retained)
 *
 * Topics: <prefix>/spaceweather, <prefix>/alerts/swpc, <prefix>/band-openings,
 * <prefix>/status — each published at most once per minute and only when
 * the payload changed (utils/mqttPayloads.shouldPublish). Data comes from
 * caches the server already maintains (N0NBH cache, /api/solar-indices,
 * refreshSwpcAlerts, /api/band-openings) — no extra upstream traffic.
 *
 * GET /api/mqtt/status → { enabled, connected, prefix, lastPublish } (no secrets)
 */
const {
  buildSpaceWeatherPayload,
  buildAlertsPayload,
  buildBandOpeningsPayload,
  buildStatusPayload,
  buildHaDiscovery,
  shouldPublish,
} = require('../utils/mqttPayloads');

const TICK_MS = 60 * 1000;

module.exports = function (app, ctx) {
  const { fetch, PORT, APP_VERSION, logInfo, logDebug, logErrorOnce } = ctx;
  const url = (process.env.MQTT_PUBLISH_URL || '').trim();
  const prefix = (process.env.MQTT_PUBLISH_PREFIX || 'openhamclock').trim().replace(/^\/+|\/+$/g, '') || 'openhamclock';
  const haDiscovery = process.env.MQTT_PUBLISH_HA_DISCOVERY === 'true';
  const startedAt = Date.now();

  const status = { enabled: !!url, connected: false, prefix, haDiscovery, lastPublish: {}, error: null };

  app.get('/api/mqtt/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(status);
  });

  if (!url) {
    logDebug?.('[MQTT] Outbound publisher disabled (MQTT_PUBLISH_URL not set)');
    return { mqttPublishStatus: status };
  }

  let mqtt;
  try {
    // ctx._mqttLib is a test seam (fake client); production always uses the real module.
    mqtt = ctx._mqttLib || require('mqtt');
  } catch (err) {
    status.error = 'mqtt module not installed';
    logErrorOnce?.('MQTT-Publish', `mqtt module not available: ${err.message}`);
    return { mqttPublishStatus: status };
  }

  const statusTopic = `${prefix}/status`;
  const client = mqtt.connect(url, {
    username: process.env.MQTT_PUBLISH_USER || undefined,
    password: process.env.MQTT_PUBLISH_PASS || undefined,
    clientId: `openhamclock-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 10 * 1000,
    connectTimeout: 15 * 1000,
    will: { topic: statusTopic, payload: JSON.stringify({ state: 'offline' }), retain: true, qos: 0 },
  });

  const last = {}; // topic → { payload, at }

  function publish(topic, payload, { force = false } = {}) {
    const now = Date.now();
    const prev = last[topic];
    if (!force && !shouldPublish(prev?.payload, payload, prev?.at, now, TICK_MS)) return false;
    if (!client.connected) return false;
    try {
      client.publish(topic, JSON.stringify(payload), { retain: true, qos: 0 });
      last[topic] = { payload, at: now };
      status.lastPublish[topic] = new Date(now).toISOString();
      return true;
    } catch (err) {
      logErrorOnce?.('MQTT-Publish', err.message);
      return false;
    }
  }

  async function localJson(path) {
    try {
      const res = await fetch(`http://localhost:${PORT}${path}`, { signal: AbortSignal.timeout(10 * 1000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function tick({ force = false } = {}) {
    if (!client.connected) return;
    try {
      // Status first (also the availability topic for HA entities).
      publish(
        statusTopic,
        buildStatusPayload({ version: APP_VERSION, startedAt, health: ctx.getSubsystemsHealth?.() }),
        { force },
      );
      const [indices, bo] = await Promise.all([localJson('/api/solar-indices'), localJson('/api/band-openings')]);
      const n0nbh = ctx.n0nbhCache?.data || null;
      if (indices || n0nbh) publish(`${prefix}/spaceweather`, buildSpaceWeatherPayload(n0nbh, indices), { force });
      if (bo) publish(`${prefix}/band-openings`, buildBandOpeningsPayload(bo), { force });
      if (typeof ctx.refreshSwpcAlerts === 'function') {
        try {
          const alerts = await ctx.refreshSwpcAlerts();
          publish(`${prefix}/alerts/swpc`, buildAlertsPayload(alerts), { force });
        } catch {}
      }
    } catch (err) {
      logErrorOnce?.('MQTT-Publish', err.message);
    }
  }

  client.on('connect', () => {
    status.connected = true;
    status.error = null;
    logInfo?.(`[MQTT] Connected to ${url.replace(/\/\/[^@]*@/, '//***@')} — publishing under "${prefix}/"`);
    if (haDiscovery) {
      for (const { topic, payload } of buildHaDiscovery(prefix)) {
        try {
          client.publish(topic, JSON.stringify(payload), { retain: true, qos: 0 });
        } catch {}
      }
      logDebug?.('[MQTT] Home Assistant discovery configs published');
    }
    tick({ force: true });
  });
  client.on('reconnect', () => logDebug?.('[MQTT] reconnecting…'));
  client.on('close', () => {
    status.connected = false;
  });
  client.on('error', (err) => {
    status.error = err.message;
    logErrorOnce?.('MQTT-Publish', err.message);
  });

  // Push alerts promptly after a fresh SWPC fetch (still rate-limited by shouldPublish).
  ctx.onSwpcAlertsRefreshed?.((alerts) => publish(`${prefix}/alerts/swpc`, buildAlertsPayload(alerts)));

  const timer = setInterval(() => tick(), TICK_MS);
  timer.unref?.();

  const shutdown = () => {
    try {
      if (client.connected) client.publish(statusTopic, JSON.stringify({ state: 'offline' }), { retain: true });
      client.end(true);
    } catch {}
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return { mqttPublishStatus: status };
};
