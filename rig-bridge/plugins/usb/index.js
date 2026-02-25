'use strict';
/**
 * plugins/usb/index.js — USB Serial Plugin
 *
 * Handles the serial port lifecycle (open, reconnect, polling) and
 * delegates all protocol-specific logic to the appropriate sub-module:
 *   - protocol-yaesu.js
 *   - protocol-kenwood.js
 *   - protocol-icom.js
 *
 * Plugin metadata:
 *   id: 'yaesu' | 'kenwood' | 'icom'  (one plugin entry per USB protocol)
 *   category: 'rig'
 */

const { getSerialPort } = require('../../core/serial-utils');
const { execFileSync } = require('child_process');

const DEBUG = process.argv.includes('--debug');

const PROTOCOLS = {
  yaesu: require('./protocol-yaesu'),
  kenwood: require('./protocol-kenwood'),
  icom: require('./protocol-icom'),
};

// Exported plugin descriptors — one per radio brand (all share this factory)
const USB_TYPES = ['yaesu', 'kenwood', 'icom'];

function createUsbPlugin(radioType) {
  return {
    id: radioType,
    name: {
      yaesu: 'Yaesu (USB CAT)',
      kenwood: 'Kenwood / Elecraft (USB CAT)',
      icom: 'Icom (USB CI-V)',
    }[radioType],
    category: 'rig',
    configKey: 'radio',

    create(config, { updateState, state }) {
      const proto = PROTOCOLS[radioType];
      if (!proto) throw new Error(`Unknown USB protocol: ${radioType}`);

      let serialPort = null;
      let pollTimer = null;
      let rxBuffer = '';
      let rxBinaryBuffer = Buffer.alloc(0);
      let reconnectTimer = null;
      let wasExplicitlyDisconnected = false;

      function getIcomAddress() {
        const addr = config.radio.icomAddress || '0x94';
        return parseInt(addr, 16);
      }

      function write(data) {
        if (!serialPort || !serialPort.isOpen) return false;
        if (DEBUG) {
          if (Buffer.isBuffer(data)) {
            console.log(`[USB/${radioType}] → ${data.toString('hex').match(/../g).join(' ')}`);
          } else {
            console.log(`[USB/${radioType}] → ${data}`);
          }
        }
        serialPort.write(data, (err) => {
          if (err) console.error(`[USB/${radioType}] Write error: ${err.message}`);
          else serialPort.drain(() => {}); // flush kernel buffer to hardware
        });
        return true;
      }

      function stopPolling() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }

      // Wrap updateState so state changes going to the UI are also visible in the log
      function loggedUpdateState(prop, value) {
        const prev = state[prop];
        updateState(prop, value);
        // Only log if the value actually changed (updateState skips no-ops internally)
        if (prev !== value) {
          if (prop === 'freq') {
            console.log(`[USB/${radioType}] freq → ${(value / 1e6).toFixed(6)} MHz`);
          } else if (prop === 'mode') {
            console.log(`[USB/${radioType}] mode → ${value}`);
          } else if (prop === 'ptt') {
            console.log(`[USB/${radioType}] PTT → ${value ? 'TX' : 'RX'}`);
          }
        }
      }

      // For Yaesu: the radio streams auto-info (AI) updates automatically.
      // We don't poll — we just listen and parse whatever the radio sends.
      // For Kenwood/Icom: traditional polling is used.
      function startPolling() {
        stopPolling();
        const doPoll = () => {
          if (!serialPort || !serialPort.isOpen) return;
          if (radioType === 'icom') {
            proto.poll(write, getIcomAddress());
          } else {
            proto.poll(write);
          }
        };
        doPoll();
        pollTimer = setInterval(doPoll, config.radio.pollInterval || 500);
      }

      // Startup sequence:
      // Yaesu: enable AI1 (auto-information) so the radio pushes IF; updates
      //   on every state change (freq, mode, PTT).
      //   Also run a slow periodic IF; keepalive poll every 30s to:
      //   - Get the current state immediately on connect (before any VFO change)
      //   - Recover if auto-info was disabled by another app
      // Kenwood/Icom: fall through to normal polling.
      function startWithPreamble() {
        rxBuffer = '';
        rxBinaryBuffer = Buffer.alloc(0);

        if (radioType === 'yaesu') {
          if (serialPort && serialPort.isOpen) {
            // Enable auto-info so radio pushes changes automatically
            serialPort.write('AI1;', (err) => {
              if (err) console.warn(`[USB/${radioType}] AI1 write error: ${err.message}`);
              else
                serialPort.drain(() => {
                  console.log(`[USB/${radioType}] Auto-info enabled (AI1). Listening for radio updates...`);
                  // Also send one immediate IF; poll to get current state right away
                  setTimeout(() => {
                    if (serialPort && serialPort.isOpen) {
                      console.log(`[USB/${radioType}] Initial state poll → IF;`);
                      serialPort.write('IF;', () => serialPort.drain(() => {}));
                    }
                  }, 300);
                });
            });
            // Slow keepalive: re-enable AI and poll IF every 30s as fallback
            pollTimer = setInterval(() => {
              if (!serialPort || !serialPort.isOpen) return;
              serialPort.write('AI1;IF;', () => serialPort.drain(() => {}));
            }, 30000);
          }
        } else {
          startPolling();
        }
      }

      // Known Yaesu CAT response prefixes - used to skip leading garbage bytes
      const YAESU_CMDS = new Set(['IF', 'FA', 'FB', 'MD', 'TX', 'RX', 'AI', 'ID', 'PS', '?;']);

      function processAsciiBuffer() {
        let idx;
        while ((idx = rxBuffer.indexOf(';')) !== -1) {
          let start = 0;
          // For Yaesu: scan forward to find a known 2-letter command prefix,
          // skipping any leading garbage from the first-byte framing error.
          if (radioType === 'yaesu' && idx >= 2) {
            for (let i = 0; i <= idx - 2; i++) {
              const prefix = rxBuffer.substring(i, i + 2).toUpperCase();
              if (YAESU_CMDS.has(prefix)) {
                start = i;
                break;
              }
            }
          }
          const response = rxBuffer.substring(start, idx);
          rxBuffer = rxBuffer.substring(idx + 1);
          proto.parse(response, loggedUpdateState, (prop) => state[prop]);
        }
        if (rxBuffer.length > 1000) rxBuffer = rxBuffer.slice(-200);
      }

      function connect() {
        const SP = getSerialPort();
        if (!SP || !config.radio.serialPort) return;

        if (serialPort && serialPort.isOpen) {
          try {
            serialPort.close();
          } catch (e) {}
        }
        serialPort = null;
        rxBuffer = '';
        rxBinaryBuffer = Buffer.alloc(0);
        wasExplicitlyDisconnected = false;

        console.log(`[USB/${radioType}] Opening ${config.radio.serialPort} at ${config.radio.baudRate} baud...`);

        serialPort = new SP({
          path: config.radio.serialPort,
          baudRate: config.radio.baudRate,
          dataBits: config.radio.dataBits || 8,
          stopBits: config.radio.stopBits || 2,
          parity: config.radio.parity || 'none',
          // Yaesu FT-991A: rtscts MUST be true for auto-info to work on macOS.
          // Diagnostic confirmed: with rtscts=false the radio sends nothing.
          rtscts: radioType === 'yaesu' ? true : !!config.radio.rtscts,
          autoOpen: false,
        });

        serialPort.open((err) => {
          if (err) {
            console.error(`[USB/${radioType}] Failed to open: ${err.message}`);
            updateState('connected', false);
            console.log(`[USB/${radioType}] Retrying in 5 s…`);
            reconnectTimer = setTimeout(connect, 5000);
            return;
          }
          console.log(`[USB/${radioType}] Port opened successfully (Hardware Flow: ${!!config.radio.rtscts})`);

          // Set DTR explicitly for CAT interface power (needed even with rtscts=true)
          const dtr = config.radio.dtr !== undefined ? !!config.radio.dtr : true;
          serialPort.set({ dtr }, (setErr) => {
            if (setErr) console.warn(`[USB/${radioType}] Could not set DTR: ${setErr.message}`);
          });

          updateState('connected', true);

          // Unix-specific: Node.js serialport sets HUPCL which can interfere with
          // hardware handshaking on CP210x (FT-991A) on macOS and some Linux systems.
          // Apply stty fix to align termios with what pyserial/rigctl use.
          // macOS uses `-f PORT`, Linux uses `-F PORT`. Windows uses Win32 API — no fix needed.
          if ((process.platform === 'darwin' || process.platform === 'linux') && radioType === 'yaesu') {
            try {
              const portFlag = process.platform === 'darwin' ? '-f' : '-F';
              const stopBitsFlag = (config.radio.stopBits || 2) >= 2 ? 'cstopb' : '-cstopb';
              execFileSync('stty', [portFlag, config.radio.serialPort, 'clocal', '-hupcl', 'crtscts', stopBitsFlag]);
              console.log(`[USB/${radioType}] stty termios fix applied (${process.platform}).`);
            } catch (sttyErr) {
              console.warn(`[USB/${radioType}] stty fix failed (non-critical): ${sttyErr.message}`);
            }
          }

          const stabilizerDelay = 500; // short settle after stty fix
          setTimeout(startWithPreamble, stabilizerDelay);
        });

        serialPort.on('data', (data) => {
          if (DEBUG) console.log(`[USB/${radioType}] ← HEX: ${data.toString('hex').match(/../g).join(' ')}`);

          if (radioType === 'icom') {
            rxBinaryBuffer = proto.handleData(data, rxBinaryBuffer, loggedUpdateState, (prop) => state[prop]);
          } else {
            const raw = data.toString('ascii');
            if (DEBUG) {
              const display = raw.replace(/[\r\n]/g, '').trim();
              if (display) console.log(`[USB/${radioType}] ← ASCII: ${display}`);
            }
            rxBuffer += raw;
            processAsciiBuffer();
          }
        });

        serialPort.on('error', (err) => {
          if (!wasExplicitlyDisconnected) {
            console.error(`[USB/${radioType}] Error: ${err.message}`);
          }
        });

        serialPort.on('close', () => {
          updateState('connected', false);
          stopPolling();
          serialPort = null;

          if (!wasExplicitlyDisconnected) {
            console.log(`[USB/${radioType}] Port closed — retrying in 5 s…`);
            reconnectTimer = setTimeout(connect, 5000);
          }
        });
      }

      function disconnect() {
        wasExplicitlyDisconnected = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        stopPolling();
        if (serialPort && serialPort.isOpen) {
          try {
            serialPort.close();
          } catch (e) {}
        }
        serialPort = null;
        updateState('connected', false);
        console.log(`[USB/${radioType}] Disconnected`);
      }

      function setFreq(hz) {
        console.log(`[USB/${radioType}] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
        if (radioType === 'icom') {
          proto.setFreq(hz, write, getIcomAddress());
        } else {
          proto.setFreq(hz, write);
        }
      }

      function setMode(mode) {
        console.log(`[USB/${radioType}] SET MODE: ${mode}`);
        if (radioType === 'icom') {
          proto.setMode(mode, write, getIcomAddress());
        } else {
          proto.setMode(mode, write);
        }
      }

      function setPTT(on) {
        console.log(`[USB/${radioType}] SET PTT: ${on ? 'TX' : 'RX'}`);
        if (radioType === 'icom') {
          proto.setPTT(on, write, getIcomAddress());
        } else {
          proto.setPTT(on, write);
        }
      }

      return { connect, disconnect, setFreq, setMode, setPTT };
    },
  };
}

// Export a descriptor for each USB radio type
module.exports = USB_TYPES.map(createUsbPlugin);
