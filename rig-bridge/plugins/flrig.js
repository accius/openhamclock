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
            if (state.connected) {
              console.error(`[Flrig] Poll error: ${err.message}`);
              updateState('connected', false);
            }
          } else {
            if (!state.connected) updateState('connected', true);
            const freq = parseFloat(val);
            if (freq > 0) {
              if (state.freq !== freq) console.log(`[Flrig] freq → ${(freq / 1e6).toFixed(6)} MHz`);
              updateState('freq', freq);
            }
            state.lastUpdate = Date.now();
          }
        });

        client.methodCall('rig.get_mode', [], (err, val) => {
          if (!err && val) {
            if (state.mode !== val) console.log(`[Flrig] mode → ${val}`);
            updateState('mode', val);
          }
        });

        client.methodCall('rig.get_ptt', [], (err, val) => {
          if (!err) {
            const ptt = !!val;
            if (state.ptt !== ptt) console.log(`[Flrig] PTT → ${ptt ? 'TX' : 'RX'}`);
            updateState('ptt', ptt);
          }
        });
      }, config.radio.pollInterval || 1000);
    }

    function connect() {
      try {
        const xmlrpc = require('xmlrpc');
        const host = config.radio.flrigHost || '127.0.0.1';
        const port = config.radio.flrigPort || 12345;
        client = xmlrpc.createClient({ host, port, path: '/' });
        updateState('connected', true);
        console.log(`[Flrig] Connecting to ${host}:${port}…`);
        startPolling();
      } catch (e) {
        console.error('[Flrig] xmlrpc module not available. Install with: npm install xmlrpc');
      }
    }

    function disconnect() {
      stopPolling();
      client = null;
      updateState('connected', false);
      console.log('[Flrig] Disconnected');
    }

    function setFreq(hz) {
      console.log(`[Flrig] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
      if (client) client.methodCall('rig.set_frequency', [parseFloat(hz) + 0.1], () => {});
    }

    function setMode(mode) {
      console.log(`[Flrig] SET MODE: ${mode}`);
      if (client) client.methodCall('rig.set_mode', [mode], () => {});
    }

    function setPTT(on) {
      console.log(`[Flrig] SET PTT: ${on ? 'TX' : 'RX'}`);
      if (client) client.methodCall('rig.set_ptt', [on ? 1 : 0], () => {});
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
