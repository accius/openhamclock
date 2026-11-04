'use strict';
/**
 * nmea.js — NMEA 0183 sentence parser for GPS receivers.
 *
 * Handles the two sentences every receiver emits:
 *   RMC — recommended minimum: fix validity, lat/lon, speed, course, UTC date+time
 *   GGA — fix data: lat/lon, fix quality, satellites used, HDOP, altitude
 * plus GSA (fix mode 2D/3D) which is useful but optional.
 *
 * Any talker ID is accepted (GP = GPS, GN = multi-GNSS, GL = GLONASS,
 * GA = Galileo, BD/GB = BeiDou). Sentences with a bad checksum are rejected;
 * sentences without a checksum are accepted (some loggers strip them).
 *
 * `NmeaFix` merges the sentence stream into one fix object:
 *   { fix, lat, lon, alt, speed (km/h), course, time (ISO), sats, hdop,
 *     quality, mode, updatedAt }
 */

const { latLonToGrid } = require('./maidenhead');

const KNOTS_TO_KMH = 1.852;

/** XOR checksum of the characters between '$' and '*'. */
function computeChecksum(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  return sum;
}

/**
 * Split a raw line into { talker, type, fields } after validating the
 * checksum. Returns null for anything that isn't a well-formed sentence.
 */
function splitSentence(line) {
  if (typeof line !== 'string') return null;
  const s = line.trim();
  if (!s.startsWith('$') || s.length < 7) return null;
  const star = s.indexOf('*');
  const body = star >= 0 ? s.slice(1, star) : s.slice(1);
  if (star >= 0) {
    const hex = s.slice(star + 1, star + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
    if (parseInt(hex, 16) !== computeChecksum(body)) return null;
  }
  const fields = body.split(',');
  const header = fields[0];
  if (!/^[A-Z]{2}[A-Z]{3}$/.test(header)) return null;
  return { talker: header.slice(0, 2), type: header.slice(2), fields };
}

/** ddmm.mmmm / dddmm.mmmm + hemisphere → signed decimal degrees (or null). */
function parseCoordinate(value, hemi) {
  if (!value) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const deg = Math.floor(n / 100);
  const min = n - deg * 100;
  let dd = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') dd = -dd;
  return dd;
}

/** hhmmss(.sss) [+ ddmmyy] → Date in UTC; without a date, today's UTC date is used. */
function parseUtcTime(hms, dmy) {
  if (!hms || !/^\d{6}(\.\d+)?$/.test(hms)) return null;
  const hh = parseInt(hms.slice(0, 2), 10);
  const mm = parseInt(hms.slice(2, 4), 10);
  const ss = parseFloat(hms.slice(4));
  if (hh > 23 || mm > 59 || ss >= 61) return null;
  let year, month, day;
  if (dmy && /^\d{6}$/.test(dmy)) {
    day = parseInt(dmy.slice(0, 2), 10);
    month = parseInt(dmy.slice(2, 4), 10) - 1;
    const yy = parseInt(dmy.slice(4, 6), 10);
    year = yy < 80 ? 2000 + yy : 1900 + yy; // 80..99 → 1980..1999 (GPS epoch era)
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth();
    day = now.getUTCDate();
  }
  const ms = Math.round((ss % 1) * 1000);
  const d = new Date(Date.UTC(year, month, day, hh, mm, Math.floor(ss), ms));
  return Number.isNaN(d.getTime()) ? null : d;
}

const num = (v) => {
  if (v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function parseRMC(f) {
  // $--RMC,time,status,lat,N/S,lon,E/W,speed_kn,course,date,magvar,E/W[,mode]
  const valid = f[2] === 'A';
  const speedKn = num(f[7]);
  return {
    type: 'RMC',
    valid,
    time: parseUtcTime(f[1], f[9]),
    lat: parseCoordinate(f[3], f[4]),
    lon: parseCoordinate(f[5], f[6]),
    speedKn,
    speedKmh: speedKn == null ? null : speedKn * KNOTS_TO_KMH,
    course: num(f[8]),
    mode: f[12] || null,
  };
}

function parseGGA(f) {
  // $--GGA,time,lat,N/S,lon,E/W,quality,sats,hdop,alt,M,geoid,M,dgps_age,dgps_id
  const quality = f[6] === '' || f[6] === undefined ? null : parseInt(f[6], 10);
  return {
    type: 'GGA',
    time: parseUtcTime(f[1]),
    lat: parseCoordinate(f[2], f[3]),
    lon: parseCoordinate(f[4], f[5]),
    quality,
    valid: Number.isFinite(quality) && quality > 0,
    sats: f[7] === '' || f[7] === undefined ? null : parseInt(f[7], 10),
    hdop: num(f[8]),
    alt: num(f[9]),
    geoidSep: num(f[11]),
  };
}

function parseGSA(f) {
  // $--GSA,mode(M/A),fixmode(1/2/3),sv*12,pdop,hdop,vdop
  const fixMode = parseInt(f[2], 10);
  return {
    type: 'GSA',
    fixMode: Number.isFinite(fixMode) ? fixMode : null, // 1 = none, 2 = 2D, 3 = 3D
    pdop: num(f[15]),
    hdop: num(f[16]),
    vdop: num(f[17]),
  };
}

/**
 * Parse one NMEA line. Returns a typed object for RMC / GGA / GSA, or null
 * for other sentence types, malformed lines, or checksum failures.
 */
function parseSentence(line) {
  const s = splitSentence(line);
  if (!s) return null;
  let out = null;
  if (s.type === 'RMC') out = parseRMC(s.fields);
  else if (s.type === 'GGA') out = parseGGA(s.fields);
  else if (s.type === 'GSA') out = parseGSA(s.fields);
  if (out) out.talker = s.talker;
  return out;
}

/**
 * Line accumulator — feed arbitrary chunks (serial data arrives split at
 * random points), get complete lines back.
 */
class LineSplitter {
  constructor(maxLine = 512) {
    this._buf = '';
    this._max = maxLine;
  }
  /** @returns {string[]} complete lines (without terminators) */
  push(chunk) {
    this._buf += typeof chunk === 'string' ? chunk : chunk.toString('ascii');
    const lines = [];
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      lines.push(this._buf.slice(0, idx).replace(/\r$/, ''));
      this._buf = this._buf.slice(idx + 1);
    }
    if (this._buf.length > this._max) this._buf = this._buf.slice(-this._max); // runaway guard
    return lines;
  }
}

/**
 * Merges RMC / GGA / GSA sentences into a single current-fix object.
 */
class NmeaFix {
  constructor() {
    this.fix = {
      fix: false,
      lat: null,
      lon: null,
      alt: null,
      speed: null, // km/h
      course: null, // degrees true
      time: null, // ISO string (UTC from the receiver)
      sats: null,
      hdop: null,
      quality: null,
      mode: null, // 2 = 2D, 3 = 3D
      grid6: null,
      updatedAt: 0,
    };
  }

  /**
   * @param {string} line raw NMEA line
   * @param {number} [now=Date.now()]
   * @returns {object|null} the updated fix when the line changed it, else null
   */
  update(line, now = Date.now()) {
    const s = parseSentence(line);
    if (!s) return null;
    const f = this.fix;
    if (s.type === 'RMC') {
      f.fix = s.valid;
      if (s.valid) {
        if (s.lat != null) f.lat = s.lat;
        if (s.lon != null) f.lon = s.lon;
        if (s.speedKmh != null) f.speed = s.speedKmh;
        if (s.course != null) f.course = s.course;
      }
      if (s.time) f.time = s.time.toISOString();
    } else if (s.type === 'GGA') {
      if (s.quality != null) f.quality = s.quality;
      if (s.sats != null) f.sats = s.sats;
      if (s.hdop != null) f.hdop = s.hdop;
      if (s.valid) {
        if (s.lat != null) f.lat = s.lat;
        if (s.lon != null) f.lon = s.lon;
        if (s.alt != null) f.alt = s.alt;
        f.fix = true;
      } else if (s.quality === 0) {
        f.fix = false;
      }
    } else if (s.type === 'GSA') {
      if (s.fixMode != null) f.mode = s.fixMode === 1 ? null : s.fixMode;
      if (s.hdop != null) f.hdop = s.hdop;
    }
    f.grid6 = f.fix && f.lat != null && f.lon != null ? latLonToGrid(f.lat, f.lon, 6) : null;
    f.updatedAt = now;
    return { ...f };
  }
}

module.exports = {
  KNOTS_TO_KMH,
  computeChecksum,
  splitSentence,
  parseCoordinate,
  parseUtcTime,
  parseSentence,
  LineSplitter,
  NmeaFix,
};
