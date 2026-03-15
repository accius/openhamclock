/**
 * Logging system with rate limiting and log levels.
 * Prevents log spam when services are down and protects cloud log pipelines.
 */

const LOG_LEVEL = (process.env.LOG_LEVEL || 'warn').toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.warn;

function logDebug(...args) {
  if (currentLogLevel <= LOG_LEVELS.debug) console.log(...args);
}
function logInfo(...args) {
  if (currentLogLevel <= LOG_LEVELS.info) console.log(...args);
}
function logWarn(...args) {
  if (currentLogLevel <= LOG_LEVELS.warn) console.warn(...args);
}

const errorLogState = {};
const ERROR_LOG_INTERVAL = 5 * 60 * 1000;

function logErrorOnce(category, message) {
  if (message && (message.includes('aborted') || message.includes('AbortError'))) return false;
  const key = `${category}:${message}`;
  const now = Date.now();
  const lastLogged = errorLogState[key] || 0;
  if (now - lastLogged >= ERROR_LOG_INTERVAL) {
    errorLogState[key] = now;
    console.error(`[${category}] ${message}`);
    return true;
  }
  return false;
}

// Global log rate limiter
const _logBucket = { tokens: 20, max: 20, rate: 10, lastRefill: Date.now(), dropped: 0 };
function _logAllowed() {
  if (LOG_LEVEL === 'debug') return true;
  const now = Date.now();
  const elapsed = (now - _logBucket.lastRefill) / 1000;
  _logBucket.tokens = Math.min(_logBucket.max, _logBucket.tokens + elapsed * _logBucket.rate);
  _logBucket.lastRefill = now;
  if (_logBucket.tokens >= 1) {
    _logBucket.tokens--;
    return true;
  }
  _logBucket.dropped++;
  return false;
}

function installRateLimiter() {
  setInterval(() => {
    if (_logBucket.dropped > 0) {
      const d = _logBucket.dropped;
      _logBucket.dropped = 0;
      process.stderr.write(`[Log Throttle] Suppressed ${d} log messages in last 60s to stay within rate limits\n`);
    }
  }, 60000);

  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);
  console.log = (...args) => {
    if (_logAllowed()) _origLog(...args);
  };
  console.warn = (...args) => {
    if (_logAllowed()) _origWarn(...args);
  };
  console.error = (...args) => {
    if (_logAllowed()) _origError(...args);
  };
}

module.exports = { LOG_LEVEL, logDebug, logInfo, logWarn, logErrorOnce, installRateLimiter };
