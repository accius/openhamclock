'use strict';
/**
 * Minimal KMZ (zip) reader — enough to pull the KML document out of the
 * NHC / JTWC forecast-track archives without a zip dependency.
 *
 * Supports the two methods those producers use: 0 (stored) and 8 (deflate),
 * via Node's built-in zlib. Walks the central directory (not the local
 * headers) so data-descriptor entries with zero sizes in the local header
 * still resolve.
 */
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** List zip entries: [{ name, method, compressedSize, size, offset }]. */
function listZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not a zip archive');
  // EOCD is in the last 22 bytes + up to 65535 bytes of comment
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Raw bytes of one entry (Buffer). */
function readZipEntry(buf, entry) {
  const p = entry.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== SIG_LOCAL) throw new Error('bad zip local header');
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip method ${entry.method}`);
}

/**
 * Extract the (first) .kml document from a KMZ buffer as a UTF-8 string.
 * A plain KML buffer (not zipped) is returned as-is, so callers can feed
 * either form.
 */
function extractKml(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('extractKml expects a Buffer');
  // Zip magic "PK\x03\x04"; anything else is treated as raw KML/XML
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return buf.toString('utf8');
  const entries = listZipEntries(buf);
  const kml = entries.find((e) => /\.kml$/i.test(e.name)) || entries.find((e) => e.name === 'doc.kml');
  if (!kml) throw new Error('no .kml entry in KMZ');
  return readZipEntry(buf, kml).toString('utf8');
}

module.exports = { listZipEntries, readZipEntry, extractKml };
