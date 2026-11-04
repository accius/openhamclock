'use strict';
/**
 * ibp-schedule.js — NCDXF/IARU International Beacon Project schedule (CommonJS)
 *
 * Mirror of the browser module src/utils/ibp.js for the Rig Bridge (which is
 * plain CommonJS and cannot import the ESM frontend code). The table and the
 * slot arithmetic MUST stay identical — rig-bridge/lib/ibp-schedule.test.js
 * imports both modules and asserts parity so they cannot drift.
 *
 * 18 beacons × 5 bands, 10-second slots in a 3-minute (180 s) cycle aligned
 * to UTC midnight. Reference: https://www.ncdxf.org/beacon/beaconschedule.html
 */

const IBP_BEACONS = [
  { callsign: '4U1UN', location: 'United Nations, NY', grid: 'FN30as', lat: 40.749, lon: -73.968 },
  { callsign: 'VE8AT', location: 'Inuvik, Canada', grid: 'CP38gh', lat: 68.317, lon: -133.533 },
  { callsign: 'W6WX', location: 'Mt. Umunhum, CA', grid: 'CM97bn', lat: 37.159, lon: -121.929 },
  { callsign: 'KH6RS', location: 'Hawaii, US', grid: 'BL11bm', lat: 21.441, lon: -157.763 },
  { callsign: 'ZL6B', location: 'Masterton, New Zealand', grid: 'RF70mc', lat: -40.683, lon: 175.567 },
  { callsign: 'VK6RBP', location: 'Bickley, Australia', grid: 'OF87av', lat: -31.802, lon: 116.126 },
  { callsign: 'JA2IGY', location: 'Mt. Asama, Japan', grid: 'PM84jk', lat: 34.634, lon: 136.873 },
  { callsign: 'RR9O', location: 'Novosibirsk, Russia', grid: 'NO14kx', lat: 54.853, lon: 83.125 },
  { callsign: 'VR2B', location: 'Hong Kong', grid: 'OL72bg', lat: 22.255, lon: 114.137 },
  { callsign: '4S7B', location: 'Colombo, Sri Lanka', grid: 'MJ96wh', lat: 6.816, lon: 79.924 },
  { callsign: 'ZS6DN', location: 'Pretoria, South Africa', grid: 'KG44dc', lat: -25.683, lon: 28.183 },
  { callsign: '5Z4B', location: 'Nairobi, Kenya', grid: 'KI88er', lat: -1.267, lon: 36.8 },
  { callsign: '4X6TU', location: 'Tel Aviv, Israel', grid: 'KM72jb', lat: 32.04, lon: 34.78 },
  { callsign: 'OH2B', location: 'Lohja, Finland', grid: 'KP20eh', lat: 60.167, lon: 24.667 },
  { callsign: 'CS3B', location: 'Madeira, Portugal', grid: 'IM12or', lat: 32.7, lon: -16.883 },
  { callsign: 'LU4AA', location: 'Buenos Aires, Argentina', grid: 'GF05rj', lat: -34.617, lon: -58.367 },
  { callsign: 'OA4B', location: 'Lima, Peru', grid: 'FH17mw', lat: -12.043, lon: -77.017 },
  { callsign: 'YV5B', location: 'Caracas, Venezuela', grid: 'FK60ab', lat: 10.483, lon: -66.983 },
];

const IBP_BANDS = [
  { mhz: 14.1, label: '20m', offset: 0 },
  { mhz: 18.11, label: '17m', offset: 17 },
  { mhz: 21.15, label: '15m', offset: 16 },
  { mhz: 24.93, label: '12m', offset: 15 },
  { mhz: 28.2, label: '10m', offset: 14 },
];

const CYCLE_SECONDS = 180;
const SLOT_SECONDS = 10;
const SLOT_MS = SLOT_SECONDS * 1000;
const CYCLE_MS = CYCLE_SECONDS * 1000;

/** Seconds since UTC midnight for a Unix-ms timestamp. */
function utcSecondsOfDay(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

/** 0–17: slot within the 3-minute cycle at time `ms`. */
function slotAt(ms = Date.now()) {
  return Math.floor((utcSecondsOfDay(ms) % CYCLE_SECONDS) / SLOT_SECONDS);
}

/** Unix-ms start of the 10-second slot containing `ms`. */
function slotStartMs(ms = Date.now()) {
  return Math.floor(ms / SLOT_MS) * SLOT_MS;
}

/** Unix-ms start of the 3-minute cycle containing `ms` (cycles align to UTC midnight). */
function cycleStartMs(ms = Date.now()) {
  const d = new Date(ms);
  return ms - (utcSecondsOfDay(ms) % CYCLE_SECONDS) * 1000 - d.getUTCMilliseconds();
}

/** The beacon transmitting on `band` (an IBP_BANDS entry or label) during `slot`. */
function beaconFor(slot, band) {
  const b = typeof band === 'string' ? IBP_BANDS.find((x) => x.label === band) : band;
  if (!b) return null;
  return IBP_BEACONS[(slot + b.offset) % IBP_BEACONS.length];
}

/** Find a band definition by label ('20m') or MHz (14.1). */
function findBand(key) {
  if (key == null) return null;
  if (typeof key === 'object') return IBP_BANDS.find((b) => b.label === key.label) || null; // already resolved
  if (typeof key === 'number') return IBP_BANDS.find((b) => Math.abs(b.mhz - key) < 0.01) || null;
  const s = String(key).trim().toLowerCase();
  return IBP_BANDS.find((b) => b.label === s) || IBP_BANDS.find((b) => String(b.mhz) === s) || null;
}

module.exports = {
  IBP_BEACONS,
  IBP_BANDS,
  CYCLE_SECONDS,
  SLOT_SECONDS,
  SLOT_MS,
  CYCLE_MS,
  slotAt,
  slotStartMs,
  cycleStartMs,
  beaconFor,
  findBand,
};
