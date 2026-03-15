/**
 * Rotator UDP bridge routes.
 * Lines ~742-937 of original server.js
 */

const dgram = require('dgram');

module.exports = function (app, ctx) {
  const { CONFIG, logDebug, logInfo, logWarn, logErrorOnce, writeLimiter, requireWriteAuth } = ctx;

  // Default to 'none' so hosted/cloud instances don't try to reach a LAN rotator.
  // Self-hosted users must explicitly set ROTATOR_PROVIDER=pstrotator_udp.
  const ROTATOR_PROVIDER = (process.env.ROTATOR_PROVIDER || 'none').toLowerCase();
  const PSTROTATOR_HOST = process.env.PSTROTATOR_HOST || '192.168.1.43';
  const PSTROTATOR_UDP_PORT = parseInt(process.env.PSTROTATOR_UDP_PORT || '12000', 10);
  const ROTATOR_STALE_MS = parseInt(process.env.ROTATOR_STALE_MS || '5000', 10);
  const ROTATOR_POLL_MS = parseInt(process.env.ROTATOR_POLL_MS || '1000', 10);

  // PstRotatorAz replies to UDP port+1 at the sender's IP (per manual)
  const PSTROTATOR_REPLY_PORT = PSTROTATOR_UDP_PORT + 1;

  const rotatorState = {
    azimuth: null,
    lastSeen: 0,
    source: ROTATOR_PROVIDER,
    lastError: null,
  };

  function clampAz(v) {
    let n = Number(v);
    if (!Number.isFinite(n)) return null;
    n = ((n % 360) + 360) % 360;
    return Math.round(n);
  }

  function parseAzimuthFromMessage(msgStr) {
    const m = msgStr.match(/AZ\s*:\s*([0-9]{1,3})/i);
    if (!m) return null;
    return clampAz(parseInt(m[1], 10));
  }

  let rotatorSocket = null;

  // Single-slot mutex: only one UDP query at a time, no chaining
  let rotatorBusy = false;

  function ensureRotatorSocket() {
    if (rotatorSocket) return rotatorSocket;

    const sock = dgram.createSocket('udp4');

    sock.on('error', (err) => {
      rotatorState.lastError = String(err?.message || err);
      console.warn(`[Rotator] UDP socket error: ${rotatorState.lastError}`);
    });

    sock.on('message', (buf, rinfo) => {
      const s = buf.toString('utf8').trim();
      const az = parseAzimuthFromMessage(s);
      if (az !== null) {
        rotatorState.azimuth = az;
        rotatorState.lastSeen = Date.now();
        rotatorState.lastError = null;
      }
    });

    sock.bind(PSTROTATOR_REPLY_PORT, '0.0.0.0', () => {
      try {
        sock.setRecvBufferSize?.(1024 * 1024);
      } catch {}
      console.log(`[Rotator] UDP listening on ${PSTROTATOR_REPLY_PORT} (provider=${ROTATOR_PROVIDER})`);
    });

    rotatorSocket = sock;
    return rotatorSocket;
  }

  function udpSend(message) {
    const sock = ensureRotatorSocket();
    const buf = Buffer.from(message, 'utf8');
    return new Promise((resolve, reject) => {
      sock.send(buf, 0, buf.length, PSTROTATOR_UDP_PORT, PSTROTATOR_HOST, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Query azimuth once via UDP.  Single-slot mutex prevents pile-up.
   * Returns immediately if another query is already in flight.
   */
  async function queryAzimuthOnce(timeoutMs = 800) {
    if (ROTATOR_PROVIDER === 'none') return { ok: false, reason: 'disabled' };
    if (rotatorBusy) return { ok: false, reason: 'busy' };

    rotatorBusy = true;
    const before = Date.now();
    try {
      await udpSend('<PST>AZ?</PST>');
      // Wait for a fresh reply (or timeout)
      while (Date.now() - before < timeoutMs) {
        if (rotatorState.lastSeen >= before && rotatorState.azimuth !== null) {
          return { ok: true, azimuth: rotatorState.azimuth };
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      return { ok: false, reason: 'timeout' };
    } catch (e) {
      rotatorState.lastError = String(e?.message || e);
      return { ok: false, reason: rotatorState.lastError };
    } finally {
      rotatorBusy = false;
    }
  }

  async function setAzimuth(az) {
    if (ROTATOR_PROVIDER === 'none') return { ok: false, reason: 'disabled' };
    const clamped = clampAz(az);
    if (clamped === null) return { ok: false, reason: 'invalid azimuth' };
    await udpSend(`<PST><AZIMUTH>${clamped}</AZIMUTH></PST>`);
    return { ok: true, target: clamped };
  }

  async function stopRotator() {
    if (ROTATOR_PROVIDER === 'none') return { ok: false, reason: 'disabled' };
    await udpSend('<PST><STOP>1</STOP></PST>');
    return { ok: true };
  }

  // --- Background poll (only if provider is configured) ---
  // Instead of querying on every HTTP request, poll once per interval server-side.
  if (ROTATOR_PROVIDER !== 'none') {
    console.log(
      `[Rotator] Starting background poll every ${ROTATOR_POLL_MS}ms to ${PSTROTATOR_HOST}:${PSTROTATOR_UDP_PORT}`,
    );
    setInterval(
      () => {
        queryAzimuthOnce(800).catch(() => {});
      },
      Math.max(500, ROTATOR_POLL_MS),
    );
  }

  // --- REST API ---
  // These are now synchronous reads of cached state — zero async work per request.

  app.get('/api/rotator/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const now = Date.now();
    const isLive = rotatorState.azimuth !== null && now - rotatorState.lastSeen <= ROTATOR_STALE_MS;

    res.json({
      source: ROTATOR_PROVIDER,
      live: isLive,
      azimuth: rotatorState.azimuth,
      lastSeen: rotatorState.lastSeen || 0,
      staleMs: ROTATOR_STALE_MS,
      error: rotatorState.lastError,
    });
  });

  app.post('/api/rotator/turn', writeLimiter, requireWriteAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const { azimuth } = req.body || {};
      const result = await setAzimuth(azimuth);

      // One follow-up query so the UI gets an updated reading quickly
      await queryAzimuthOnce(800);

      res.json({
        ok: result.ok,
        target: result.target,
        azimuth: rotatorState.azimuth,
        live: rotatorState.azimuth !== null && Date.now() - rotatorState.lastSeen <= ROTATOR_STALE_MS,
        error: result.ok ? null : result.reason,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/rotator/stop', writeLimiter, requireWriteAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const result = await stopRotator();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
};
