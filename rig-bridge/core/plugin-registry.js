'use strict';
/**
 * plugin-registry.js — Plugin lifecycle manager and command dispatcher
 *
 * Loads all plugin descriptors, instantiates the active plugin based on
 * config, and dispatches rig commands (setFreq, setMode, setPTT) to it.
 *
 * Plugin descriptor shape:
 *   {
 *     id: string,
 *     name: string,
 *     category: 'rig' | 'rotator' | 'logger' | 'other',
 *     configKey: string,          // which config section the plugin uses
 *     create(config, services),   // factory → returns plugin instance
 *     // Optional:
 *     registerRoutes(app),        // add extra Express routes
 *   }
 *
 * Plugin instance shape (rig category):
 *   { connect(), disconnect(), setFreq(hz), setMode(mode), setPTT(on) }
 *
 * Non-rig plugins only need connect() / disconnect() and registerRoutes().
 */

class PluginRegistry {
  constructor(config, services) {
    this._config = config;
    this._services = services; // { updateState, state, broadcast }
    this._descriptors = new Map(); // id → descriptor
    this._instance = null;        // current active plugin instance
    this._activeId = null;
  }

  /**
   * Register all built-in plugins. Call once at startup before load().
   */
  registerBuiltins() {
    // USB plugins export an array (one per radio brand)
    const usbPlugins = require('../plugins/usb/index');
    for (const p of usbPlugins) {
      this._descriptors.set(p.id, p);
    }

    // Single-export plugins
    for (const file of ['rigctld', 'flrig']) {
      const p = require(`../plugins/${file}`);
      this._descriptors.set(p.id, p);
    }
  }

  /**
   * Register an external plugin descriptor (for future dynamic loading).
   */
  register(descriptor) {
    if (!descriptor.id || typeof descriptor.create !== 'function') {
      throw new Error(`[Registry] Invalid plugin descriptor: missing id or create()`);
    }
    this._descriptors.set(descriptor.id, descriptor);
    console.log(`[Registry] Registered plugin: ${descriptor.id} (${descriptor.name})`);
  }

  /**
   * List all registered plugin ids.
   */
  list() {
    return Array.from(this._descriptors.values()).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
    }));
  }

  /**
   * Connect the plugin matching the current config.radio.type.
   * Disconnects any previously active plugin first.
   */
  connectActive() {
    const type = this._config.radio && this._config.radio.type;
    if (!type || type === 'none') {
      console.log('[Registry] No radio type configured.');
      return;
    }
    this.switchPlugin(type);
  }

  /**
   * Switch to (and connect) a different plugin by id.
   * Disconnects the current plugin if one is running.
   */
  switchPlugin(id) {
    // Disconnect old instance
    if (this._instance) {
      try {
        this._instance.disconnect();
      } catch (e) {
        console.error(`[Registry] Error disconnecting plugin ${this._activeId}:`, e.message);
      }
      this._instance = null;
      this._activeId = null;
    }

    if (!id || id === 'none') return;

    const descriptor = this._descriptors.get(id);
    if (!descriptor) {
      console.error(`[Registry] Unknown plugin id: "${id}"`);
      return;
    }

    console.log(`[Registry] Starting plugin: ${descriptor.name}`);
    try {
      this._instance = descriptor.create(this._config, this._services);
      this._activeId = id;
      this._instance.connect();
    } catch (e) {
      console.error(`[Registry] Failed to create plugin ${id}:`, e.message);
      this._instance = null;
      this._activeId = null;
    }
  }

  /**
   * Register extra HTTP routes from all plugins that expose them.
   * Call after Express app is created, before server starts listening.
   */
  registerRoutes(app) {
    for (const descriptor of this._descriptors.values()) {
      if (typeof descriptor.registerRoutes === 'function') {
        descriptor.registerRoutes(app);
      }
    }
  }

  /**
   * Dispatch a rig command to the active plugin instance.
   * Returns false if no active rig plugin or method not supported.
   */
  dispatch(method, ...args) {
    if (!this._instance) return false;
    if (typeof this._instance[method] !== 'function') return false;
    this._instance[method](...args);
    return true;
  }

  get activeId() {
    return this._activeId;
  }
}

module.exports = PluginRegistry;
