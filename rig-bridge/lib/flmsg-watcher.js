'use strict';
/**
 * flmsg-watcher.js — watch NBEMS folders for flmsg forms and tell received
 * traffic apart from the operator's own forms.
 *
 * Where forms land (checked against fldigi and flmsg sources):
 *   - WRAP/recv — fldigi writes every WRAP transfer it decodes here as
 *     extract-YYYYMMDD-HHMMSS.wrap, before handing it to flmsg
 *     (fldigi src/logger/rx_extract.cxx invoke_flmsg()). Everything in it was
 *     received over the air.
 *   - ICS/messages — flmsg's default folder for saving any form
 *     (src/flmsg.cxx def_*_filename = ICS_msg_dir). It holds the operator's
 *     drafts and sent forms, and received forms only if the operator chose to
 *     save them. flmsg keeps no "received" flag, but hdr_fm tells: it is
 *     written only when a form is sent (update_header(FROM)), so
 *       empty hdr_fm                     → a draft that was never sent
 *       last hdr_fm call = this station  → this station sent it
 *       last hdr_fm call = someone else  → received, then saved here
 *
 * Every record gets `origin`: 'received', 'local', or 'unknown' — a form
 * that was sent by someone but we do not know this station's callsign, so
 * we cannot say whether it was us. Folders other than these two are
 * classified by the same hdr_fm rule.
 *
 * Files are read as raw bytes (WRAP checksums count bytes), tracked by
 * path + mtime + size, and de-duplicated by the form id from flmsg-format, so a
 * received transfer and the copy the operator saved from it count once. On
 * the first scan, files older than maxAgeMs are remembered but not reported.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { formToFieldReport } = require('./flmsg-format');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_SEEN = 5000;

/** The NBEMS folders for this machine's user: received transfers first. */
function defaultFlmsgDirs(home = os.homedir()) {
  const base = path.join(home, 'NBEMS.files');
  return [path.join(base, 'WRAP', 'recv'), path.join(base, 'ICS', 'messages')];
}

/** 'received' for a receive folder, 'local' for ICS/messages, 'auto' otherwise. */
function folderKind(dir) {
  const d = String(dir).replace(/[\\/]+$/, '');
  if (/(^|[\\/])(WRAP|ARQ)[\\/]recv$/i.test(d)) return 'received';
  if (/(^|[\\/])ICS[\\/]messages$/i.test(d)) return 'local';
  return 'auto';
}

/**
 * Decide where a form came from.
 * @param {object} record     from formToFieldReport (has .senders)
 * @param {string} kind       folderKind() of the file's folder
 * @param {string} stationCall this station's callsign ('' when unknown)
 */
function classifyOrigin(record, kind, stationCall) {
  if (kind === 'received') return 'received';
  const last = record.senders && record.senders.length ? record.senders[record.senders.length - 1] : '';
  if (!last) return 'local'; // never sent → a draft
  const me = String(stationCall || '')
    .toUpperCase()
    .split('-')[0];
  if (me) return last.split('-')[0] === me ? 'local' : 'received';
  // No callsign known: in ICS/messages a sent form may be ours or someone
  // else's — say so rather than guess; in another folder the operator chose,
  // a sender means received.
  return kind === 'local' ? 'unknown' : 'received';
}

/**
 * @param {object} opts
 * @param {string[]} [opts.dirs]          folders (default: defaultFlmsgDirs())
 * @param {number}   [opts.pollMs=15000]
 * @param {number}   [opts.maxAgeMs]      first-scan age cutoff (default 72 h; 0 = none)
 * @param {function} [opts.stationCall]   () => this station's callsign
 * @param {function} [opts.dateOrder]     () => { slash, dash } for ambiguous dates
 * @param {function} opts.onForm          (record, filePath) — record.origin is set
 * @param {function} [opts.onError]       (message) => void
 * @param {object}   [opts.fsImpl]        injectable fs (tests)
 * @param {boolean}  [opts.watch=true]    use fs.watch as well as polling
 */
function createFlmsgWatcher(opts) {
  const fsx = opts.fsImpl || fs;
  const dirs = (opts.dirs && opts.dirs.length ? opts.dirs : defaultFlmsgDirs()).map((d) => path.resolve(d));
  const pollMs = Math.max(1000, opts.pollMs ?? 15000);
  const maxAgeMs = opts.maxAgeMs ?? 72 * 3600 * 1000;
  const onForm = opts.onForm || (() => {});
  const onError = opts.onError || (() => {});
  const stationCall = opts.stationCall || (() => '');
  const dateOrder = opts.dateOrder || (() => ({}));
  const useWatch = opts.watch !== false;

  const fileStamps = new Map(); // path → `${mtimeMs}:${size}`
  const seen = new Map(); // form id → 'received' | 'local' (best origin reported so far)
  const watchers = [];
  let pollTimer = null;
  let debounce = null;
  let firstScanDone = false;
  let running = false;
  let formsFound = 0;
  const byOrigin = { received: 0, local: 0, unknown: 0 };
  let lastScan = null;
  let lastError = null;
  const skipped = { compressed: 0, corrupt: 0, unreadable: 0, notForm: 0 };

  function remember(id, origin) {
    seen.set(id, origin);
    if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
  }

  function processFile(file, st, initial, kind) {
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (fileStamps.get(file) === stamp) return;
    fileStamps.set(file, stamp);
    if (st.size > MAX_FILE_BYTES || st.size === 0) return;

    let bytes;
    try {
      bytes = fsx.readFileSync(file);
    } catch (e) {
      skipped.unreadable++;
      return;
    }
    const record = formToFieldReport(bytes, { file, mtimeMs: st.mtimeMs, dateOrder: dateOrder() });
    if (!record) {
      skipped.notForm++;
      return;
    }
    if (record.error) {
      const name = path.basename(file);
      if (record.error === 'lzma-unavailable') {
        skipped.compressed++;
        lastError = `${name} is compressed and the LZMA decoder is missing — run "npm install" in the rig-bridge folder`;
      } else if (record.error === 'unsupported-encoding') {
        skipped.compressed++;
        lastError = `${name} uses a base128/base256 armour, which flmsg itself does not write for forms`;
      } else {
        skipped.corrupt++;
        lastError = `${name}: compressed transfer could not be decoded (damaged on the air?)`;
      }
      onError(lastError);
      return;
    }
    const origin = classifyOrigin(record, kind, stationCall());
    const prev = seen.get(record.id);
    // Already reported as received / unknown (both forwarded), or with the
    // same origin → nothing new.
    if (prev === 'received' || prev === 'unknown' || prev === origin) return;
    remember(record.id, origin);
    if (initial && maxAgeMs > 0 && Date.now() - st.mtimeMs > maxAgeMs) return; // old traffic
    formsFound++;
    byOrigin[origin]++;
    onForm({ ...record, origin }, file);
  }

  /** Scan every folder once. Returns the number of forms reported. */
  function scan() {
    const before = formsFound;
    const initial = !firstScanDone;
    lastScan = Date.now();
    for (const dir of dirs) {
      const kind = folderKind(dir);
      let names;
      try {
        names = fsx.readdirSync(dir);
      } catch (e) {
        continue; // folder absent (flmsg not installed / not used yet)
      }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const file = path.join(dir, name);
        let st;
        try {
          st = fsx.statSync(file);
        } catch (e) {
          continue;
        }
        if (!st.isFile()) continue;
        try {
          processFile(file, st, initial, kind);
        } catch (e) {
          lastError = `${name}: ${e.message}`;
          onError(lastError);
        }
      }
    }
    firstScanDone = true;
    return formsFound - before;
  }

  function start() {
    if (running) return;
    running = true;
    scan();
    if (useWatch) {
      for (const dir of dirs) {
        try {
          const w = fsx.watch(dir, () => {
            clearTimeout(debounce);
            debounce = setTimeout(scan, 750);
          });
          w.on('error', () => {
            try {
              w.close();
            } catch (e) {}
          });
          watchers.push(w);
        } catch (e) {
          // folder missing or watch unsupported — polling covers it
        }
      }
    }
    pollTimer = setInterval(scan, pollMs);
  }

  function stop() {
    running = false;
    clearInterval(pollTimer);
    pollTimer = null;
    clearTimeout(debounce);
    debounce = null;
    for (const w of watchers.splice(0)) {
      try {
        w.close();
      } catch (e) {}
    }
  }

  function exists(d) {
    try {
      return fsx.statSync(d).isDirectory();
    } catch (e) {
      return false;
    }
  }

  function getStatus() {
    return {
      running,
      dirs: dirs.map((d) => ({ path: d, kind: folderKind(d), exists: exists(d) })),
      watching: watchers.length,
      pollIntervalSec: pollMs / 1000,
      filesTracked: fileStamps.size,
      formsFound,
      byOrigin: { ...byOrigin },
      skipped: { ...skipped },
      lastScan,
      lastError,
    };
  }

  return { start, stop, scan, getStatus };
}

module.exports = { createFlmsgWatcher, defaultFlmsgDirs, folderKind, classifyOrigin };
