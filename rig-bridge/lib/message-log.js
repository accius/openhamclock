'use strict';
/**
 * message-log.js — JSON Lines message logger for APRS and Winlink messages
 *
 * Stores messages as one JSON object per line (.jsonl format) for simplicity,
 * no dependencies, and easy grep/export. Supports:
 *   - Append messages with timestamp and type
 *   - Query by callsign, time range, type
 *   - Export as CSV or plain text
 *   - Auto-pruning based on configurable retention
 *
 * Storage: ~/.config/openhamclock/messages.jsonl (same dir as config)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class MessageLog {
  constructor(options = {}) {
    const baseDir =
      process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'openhamclock')
        : path.join(os.homedir(), '.config', 'openhamclock');

    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch (e) {}
    }

    this.filePath = options.filePath || path.join(baseDir, 'messages.jsonl');
    this.maxAgeDays = options.maxAgeDays || 7;
    this.maxEntries = options.maxEntries || 10000;
    this._pruneTimer = null;

    // Prune on startup and every hour
    this.prune();
    this._pruneTimer = setInterval(() => this.prune(), 3600000);
  }

  /**
   * Append a message to the log.
   * @param {object} msg - Must include { type, from, to, content }
   */
  append(msg) {
    const entry = {
      ...msg,
      timestamp: msg.timestamp || Date.now(),
      iso: msg.iso || new Date().toISOString(),
    };
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error(`[MessageLog] Write error: ${e.message}`);
    }
  }

  /**
   * Read all entries (with optional filters).
   */
  query({ callsign, type, since, until, limit } = {}) {
    let entries = this._readAll();

    if (callsign) {
      const upper = callsign.toUpperCase();
      entries = entries.filter(
        (e) => (e.from || '').toUpperCase().includes(upper) || (e.to || '').toUpperCase().includes(upper),
      );
    }
    if (type) {
      entries = entries.filter((e) => e.type === type);
    }
    if (since) {
      const sinceMs = typeof since === 'number' ? since : new Date(since).getTime();
      entries = entries.filter((e) => e.timestamp >= sinceMs);
    }
    if (until) {
      const untilMs = typeof until === 'number' ? until : new Date(until).getTime();
      entries = entries.filter((e) => e.timestamp <= untilMs);
    }
    if (limit) {
      entries = entries.slice(-limit);
    }

    return entries;
  }

  /**
   * Export messages as CSV.
   */
  exportCSV(filters) {
    const entries = this.query(filters);
    const header = 'timestamp,type,from,to,content\n';
    const rows = entries
      .map((e) => {
        const content = (e.content || '').replace(/"/g, '""');
        return `${e.iso || new Date(e.timestamp).toISOString()},${e.type || ''},${e.from || ''},${e.to || ''},"${content}"`;
      })
      .join('\n');
    return header + rows;
  }

  /**
   * Export messages as plain text (ICS-213 style for EmComm).
   */
  exportText(filters) {
    const entries = this.query(filters);
    return entries
      .map((e) => {
        const time = e.iso || new Date(e.timestamp).toISOString();
        return `[${time}] ${e.type || '?'} | ${e.from || '?'} → ${e.to || '?'} | ${e.content || ''}`;
      })
      .join('\n');
  }

  /**
   * Get statistics.
   */
  stats() {
    const entries = this._readAll();
    const types = {};
    for (const e of entries) {
      types[e.type || 'unknown'] = (types[e.type || 'unknown'] || 0) + 1;
    }
    return {
      total: entries.length,
      types,
      oldestTimestamp: entries.length > 0 ? entries[0].timestamp : null,
      newestTimestamp: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
      filePath: this.filePath,
      fileSizeBytes: fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0,
    };
  }

  /**
   * Remove entries older than maxAgeDays or if total exceeds maxEntries.
   */
  prune() {
    if (!fs.existsSync(this.filePath)) return;

    let entries = this._readAll();
    const before = entries.length;

    // Age-based pruning
    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000;
    entries = entries.filter((e) => e.timestamp >= cutoff);

    // Count-based pruning (keep newest)
    if (entries.length > this.maxEntries) {
      entries = entries.slice(-this.maxEntries);
    }

    if (entries.length < before) {
      try {
        fs.writeFileSync(
          this.filePath,
          entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''),
        );
        console.log(`[MessageLog] Pruned ${before - entries.length} entries (${entries.length} remaining)`);
      } catch (e) {
        console.error(`[MessageLog] Prune error: ${e.message}`);
      }
    }
  }

  /**
   * Read all entries from the log file.
   */
  _readAll() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
      return lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  /**
   * Clean up timer on shutdown.
   */
  destroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
  }
}

module.exports = { MessageLog };
