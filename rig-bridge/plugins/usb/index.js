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

      function getIcomAddress() {
        const addr = config.radio.icomAddress || '0x94';
        return parseInt(addr, 16);
      }

      function write(data) {
        if (!serialPort || !serialPort.isOpen) return false;
        serialPort.write(data);
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

      function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => {
          if (!serialPort || !serialPort.isOpen) return;
          if (radioType === 'icom') {
            proto.poll(write, getIcomAddress());
          } else {
            proto.poll(write);
          }
        }, config.radio.pollInterval || 500);
      }

      function processAsciiBuffer() {
        let idx;
        while ((idx = rxBuffer.indexOf(';')) !== -1) {
          const response = rxBuffer.substring(0, idx);
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

        console.log(`[USB/${radioType}] Opening ${config.radio.serialPort} at ${config.radio.baudRate} baud...`);

        serialPort = new SP({
          path: config.radio.serialPort,
          baudRate: config.radio.baudRate,
          dataBits: config.radio.dataBits || 8,
          stopBits: config.radio.stopBits || 2,
          parity: config.radio.parity || 'none',
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
          console.log(`[USB/${radioType}] Port opened successfully`);
          updateState('connected', true);
          startPolling();
        });

        serialPort.on('data', (data) => {
          if (radioType === 'icom') {
            rxBinaryBuffer = proto.handleData(data, rxBinaryBuffer, loggedUpdateState, (prop) => state[prop]);
          } else {
            rxBuffer += data.toString('ascii');
            processAsciiBuffer();
          }
        });

        serialPort.on('error', (err) => {
          console.error(`[USB/${radioType}] Error: ${err.message}`);
        });

        serialPort.on('close', () => {
          console.log(`[USB/${radioType}] Port closed — retrying in 5 s…`);
          updateState('connected', false);
          stopPolling();
          serialPort = null;
          reconnectTimer = setTimeout(connect, 5000);
        });
      }

      function disconnect() {
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
