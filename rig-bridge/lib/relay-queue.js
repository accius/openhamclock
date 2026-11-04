'use strict';
/**
 * relay-queue.js — bounded outbound queue for the WSJT-X server relay (CommonJS)
 *
 * Kept separate from plugins/wsjtx-relay.js so the bounds can be unit tested
 * without a network.
 *
 * While the server is unreachable every UDP message stays queued for retry.
 * Unbounded, the queue grew for as long as the outage lasted; each retry then
 * POSTed the whole backlog as one body (which timed out, so it never drained)
 * and put it back with `unshift(...batch)`, which passes every message as a
 * call argument and throws "Maximum call stack size exceeded" once the
 * backlog is large enough. The queue now keeps only the newest messages and
 * each send takes a bounded batch.
 */

const MAX_QUEUE = 5000; // messages kept while the server is unreachable
const MAX_BATCH = 100; // messages per POST — the server keeps only the first 100 (server/routes/wsjtx.js)

/**
 * Drop the oldest messages so at most `max` remain.
 * @param {Array} queue - mutated in place
 * @param {number} [max]
 * @returns {number} how many messages were dropped
 */
function trimQueue(queue, max = MAX_QUEUE) {
  const excess = queue.length - max;
  if (excess <= 0) return 0;
  queue.splice(0, excess);
  return excess;
}

/**
 * Remove and return the oldest messages, at most `max` of them.
 * @param {Array} queue - mutated in place
 * @param {number} [max]
 * @returns {Array}
 */
function takeBatch(queue, max = MAX_BATCH) {
  return queue.splice(0, max);
}

/**
 * Put a failed batch back at the front of the queue, then trim to `max`.
 * Builds a new array instead of spreading the batch into unshift(), so a
 * batch of any size is safe.
 * @param {Array} queue
 * @param {Array} batch
 * @param {number} [max]
 * @returns {{ queue: Array, dropped: number }}
 */
function requeue(queue, batch, max = MAX_QUEUE) {
  const merged = batch.concat(queue);
  const dropped = trimQueue(merged, max);
  return { queue: merged, dropped };
}

module.exports = { trimQueue, takeBatch, requeue, MAX_QUEUE, MAX_BATCH };
