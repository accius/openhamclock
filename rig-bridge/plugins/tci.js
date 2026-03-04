'use strict';
/**
 * plugins/tci.js — TCI (Transceiver Control Interface) WebSocket plugin
 *
 * Connects to an SDR application's TCI server via WebSocket and provides
 * real-time rig control without polling. TCI pushes frequency, mode, and
 * PTT changes as they happen.
 *
 * Supported applications:
 *   Thetis        — Hermes Lite 2, ANAN  (default port 40001)
 *   ExpertSDR     — SunSDR2              (default port 40001)
 *   SmartSDR      — Flex (via TCI bridge)
 *
 * Config key: config.tci  { host, port, trx, vfo }
 *
 * TCI reference: https://github.com/ExpertSDR3/TCI
 */

// TCI mode name → OpenHamClock mode name
const TCI_MODES = {
  am: 'AM',
  sam: 'SAM',
  dsb: 'DSB',
  lsb: 'LSB',
  usb: 'USB',
  cw: 'CW',
  nfm: 'FM',
  wfm: 'WFM',
  digl: 'DATA-LSB',
  digu: 'DATA-USB',
  spec: 'SPEC',
  drm: 'DRM',
};

// OpenHamClock mode name → TCI mode name
const TCI_MODES_REV = {};
for (const [tci, ohc] of Object.entries(TCI_MODES)) {
  TCI_MODES_REV[ohc] = tci;
}

module.exports = {
  id: 'tci',
  name: 'TCI/SDR (WebSocket)',
  category: 'rig',
  configKey: 'tci',

  create(config, { updateState, state }) {
    // Resolve WebSocket implementation: prefer 'ws' npm package (works inside
    // pkg snapshots), fall back to Node 21+ built-in WebSocket.
    let WS;
    try {
      WS = require('ws');
    } catch {
      if (typeof globalThis.WebSocket !== 'undefined') {
        WS = globalThis.WebSocket;
      } else {
        console.error('[TCI] WebSocket library not available. Run: npm install ws');
        WS = null;
      }
    }

    const tciCfg = config.tci || {};
    const trx = tciCfg.trx ?? 0;
    const vfo = tciCfg.vfo ?? 0;
    const host = tciCfg.host || 'localhost';
    const port = tciCfg.port || 40001;
    const url = `ws://${host}:${port}`;

    let ws = null;
    let reconnectTimer = null;
    let wasExplicitlyDisconnected = false;
    let msgBuffer = ''; // TCI messages end with ';', may arrive chunked

    function parseMessage(msg) {
      // Accumulate into buffer; split on ';' delimiter
      msgBuffer += msg;
      const parts = msgBuffer.split(';');
      // Last element is either empty (complete) or a partial message
      msgBuffer = parts.pop();

      for (const raw of parts) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        // Format: "name:arg1,arg2,..." or just "name"
        const colonIdx = trimmed.indexOf(':');
        const name = colonIdx >= 0 ? trimmed.slice(0, colonIdx).toLowerCase() : trimmed.toLowerCase();
        const argStr = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : '';
        const args = argStr ? argStr.split(',') : [];

        switch (name) {
          case 'vfo': {
            // vfo:rx,sub_vfo,freq_hz
            const rxIdx = parseInt(args[0]);
            const vfoIdx = parseInt(args[1]);
            if (rxIdx === trx && vfoIdx === vfo) {
              const freq = parseInt(args[2]);
              if (freq > 0 && state.freq !== freq) {
                console.log(`[TCI] freq → ${(freq / 1e6).toFixed(6)} MHz`);
                updateState('freq', freq);
              }
            }
            break;
          }
          case 'modulation': {
            // modulation:rx,mode_name
            const rxIdx = parseInt(args[0]);
            if (rxIdx === trx) {
              const modeName = (args[1] || '').toLowerCase();
              const ohcMode = TCI_MODES[modeName] || modeName.toUpperCase();
              if (state.mode !== ohcMode) {
                console.log(`[TCI] mode → ${ohcMode}`);
                updateState('mode', ohcMode);
              }
            }
            break;
          }
          case 'trx': {
            // trx:rx,true|false  — transmit state
            const rxIdx = parseInt(args[0]);
            if (rxIdx === trx) {
              const ptt = args[1] === 'true';
              if (state.ptt !== ptt) {
                console.log(`[TCI] PTT → ${ptt ? 'TX' : 'RX'}`);
                updateState('ptt', ptt);
              }
            }
            break;
          }
          case 'rx_filter_band': {
            // rx_filter_band:rx,low_hz,high_hz
            const rxIdx = parseInt(args[0]);
            if (rxIdx === trx) {
              const lo = parseInt(args[1]);
              const hi = parseInt(args[2]);
              const width = hi - lo;
              if (width > 0 && state.width !== width) updateState('width', width);
            }
            break;
          }
          case 'protocol':
            console.log(`[TCI] Server protocol: ${argStr}`);
            break;
          case 'device':
            console.log(`[TCI] Device: ${argStr}`);
            break;
          case 'receive_only':
            if (args[0] === 'true') {
              console.log('[TCI] ⚠️  Radio is in receive-only mode (PTT disabled server-side)');
            }
            break;
          case 'ready':
            console.log('[TCI] Server ready');
            break;
          // Silently ignore high-volume / irrelevant TCI messages
          case 'iq_samplerate':
          case 'audio_samplerate':
          case 'iq_start':
          case 'iq_stop':
          case 'audio_start':
          case 'audio_stop':
          case 'spot':
          case 'drive':
          case 'sql_enable':
          case 'mute':
          case 'rx_enable':
          case 'sensors_enable':
          case 'cw_macros_speed':
          case 'volume':
          case 'rx_smeter':
            break;
          default:
            // Uncomment for debugging unknown TCI messages:
            // console.log(`[TCI] Unhandled: ${trimmed}`);
            break;
        }
      }
    }

    function send(data) {
      if (!ws || ws.readyState !== 1 /* OPEN */) return false;
      try {
        ws.send(data);
        return true;
      } catch (e) {
        console.error(`[TCI] Send error: ${e.message}`);
        return false;
      }
    }

    function scheduleReconnect() {
      if (reconnectTimer || wasExplicitlyDisconnected) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(); // eslint-disable-line no-use-before-define
      }, 5000);
    }

    function connect() {
      if (ws || wasExplicitlyDisconnected) return;
      if (!WS) return;

      console.log(`[TCI] Connecting to ${url}...`);
      try {
        ws = new WS(url);
      } catch (e) {
        console.error(`[TCI] Connection failed: ${e.message}`);
        scheduleReconnect();
        return;
      }

      // Use addEventListener — works on both 'ws' npm lib AND Node 21+ native
      // WebSocket. (.on() is ws-library-only and crashes with native WebSocket.)
      ws.addEventListener('open', () => {
        console.log(`[TCI] ✅ Connected to ${url}`);
        msgBuffer = '';
        updateState('connected', true);
        // Initiate TCI session — server will send device info, then state dump
        ws.send('start;');
      });

      ws.addEventListener('message', (evt) => {
        // ws lib: evt is the data directly (string or Buffer)
        // native WebSocket: evt is a MessageEvent with .data property
        const raw = evt.data !== undefined ? evt.data : evt;
        const msg = typeof raw === 'string' ? raw : raw.toString('utf8');
        parseMessage(msg);
      });

      ws.addEventListener('error', (evt) => {
        // 'error' fires before 'close' — just log; reconnect happens on 'close'
        const err = evt.error || evt;
        if (err && err.code === 'ECONNREFUSED') {
          console.error('[TCI] Connection refused — is the SDR app running with TCI enabled?');
        } else {
          console.error(`[TCI] Error: ${(err && err.message) || 'connection error'}`);
        }
      });

      ws.addEventListener('close', () => {
        console.log('[TCI] Disconnected');
        ws = null;
        updateState('connected', false);
        scheduleReconnect();
      });
    }

    function disconnect() {
      wasExplicitlyDisconnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.send('stop;');
          ws.close();
        } catch (e) {}
        ws = null;
      }
      msgBuffer = '';
      updateState('connected', false);
      console.log('[TCI] Disconnected');
    }

    function setFreq(hz) {
      console.log(`[TCI] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
      send(`VFO:${trx},${vfo},${hz};`);
    }

    function setMode(mode) {
      console.log(`[TCI] SET MODE: ${mode}`);
      const tciMode = TCI_MODES_REV[mode] || TCI_MODES_REV[mode.toUpperCase()] || mode.toLowerCase();
      send(`MODULATION:${trx},${tciMode};`);
    }

    function setPTT(on) {
      console.log(`[TCI] SET PTT: ${on ? 'TX' : 'RX'}`);
      send(`TRX:${trx},${on};`);
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
