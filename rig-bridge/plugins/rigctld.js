'use strict';
/**
 * plugins/rigctld.js — rigctld / Hamlib TCP plugin
 *
 * Connects to a running rigctld daemon via TCP and provides rig control
 * by sending single-letter commands over a persistent socket connection.
 */

const net = require('net');

module.exports = {
  id: 'rigctld',
  name: 'rigctld / Hamlib (TCP)',
  category: 'rig',
  configKey: 'radio',

  create(config, { updateState, state }) {
    let socket = null;
    let queue = [];
    let pending = null;
    let pollTimer = null;
    let reconnectTimer = null;
    let wasExplicitlyDisconnected = false;

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function process() {
      if (pending || queue.length === 0 || !socket) return;
      const req = queue.shift();
      pending = req;
      socket.write(req.cmd + '\n');
    }

    function send(cmd, cb) {
      if (!socket) {
        if (cb) cb(new Error('Not connected'));
        return;
      }
      queue.push({ cmd, cb });
      process();
    }

    function handleResponse(line) {
      if (!pending) return;
      const req = pending;
      pending = null;

      if (req.cmd === 'f') {
        const freq = parseInt(line);
        if (freq > 0) {
          if (state.freq !== freq) console.log(`[Rigctld] freq → ${(freq / 1e6).toFixed(6)} MHz`);
          updateState('freq', freq);
        }
      } else if (req.cmd === 'm') {
        const parts = line.split(' ');
        const mode = parts[0];
        if (mode && state.mode !== mode) console.log(`[Rigctld] mode → ${mode}`);
        updateState('mode', mode);
        if (parts[1]) updateState('width', parseInt(parts[1]));
      } else if (req.cmd === 't') {
        const ptt = line === '1';
        if (state.ptt !== ptt) console.log(`[Rigctld] PTT → ${ptt ? 'TX' : 'RX'}`);
        updateState('ptt', ptt);
      }
      if (req.cb) req.cb(null, line);
      state.lastUpdate = Date.now();
      process();
    }

    function startPolling() {
      stopPolling();
      pollTimer = setInterval(() => {
        if (!socket) return;
        send('f');
        send('m');
        send('t');
      }, config.radio.pollInterval || 1000);
    }

    function connect() {
      if (socket) return;
      wasExplicitlyDisconnected = false;

      const host = config.radio.rigctldHost || '127.0.0.1';
      const port = config.radio.rigctldPort || 4532;
      console.log(`[Rigctld] Connecting to ${host}:${port}...`);

      const s = new net.Socket();
      s.connect(port, host, () => {
        console.log('[Rigctld] Connected');
        updateState('connected', true);
        socket = s;
        startPolling();
      });

      s.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          handleResponse(line.trim());
        }
      });

      s.on('close', () => {
        updateState('connected', false);
        socket = null;
        stopPolling();
        pending = null;
        queue = [];

        if (!wasExplicitlyDisconnected) {
          console.log('[Rigctld] Connection lost — retrying in 5 s…');
          reconnectTimer = setTimeout(connect, 5000);
        }
      });

      s.on('error', (err) => {
        if (!wasExplicitlyDisconnected) {
          console.error(`[Rigctld] Error: ${err.message}`);
        }
        s.destroy();
      });
    }

    function disconnect() {
      wasExplicitlyDisconnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopPolling();
      if (socket) {
        try {
          socket.destroy();
        } catch (e) {}
        socket = null;
      }
      pending = null;
      queue = [];
      updateState('connected', false);
      console.log('[Rigctld] Disconnected');
    }

    function setFreq(hz) {
      console.log(`[Rigctld] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
      send(`F ${hz}`);
    }

    function setMode(mode) {
      console.log(`[Rigctld] SET MODE: ${mode}`);
      send(`M ${mode} 0`);
    }

    function setPTT(on) {
      console.log(`[Rigctld] SET PTT: ${on ? 'TX' : 'RX'}`);
      send(on ? 'T 1' : 'T 0');
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
