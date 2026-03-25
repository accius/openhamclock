'use strict';
/**
 * state.js — Shared rig state store and SSE broadcast
 */

const state = {
  connected: false,
  freq: 0,
  mode: '',
  width: 0,
  ptt: false,
  lastUpdate: 0,
};

let sseClients = [];
let changeListeners = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((c) => c.res.write(msg));
}

function updateState(prop, value) {
  if (state[prop] !== value) {
    state[prop] = value;
    state.lastUpdate = Date.now();
    broadcast({ type: 'update', prop, value });
    // Notify change listeners (used by cloud relay for immediate push)
    for (const fn of changeListeners) {
      try {
        fn(prop, value);
      } catch (e) {}
    }
  }
}

function onStateChange(fn) {
  changeListeners.push(fn);
}

function removeStateChangeListener(fn) {
  changeListeners = changeListeners.filter((f) => f !== fn);
}

function addSseClient(id, res) {
  sseClients.push({ id, res });
}

function removeSseClient(id) {
  sseClients = sseClients.filter((c) => c.id !== id);
}

module.exports = {
  state,
  broadcast,
  updateState,
  addSseClient,
  removeSseClient,
  onStateChange,
  removeStateChangeListener,
};
