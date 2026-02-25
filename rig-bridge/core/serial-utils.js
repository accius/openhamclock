'use strict';
/**
 * serial-utils.js — Shared serial port helpers
 */

// Lazy-load serialport (may not be available in all envs)
let SerialPort = null;

function getSerialPort() {
  if (!SerialPort) {
    try {
      SerialPort = require('serialport').SerialPort;
    } catch (e) {
      console.error('[Serial] serialport module not available:', e.message);
    }
  }
  return SerialPort;
}

async function listPorts() {
  try {
    const { SerialPort: SP } = require('serialport');
    let ports = await SP.list();

    if (process.platform === 'darwin') {
      // @serialport/bindings-cpp only enumerates /dev/tty.* via IOKit on macOS —
      // the /dev/cu.* (call-out) counterparts are never returned by the library.
      // tty.* = dial-in, blocks open() until carrier-detect; cu.* = call-out,
      // opens immediately and is correct for outgoing CAT / CI-V connections.
      // Synthesize cu.* paths from USB-serial tty.* entries (identified by vendorId),
      // then drop all remaining tty.* so only cu.* appears in the dropdown.
      ports = ports
        .map((p) =>
          p.path.startsWith('/dev/tty.') && p.vendorId ? { ...p, path: p.path.replace('/dev/tty.', '/dev/cu.') } : p,
        )
        .filter((p) => !p.path.startsWith('/dev/tty.'));
    }

    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      friendlyName: p.friendlyName || p.path,
    }));
  } catch (e) {
    console.error('[Serial] Cannot list ports:', e.message);
    return [];
  }
}

module.exports = { getSerialPort, listPorts };
