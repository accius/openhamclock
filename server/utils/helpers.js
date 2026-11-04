/**
 * General-purpose helper functions shared across route modules.
 */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// CF-Connecting-IP is only trustworthy when the origin can't be reached except
// through Cloudflare: anyone hitting the origin directly can send their own
// CF-Ray / CF-Connecting-IP headers and dodge per-IP rate limits and lockouts.
// So it is opt-in (TRUST_CLOUDFLARE=true, applied by the middleware at startup);
// otherwise req.ip is used, which honours Express's `trust proxy` (TRUST_PROXY).
let trustCloudflare = false;

function setTrustCloudflare(value) {
  trustCloudflare = value === true;
}

function getClientIP(req) {
  if (trustCloudflare && req.headers['cf-ray'] && req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'];
  }
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

module.exports = { formatBytes, formatDuration, getClientIP, setTrustCloudflare };
