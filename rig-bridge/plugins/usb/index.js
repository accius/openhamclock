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
      let stabilizerTimer = null;
      let initialPollTimer = null;
      let wasExplicitlyDisconnected = false;

      function getIcomAddress() {
        const addr = config.radio.icomAddress || '0x94';
        return parseInt(addr, 16);
      }

      function write(data) {
        if (!serialPort || !serialPort.isOpen) return false;
        if (config.debug) {
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
                  // Also send one immediate IF; + TX; poll to get current state right away.
                  // TX; is sent separately (not combined) so the radio echoes a clean
                  // TXn; response that parse() can unambiguously decode as PTT state.
                  // IF; alone is not used for PTT because its TX/RX field position
                  // varies across Yaesu models and can cause false TX readings.
                  initialPollTimer = setTimeout(() => {
                    if (serialPort && serialPort.isOpen) {
                      console.log(`[USB/${radioType}] Initial state poll → IF; TX;`);
                      serialPort.write('IF;TX;', () => serialPort.drain(() => {}));
                    }
                  }, 300);
                });
            });
            // Slow keepalive: re-enable AI, poll IF for freq/mode, and TX; for PTT every 30s.
            // TX; is the only reliable PTT query across all Yaesu models — IF; TX/RX
            // field position varies by model and is not used for PTT state.
            pollTimer = setInterval(() => {
              if (!serialPort || !serialPort.isOpen) return;
              serialPort.write('AI1;IF;TX;', () => serialPort.drain(() => {}));
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
          proto.parse(response, loggedUpdateState, (prop) => state[prop], config.debug);
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
          rtscts: !!config.radio.rtscts,
          autoOpen: false,
        });

        serialPort.open((err) => {
          if (err) {
            if (!wasExplicitlyDisconnected) {
              console.error(`[USB/${radioType}] Failed to open: ${err.message}`);
              updateState('connected', false);
              console.log(`[USB/${radioType}] Retrying in 5 s…`);
              reconnectTimer = setTimeout(connect, 5000);
            }
            return;
          }

          // Safety: if we were disconnected while the port was opening, close it immediately
          if (wasExplicitlyDisconnected) {
            console.log(`[USB/${radioType}] Port opened but plugin already stopped. Closing...`);
            try {
              serialPort.close();
            } catch (e) {}
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
          stabilizerTimer = setTimeout(startWithPreamble, stabilizerDelay);
        });

        serialPort.on('data', (data) => {
          if (config.debug) console.log(`[USB/${radioType}] ← HEX: ${data.toString('hex').match(/../g).join(' ')}`);

          if (radioType === 'icom') {
            rxBinaryBuffer = proto.handleData(
              data,
              rxBinaryBuffer,
              loggedUpdateState,
              (prop) => state[prop],
              config.debug,
            );
          } else {
            const raw = data.toString('ascii');
            if (config.debug) {
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
        if (stabilizerTimer) {
          clearTimeout(stabilizerTimer);
          stabilizerTimer = null;
        }
        if (initialPollTimer) {
          clearTimeout(initialPollTimer);
          initialPollTimer = null;
        }
        stopPolling();

        if (serialPort) {
          try {
            serialPort.removeAllListeners();
            if (serialPort.isOpen) {
              serialPort.close();
            }
          } catch (e) {
            console.error(`[USB/${radioType}] Error during close: ${e.message}`);
          }
          serialPort = null;
        }

        updateState('connected', false);
        console.log(`[USB/${radioType}] Disconnected`);
      }

      // A band change makes the radio recall that band's stored mode and VFO, so
      // both the mode to apply afterwards and the band to compare against have
      // to survive the gap between a tune being requested and the radio
      // reporting it back on the next IF; poll.
      let lastRequestedMode = null;
      let lastRequestedModeAt = 0;
      let lastRequestedFreq = 0;
      let lastRequestedFreqAt = 0;

      // A tune and its mode arrive as two separate commands milliseconds apart,
      // and nothing guarantees which lands first. Anything inside this window
      // belongs to the same tune, whichever order it arrived in.
      const TUNE_WINDOW_MS = 1000;

      /**
       * Frequency to reason about the radio's current band and sideband.
       *
       * state.freq only refreshes on the IF; poll (500 ms by default), so a tune
       * still in flight has not been echoed back yet. Within the window the
       * frequency just requested wins; after it, state.freq is authoritative and
       * also reflects the operator turning the VFO by hand.
       */
      const modeReferenceFreq = () =>
        Date.now() - lastRequestedFreqAt < TUNE_WINDOW_MS ? lastRequestedFreq : state.freq;

      function setFreq(hz) {
        console.log(`[USB/${radioType}] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
        // Both read before this tune is recorded: comparing the target against
        // itself would make every band change look like an in-band retune, and
        // the mode has to be the one in effect before BS; recalls another.
        const referenceFreq = modeReferenceFreq();
        const modeBefore = state.mode;
        lastRequestedFreq = hz;
        lastRequestedFreqAt = Date.now();

        if (radioType === 'icom') {
          proto.setFreq(hz, write, getIcomAddress());
        } else {
          // Third arg is the frequency Yaesu compares to decide whether this is a
          // band change. Kenwood ignores both extra args.
          proto.setFreq(hz, write, referenceFreq, () => {
            // A mode requested around this tune wins. Otherwise re-assert the
            // mode from before the band change: the caller skips the mode command
            // when the mode is already correct, so letting the band's stored mode
            // win would drop the operator out of it — clicking a 20m CW spot from
            // 40m CW would land in USB.
            if (lastRequestedMode && Date.now() - lastRequestedModeAt < TUNE_WINDOW_MS) {
              return lastRequestedMode;
            }
            return modeBefore;
          });
        }
      }

      function setMode(mode) {
        console.log(`[USB/${radioType}] SET MODE: ${mode}`);
        lastRequestedMode = mode;
        lastRequestedModeAt = Date.now();
        if (radioType === 'icom') {
          proto.setMode(mode, write, getIcomAddress());
        } else {
          proto.setMode(mode, write, modeReferenceFreq());
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
