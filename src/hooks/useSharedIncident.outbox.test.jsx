/**
 * useSharedIncident — two joined tabs share one outbox in localStorage; only
 * one may send it at a time, and nothing goes out twice. Two hook instances
 * in one jsdom stand in for two tabs (same storage, no navigator.locks, so
 * the localStorage lease is used). The server answers slowly so the two
 * tabs' flushes overlap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSharedIncident } from './useSharedIncident.js';
import { SESSION_KEY, OUTBOX_KEY } from '../utils/incidentSync.js';
import { _resetForTests } from '../utils/incidentDocs.js';
import { _resetForTests as resetLog } from '../utils/emcommEventLog.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tabs = [];
let syncBodies;

function Tab({ index }) {
  tabs[index] = useSharedIncident({ callsign: 'K0CJH', localRoster: [], fieldReports: [], shelterReports: [] });
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('shared outbox across tabs', () => {
  let roots;

  beforeEach(async () => {
    localStorage.clear();
    _resetForTests();
    resetLog();
    syncBodies = [];
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ id: 'ABCDEFGH', key: 'JOINKEYJOINKEY22', role: 'operator', keyGen: 1, joinedAt: 1 }),
    );
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).endsWith('/sync')) {
        syncBodies.push(JSON.parse(opts.body));
        await wait(150); // slow server: the other tab tries while this one is sending
        return { ok: true, status: 200, json: async () => ({ ok: true, seq: 1, accepted: {} }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'ABCDEFGH', seq: 1, full: true, roster: [], events: [], reports: [], docs: [] }),
      };
    });
    roots = [0, 1].map(() => createRoot(document.createElement('div')));
    await act(async () => {
      roots.forEach((r, i) => r.render(<Tab index={i} />));
    });
  });

  afterEach(async () => {
    await act(async () => roots.forEach((r) => r.unmount()));
    vi.restoreAllMocks();
  });

  it('each record is sent once although both tabs queue and flush', async () => {
    await act(async () => {
      tabs[0].checkIn({ call: 'W1AW', status: 'At EOC' });
      tabs[1].checkIn({ call: 'K1ABC', status: 'Mobile' });
    });
    await act(async () => {
      await wait(2500); // debounce, overlapping flushes, the busy tab's retry
    });
    const sentEvents = syncBodies.flatMap((b) => (b.events || []).map((e) => e.id));
    const sentRoster = syncBodies.flatMap((b) => (b.roster || []).map((r) => r.call));
    expect(new Set(sentEvents).size).toBe(sentEvents.length); // no event twice
    expect(sentRoster.sort()).toEqual(['K1ABC', 'W1AW']); // both tabs' check-ins, once each
    expect(sentEvents.length).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull(); // everything acked
    expect(tabs[0].pending).toBe(0);
  });
});
