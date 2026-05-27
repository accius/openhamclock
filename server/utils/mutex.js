/**
 * A simple mutex implementation for Node.js to manage concurrent access to shared resources.
 * The Mutex class provides basic locking and unlocking functionality, while MutexValue and MutexCounter
 * extend this functionality to manage a value and a counter, respectively.
 *
 * @class Mutex
 * @typedef {Mutex}
 */
class Mutex {
  constructor() {
    this.locked = false;
    this.queue = [];
  }

  async lock() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  unlock() {
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      nextResolve();
    } else {
      this.locked = false;
    }
  }
}

/**
 * A MutexValue class that encapsulates a value and provides thread-safe access to it using a mutex.
 * The update method allows for atomic updates to the value,
 * while the get method retrieves the current value in a thread-safe manner.
 *
 * @class MutexValue
 * @typedef {MutexValue}
 */
class MutexValue {
  constructor(initialValue) {
    this.value = initialValue;
    this.mutex = new Mutex();
  }

  async update(fn) {
    await this.mutex.lock();
    try {
      this.value = await fn(this.value);
      return this.value;
    } finally {
      this.mutex.unlock();
    }
  }

  async get() {
    await this.mutex.lock();
    try {
      return this.value;
    } finally {
      this.mutex.unlock();
    }
  }
}

/**
 * A MutexCounter class that extends MutexValue to provide a simple counter
 * that can be safely incremented across multiple threads.
 * The increment method atomically increases the counter value by one,
 * ensuring that concurrent increments do not lead.
 *
 * @class MutexCounter
 * @typedef {MutexCounter}
 * @extends {MutexValue}
 */
class MutexCounter extends MutexValue {
  async increment() {
    return this.update((v) => v + 1);
  }

  async setValue(newValue) {
    return this.update(() => newValue);
  }
}

module.exports = { Mutex, MutexValue, MutexCounter };
