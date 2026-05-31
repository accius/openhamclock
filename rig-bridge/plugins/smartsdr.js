'use strict';
/**
 * plugins/smartsdr.js — FlexRadio SmartSDR native TCP API plugin
 *
 * Connects directly to a FlexRadio 6000/8000 series via the SmartSDR
 * TCP API (port 4992) without needing rigctld, SmartSDR CAT, or DAX.
 *
 * Protocol: line-based TCP. Radio sends version/handle on connect,
 * then push-based status updates after subscribing to slice and interlock changes.
 *
 * PTT/TX detection: the SmartSDR API reports live transmit state through the
 * interlock object (S0|interlock state=TRANSMITTING …), not through the
 * transmit settings object.  Interlock messages are part of the radio object
 * and arrive via "sub radio all".  Watch for state=TRANSMITTING or
 * PTT_REQUESTED (PTT on) vs RECEIVE/READY/UNKEY_REQUESTED (PTT off).
 */

const net = require('net');

// FlexRadio mode name → OpenHamClock mode name
const FLEX_MODES = {
  USB: 'USB',
  LSB: 'LSB',
  CW: 'CW',
  AM: 'AM',
  SAM: 'SAM',
  FM: 'FM',
  NFM: 'FM',
  DFM: 'FM',
  DIGU: 'DATA-USB',
  DIGL: 'DATA-LSB',
  RTTY: 'RTTY',
  FDV: 'FreeDV',
};

// OpenHamClock mode name → FlexRadio mode name
const FLEX_MODES_REV = {};
for (const [flex, ohc] of Object.entries(FLEX_MODES)) {
  if (!FLEX_MODES_REV[ohc]) FLEX_MODES_REV[ohc] = flex;
}

module.exports = {
  id: 'smartsdr',
  name: 'FlexRadio SmartSDR (TCP)',
  category: 'rig',
  configKey: 'smartsdr',

  create(config, { updateState, state }) {
    const cfg = config.smartsdr || {};
    const host = cfg.host || '192.168.1.100';
    const port = cfg.port || 4992;
    const sliceIndex = cfg.sliceIndex ?? 0;

    let socket = null;
    let reconnectTimer = null;
    let wasExplicitlyDisconnected = false;
    let seq = 1; // command sequence number
    let handle = null; // session handle from radio
    let lineBuf = ''; // partial line buffer

    function nextSeq() {
      return seq++;
    }

    function sendCmd(cmd) {
      if (!socket) return;
      const s = nextSeq();
      socket.write(`C${s}|${cmd}\n`);
      return s;
    }

    function handleLine(line) {
      if (!line) return;

      const firstChar = line[0];

      // Version line: V1.x.x.x...
      if (firstChar === 'V') {
        console.log(`[SmartSDR] Radio version: ${line.slice(1)}`);
        return;
      }

      // Handle line: Hxxxxxxxx
      if (firstChar === 'H') {
        handle = line.slice(1).trim();
        console.log(`[SmartSDR] Session handle: ${handle}`);
        sendCmd('sub slice all');
        // Subscribe to radio-wide status so interlock (PTT/TX) state changes
        // are delivered.  "sub interlock" does not exist as a standalone command;
        // interlock messages (S0|interlock state=TRANSMITTING …) are part of the
        // radio object and arrive via "sub radio all".
        sendCmd('sub radio all');
        return;
      }

      // Response line: R<seq>|<hex_status>|...
      if (firstChar === 'R') {
        const parts = line.slice(1).split('|');
        const respSeq = parts[0];
        const status = parseInt(parts[1], 16);
        if (status !== 0) {
          console.warn(`[SmartSDR] Command seq ${respSeq} error: 0x${parts[1]}`);
        }
        return;
      }

      // Status line: S<handle>|<object> key=value key=value...
      if (firstChar === 'S') {
        const pipeIdx = line.indexOf('|');
        if (pipeIdx < 0) return;
        const payload = line.slice(pipeIdx + 1);

        // Interlock status — primary source for PTT/TX state.
        // Format: S0|interlock state=<STATE> [source=<SRC>] [tx_allowed=<0|1>] …
        // TRANSMITTING / PTT_REQUESTED → on air; everything else → receive.
        const interlockMatch = payload.match(/^interlock\s+(.*)/);
        if (interlockMatch) {
          const kvPairs = interlockMatch[1].split(/\s+/);
          for (const kv of kvPairs) {
            const eqIdx = kv.indexOf('=');
            if (eqIdx < 0) continue;
            if (kv.slice(0, eqIdx) === 'state') {
              const interlockState = kv.slice(eqIdx + 1);
              const ptt = interlockState === 'TRANSMITTING' || interlockState === 'PTT_REQUESTED';
              if (state.ptt !== ptt) {
                console.log(`[SmartSDR] PTT → ${ptt ? 'TX' : 'RX'} (interlock ${interlockState})`);
                updateState('ptt', ptt);
              }
              break;
            }
          }
          state.lastUpdate = Date.now();
          return;
        }

        // Slice status — frequency and mode
        const sliceMatch = payload.match(/^slice (\d+)\s+(.*)/);
        if (!sliceMatch) return;

        const idx = parseInt(sliceMatch[1]);
        if (idx !== sliceIndex) return;

        const kvPairs = sliceMatch[2].split(/\s+/);
        for (const kv of kvPairs) {
          const eqIdx = kv.indexOf('=');
          if (eqIdx < 0) continue;
          const key = kv.slice(0, eqIdx);
          const val = kv.slice(eqIdx + 1);

          if (key === 'RF_frequency') {
            const freqMhz = parseFloat(val);
            const freqHz = Math.round(freqMhz * 1e6);
            if (freqHz > 0 && state.freq !== freqHz) {
              console.log(`[SmartSDR] freq → ${freqMhz.toFixed(6)} MHz`);
              updateState('freq', freqHz);
            }
          } else if (key === 'mode') {
            const ohcMode = FLEX_MODES[val] || val;
            if (state.mode !== ohcMode) {
              console.log(`[SmartSDR] mode → ${ohcMode}`);
              updateState('mode', ohcMode);
            }
          }
        }
        state.lastUpdate = Date.now();
        return;
      }

      // Message line: M<seq>|... — informational messages from radio
      if (firstChar === 'M') {
        console.log(`[SmartSDR] Message: ${line.slice(1)}`);
        return;
      }
    }

    function connect() {
      if (socket) return;
      wasExplicitlyDisconnected = false;
      seq = 1;
      handle = null;
      lineBuf = '';

      // SECURITY: Defensive host check — primary validation is in POST /api/config,
      // but guard here too in case config is edited manually.
      if (
        !/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-fA-F:]+\]|[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*)$/.test(
          host,
        ) ||
        /[/:]{2}|[/\\]/.test(host)
      ) {
        console.error(`[SmartSDR] Refused to connect: invalid host value "${host}"`);
        return;
      }

      console.log(`[SmartSDR] Connecting to ${host}:${port}...`);

      const s = new net.Socket();
      s.connect(port, host, () => {
        console.log('[SmartSDR] Connected');
        socket = s;
        updateState('connected', true);
      });

      s.on('data', (data) => {
        lineBuf += data.toString();
        const lines = lineBuf.split('\n');
        // Last element is partial (or empty if data ended with \n)
        lineBuf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) handleLine(trimmed);
        }
      });

      s.on('close', () => {
        updateState('connected', false);
        socket = null;
        handle = null;

        if (!wasExplicitlyDisconnected) {
          console.log('[SmartSDR] Connection lost — retrying in 5 s…');
          reconnectTimer = setTimeout(connect, 5000);
        }
      });

      s.on('error', (err) => {
        if (!wasExplicitlyDisconnected) {
          console.error(`[SmartSDR] Error: ${err.message}`);
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
      if (socket) {
        try {
          socket.destroy();
        } catch (e) {}
        socket = null;
      }
      handle = null;
      lineBuf = '';
      updateState('connected', false);
      console.log('[SmartSDR] Disconnected');
    }

    function setFreq(hz) {
      const mhz = (hz / 1e6).toFixed(6);
      console.log(`[SmartSDR] SET FREQ: ${mhz} MHz`);
      sendCmd(`slice tune ${sliceIndex} ${mhz}`);
    }

    function setMode(mode) {
      const flexMode = FLEX_MODES_REV[mode] || FLEX_MODES_REV[mode.toUpperCase()] || mode;
      console.log(`[SmartSDR] SET MODE: ${mode} → ${flexMode}`);
      sendCmd(`slice set ${sliceIndex} mode=${flexMode}`);
    }

    function setPTT(on) {
      console.log(`[SmartSDR] SET PTT: ${on ? 'TX' : 'RX'}`);
      sendCmd(`xmit ${on ? '1' : '0'}`);
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
