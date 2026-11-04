'use strict';
/**
 * sample-ring.js — bounded, one-sample-per-minute history buffer.
 *
 * push() keeps the newest sample for the current minute (so a 10 s poll
 * doesn't inflate the buffer) and drops anything older than `capacity`
 * minutes. Used for the 24 h environment-sensor history (1440 slots).
 */
class MinuteRing {
  /**
   * @param {number} [capacity=1440] minutes to keep
   */
  constructor(capacity = 1440) {
    this.capacity = Math.max(1, capacity | 0);
    this._items = [];
  }

  /**
   * @param {object} sample must carry a numeric `t` (ms since epoch)
   * @returns {boolean} true when a new minute slot was started
   */
  push(sample) {
    if (!sample || !Number.isFinite(sample.t)) return false;
    const minute = Math.floor(sample.t / 60000);
    const last = this._items[this._items.length - 1];
    let newSlot = true;
    if (last && Math.floor(last.t / 60000) === minute) {
      this._items[this._items.length - 1] = sample;
      newSlot = false;
    } else if (last && last.t > sample.t) {
      return false; // out-of-order sample — ignore
    } else {
      this._items.push(sample);
    }
    this.prune(sample.t);
    return newSlot;
  }

  /** Drop samples older than capacity minutes relative to `now`. */
  prune(now = Date.now()) {
    const cutoff = now - this.capacity * 60000;
    let i = 0;
    while (i < this._items.length && this._items[i].t < cutoff) i++;
    if (i > 0) this._items.splice(0, i);
    if (this._items.length > this.capacity) this._items.splice(0, this._items.length - this.capacity);
  }

  latest() {
    return this._items.length ? this._items[this._items.length - 1] : null;
  }

  toArray() {
    return this._items.slice();
  }

  get length() {
    return this._items.length;
  }

  clear() {
    this._items = [];
  }
}

module.exports = { MinuteRing };
