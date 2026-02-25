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
    this._instance = null; // current active rig plugin instance
    this._activeId = null;
    this._integrations = new Map(); // id → running integration plugin instance
  }

  /**
   * Register all built-in plugins. Call once at startup before load().
   */
  registerBuiltins() {
    // USB plugins export an array (one per radio brand)
    try {
      const usbPlugins = require('../plugins/usb/index');
      for (const p of usbPlugins) {
        this._descriptors.set(p.id, p);
      }
    } catch (e) {
      console.error(`[Registry] Failed to load USB plugins: ${e.message}`);
    }

    // Single-export rig plugins
    for (const file of ['rigctld', 'flrig', 'mock']) {
      try {
        const p = require(`../plugins/${file}`);
        this._descriptors.set(p.id, p);
      } catch (e) {
        console.error(`[Registry] Failed to load plugin "${file}": ${e.message}`);
      }
    }

    // Integration plugins (non-rig, run in parallel alongside the rig plugin)
    for (const file of ['wsjtx-relay']) {
      try {
        const p = require(`../plugins/${file}`);
        this._descriptors.set(p.id, p);
      } catch (e) {
        console.error(`[Registry] Failed to load integration plugin "${file}": ${e.message}`);
      }
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
   * Start all integration plugins (category: 'integration') that are enabled.
   * Integration plugins run in parallel alongside the active rig plugin.
   * Call once at startup after connectActive().
   */
  connectIntegrations() {
    for (const [id, descriptor] of this._descriptors) {
      if (descriptor.category !== 'integration') continue;
      const cfgKey = descriptor.configKey;
      if (!this._config[cfgKey] || !this._config[cfgKey].enabled) continue;
      try {
        const instance = descriptor.create(this._config, this._services);
        instance.connect();
        this._integrations.set(id, instance);
        console.log(`[Registry] Started integration plugin: ${descriptor.name}`);
      } catch (e) {
        console.error(`[Registry] Failed to start integration plugin "${id}": ${e.message}`);
      }
    }
  }

  /**
   * Restart a single integration plugin by id (e.g. after its config changes).
   * Disconnects the running instance if any, then starts a fresh one if enabled.
   */
  restartIntegration(id) {
    const existing = this._integrations.get(id);
    if (existing) {
      try {
        existing.disconnect();
      } catch (e) {}
      this._integrations.delete(id);
    }

    const descriptor = this._descriptors.get(id);
    if (!descriptor) return;

    const cfgKey = descriptor.configKey;
    if (!this._config[cfgKey] || !this._config[cfgKey].enabled) return;

    try {
      const instance = descriptor.create(this._config, this._services);
      instance.connect();
      this._integrations.set(id, instance);
      console.log(`[Registry] Restarted integration plugin: ${descriptor.name}`);
    } catch (e) {
      console.error(`[Registry] Failed to restart integration plugin "${id}": ${e.message}`);
    }
  }

  /**
   * Register extra HTTP routes from all plugins that expose them.
   * Call after Express app is created, before server starts listening.
   * Integration plugins expose registerRoutes() on the descriptor itself
   * (using a module-level instance reference) so routes work regardless of
   * whether the integration is currently running.
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
