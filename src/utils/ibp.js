/**
 * IBP (International Beacon Project) Schedule Utilities
 *
 * The NCDXF/IARU International Beacon Project operates 18 HF beacons on
 * 5 frequencies: 14.100, 18.110, 21.150, 24.930 and 28.200 MHz.
 *
 * The schedule is fully deterministic — no network access required.
 * Each beacon transmits for 10 seconds in a fixed 3-minute (180 s) cycle.
 * Five bands run in parallel, offset from each other by 3 beacon slots.
 *
 * Reference: https://www.ncdxf.org/beacon/beaconschedule.html
 */

/**
 * The 18 IBP beacons in transmission order.
 * Coordinates are WGS-84 (lat/lon in decimal degrees).
 */
export const IBP_BEACONS = [
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

/**
 * The 5 IBP frequencies in MHz, with schedule offsets.
 *
 * Each beacon enters the cycle on 14.100 MHz, then steps UP one band every
 * 10 s: 14.100 → 18.110 → 21.150 → 24.930 → 28.200.  At a given slot s
 * the beacon on band N started N slots earlier, so its offset is (−N mod 18):
 *   20m: −0 mod 18 = 0
 *   17m: −1 mod 18 = 17
 *   15m: −2 mod 18 = 16
 *   12m: −3 mod 18 = 15
 *   10m: −4 mod 18 = 14
 */
export const IBP_BANDS = [
  { mhz: 14.1, label: '20m', offset: 0 },
  { mhz: 18.11, label: '17m', offset: 17 },
  { mhz: 21.15, label: '15m', offset: 16 },
  { mhz: 24.93, label: '12m', offset: 15 },
  { mhz: 28.2, label: '10m', offset: 14 },
];

/** Full cycle duration in seconds (18 beacons × 10 s). */
export const CYCLE_SECONDS = 180;

/** Each beacon's transmission window in seconds. */
export const SLOT_SECONDS = 10;

/**
 * Return the current 10-second slot (0–17) for a given Date.
 * The cycle aligns to UTC midnight; every 3-minute boundary starts slot 0.
 */
export const getCurrentSlot = (date = new Date()) => {
  const utcSeconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  return Math.floor((utcSeconds % CYCLE_SECONDS) / SLOT_SECONDS);
};

/**
 * Seconds remaining in the current 10-second slot.
 */
export const getSecondsRemainingInSlot = (date = new Date()) => {
  const utcSeconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  return SLOT_SECONDS - (utcSeconds % SLOT_SECONDS);
};

/**
 * Seconds remaining in the current 3-minute cycle.
 */
export const getSecondsRemainingInCycle = (date = new Date()) => {
  const utcSeconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  return CYCLE_SECONDS - (utcSeconds % CYCLE_SECONDS);
};

/**
 * Return the active beacon on each band for the given Date.
 *
 * @param {Date} date
 * @param {number|null} deLat  - operator latitude  (null/undefined = skip bearing/distance)
 * @param {number|null} deLon  - operator longitude
 * @returns {Array<{ band, beacon, bearing, distanceKm }>}
 */
export const getSchedule = (date = new Date(), deLat = null, deLon = null) => {
  const slot = getCurrentSlot(date);
  const includeGeo = deLat != null && deLon != null;

  return IBP_BANDS.map((band) => {
    const beaconIndex = (slot + band.offset) % IBP_BEACONS.length;
    const beacon = IBP_BEACONS[beaconIndex];

    let bearing = null;
    let distanceKm = null;
    if (includeGeo) {
      // Inline haversine — avoids a circular dep on geo.js for the utility module.
      const toRad = (d) => (d * Math.PI) / 180;
      const φ1 = toRad(deLat);
      const φ2 = toRad(beacon.lat);
      const Δφ = toRad(beacon.lat - deLat);
      const Δλ = toRad(beacon.lon - deLon);

      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      const y = Math.sin(toRad(beacon.lon - deLon)) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(toRad(beacon.lon - deLon));
      bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    return { band, beacon, beaconIndex, bearing, distanceKm };
  });
};

/**
 * Return the full upcoming schedule for the next `numCycles` 3-minute cycles.
 * Useful for rendering a timeline.
 * TODO: consumed by Phase 4 (listening log timeline) — not yet used in this PR.
 *
 * @param {Date}   date
 * @param {number} numCycles
 * @returns {Array<{ startDate, slot, bands }>}  one entry per 10-second slot
 */
export const getUpcomingSchedule = (date = new Date(), numCycles = 2) => {
  const utcMs = date.getTime();
  const utcSeconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  const cycleStart = utcMs - (utcSeconds % CYCLE_SECONDS) * 1000;

  const slots = [];
  const totalSlots = (numCycles * CYCLE_SECONDS) / SLOT_SECONDS;
  for (let i = 0; i < totalSlots; i++) {
    const slotMs = cycleStart + i * SLOT_SECONDS * 1000;
    const slotDate = new Date(slotMs);
    const slot =
      (i + (IBP_BEACONS.length - Math.floor(((utcMs - cycleStart) / 1000 / SLOT_SECONDS) % IBP_BEACONS.length))) %
      IBP_BEACONS.length;
    slots.push({
      startDate: slotDate,
      slot,
      bands: IBP_BANDS.map((band) => ({
        band,
        beacon: IBP_BEACONS[(slot + band.offset) % IBP_BEACONS.length],
      })),
    });
  }
  return slots;
};
