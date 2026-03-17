/**
 * Upstream Request Manager
 * Prevents request stampedes on external APIs:
 * 1. In-flight deduplication — only 1 fetch per cache key at a time
 * 2. Exponential backoff with jitter per service
 */
class UpstreamManager {
  constructor() {
    this.inFlight = new Map();
    this.backoffs = new Map();
  }

  isBackedOff(service) {
    const b = this.backoffs.get(service);
    return b && Date.now() < b.until;
  }

  backoffRemaining(service) {
    const b = this.backoffs.get(service);
    if (!b || Date.now() >= b.until) return 0;
    return Math.round((b.until - Date.now()) / 1000);
  }

  recordFailure(service, statusCode) {
    const prev = this.backoffs.get(service) || { consecutive: 0 };
    const consecutive = prev.consecutive + 1;
    const baseDelay = statusCode === 429 ? 60000 : statusCode === 503 ? 30000 : 15000;
    const maxBackoff = 30 * 60 * 1000;
    const delay = Math.min(maxBackoff, baseDelay * Math.pow(2, Math.min(consecutive - 1, 8)));
    const jitter = Math.random() * 15000;

    this.backoffs.set(service, { until: Date.now() + delay + jitter, consecutive });
    return Math.round((delay + jitter) / 1000);
  }

  recordSuccess(service) {
    this.backoffs.delete(service);
  }

  async fetch(cacheKey, fetchFn) {
    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }
    const promise = fetchFn().finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }
}

module.exports = UpstreamManager;
