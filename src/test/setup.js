// Test setup file for Vitest
// Add any global test configuration or mocks here
import os from 'node:os';
import path from 'node:path';

// rig-bridge keeps its settings in ~/.config/openhamclock/rig-bridge-config.json
// (rig-bridge/core/config.js). Point it at a temp dir before any test can load
// it, so a test that saves config never overwrites the user's real file.
process.env.RIG_BRIDGE_CONFIG_DIR ||= path.join(os.tmpdir(), `openhamclock-rig-bridge-test-${process.pid}`);

// Node >= 25 enables the WebStorage API by default: every process gets a
// global `localStorage`, but unless node is started with --localstorage-file
// it is a non-functional stub whose methods are all undefined. Inside
// vitest's jsdom environment that stub shadows jsdom's real implementation,
// so anything touching localStorage silently no-ops (or throws, e.g. on
// localStorage.clear()). Replace broken storage globals with a real
// in-memory Storage so tests behave the same on Node 25 as on Node 20/22.
class MemoryStorage {
  #store = new Map();
  get length() {
    return this.#store.size;
  }
  key(index) {
    return [...this.#store.keys()][index] ?? null;
  }
  getItem(key) {
    const k = String(key);
    return this.#store.has(k) ? this.#store.get(k) : null;
  }
  setItem(key, value) {
    this.#store.set(String(key), String(value));
  }
  removeItem(key) {
    this.#store.delete(String(key));
  }
  clear() {
    this.#store.clear();
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  if (typeof globalThis[name]?.clear !== 'function') {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, name, { value: storage, writable: true, configurable: true });
    if (typeof window !== 'undefined' && window[name] !== storage) {
      Object.defineProperty(window, name, { value: storage, writable: true, configurable: true });
    }
  }
}
