/**
 * Express middleware — security, rate limiting, compression, caching, endpoint monitoring.
 */

const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const express = require('express');
const { formatBytes } = require('../utils/helpers');

/**
 * Apply all middleware to the Express app.
 * @param {object} app - Express app
 * @param {object} ctx - Shared context
 * @returns {{ endpointStats, writeLimiter, requireWriteAuth }} shared middleware refs
 */
function applyMiddleware(app, ctx) {
  const { CONFIG, PORT, TRUST_PROXY, API_WRITE_KEY, CORS_ORIGINS } = ctx;

  // Trust proxy
  app.set('trust proxy', TRUST_PROXY);

  // Helper: check write auth on POST endpoints that modify server state
  function requireWriteAuth(req, res, next) {
    if (!API_WRITE_KEY) return next(); // No key configured = open (local installs)
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.key || '';
    if (token === API_WRITE_KEY) return next();
    return res.status(401).json({
      error: 'Unauthorized — set Authorization: Bearer <API_WRITE_KEY>',
    });
  }

  // Security: Helmet
  // CSP is intentionally disabled — the app loads scripts, styles, images, and data
  // from dozens of external services (Leaflet CDN, Google Fonts, Open-Meteo, NOAA,
  // NASA SDO/GIBS, PSKReporter, tile CDNs, etc.). A restrictive CSP breaks everything.
  // All other Helmet protections (X-Content-Type-Options, HSTS, X-Frame-Options, etc.)
  // remain active.
  app.use(
    helmet({
      contentSecurityPolicy: false, // eslint-disable-line -- see comment above
      crossOriginEmbedderPolicy: false, // Required for cross-origin tile loading
    }),
  );

  // Permissions-Policy
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
    next();
  });

  // CORS
  const defaultOrigins = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://openhamclock.com',
    'https://www.openhamclock.com',
    'https://openhamclock.app',
    'https://www.openhamclock.app',
  ];
  const allowedOrigins = new Set([...defaultOrigins, ...(CORS_ORIGINS || [])]);

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        if (!requestOrigin) return callback(null, true);
        if (allowedOrigins.has(requestOrigin)) return callback(null, true);
        callback(null, false);
      },
      methods: ['GET', 'POST'],
      maxAge: 86400,
    }),
  );

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1800,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/', apiLimiter);

  // Stricter rate limit for write/expensive endpoints
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  });

  // Body parser
  app.use(express.json({ limit: '1mb' }));

  // GZIP compression
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['accept'] === 'text/event-stream') return false;
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // API response caching middleware
  app.use('/api', (req, res, next) => {
    if (req.path.includes('/stream/')) {
      return next();
    }
    if (req.path.includes('/settings')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return next();
    }
    if (req.path.includes('/rotator')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return next();
    }
    if (req.path.includes('/pota') || req.path.includes('/sota') || req.path.includes('/wwff')) {
      res.setHeader('Cache-Control', 'no-store');
      return next();
    }
    let cacheDuration = 30;

    const p = req.path.toLowerCase();

    if (p.includes('/satellites/tle')) {
      cacheDuration = 3600;
    } else if (p.includes('/contests') || p.includes('/dxpeditions')) {
      cacheDuration = 1800;
    } else if (p.includes('/solar-indices') || p.includes('/noaa')) {
      cacheDuration = 300;
    } else if (p.includes('/propagation')) {
      cacheDuration = 600;
    } else if (p.includes('/n0nbh') || p.includes('/hamqsl')) {
      cacheDuration = 3600;
    } else if (p.includes('/pskreporter')) {
      cacheDuration = 300;
    } else if (p.includes('/dxcluster') || p.includes('/myspots')) {
      cacheDuration = 30;
    } else if (p.includes('/config')) {
      cacheDuration = 3600;
    }

    res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
    res.setHeader('Vary', 'Accept-Encoding');
    next();
  });

  // Endpoint monitoring system
  const endpointStats = {
    endpoints: new Map(),
    startTime: Date.now(),

    reset() {
      this.endpoints.clear();
      this.startTime = Date.now();
    },

    record(path, responseSize, duration, statusCode) {
      const normalizedPath = path.replace(/\/[A-Z0-9]{3,10}(-[A-Z0-9]+)?$/i, '/:param').replace(/\/\d+$/g, '/:id');

      if (!this.endpoints.has(normalizedPath)) {
        this.endpoints.set(normalizedPath, {
          path: normalizedPath,
          requests: 0,
          totalBytes: 0,
          totalDuration: 0,
          errors: 0,
          lastRequest: null,
        });
      }

      const stats = this.endpoints.get(normalizedPath);
      stats.requests++;
      stats.totalBytes += responseSize || 0;
      stats.totalDuration += duration || 0;
      stats.lastRequest = Date.now();
      if (statusCode >= 400) stats.errors++;
    },

    getStats() {
      const uptimeHours = (Date.now() - this.startTime) / (1000 * 60 * 60);
      const stats = Array.from(this.endpoints.values())
        .map((s) => ({
          ...s,
          avgBytes: s.requests > 0 ? Math.round(s.totalBytes / s.requests) : 0,
          avgDuration: s.requests > 0 ? Math.round(s.totalDuration / s.requests) : 0,
          requestsPerHour: uptimeHours > 0 ? (s.requests / uptimeHours).toFixed(1) : s.requests,
          bytesPerHour: uptimeHours > 0 ? Math.round(s.totalBytes / uptimeHours) : s.totalBytes,
          errorRate: s.requests > 0 ? ((s.errors / s.requests) * 100).toFixed(1) : 0,
        }))
        .sort((a, b) => b.totalBytes - a.totalBytes);

      return {
        uptimeHours: uptimeHours.toFixed(2),
        totalRequests: stats.reduce((sum, s) => sum + s.requests, 0),
        totalBytes: stats.reduce((sum, s) => sum + s.totalBytes, 0),
        endpoints: stats,
      };
    },
  };

  // Middleware to track endpoint usage
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/version') return next();

    const startTime = Date.now();
    let responseSize = 0;

    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function (body) {
      if (body) {
        responseSize =
          typeof body === 'string'
            ? Buffer.byteLength(body)
            : Buffer.isBuffer(body)
              ? body.length
              : JSON.stringify(body).length;
      }
      return originalSend.call(this, body);
    };

    res.json = function (body) {
      if (body) {
        responseSize = Buffer.byteLength(JSON.stringify(body));
      }
      return originalJson.call(this, body);
    };

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      endpointStats.record(req.path, responseSize, duration, res.statusCode);
    });

    next();
  });

  return { endpointStats, writeLimiter, requireWriteAuth };
}

module.exports = applyMiddleware;
