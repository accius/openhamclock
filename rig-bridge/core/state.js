'use strict';
/**
 * state.js — Shared rig state store and SSE broadcast
 */

// Ring-buffer of recent plugin decodes (FT8/FT4/MSHV/JTDX/JS8Call).
// Sent to browsers on SSE connect so they see recent data immediately
// without waiting for the next decode cycle.
const DECODE_RING_MAX = 100;
const decodeRingBuffer = [];

function addToDecodeRingBuffer(decode) {
  decodeRingBuffer.push(decode);
  if (decodeRingBuffer.length > DECODE_RING_MAX) decodeRingBuffer.shift();
}

function getDecodeRingBuffer() {
  return decodeRingBuffer.slice();
}

const state = {
  connected: false,
  freq: 0,
  mode: '',
  width: 0,
  ptt: false,
  onAir: false, // hardware PTT / ON-AIR sense line (GPIO plugin)
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

function getSseClientCount() {
  return sseClients.length;
}

module.exports = {
  state,
  broadcast,
  updateState,
  addSseClient,
  removeSseClient,
  getSseClientCount,
  onStateChange,
  removeStateChangeListener,
  addToDecodeRingBuffer,
  getDecodeRingBuffer,
};
