'use strict';

/**
 * Electron Preload Script
 *
 * Exposes a minimal, safe API surface to the renderer process via contextBridge.
 * contextIsolation is enabled and nodeIntegration is disabled in main.js,
 * so this is the only sanctioned way for the renderer to communicate with the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Ask the main process to enable or disable the power save blocker
   * (prevents display sleep while the app is open).
   * @param {boolean} enabled
   */
  setPreventSleep: (enabled) => ipcRenderer.send('set-prevent-sleep', enabled),
});
