'use strict';
/**
 * plugins/flrig.js — flrig XML-RPC plugin
 *
 * Connects to a running flrig instance via XML-RPC and polls for
 * frequency, mode, and PTT state.
 *
 * Requires: npm install xmlrpc
 */

module.exports = {
  id: 'flrig',
  name: 'flrig (XML-RPC)',
  category: 'rig',
  configKey: 'radio',

  create(config, { updateState, state }) {
    let client = null;
    let pollTimer = null;

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      stopPolling();
      pollTimer = setInterval(() => {
        if (!client) return;

        client.methodCall('rig.get_vfo', [], (err, val) => {
          if (err) {
            if (state.connected) updateState('connected', false);
          } else {
            if (!state.connected) updateState('connected', true);
            const freq = parseFloat(val);
            if (freq > 0) updateState('freq', freq);
            state.lastUpdate = Date.now();
          }
        });

        client.methodCall('rig.get_mode', [], (err, val) => {
          if (!err && val) updateState('mode', val);
        });

        client.methodCall('rig.get_ptt', [], (err, val) => {
          if (!err) updateState('ptt', !!val);
        });
      }, config.radio.pollInterval || 1000);
    }

    function connect() {
      try {
        const xmlrpc = require('xmlrpc');
        client = xmlrpc.createClient({
          host: config.radio.flrigHost || '127.0.0.1',
          port: config.radio.flrigPort || 12345,
          path: '/',
        });
        updateState('connected', true);
        console.log('[Flrig] Client initialized');
        startPolling();
      } catch (e) {
        console.error('[Flrig] xmlrpc module not available. Install with: npm install xmlrpc');
      }
    }

    function disconnect() {
      stopPolling();
      client = null;
      updateState('connected', false);
    }

    function setFreq(hz) {
      if (client) client.methodCall('rig.set_frequency', [parseFloat(hz) + 0.1], () => {});
    }

    function setMode(mode) {
      if (client) client.methodCall('rig.set_mode', [mode], () => {});
    }

    function setPTT(on) {
      if (client) client.methodCall('rig.set_ptt', [on ? 1 : 0], () => {});
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
