/**
 * useSharedIncident — a site flushing an hour-old ICS draft. The draft was
 * made from revision 1; meanwhile another site saved revision 3. The server
 * answers 409 with its copy: the hook shows theirs, keeps ours as a conflict
 * (Apply mine / Keep theirs), and the rest of the outbox is acked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSharedIncident } from './useSharedIncident.js';
import { SESSION_KEY, OUTBOX_KEY } from '../utils/incidentSync.js';
import * as incidentDocs from '../utils/incidentDocs.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let latest;
function Harness() {
  latest = useSharedIncident({ callsign: 'K0CJH', localRoster: [], fieldReports: [], shelterReports: [] });
  return null;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const drafts = (name) => ({ header: { incidentName: name } });

describe('stale shared draft', () => {
  let root;
  let sent;

  beforeEach(async () => {
    localStorage.clear();
    incidentDocs._resetForTests();
    sent = [];
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ id: 'ABCDEFGH', key: 'JOINKEYJOINKEY22', role: 'operator', keyGen: 1, joinedAt: 1 }),
    );
    const south = { id: 'ics-drafts', data: drafts('South, newer'), docRev: 3, by: 'W1AW' };
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).endsWith('/sync')) {
        const body = JSON.parse(opts.body);
        sent.push(body);
        return {
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            accepted: { roster: 0, events: (body.events || []).length, reports: 0, docs: 0, board: false },
            docRevs: {},
            conflicts: [{ id: 'ics-drafts', baseRev: 1, current: south }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'ABCDEFGH',
          seq: 1,
          full: true,
          roster: [],
          events: [],
          reports: [],
          docs: [{ id: 'ics-drafts', data: drafts('start'), docRev: 1 }],
        }),
      };
    });
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness />));
    await act(async () => wait(50)); // first poll: documents known, sharing attached
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  it('is refused, theirs is shown and ours is kept for Apply mine', async () => {
    expect(incidentDocs.isSharing()).toBe(true);
    await act(async () => {
      incidentDocs.saveDoc('ics-drafts', drafts('North, an hour old'));
    });
    await act(async () => wait(1500)); // debounce + send
    const docSent = sent.flatMap((b) => b.docs || []);
    expect(docSent).toEqual([expect.objectContaining({ id: 'ics-drafts', baseRev: 1 })]);
    expect(incidentDocs.loadDoc('ics-drafts').header.incidentName).toBe('South, newer');
    expect(incidentDocs.getDocConflict('ics-drafts')).toMatchObject({
      mine: drafts('North, an hour old'),
      theirsRev: 3,
      by: 'W1AW',
    });
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull(); // nothing left to resend
    expect(latest.pending).toBe(0);
  });
});
