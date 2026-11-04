/**
 * outboxLock — one flusher per browser for the shared-incident outbox.
 *
 * Every tab that has joined an incident shares one outbox in localStorage.
 * Only one of them may send it at a time, or the same records go out twice.
 * The Web Locks API (navigator.locks) gives a lock across all tabs of the
 * origin; where it is missing, a short lease in localStorage stands in: a
 * tab takes it when nobody holds it or the holder's lease has run out (the
 * holder crashed or closed mid-flush). The holder renews it every 5 s for
 * as long as its send runs, however slow, and releases it when the send
 * finishes or fails.
 */

export const LOCK_NAME = 'ohc-incident-outbox';
export const LEASE_KEY = 'openhamclock_incidentOutboxLease';
export const LEASE_MS = 15 * 1000;
/** While a send runs, the lease is renewed this often, so a slow send keeps it. */
export const LEASE_RENEW_MS = 5 * 1000;

const readLease = (storage) => {
  try {
    const raw = storage?.getItem(LEASE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Take (or renew) the lease for `owner`. → true when it is ours now. */
export function tryLease(storage, owner, now = Date.now(), ttl = LEASE_MS) {
  if (!storage) return true; // no storage: no other tab can share the outbox either
  const cur = readLease(storage);
  if (cur && cur.owner !== owner && cur.until > now) return false;
  try {
    storage.setItem(LEASE_KEY, JSON.stringify({ owner, until: now + ttl }));
    // Two tabs racing: whoever wrote last holds it. Read back to find out.
    return readLease(storage)?.owner === owner;
  } catch {
    return true;
  }
}

export function releaseLease(storage, owner) {
  try {
    if (readLease(storage)?.owner === owner) storage.removeItem(LEASE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Run `fn` while holding the outbox lock; do nothing if another tab holds it.
 * → true when `fn` ran, false when the lock was busy.
 */
export async function withOutboxLock(fn, { locks, storage, owner, now = Date.now } = {}) {
  if (locks?.request) {
    return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await fn();
      return true;
    });
  }
  if (!tryLease(storage, owner, now())) return false;
  const heartbeat = setInterval(() => tryLease(storage, owner, now()), LEASE_RENEW_MS);
  try {
    await fn();
    return true;
  } finally {
    clearInterval(heartbeat);
    releaseLease(storage, owner);
  }
}
