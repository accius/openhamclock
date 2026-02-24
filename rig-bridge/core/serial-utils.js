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
    const ports = await SP.list();
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
