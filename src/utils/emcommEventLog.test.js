/**
 * Tests for emcommEventLog — accumulate, cap, dedupe, CSV escaping, diffing,
 * and print export.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STORAGE_KEY,
  MAX_EVENTS,
  recordEvent,
  getEvents,
  clearEvents,
  subscribeEvents,
  csvEscape,
  eventsToCSV,
  diffAdded,
  buildPrintHtml,
  _resetForTests,
} from './emcommEventLog.js';

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
});

describe('recordEvent / getEvents', () => {
  it('accumulates events with timestamps and persists to localStorage', () => {
    const ev = recordEvent('net_checkin', { callsign: 'K0CJH', summary: 'Checked into TESTNET' });
    expect(ev).toBeTruthy();
    expect(ev.ts).toBeGreaterThan(0);

    const events = getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('net_checkin');
    expect(events[0].callsign).toBe('K0CJH');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].summary).toBe('Checked into TESTNET');
  });

  it('honors a ts override', () => {
    const ev = recordEvent('nws_alert', { summary: 'Tornado Warning', ts: 1234567890 });
    expect(ev.ts).toBe(1234567890);
  });

  it('reloads persisted events across module resets', () => {
    recordEvent('shelter_report', { callsign: 'W1AW', summary: 'Shelter open' });
    _resetForTests();
    expect(getEvents()).toHaveLength(1);
    expect(getEvents()[0].callsign).toBe('W1AW');
  });

  it('caps the log at MAX_EVENTS, dropping oldest first', () => {
    // Pre-seed just below the cap to keep the test fast
    const seed = [];
    for (let i = 0; i < MAX_EVENTS - 5; i++) {
      seed.push({ id: `seed-${i}`, ts: i, type: 'nws_alert', callsign: '', summary: `s${i}`, details: '' });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    _resetForTests();

    for (let i = 0; i < 10; i++) {
      recordEvent('station_heard', { callsign: `N${i}XX`, summary: 'heard' });
    }
    const events = getEvents();
    expect(events).toHaveLength(MAX_EVENTS);
    // The 5 oldest seeds were dropped
    expect(events[0].summary).toBe('s5');
    expect(events[events.length - 1].callsign).toBe('N9XX');
  });

  it('skips duplicate events with the same type + dedupeKey', () => {
    const first = recordEvent('nws_alert', { summary: 'Flood Watch', dedupeKey: 'alert-1' });
    const dup = recordEvent('nws_alert', { summary: 'Flood Watch', dedupeKey: 'alert-1' });
    expect(first).toBeTruthy();
    expect(dup).toBeNull();
    expect(getEvents()).toHaveLength(1);

    // Same key under a different type is a different event
    expect(recordEvent('station_heard', { dedupeKey: 'alert-1' })).toBeTruthy();
    expect(getEvents()).toHaveLength(2);
  });

  it('dedupe survives a reload from localStorage', () => {
    recordEvent('field_report', { callsign: 'KD0AAA', summary: 'FSR', dedupeKey: 'hash-abc' });
    _resetForTests();
    expect(recordEvent('field_report', { callsign: 'KD0AAA', summary: 'FSR', dedupeKey: 'hash-abc' })).toBeNull();
    expect(getEvents()).toHaveLength(1);
  });
});

describe('clearEvents / subscribeEvents', () => {
  it('clears the log and notifies subscribers', () => {
    recordEvent('net_checkin', { callsign: 'K0CJH', summary: 'in' });
    const listener = vi.fn();
    const unsub = subscribeEvents(listener);

    clearEvents();
    expect(getEvents()).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual([]);

    // Clearing also resets dedupe — the same key can be recorded again
    expect(recordEvent('nws_alert', { dedupeKey: 'k' })).toBeTruthy();
    clearEvents();
    expect(recordEvent('nws_alert', { dedupeKey: 'k' })).toBeTruthy();

    unsub();
    listener.mockClear();
    recordEvent('nws_alert', { summary: 'after unsub' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers on record', () => {
    const listener = vi.fn();
    subscribeEvents(listener);
    recordEvent('aprs_msg_sent', { callsign: 'K0CJH', summary: 'msg' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('csvEscape / eventsToCSV', () => {
  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('serializes events with header and escaped fields', () => {
    const events = [
      { ts: 0, type: 'net_checkin', callsign: 'K0CJH', summary: 'Checked into TEST, NET', details: 'said "ok"' },
      { ts: 60000, type: 'custom_type', callsign: '', summary: 'plain', details: '' },
    ];
    const csv = eventsToCSV(events);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Time (UTC),Type,Callsign,Summary,Details');
    expect(lines[1]).toBe('1970-01-01T00:00:00.000Z,Net Check-In,K0CJH,"Checked into TEST, NET","said ""ok"""');
    // Unknown types fall back to the raw type string
    expect(lines[2]).toContain('custom_type');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('diffAdded', () => {
  it('reports nothing added on the first (baseline) snapshot', () => {
    const { added, removed, keys } = diffAdded(null, [{ id: 'a' }, { id: 'b' }], (x) => x.id);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
    expect([...keys].sort()).toEqual(['a', 'b']);
  });

  it('reports added and removed items versus the previous key set', () => {
    const prev = new Set(['a', 'b']);
    const { added, removed, keys } = diffAdded(prev, [{ id: 'b' }, { id: 'c' }], (x) => x.id);
    expect(added).toEqual([{ id: 'c' }]);
    expect(removed).toEqual(['a']);
    expect(keys.has('b')).toBe(true);
  });

  it('treats an empty (non-null) baseline as "everything is new" — the re-seed after Clear (#1181)', () => {
    const { added, removed, keys } = diffAdded(new Set(), [{ id: 'a' }, { id: 'b' }], (x) => x.id);
    expect(added.map((x) => x.id)).toEqual(['a', 'b']);
    expect(removed).toEqual([]);
    expect([...keys]).toEqual(['a', 'b']);
  });

  it('ignores items whose key is null', () => {
    const { added, keys } = diffAdded(new Set(), [{ id: null }, { id: 'x' }], (x) => x.id);
    expect(added).toEqual([{ id: 'x' }]);
    expect(keys.size).toBe(1);
  });
});

describe('buildPrintHtml', () => {
  it('builds a self-contained report with header and escaped content', () => {
    const html = buildPrintHtml({
      events: [
        { ts: 0, type: 'nws_alert', callsign: '', summary: '<script>alert(1)</script>', details: 'a & b' },
        { ts: 3600000, type: 'net_checkin', callsign: 'K0CJH', summary: 'Checked in', details: '' },
      ],
      callsign: 'K0CJH',
      location: { lat: 39.0997, lon: -94.5786 },
      grid: 'EM29qb',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('K0CJH');
    expect(html).toContain('39.0997, -94.5786');
    expect(html).toContain('EM29qb');
    // Date range from first to last event
    expect(html).toContain('1970-01-01 00:00:00Z — 1970-01-01 01:00:00Z');
    // XSS-safe
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('handles an empty log gracefully', () => {
    const html = buildPrintHtml({ events: [], callsign: '' });
    expect(html).toContain('No events recorded');
    expect(html).toContain('N0CALL');
  });
});
